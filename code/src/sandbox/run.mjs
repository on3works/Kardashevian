import { RunStopped } from '../stop.mjs';
import { generateWorld, generateLayout, SANDBOX_PROTOCOL, MAX_TIME, ARENA } from './world.mjs';
import { BASELINES, practiceRun, evaluate, sandboxPrompt, parseSandboxReply } from './runner.mjs';
import { publicBrief } from './world.mjs';
import { EXPEDITION_PROTOCOL, SIZE, MISSION, generateExpedition, generateCourse, expeditionBrief } from './expedition.mjs';
import { EXPEDITION_BASELINES, expeditionReferences, expeditionPractice, expeditionEvaluate, expeditionPrompt } from './runner.mjs';

export const SANDBOX_ATTEMPTS = 8;
// Reasoning tokens count against this ceiling. 12k was not enough in v1; on
// the harder v2 world 32k was not either (GPT-5.6 Luna ran out in 6 of 8
// attempts), and at 64k MiMo still ran out in 3 of 7 attempts after 25-35
// minutes of thinking. Since 19 Oct every arena uses 128k, the largest
// output every model's API accepts (Haiku 5.5 128k, GPT-6 Luna 128k, MiMo
// 131k, DeepSeek 384k): models cannot track their own token count, so the
// ceiling should almost never be what decides an answer. If a provider
// refuses it, the attempt is asked again once at 64k.
export const MAX_OUTPUT_TOKENS = 128000;
// Each provider's own output ceiling, used where a model may think as long as it
// likes (Structures). MiMo V2.6 Pro allows 131,072; the rest stay at 128,000.
export const PROVIDER_MAX_OUTPUT = { mimo: 131072 };
export const maxOutputFor = provider => PROVIDER_MAX_OUTPUT[provider] || MAX_OUTPUT_TOKENS;
const FALLBACK_OUTPUT_TOKENS = 65536;

// New worlds are expeditions (sandbox-v3). Rover worlds (sandbox-v2) already
// stored keep running, resuming and showing exactly as before.
export function newSandboxInput({ models, seed, providerSnapshot, asOf, family = 'expedition' }) {
  if (family === 'rover') return { protocol: SANDBOX_PROTOCOL, family: 'rover', seed, attempts: SANDBOX_ATTEMPTS, maxOutputTokens: MAX_OUTPUT_TOKENS, models, providerSnapshot, asOf };
  return { protocol: EXPEDITION_PROTOCOL, family: 'expedition', seed, attempts: SANDBOX_ATTEMPTS, maxOutputTokens: MAX_OUTPUT_TOKENS, models, providerSnapshot, asOf };
}
export const isExpedition = run => run.input?.family === 'expedition';

// Public view: hidden physics stay hidden until every model has finished.
export function publicSandboxView(run, humans = []) {
  const done = run.status === 'complete';
  const base = { id: run.id, status: run.status, error: run.error, created_at: run.created_at, result: run.result, humans: Object.fromEntries(humans.map(h => [h.player, { attempts: h.attempts, final: h.final }])) };
  if (isExpedition(run)) {
    const c = generateCourse(run.input.seed, 0);
    // The Lab draws the practice course: rocks as obstacles, sites as checkpoints, the base as start and goal.
    const practice = { start: c.start, goal: c.base, checkpoints: c.sites.map(s => ({ x: s.x, y: s.y, value: s.value })), obstacles: c.rocks, sand: c.sand, hints: c.hints, totalValue: c.totalValue };
    return { ...base, input: { ...run.input, practice, arena: SIZE, maxTime: MISSION }, hidden: done ? { ...c.hidden, hills: c.hills, ice: [], faults: c.faults, storm: c.storm } : null, brief: expeditionBrief(run.input.attempts || SANDBOX_ATTEMPTS) };
  }
  const world = generateWorld(run.input.seed);
  return { ...base, input: { ...run.input, practice: generateLayout(run.input.seed, 0), arena: ARENA, maxTime: MAX_TIME }, hidden: done ? world.hidden : null, brief: publicBrief(run.input.attempts || SANDBOX_ATTEMPTS) };
}

