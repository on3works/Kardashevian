import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import { EVAL_VARIANTS, generateLayout, simulate, rng, publicBrief } from './world.mjs';
import { EVAL_COURSES, generateCourse, simulate as fly, referenceValue, expeditionBrief, EXPEDITION_BASELINES } from './expedition.mjs';

// Model-written controllers run inside QuickJS (a separate JavaScript engine
// compiled to WebAssembly). They have no access to Node, the network, the file
// system, the database or the simulator's hidden values: only the observation
// object is passed in, and only a { left, right } command comes back.
const MEMORY_LIMIT = 32 * 1024 * 1024;
const TICK_MS = 25;
const SETUP_MS = 200;
let quickjs;
async function engine() { return (quickjs ||= await getQuickJS()); }

export async function compileController(source, seed = 1, { maxChars = 40_000, tickMs = TICK_MS, memory = MEMORY_LIMIT, totalMs = Infinity } = {}) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('No controller code');
  if (source.length > maxChars) throw new Error(`Controller code is longer than ${maxChars.toLocaleString('en')} characters`);
  const q = await engine();
  const runtime = q.newRuntime();
  runtime.setMemoryLimit(memory);
  runtime.setMaxStackSize(512 * 1024);
  const vm = runtime.newContext();
  const dispose = () => { try { vm.dispose(); } catch {} try { runtime.dispose(); } catch {} };
  let spent = 0;
  const run = (code, ms) => {
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + ms));
    const result = vm.evalCode(code);
    if (result.error) { const err = vm.dump(result.error); result.error.dispose(); throw new Error(typeof err === 'object' ? `${err.name || 'Error'}: ${err.message || ''}` : String(err)); }
    const value = vm.dump(result.value); result.value.dispose();
    return value;
  };
  try {
    // A seeded Math.random keeps every run reproducible.
    const r = rng(seed);
    run(`(function(){ let s = ${Math.floor(r() * 2 ** 31)} >>> 0; Math.random = function(){ s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`, SETUP_MS);
    run(`${source}\n;if (typeof act !== 'function') throw new Error('Define function act(obs, mem)');\nvar __mem = {}; function __reset(){ __mem = {}; } function __step(s){ var o = act(JSON.parse(s), __mem); return JSON.stringify(o && typeof o === 'object' ? { left: +o.left, right: +o.right, drill: !!o.drill } : null); }`, SETUP_MS);
  } catch (e) { dispose(); throw e; }
  return {
    reset: () => run('__reset()', SETUP_MS),
    // Wall-clock time spent inside the controller, summed over the mission.
    step: obs => {
      const t0 = performance.now();
      const out = JSON.parse(run(`__step(${JSON.stringify(JSON.stringify(obs))})`, tickMs));
      if ((spent += performance.now() - t0) > totalMs) throw new Error(`Controller used more than ${Math.round(totalMs / 1000)} s of computing time in one mission`);
      return out;
    },
    dispose,
  };
}

async function episode(world, layout, source, opts) {
  const ctl = await compileController(source, world.seed + layout.variant);
  try { return simulate(world, layout, obs => ctl.step(obs), opts); }
  finally { ctl.dispose(); }
}

export async function practiceRun(world, source) {
  try { return await episode(world, generateLayout(world.seed, 0), source, { traceEvery: 10, pathEvery: 5 }); }
  catch (e) { return { score: -15, outcome: 'error', time: 0, progress: 0, message: String(e.message || e).slice(0, 300), trace: [], path: [] }; }
}

export async function evaluate(world, source, variants = EVAL_VARIANTS) {
  const runs = [];
  for (let v = 1; v <= variants; v++) {
    try { const r = await episode(world, generateLayout(world.seed, v), source, {}); runs.push({ variant: v, score: r.score, outcome: r.outcome, time: r.time, message: r.message }); }
    catch (e) { runs.push({ variant: v, score: -15, outcome: 'error', time: 0, message: String(e.message || e).slice(0, 200) }); }
  }
  const mean = runs.reduce((s, r) => s + r.score, 0) / runs.length;
  return { score: Math.round(mean * 100) / 100, goals: runs.filter(r => r.outcome === 'goal').length, crashes: runs.filter(r => r.outcome === 'crash' || r.outcome === 'error').length, runs };
}

