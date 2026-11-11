import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, generateLayout, simulate } from '../src/sandbox/world.mjs';
import { BASELINES, evaluate, practiceRun, parseSandboxReply, sandboxPrompt } from '../src/sandbox/runner.mjs';
import { sandboxRun, humanAttempt, publicSandboxView } from '../src/sandbox/run.mjs';
import { isoWeek, maybeWeeklyBook } from '../src/books.mjs';
import { classifyCall } from '../src/spend.mjs';

test('worlds and courses are deterministic per seed', () => {
  assert.deepEqual(generateWorld(42), generateWorld(42));
  assert.notDeepEqual(generateWorld(42).hidden, generateWorld(43).hidden);
  assert.deepEqual(generateLayout(42, 3), generateLayout(42, 3));
  const w = generateWorld(42), l = generateLayout(42, 0);
  const a = simulate(w, l, () => ({ left: 0.6, right: 0.6 })), b = simulate(w, l, () => ({ left: 0.6, right: 0.6 }));
  assert.deepEqual(a, b);
});

test('reference controller beats doing nothing and random on average', async () => {
  const totals = { idle: 0, random: 0, reference: 0 };
  for (const seed of [11, 202, 44, 5]) {
    const w = generateWorld(seed);
    for (const id of Object.keys(totals)) totals[id] += (await evaluate(w, BASELINES[id].code, 4)).score;
  }
  // v2 is deliberately hard: the reference is only a modest yardstick.
  assert.ok(totals.idle > -40); // only hills can move a parked rover (wind needs motion)
  assert.ok(totals.reference > totals.random + 40);
  assert.ok(totals.reference > totals.idle + 30);
});

test('controllers are sandboxed: no Node access, runaway loops are stopped', async () => {
  const w = generateWorld(7);
  const escape = await practiceRun(w, 'function act(o){ if (typeof process !== "undefined" || typeof require !== "undefined") return { left: 1, right: -1 }; return { left: 0, right: 0 }; }');
  assert.equal(escape.outcome, 'timeout');
  assert.equal(escape.score, 0);
  const loop = await practiceRun(w, 'function act(o){ while (true) {} }');
  assert.equal(loop.outcome, 'error');
  assert.match(loop.message, /interrupted/);
  const missing = await practiceRun(w, 'var x = 1;');
  assert.equal(missing.outcome, 'error');
});

test('replies are parsed and the prompt never reveals hidden physics', () => {
  const parsed = parseSandboxReply('NOTE: left motor looks weak\n```javascript\nfunction act(obs, mem) { return { left: 1, right: 0.9 }; }\n```');
  assert.equal(parsed.hypothesis, 'left motor looks weak');
  assert.match(parsed.code, /^function act/);
  const w = generateWorld(99);
  const prompt = sandboxPrompt(w, 8, []);
  for (const value of [w.hidden.leftMotorGain, w.hidden.compassBiasDeg, w.hidden.rangeBias, w.hidden.traction]) assert.ok(!prompt.includes(String(value)));
});

test('a sandbox run scores every model on held-out courses and records costs by attempt', async () => {
  const run = { id: 'run-1', input: { seed: 555, models: ['openai', 'mimo'], attempts: 3 }, result: {} };
  const keys = [];
  const call = async (r, provider, key) => { keys.push(key); return { text: `NOTE: steer to goal\n\`\`\`javascript\n${BASELINES.reference.code}\n\`\`\`` }; };
  await sandboxRun(run, { call, save: async () => {} });
  assert.equal(keys.length, 6);
  assert.equal(classifyCall(keys[0]).experiment, 'sandbox');
  for (const id of ['openai', 'mimo']) {
    assert.equal(run.result.players[id].attempts.length, 3);
    assert.equal(run.result.players[id].final.runs.length, 10);
  }
  assert.ok(run.result.baselines.reference.final.score > run.result.baselines.idle.final.score);
});

test('weekly book runs once per ISO week, only when switched on', async () => {
  assert.equal(isoWeek(new Date('2026-09-29T08:00:00Z')), '2026-W40');
  const queries = [];
  const settings = { weekly_books: false };
  const db = { query: async (sql) => { queries.push(sql); return { rows: [settings] }; } };
  assert.equal(await maybeWeeklyBook(new Date('2026-09-29T08:00:00Z'), db), null);
  assert.equal(await maybeWeeklyBook(new Date('2026-09-28T08:00:00Z'), db), null); // Monday
  assert.equal(await maybeWeeklyBook(new Date('2026-09-29T06:00:00Z'), db), null); // before 07:00 UTC
});

test('a person gets the same brief, feedback and attempt budget, stored apart from the models', async () => {
  const run = { id: 'w', kind: 'sandbox', status: 'running', input: { seed: 77, attempts: 2, models: [] }, result: {} };
  let stored = null;
  const db = { query: async (sql, args) => {
    if (sql.startsWith('SELECT * FROM runs')) return { rows: [run] };
    if (sql.startsWith('SELECT * FROM sandbox_humans')) return { rows: stored ? [stored] : [] };
    if (sql.startsWith('INSERT INTO sandbox_humans')) { stored = { attempts: JSON.parse(args[2]), final: args[3] ? JSON.parse(args[3]) : null }; return { rows: [] }; }
    throw new Error(sql);
  } };
  const first = await humanAttempt(db, 'w', { code: BASELINES.reference.code });
  assert.equal(first.attempts.length, 1);
  assert.ok(first.last.trace.length > 10);
  assert.equal(first.final, null);
  const second = await humanAttempt(db, 'w', { code: 'function act(o){ return { left: 0.5, right: 0.5 }; }' });
  assert.equal(second.final.runs.length, 10); // budget used up: scored on held-out courses
  await assert.rejects(() => humanAttempt(db, 'w', { code: 'x' }), /already finished/);
  const view = publicSandboxView(run, [{ player: 'human', ...stored }]);
  assert.equal(view.hidden, null); // hidden physics stay hidden while the world is running
  assert.match(view.brief, /function act\(obs, mem\)/);
  assert.equal(view.humans.human.attempts.length, 2);
});