// The two families differ only in their world, prompt and scoring.
function familyOf(run) {
  if (isExpedition(run)) {
    const world = generateExpedition(run.input.seed);
    const prepare = async () => { run.result.reference ||= await expeditionReferences(world); };
    return { world, baselines: EXPEDITION_BASELINES, floor: 0, prepare, practice: code => expeditionPractice(world, code, run.result.reference), evaluate: code => expeditionEvaluate(world, code, run.result.reference), prompt: (attempts, history) => expeditionPrompt(attempts, history, MAX_OUTPUT_TOKENS) };
  }
  const world = generateWorld(run.input.seed);
  return { world, baselines: BASELINES, floor: -15, prepare: async () => {}, practice: code => practiceRun(world, code), evaluate: code => evaluate(world, code), prompt: (attempts, history) => sandboxPrompt(world, attempts, history, MAX_OUTPUT_TOKENS) };
}

// Asks for one attempt, riding out provider trouble. None of these failures
// returns an answer, so the model learns nothing from them:
// - an interrupted call (server restart, dropped connection, timeout) is
//   asked again straight away under a new key;
// - a server error or rate limit (HTTP 5xx/429) is asked again after about
//   1, 5 and 15 minutes;
// - a provider that refuses the 128k ceiling is asked once at 64k.
// On resume, keys that already failed are skipped quickly for the same reason.
const RETRY_SUFFIXES = ['', ':retry', ':r2', ':r3', ':r4', ':r5', ':r6'];
export async function askWithRetries(run, provider, key, prompt, { call, retryDelayMs = 20_000, maxTokens = MAX_OUTPUT_TOKENS }) {
  const waits = [3, 15, 45].map(k => k * retryDelayMs);
  let serverErrors = 0;
  for (let i = 0; i < RETRY_SUFFIXES.length; i++) {
    try { return await call(run, provider, `${key}${RETRY_SUFFIXES[i]}`, prompt, maxTokens); }
    catch (e) {
      if (e?.code === 'provider_http' && e?.status === 400 && /token/i.test(String(e?.providerMessage || e?.message))) return call(run, provider, `${key}:smaller`, prompt, FALLBACK_OUTPUT_TOKENS);
      const serverError = e?.code === 'provider_http' && (e.status >= 500 || e.status === 429);
      const interrupted = /uncertain outcome/i.test(String(e?.message)) || ['provider_transport', 'provider_timeout'].includes(e?.code);
      if ((!serverError && !interrupted) || i === RETRY_SUFFIXES.length - 1) throw e;
      if (serverError) {
        if (serverErrors >= waits.length) throw e;
        await new Promise(resolve => setTimeout(resolve, waits[serverErrors++]));
      }
    }
  }
}

