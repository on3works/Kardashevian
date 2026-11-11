import { RunStopped } from '../../stop.mjs';
import { STRUCTURES_PROTOCOL, SECTIONS, NOMINAL, TOLERANCE, SAFETY, DEFLECTION_RATIO, MIN_MEMBER, MAX_MEMBER, MAX_NODES, MAX_MEMBERS, JOINT_KG, HELD_OUT_UNITS, CASES_PER_UNIT, generateSite, heldOutUnits } from './site.mjs';
import { validateDesign, analyse, DesignError } from './solver.mjs';
import { parDesign, referenceDesign } from './par.mjs';
import { askWithRetries, MAX_OUTPUT_TOKENS } from '../../sandbox/run.mjs';

export const STRUCTURES_ATTEMPTS = 8;
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const fmtKg = v => Math.round(v).toLocaleString('en');

// Every seed is checked to have a deliverable par design; in the rare case it
// does not, the next seed is used.
export function usableSeed(seed) {
  for (let s = seed, i = 0; i < 50; i++, s = (s % (2 ** 31 - 2)) + 1) if (parDesign(generateSite(s))) return s;
  throw new Error('Could not generate a solvable site');
}

export function newStructuresInput({ models, seed, providerSnapshot, asOf }) {
  return { protocol: STRUCTURES_PROTOCOL, family: 'truss', seed: usableSeed(seed), attempts: STRUCTURES_ATTEMPTS, maxOutputTokens: MAX_OUTPUT_TOKENS, models, providerSnapshot, asOf };
}

export function structuresBrief(site, attempts, parMass) {
  const v = site.loads.vehicle, k = site.keepOut;
  const sup = site.supports.map(s => `${s.id} at (${s.x}, ${s.y}) ${s.type === 'pin' ? 'pinned (holds x and y)' : 'roller (holds y only)'}`).join('; ');
  const sections = SECTIONS.map(s => `  ${s.id}: A ${round(s.A * 1e4, 2)} cm², I ${round(s.I * 1e8, 1)} cm⁴, ${s.kgPerM} kg/m`).join('\n');
  const cases = site.designCases.map(c => `  ${c.id}: ${c.vehicle ? `${c.vehicle.weight} kN vehicle centred at x = ${c.vehicle.center} m, axles ${c.vehicle.spacing} m apart, front axle toward ${c.vehicle.dir > 0 ? '+x' : '-x'}` : 'no vehicle'}; wind ${c.wind} kN/m`).join('\n');
  return `Kardashevian lab · Lightest Structure (truss bridge, ${STRUCTURES_PROTOCOL})
Design a steel truss bridge, seen in elevation (2D), that carries every load below at the lowest possible mass. x runs along the bridge in metres, y is up, the deck is at y = 0.

SITE
- Span ${site.span} m. Fixed deck nodes, which carry the loads: ${site.deck.map(d => `${d.id} (${d.x}, 0)`).join(', ')}.
- Supports: ${sup}.
- Nodes and members must stay inside x ${site.region.xMin}..${site.region.xMax}, y ${site.region.yMin}..${site.region.yMax}${site.region.yMax === 0 ? ' (nothing may stand above the deck)' : ''}${site.region.yMin === 0 ? ' (nothing may hang below the deck)' : ''}.
${k ? `- Clearance zone: nothing may enter x ${k.x0}..${k.x1}, y ${k.y0}..${k.y1} (members may touch its edges, not cross it).` : '- No clearance zone.'}

LOADS (kN; all act on the deck nodes; stringers span between deck nodes, so an axle between two deck nodes is shared between them by distance)
- Dead load ${site.loads.deadKNm} kN/m along the deck, always present. Your structure's own weight is added automatically (members ${NOMINAL.density} kg/m³, plus ${JOINT_KG} kg of connection steel per node).
- One vehicle with two axles, front axle carrying ${v.frontShare * 100}% of its weight: weight anywhere from ${v.weightMin} to ${v.weightMax} kN, axle spacing ${v.spacingMin} to ${v.spacingMax} m, either direction, anywhere with both axles on the deck. It may also be absent.
- Wind: horizontal on the deck, any value from -${site.loads.windKNm} to +${site.loads.windKNm} kN/m.
Published design cases (you get results for these after each attempt):
${cases}

STEEL AND CHECKS
- Nominal steel: yield ${NOMINAL.fy} MPa, E ${NOMINAL.E.toLocaleString('en')} MPa. Every built bridge's steel varies: yield ${TOLERANCE.fyMin * 100}% to ${TOLERANCE.fyMax * 100}% of nominal, E ${TOLERANCE.EMin * 100}% to ${TOLERANCE.EMax * 100}%. Practice results use nominal steel.
- Members are pin-ended and carry axial force only. Each member must satisfy, with a safety factor of ${SAFETY}: |force| ≤ yield × area / ${SAFETY}, and in compression also |force| ≤ π² E I / L² / ${SAFETY} (Euler buckling, full member length).
- The deck may sag at most span / ${DEFLECTION_RATIO} = ${round(site.span / DEFLECTION_RATIO * 1000, 1)} mm under any load.
- The structure must be stable (no mechanism). Members ${MIN_MEMBER} m to ${MAX_MEMBER} m long; at most ${MAX_NODES} nodes including the deck nodes and supports, and ${MAX_MEMBERS} members. Members may cross each other without a node (they pass in different planes).
Sections (circular hollow sections, outer diameter x wall in mm):
${sections}

SCORING
You get ${attempts} attempts. After each one you see its mass, its score and an analysis report on the published cases. Your best practice design is then built ${HELD_OUT_UNITS} times, each unit with its own steel inside the tolerance and its own ${CASES_PER_UNIT} unseen load cases from the ranges above. A unit that fails any check counts as a collapse and scores 0; a unit that holds scores 100 × par mass ÷ your mass. Par for this site is ${parMass ? `${fmtKg(parMass)} kg` : 'set by our optimizer'}: our optimizer's lightest design that holds everything. You can beat par; there is no ceiling. Design for the full ranges and the weakest steel, not only the published cases.`;
}