// Reference players, scored on exactly the same courses as the models.
export const BASELINES = {
  idle: { name: 'Do nothing', code: 'function act(obs, mem) { return { left: 0, right: 0 }; }' },
  random: { name: 'Random', code: 'function act(obs, mem) { if (!mem.c || obs.t % 1 < 0.05) mem.c = { left: Math.random() * 2 - 1, right: Math.random() * 2 - 1 }; return mem.c; }' },
  reference: { name: 'Reference engineer', code: `function act(obs, mem) {
  // A careful but non-learning controller. Heads for the next target at
  // moderate speed; when something is close it turns toward the more open
  // side; when nearly touching it reverses and spins away. It never adapts to
  // the world's hidden physics.
  var r = obs.rays;
  var target = Math.atan2(obs.targetY - obs.y, obs.targetX - obs.x) * 180 / Math.PI;
  var err = ((target - obs.heading + 540) % 360) - 180;
  if (mem.back > 0) { mem.back--; return { left: -0.5, right: -0.5 }; }
  if (mem.spin > 0) { mem.spin--; return { left: -0.55 * mem.dir, right: 0.55 * mem.dir }; }
  var front = Math.min(r[1], r[2], r[3]);
  if (r[2] < 1.2 || r[1] < 0.9 || r[3] < 0.9) { mem.back = 8; mem.spin = 10; mem.dir = (r[0] + r[1] > r[3] + r[4]) ? -1 : 1; return { left: -0.5, right: -0.5 }; }
  var turn = front < 3.5 ? ((r[3] + r[4] > r[0] + r[1]) ? 0.9 : -0.9) : Math.max(-1, Math.min(1, err / 35));
  var base = front < 3.5 ? 0.4 : 0.55;
  return { left: base - turn * 0.4, right: base + turn * 0.4 };
}` },
};

export function sandboxPrompt(world, attempts, history, maxOutputTokens = 65536) {
  const lines = [publicBrief(attempts), '', `This is attempt ${history.length + 1} of ${attempts}.`];
  if (history.length) {
    lines.push('', 'Results so far on the practice course:');
    history.forEach((h, i) => lines.push(`Attempt ${i + 1}: ${h.error ? `invalid (${h.error})` : `${h.outcome}, score ${h.score}, time ${h.time} s, checkpoints ${h.checkpoints ?? '?'}, ${Math.round(h.progress * 100)}% of the course${h.message ? `, ${h.message}` : ''}`}${h.hypothesis ? ` · your note: ${h.hypothesis}` : ''}`));
    const recent = history.slice(-2).filter(h => h.code);
    for (const h of recent) lines.push('', `Code of attempt ${h.attempt}:`, '```javascript', h.code, '```');
    const last = [...history].reverse().find(h => h.trace?.length);
    if (last) {
      lines.push('', `Trace of attempt ${last.attempt} (every 0.5 s): t,x,y,heading,speed,rays(-60|-30|0|30|60),targetIndex,left,right`);
      for (const p of last.trace) lines.push([p.t, p.x, p.y, p.heading, p.speed, p.rays, p.target, p.left, p.right].join(','));
    }
  }
  lines.push('', `Budget: each reply may use at most ${maxOutputTokens.toLocaleString('en')} output tokens, and your reasoning counts toward it. A reply that runs out before the code block is finished scores as a failed attempt. Test an idea rather than perfecting it in your head; you get feedback and more attempts. Write the code block before any long explanation.`, '', 'Reply in exactly this format:', 'NOTE: one sentence on what you believe about this world and what you are changing', '```javascript', 'function act(obs, mem) { ... }', '```');
  return lines.join('\n');
}