test('a sandbox attempt interrupted by a restart is asked again once; empty replies are explained', async () => {
  const run = { id: 'run-2', input: { seed: 9, models: ['openai'], attempts: 2 }, result: {} };
  const keys = [];
  const call = async (r, provider, key) => {
    keys.push(key);
    if (key.endsWith(':1')) throw new Error('An earlier provider request has an uncertain outcome. Manual review required; no automatic retry.');
    if (key.endsWith(':2')) return { text: '', finishReason: 'incomplete', outputTokens: 32768 };
    return { text: `\`\`\`javascript\n${BASELINES.reference.code}\n\`\`\`` };
  };
  await sandboxRun(run, { call, save: async () => {} });
  assert.deepEqual(keys, ['run-2:sandbox:openai:1', 'run-2:sandbox:openai:1:retry', 'run-2:sandbox:openai:2']);
  const [first, second] = run.result.players.openai.attempts;
  assert.ok(first.code);
  assert.equal(second.error, 'Used the whole output budget thinking and returned no code');
});

test('v2 courses are solvable, and unseen courses vary in style', async () => {
  const { generateLayout, SANDBOX_PROTOCOL } = await import('../src/sandbox/world.mjs');
  assert.equal(SANDBOX_PROTOCOL, 'sandbox-v2');
  const styles = new Set();
  for (let v = 0; v <= 10; v++) {
    const L = generateLayout(777, v);
    assert.ok(L.obstacles.length > 20);
    assert.ok(L.checkpoints.length >= 1);
    if (v) styles.add(JSON.stringify(L.style));
  }
  assert.ok(styles.size >= 8);
  assert.deepEqual(generateLayout(777, 0), generateLayout(777, 0));
});

test('sandbox gives 128k output tokens, falls back to 64k if refused, and explains cut-off code', async () => {
  const { MAX_OUTPUT_TOKENS } = await import('../src/sandbox/run.mjs');
  assert.equal(MAX_OUTPUT_TOKENS, 128000);
  const run = { id: 'run-3', input: { seed: 5, models: ['openai'], attempts: 2 }, result: {} };
  const seen = [];
  const call = async (r, provider, key, prompt, maxTokens) => {
    seen.push([key, maxTokens]);
    if (key.endsWith(':1')) { const e = new Error('HTTP 400'); e.code = 'provider_http'; e.status = 400; e.providerMessage = 'max_output_tokens is too large'; throw e; }
    if (key.endsWith(':1:smaller')) return { text: '```javascript\nfunction act(obs, mem) { return { left: 0.5, right: 0.5 }; }\n```' };
    assert.match(prompt, /128,000 output tokens/);
    return { text: '```javascript\nfunction act(obs, mem) { var x = ', finishReason: 'incomplete' };
  };
  await sandboxRun(run, { call, save: async () => {} });
  assert.deepEqual(seen.slice(0, 2), [['run-3:sandbox:openai:1', 128000], ['run-3:sandbox:openai:1:smaller', 65536]]);
  const [, second] = run.result.players.openai.attempts;
  assert.match(second.error || second.message || '', /cut off at the output limit/);
});

test('a sandbox attempt that hits a provider server error is asked again once', async () => {
  const run = { id: 'run-4', input: { seed: 6, models: ['openai'], attempts: 1 }, result: {} };
  const keys = [];
  const call = async (r, provider, key) => {
    keys.push(key);
    if (!key.endsWith(':retry')) { const e = new Error('HTTP 502'); e.code = 'provider_http'; e.status = 502; throw e; }
    return { text: `\`\`\`javascript\n${BASELINES.reference.code}\n\`\`\`` };
  };
  await sandboxRun(run, { call, save: async () => {}, retryDelayMs: 0 });
  assert.deepEqual(keys, ['run-4:sandbox:openai:1', 'run-4:sandbox:openai:1:retry']);
  assert.ok(run.result.players.openai.attempts[0].code);
  assert.equal(run.result.players.openai.stopped, undefined);
});

test('a stopped model resumes past its failed keys, and server errors get several waits', async () => {
  const { askWithRetries } = await import('../src/sandbox/run.mjs');
  const failed = new Set(['w:sandbox:openai:3', 'w:sandbox:openai:3:retry']);
  const seen = [];
  const call = async (r, p, key) => {
    seen.push(key);
    if (failed.has(key)) throw new Error('An earlier provider request has an uncertain outcome. Manual review required; no automatic retry.');
    return { text: 'ok' };
  };
  assert.equal((await askWithRetries({}, 'openai', 'w:sandbox:openai:3', 'p', { call, retryDelayMs: 0 })).text, 'ok');
  assert.deepEqual(seen, ['w:sandbox:openai:3', 'w:sandbox:openai:3:retry', 'w:sandbox:openai:3:r2']);
  let n = 0;
  const flaky = async () => { if (++n <= 3) { const e = new Error('HTTP 502'); e.code = 'provider_http'; e.status = 502; throw e; } return { text: 'fine' }; };
  assert.equal((await askWithRetries({}, 'openai', 'k', 'p', { call: flaky, retryDelayMs: 0 })).text, 'fine');
  let m = 0;
  const down = async () => { m++; const e = new Error('HTTP 503'); e.code = 'provider_http'; e.status = 503; throw e; };
  await assert.rejects(askWithRetries({}, 'openai', 'k', 'p', { call: down, retryDelayMs: 0 }));
  assert.equal(m, 4);
});