export function structuresPrompt(site, attempts, history, parMass, maxOutputTokens = MAX_OUTPUT_TOKENS) {
  const lines = [structuresBrief(site, attempts, parMass), '', `This is attempt ${history.length + 1} of ${attempts}.`];
  if (history.length) {
    lines.push('', 'Results so far (nominal steel, published cases):');
    history.forEach(h => lines.push(`Attempt ${h.attempt}: ${h.error ? `invalid (${h.error})` : `${fmtKg(h.mass)} kg, ${h.ok ? 'holds every published case' : `fails (${h.failure})`}, score ${h.score}`}${h.note ? ` · your note: ${h.note}` : ''}`));
    const recent = history.slice(-2).filter(h => h.design);
    for (const h of recent) lines.push('', `Design of attempt ${h.attempt}:`, '```json', JSON.stringify(h.design), '```');
    const last = [...history].reverse().find(h => h.report);
    if (last) lines.push('', `Analysis of attempt ${last.attempt}:`, last.report);
  }
  lines.push('', `Budget: each reply may use at most ${maxOutputTokens.toLocaleString('en')} output tokens, and your reasoning counts toward it. A reply that runs out before the JSON is complete scores as a failed attempt. Write the design before any long explanation.`, '', 'Reply with one JSON object in a ```json block:', '{"note": "one sentence on your idea and what you changed", "nodes": [{"id": "T1", "x": 3.5, "y": 2.0}, ...], "members": [["D0", "T1", "CHS114.3x5"], ...]}', 'List only your own nodes in "nodes"; the deck nodes and supports already exist and can be used by id.');
  return lines.join('\n');
}

