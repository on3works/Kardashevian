import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCourse, generateExpedition, simulate, plannerRun, referenceValue, navGrid, travelField, expeditionBrief, MISSION, CAPACITY, EXPEDITION_PROTOCOL } from '../src/sandbox/expedition.mjs';
import { expeditionPractice, expeditionEvaluate, expeditionPrompt, EXPEDITION_BASELINES } from '../src/sandbox/runner.mjs';
import { newSandboxInput, publicSandboxView, sandboxRun } from '../src/sandbox/run.mjs';

const world = generateExpedition(4242);

test('a course is the same on every machine and differs between courses, physics included', () => {
  const a = generateCourse(4242, 0), b = generateCourse(4242, 0), c = generateCourse(4242, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.notDeepEqual(a.hidden, c.hidden);
  assert.notDeepEqual(a.sites, c.sites);
  assert.ok(a.sites.length >= 20 && a.faults.length >= 1);
});

test('every site can be reached from the base, and hints include false positives', () => {
  const c = generateCourse(4242, 3), nav = navGrid(c), f = travelField(nav, c.base);
  for (const s of c.sites) assert.ok(Number.isFinite(f.time[nav.cell(s.x, s.y)]));
  assert.ok(c.hints.length > 8);
  assert.ok(c.hints.some(h => !c.sites.some(s => Math.hypot(s.x - h.x, s.y - h.y) < 21)));
});

test('the full-knowledge planner delivers a good share of the map and never loses the rover', () => {
  for (const v of [0, 1]) {
    const c = generateCourse(4242, v), r = plannerRun(world, c);
    assert.equal(r.outcome, 'complete');
    assert.ok(r.delivered >= 0.2 * c.totalValue, `planner delivered ${r.delivered} of ${c.totalValue}`);
    assert.ok(r.delivered < c.totalValue, 'more science exists than one mission can collect');
  }
});

test('only delivered samples count; a controller that does nothing scores 0 and one that throws ends the mission', () => {
  const c = generateCourse(4242, 0), ref = referenceValue(world, c);
  const idle = simulate(world, c, () => ({ left: 0, right: 0 }), { reference: ref });
  assert.equal(idle.score, 0); assert.equal(idle.outcome, 'complete'); assert.equal(idle.time, MISSION);
  const broken = simulate(world, c, () => { throw new Error('boom'); }, { reference: ref });
  assert.equal(broken.outcome, 'error'); assert.equal(broken.score, 0);
});

test('driving flat out into a rock destroys the rover; an empty battery strands it', () => {
  const c = generateCourse(4242, 0);
  const r = simulate(world, c, () => ({ left: 1, right: 1 }), { reference: 100 });
  assert.ok(['crash', 'stranded'].includes(r.outcome), r.outcome);
  assert.ok(r.time < MISSION);
});

test('the first observation carries the mission data and no hidden physics', () => {
  const c = generateCourse(4242, 0); let first, later;
  simulate(world, c, obs => { if (obs.t === 0) first = obs; else later ||= obs; return { left: 0, right: 0 }; }, { reference: 100 });
  assert.equal(first.mission.capacity, CAPACITY);
  assert.deepEqual(first.mission.hints, c.hints);
  assert.equal(later.mission, undefined);
  const text = JSON.stringify(first);
  for (const key of Object.keys(c.hidden)) assert.ok(!text.includes(key), key);
  assert.ok(!text.includes('faults') && !text.includes('sites'));
});

test('model code runs sandboxed and is scored against the planner', async () => {
  const refs = { 0: referenceValue(world, generateCourse(4242, 0)), 1: referenceValue(world, generateCourse(4242, 1)) };
  const p = await expeditionPractice(world, EXPEDITION_BASELINES.reference.code, refs);
  assert.ok(p.score >= 0 && p.trace.length > 100 && p.path.length > 100);
  const bad = await expeditionPractice(world, 'function act(){ return process.exit(1); }', refs);
  assert.equal(bad.outcome, 'error');
  const f = await expeditionEvaluate(world, EXPEDITION_BASELINES.idle.code, refs, 1);
  assert.equal(f.score, 0); assert.equal(f.runs.length, 1);
});

test('new worlds are expeditions; the brief states the rules and hides the numbers', () => {
  const input = newSandboxInput({ models: ['deepseek'], seed: 9, providerSnapshot: [], asOf: 'now' });
  assert.equal(input.protocol, EXPEDITION_PROTOCOL); assert.equal(input.family, 'expedition');
  assert.equal(newSandboxInput({ models: ['deepseek'], seed: 9, providerSnapshot: [], asOf: 'now', family: 'rover' }).protocol, 'sandbox-v2');
  const brief = expeditionBrief(8);
  assert.match(brief, /DIFFERENT ON EVERY COURSE/); assert.match(brief, /no upper limit/i);
  const prompt = expeditionPrompt(8, [{ attempt: 1, code: 'function act(){}', score: 0, delivered: 0, outcome: 'complete', time: 1200, events: [], trace: [{ t: 0 }] }], 128000);
  assert.match(prompt, /attempt 2 of 8/); assert.match(prompt, /Event log of attempt 1/);
  const view = publicSandboxView({ id: 'x', status: 'running', input, result: {} });
  assert.equal(view.hidden, null); assert.equal(view.input.arena, 400);
});

test('an expedition world runs end to end with a stubbed model', async () => {
  const run = { id: 'w', kind: 'sandbox', status: 'running', input: { ...newSandboxInput({ models: ['deepseek'], seed: 77, providerSnapshot: [], asOf: 'now' }), attempts: 2 }, result: {} };
  const prompts = [];
  const call = async (r, provider, key, prompt) => { prompts.push(prompt); return { text: 'NOTE: sit still\n```javascript\nfunction act(obs, mem) { return { left: 0, right: 0, drill: false }; }\n```', finishReason: 'stop' }; };
  await sandboxRun(run, { call, save: async () => {} });
  const p = run.result.players.deepseek;
  assert.equal(p.attempts.length, 2); assert.equal(p.final.score, 0); assert.equal(p.final.runs.length, 10);
  assert.equal(Object.keys(run.result.reference).length, 11);
  assert.ok(run.result.baselines.reference.final.score >= 0);
  assert.match(prompts[1], /Results so far on the practice course/);
});