export function parseSandboxReply(text) {
  if (typeof text !== 'string') return { code: null, hypothesis: null };
  const blocks = [...text.matchAll(/```(?:javascript|js)?\s*\n([\s\S]*?)```/gi)].map(m => m[1]);
  const code = blocks.find(b => /function\s+act\s*\(/.test(b)) || (/function\s+act\s*\(/.test(text) ? text.slice(text.search(/function\s+act\s*\(/)) : null);
  const note = text.match(/NOTE:\s*(.+)/i)?.[1]?.trim().slice(0, 300) || null;
  return { code: code?.trim() || null, hypothesis: note };
}

// ---------------------------------------------------------------------------
// Expedition (sandbox-v3). Bigger controllers and more time per tick, because
// mapping and planning are part of the task.
const EXPEDITION_LIMITS = { maxChars: 120_000, tickMs: 50, memory: 96 * 1024 * 1024, totalMs: 60_000 };
export { EXPEDITION_BASELINES };

// What 100 means on each course: the full-knowledge planner's delivery.
// Computed once per world and stored with it, so scores are reproducible.
export async function expeditionReferences(world, courses = EVAL_COURSES) {
  const out = {};
  for (let v = 0; v <= courses; v++) {
    out[v] = referenceValue(world, generateCourse(world.seed, v));
    await new Promise(resolve => setImmediate(resolve)); // about 2 s of computing per course: let the server breathe
  }
  return out;
}
async function mission(world, variant, source, refs, opts) {
  const course = generateCourse(world.seed, variant);
  const ctl = await compileController(source, world.seed + variant, EXPEDITION_LIMITS);
  try { return fly(world, course, obs => ctl.step(obs), { ...opts, reference: refs[variant] }); }
  finally { ctl.dispose(); }
}
export async function expeditionPractice(world, source, refs) {
  try { return await mission(world, 0, source, refs, { traceEvery: 50, pathEvery: 20 }); }
  catch (e) { return { score: 0, delivered: 0, outcome: 'error', time: 0, progress: 0, message: String(e.message || e).slice(0, 300), events: [], trace: [], path: [] }; }
}
export async function expeditionEvaluate(world, source, refs, courses = EVAL_COURSES) {
  const runs = [];
  for (let v = 1; v <= courses; v++) {
    try { const r = await mission(world, v, source, refs, {}); runs.push({ variant: v, score: r.score, delivered: r.delivered, outcome: r.outcome, time: r.time, lost: r.lost, message: r.message }); }
    catch (e) { runs.push({ variant: v, score: 0, delivered: 0, outcome: 'error', time: 0, lost: 0, message: String(e.message || e).slice(0, 200) }); }
  }
  const mean = runs.reduce((s, r) => s + r.score, 0) / runs.length;
  // `goals` counts courses where the controller matched the planner; `crashes` counts lost rovers.
  return { score: Math.round(mean * 100) / 100, goals: runs.filter(r => r.score >= 100).length, crashes: runs.filter(r => r.outcome !== 'complete').length, runs };
}

export function expeditionPrompt(attempts, history, maxOutputTokens) {
  const lines = [expeditionBrief(attempts), '', `This is attempt ${history.length + 1} of ${attempts}.`];
  if (history.length) {
    lines.push('', 'Results so far on the practice course:');
    history.forEach((h, i) => lines.push(`Attempt ${i + 1}: ${h.error ? `invalid (${h.error})` : `score ${h.score} (delivered ${h.delivered} in ${h.samples ?? 0} samples; lost ${h.lost ?? 0} still on board), ended ${h.outcome} at ${h.time} s${h.message ? ` (${h.message})` : ''}, drove ${h.distance ?? 0} m, ${h.sandSeconds ?? 0} s in sand, ${h.bumps ?? 0} bumps, battery left ${Math.round((h.batteryLeft ?? 0) * 100)}%`}${h.outputTokens ? ` · used ${h.outputTokens.toLocaleString('en')} output tokens` : ''}${h.hypothesis ? ` · your note: ${h.hypothesis}` : ''}`));
    const recent = history.slice(-2).filter(h => h.code);
    for (const h of recent) lines.push('', `Code of attempt ${h.attempt}:`, '```javascript', h.code, '```');
    const last = [...history].reverse().find(h => h.trace?.length);
    if (last) {
      lines.push('', `Event log of attempt ${last.attempt}:`, ...(last.events?.length ? last.events.map(e => `${e.t} s: ${e.what}`) : ['(nothing sampled or delivered)']));
      lines.push('', `Trace of attempt ${last.attempt} (every 5 s): t,x,y,heading,wheelLeft,wheelRight,pitch,minRay,battery,solar,carried,delivered,science,left,right,drill`);
      for (const p of last.trace) lines.push([p.t, p.x, p.y, p.heading, p.wl, p.wr, p.pitch, p.minRay, p.battery, p.solar, p.carried, p.delivered, p.science, p.left, p.right, p.drill].join(','));
    }
  }
  lines.push('', `Budget: each reply may use at most ${maxOutputTokens.toLocaleString('en')} output tokens, and your reasoning counts toward it. A reply that runs out before the code block is finished scores as a failed attempt. Write the code block before any long explanation.`, '', 'Reply in exactly this format:', 'NOTE: one sentence on what you believe about this world and what you are changing', '```javascript', 'function act(obs, mem) { ... }', '```');
  return lines.join('\n');
}