export function parseStructuresReply(text) {
  if (typeof text !== 'string') return { design: null, note: null, error: 'Empty reply' };
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)].map(m => m[1]);
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start >= 0 && end > start) blocks.push(text.slice(start, end + 1));
  for (const b of blocks) {
    try {
      const obj = JSON.parse(b);
      if (obj && typeof obj === 'object' && Array.isArray(obj.members)) return { design: { nodes: Array.isArray(obj.nodes) ? obj.nodes : [], members: obj.members }, note: typeof obj.note === 'string' ? obj.note.slice(0, 300) : null, error: null };
    } catch {}
  }
  return { design: null, note: null, error: 'No JSON design with "members" found in the reply' };
}

const label = (d, i) => `${d.members[i].a}-${d.members[i].b}`;

function reportOf(site, design, res) {
  const lines = ['case | max utilisation | governing member (mode) | deck sag mm (limit ' + round(res.deflectionLimit * 1000, 1) + ')'];
  for (const c of res.cases) lines.push(`${c.id} | ${res.mechanism ? 'mechanism' : c.maxUtil} | ${c.governing != null ? `${label(design, c.governing)} (${c.mode})` : '-'} | ${c.deflection != null ? round(c.deflection * 1000, 1) : '-'}`);
  if (!res.mechanism) {
    const top = res.members.map((m, i) => ({ ...m, i })).sort((a, b) => b.util - a.util).slice(0, 15);
    lines.push('', 'Most loaded members: member | section | length m | max tension kN | max compression kN | utilisation (mode, case)');
    for (const m of top) lines.push(`${label(design, m.i)} | ${design.members[m.i].section} | ${round(design.members[m.i].len, 2)} | ${round(m.tension)} | ${round(m.compression)} | ${round(m.util, 3)} (${m.mode}, ${m.case})`);
  } else lines.push('', 'The structure is a mechanism: at least one node or part can move without stretching any member. Add members to triangulate it.');
  return lines.join('\n');
}

function failureOf(design, res) {
  if (res.mechanism) return 'mechanism';
  const bad = res.cases.filter(c => !c.ok);
  const worst = bad.reduce((a, b) => (b.maxUtil > a.maxUtil ? b : a), bad[0]);
  if (worst.maxUtil > 1) return `${worst.id}: ${label(design, worst.governing)} at ${worst.maxUtil}× capacity (${worst.mode})`;
  return `${worst.id}: deck sags ${round(worst.deflection * 1000, 1)} mm, limit ${round(res.deflectionLimit * 1000, 1)} mm`;
}

// One practice attempt: validate, analyse the published cases on nominal
// steel, score against par.
export function practice(site, raw, parMass) {
  let design;
  try { design = validateDesign(site, raw); }
  catch (e) { if (e instanceof DesignError) return { ok: false, error: e.message, score: 0 }; throw e; }
  const res = analyse(site, design, site.designCases, { fyF: 1, EF: 1 });
  return {
    ok: res.ok, mass: round(res.mass), score: res.ok ? round(100 * parMass / res.mass, 2) : 0,
    maxUtil: res.mechanism ? null : round(Math.max(...res.members.map(m => m.util)), 3),
    maxSag: res.mechanism ? null : round(Math.max(...res.cases.map(c => c.deflection)) * 1000, 1),
    failure: res.ok ? null : failureOf(design, res),
    utils: res.mechanism ? null : res.members.map(m => round(m.util, 3)),
    report: reportOf(site, design, res),
  };
}

// Held-out: the design is built HELD_OUT_UNITS times with secret steel and
// secret load cases.
export function evaluateHeldOut(site, raw, parMass) {
  let design;
  try { design = validateDesign(site, raw); } catch (e) { return { score: 0, delivered: 0, mass: null, units: [], error: e.message }; }
  const units = heldOutUnits(site).map(u => {
    const res = analyse(site, design, u.cases, u.material);
    const ok = res.ok;
    return { unit: u.unit, ok, score: ok ? round(100 * parMass / res.mass, 2) : 0, failure: ok ? null : failureOf(design, res) };
  });
  const mass = analyse(site, design, [], { fyF: 1, EF: 1 }).mass;
  return { score: round(units.reduce((s, u) => s + u.score, 0) / units.length, 2), delivered: units.filter(u => u.ok).length, mass: round(mass), units };
}