export async function sandboxRun(run, { call, save, retryDelayMs = 20_000 }) {
  const fam = familyOf(run);
  run.result.baselines ||= {};
  await fam.prepare();
  for (const [id, b] of Object.entries(fam.baselines)) {
    if (run.result.baselines[id]) continue;
    run.result.baselines[id] = { name: b.name, final: await fam.evaluate(b.code), practice: slim(await fam.practice(b.code)) };
  }
  run.result.players ||= {};
  await save(run);
  const attempts = run.input.attempts || SANDBOX_ATTEMPTS;
  await Promise.all(run.input.models.map(async provider => {
    const player = run.result.players[provider] ||= { attempts: [], final: null };
    // A model stopped earlier (for example by a server error) resumes here
    // after a restart; the old note no longer applies.
    if (player.attempts.length < attempts) delete player.stopped;
    while (player.attempts.length < attempts) {
      const n = player.attempts.length + 1;
      const prompt = fam.prompt(attempts, player.attempts);
      let entry;
      try {
        const response = await askWithRetries(run, provider, `${run.id}:sandbox:${provider}:${n}`, prompt, { call, retryDelayMs });
        const { code, hypothesis } = parseSandboxReply(response.text);
        // A reply cut off at the ceiling may hold half a function; say so
        // rather than reporting only the syntax error it causes.
        const cutOff = /length|incomplete|max_output/i.test(String(response.finishReason));
        if (!code) entry = { attempt: n, error: cutOff ? (response.text ? 'Reply was cut off at the output limit before the code was complete' : 'Used the whole output budget thinking and returned no code') : 'No function act(obs, mem) found in the reply', hypothesis, score: fam.floor, outcome: 'error', progress: 0, time: 0, finishReason: response.finishReason || null, outputTokens: response.outputTokens ?? null };
        else {
          entry = { attempt: n, code, hypothesis, ...(await fam.practice(code)) };
          if (cutOff && entry.outcome === 'error') entry.message = `Reply was cut off at the output limit, so the code is incomplete (${entry.message || 'error'})`;
        }
      } catch (e) {
        if (e instanceof RunStopped) throw e;
        // A failed or uncertain provider call ends this model's attempts; the
        // attempts already made still count.
        player.stopped = String(e.message || e).slice(0, 300);
        break;
      }
      player.attempts.push(entry);
      // Keep the trace only for the latest attempt and the path only for the
      // best one, so stored results stay small.
      const best = bestAttempt(player);
      for (const a of player.attempts) { if (a !== entry) { delete a.trace; delete a.events; } if (a !== best) delete a.path; }
      await save(run);
    }
    const best = bestAttempt(player);
    if (best?.code) player.final = { attempt: best.attempt, ...(await fam.evaluate(best.code)) };
    else player.final = { attempt: null, score: fam.floor, goals: 0, crashes: 0, runs: [] };
    await save(run);
  }));
  run.result.completedAt = new Date().toISOString();
}

function bestAttempt(player) {
  return player.attempts.filter(a => a.code).reduce((best, a) => (!best || a.score > best.score ? a : best), null);
}
function slim(r) { return { score: r.score, outcome: r.outcome, time: r.time, progress: r.progress, message: r.message, path: r.path }; }

// A person can play any world with the same brief, feedback and attempt
// budget as the models. Stored separately so the worker never overwrites it.
export async function humanAttempt(db, runId, { code, finish }, player = 'human') {
  const run = (await db.query("SELECT * FROM runs WHERE id=$1 AND kind='sandbox'", [runId])).rows[0];
  if (!run) { const e = new Error('World not found'); e.status = 404; throw e; }
  const fam = familyOf(run);
  if (isExpedition(run) && !run.result?.reference) { run.result ||= {}; await fam.prepare(); await db.query('UPDATE runs SET result=$2 WHERE id=$1', [runId, JSON.stringify(run.result)]); }
  const limit = run.input.attempts || SANDBOX_ATTEMPTS;
  const row = (await db.query('SELECT * FROM sandbox_humans WHERE run_id=$1 AND player=$2', [runId, player])).rows[0] || { attempts: [], final: null };
  if (row.final) { const e = new Error('You have already finished this world.'); e.status = 409; throw e; }
  const attempts = row.attempts;
  if (code != null) {
    if (attempts.length >= limit) { const e = new Error(`All ${limit} attempts are used. Finish to get your held-out score.`); e.status = 409; throw e; }
    const result = await fam.practice(code);
    attempts.push({ attempt: attempts.length + 1, code, ...result });
    const best = attempts.filter(a => a.code && a.outcome !== 'error').reduce((b, a) => (!b || a.score > b.score ? a : b), null);
    for (const a of attempts) { if (a !== attempts.at(-1)) { delete a.trace; delete a.events; } if (a !== best && a !== attempts.at(-1)) delete a.path; }
  }
  let final = null;
  if (finish || attempts.length >= limit) {
    const best = attempts.filter(a => a.code).reduce((b, a) => (!b || a.score > b.score ? a : b), null);
    final = best ? { attempt: best.attempt, ...(await fam.evaluate(best.code)) } : { attempt: null, score: fam.floor, goals: 0, crashes: 0, runs: [] };
  }
  await db.query('INSERT INTO sandbox_humans(run_id,player,attempts,final) VALUES($1,$2,$3,$4) ON CONFLICT (run_id,player) DO UPDATE SET attempts=$3, final=$4, updated_at=now()', [runId, player, JSON.stringify(attempts), final ? JSON.stringify(final) : null]);
  return { attempts, final, last: attempts.at(-1) || null };
}