function bestAttempt(player) {
  return player.attempts.filter(a => a.design && !a.error).reduce((best, a) => (!best || a.score > best.score || (a.score === best.score && (a.maxUtil ?? 99) < (best.maxUtil ?? 99)) ? a : best), null);
}

export async function structuresRun(run, { call, save, retryDelayMs = 20_000 }) {
  const site = generateSite(run.input.seed);
  if (!run.result.par) {
    const par = parDesign(site);
    if (!par) throw new Error('No par design for this site');
    run.result.par = { mass: par.mass, layout: par.layout, design: par.design };
  }
  const parMass = run.result.par.mass;
  run.result.baselines ||= {};
  if (!run.result.baselines.reference) {
    const ref = referenceDesign(site);
    if (ref) run.result.baselines.reference = { name: 'Reference engineer', design: ref.design, layout: ref.layout, practice: slim(practice(site, ref.design, parMass)), final: evaluateHeldOut(site, ref.design, parMass) };
  }
  run.result.players ||= {};
  await save(run);
  const attempts = run.input.attempts || STRUCTURES_ATTEMPTS;
  await Promise.all(run.input.models.map(async provider => {
    const player = run.result.players[provider] ||= { attempts: [], final: null };
    if (player.attempts.length < attempts) delete player.stopped;
    while (player.attempts.length < attempts) {
      const n = player.attempts.length + 1;
      const prompt = structuresPrompt(site, attempts, player.attempts, parMass, MAX_OUTPUT_TOKENS);
      let entry;
      try {
        const response = await askWithRetries(run, provider, `${run.id}:structures:${provider}:${n}`, prompt, { call, retryDelayMs });
        const parsed = parseStructuresReply(response.text);
        const cutOff = /length|incomplete|max_output/i.test(String(response.finishReason));
        if (!parsed.design) entry = { attempt: n, note: parsed.note, error: cutOff ? 'Reply was cut off at the output limit before the design was complete' : parsed.error, score: 0, finishReason: response.finishReason || null, outputTokens: response.outputTokens ?? null };
        else entry = { attempt: n, note: parsed.note, design: parsed.design, ...practice(site, parsed.design, parMass) };
      } catch (e) {
        if (e instanceof RunStopped) throw e;
        player.stopped = String(e.message || e).slice(0, 300);
        break;
      }
      player.attempts.push(entry);
      // Keep the full report only for the latest attempt.
      for (const a of player.attempts) if (a !== entry) delete a.report;
      await save(run);
    }
    const best = bestAttempt(player);
    player.final = best ? { attempt: best.attempt, ...evaluateHeldOut(site, best.design, parMass) } : { attempt: null, score: 0, delivered: 0, mass: null, units: [] };
    await save(run);
  }));
  run.result.completedAt = new Date().toISOString();
}

function slim(p) { const { report, ...rest } = p; return rest; }

// Public view: the held-out units and par design stay hidden until every
// model has finished.
export function publicStructuresView(run) {
  const done = run.status === 'complete';
  const site = generateSite(run.input.seed);
  const result = { ...run.result };
  if (!done && result.par) result.par = { mass: result.par.mass };
  if (result.players) result.players = Object.fromEntries(Object.entries(result.players).map(([id, p]) => [id, { ...p, attempts: p.attempts.map(a => { const { report, ...rest } = a; return rest; }) }]));
  return {
    id: run.id, status: run.status, error: run.error, created_at: run.created_at,
    input: run.input, site,
    heldOut: done ? heldOutUnits(site) : null,
    brief: structuresBrief(site, run.input.attempts || STRUCTURES_ATTEMPTS, run.result.par?.mass),
    result,
  };
}
