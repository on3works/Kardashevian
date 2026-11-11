import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSite, envelopeCases, heldOutUnits, deckLoads, SECTIONS } from '../src/structures/v1/site.mjs';
import { validateDesign, analyse, DesignError } from '../src/structures/v1/solver.mjs';
import { parDesign, referenceDesign } from '../src/structures/v1/par.mjs';
import { structuresRun, parseStructuresReply, structuresPrompt, practice, evaluateHeldOut, publicStructuresView, usableSeed } from '../src/structures/v1/run.mjs';
import { classifyCall } from '../src/spend.mjs';

// A tiny hand-made site: one triangle, so forces can be checked by hand.
function triangleSite() {
  return {
    seed: 1, span: 4, panels: 1, deck: [{ id: 'D0', x: 0, y: 0 }, { id: 'D1', x: 4, y: 0 }],
    supports: [{ id: 'D0', x: 0, y: 0, type: 'pin' }, { id: 'D1', x: 4, y: 0, type: 'roller' }],
    region: { xMin: 0, xMax: 4, yMin: 0, yMax: 3 }, keepOut: null,
    loads: { deadKNm: 0, vehicle: { weightMin: 0, weightMax: 0, frontShare: 0.4, spacingMin: 1, spacingMax: 1 }, windKNm: 0 },
    designCases: [],
  };
}

test('sites, envelopes and held-out units are deterministic per seed', () => {
  assert.deepEqual(generateSite(42), generateSite(42));
  assert.notDeepEqual(generateSite(42), generateSite(43));
  assert.deepEqual(heldOutUnits(generateSite(42)), heldOutUnits(generateSite(42)));
  assert.equal(heldOutUnits(generateSite(42)).length, 10);
  const s = generateSite(7);
  for (const c of [...s.designCases, ...envelopeCases(s)]) {
    const total = deckLoads(s, c).reduce((t, [, fy]) => t + fy, 0);
    const expected = -(s.loads.deadKNm * s.span + (c.vehicle ? c.vehicle.weight : 0));
    assert.ok(Math.abs(total - expected) < 1e-6, `${c.id} loads add up`);
  }
});

test('solver matches hand calculation for a loaded triangle', () => {
  const site = triangleSite();
  const design = validateDesign(site, { nodes: [{ id: 'T', x: 2, y: 1.5 }], members: [['D0', 'T', SECTIONS[5].id], ['T', 'D1', SECTIONS[5].id], ['D0', 'D1', SECTIONS[5].id]] });
  // 100 kN down at the apex via a fake wind-free case: put it on the apex by
  // giving the apex the dead load through a custom case object.
  const res = analyse({ ...site, deck: [...site.deck] }, design, [{ id: 'X', vehicle: null, wind: 0 }]);
  assert.equal(res.mechanism, false);
  // Self-weight only: the diagonals carry compression, the tie carries tension.
  const [d1, d2, tie] = res.members;
  assert.ok(d1.compression > 0 && d2.compression > 0 && tie.tension > 0);
  // Statics: apex weight W gives diagonal force W/(2 sinθ) with sinθ = 0.6.
  const kg = SECTIONS[5].kgPerM, len = 2.5, W = (kg * len * 9.81 / 1000) + 15 * 9.81 / 1000; // two half-diagonals + joint at apex
  assert.ok(Math.abs(d1.compression - W / 1.2) < 0.05 * W, `diagonal ${d1.compression} vs ${W / 1.2}`);
});

test('mechanisms and illegal geometry are caught', () => {
  const site = triangleSite();
  const square = { nodes: [{ id: 'A', x: 0, y: 2 }, { id: 'B', x: 4, y: 2 }], members: [['D0', 'A', SECTIONS[3].id], ['A', 'B', SECTIONS[3].id], ['B', 'D1', SECTIONS[3].id], ['D0', 'D1', SECTIONS[3].id]] };
  assert.equal(analyse(site, validateDesign(site, square), [{ id: 'X', vehicle: null, wind: 0 }]).mechanism, true);
  assert.throws(() => validateDesign(site, { nodes: [{ id: 'A', x: 2, y: 5 }], members: [['D0', 'A', SECTIONS[0].id]] }), DesignError);
  assert.throws(() => validateDesign(site, { nodes: [], members: [['D0', 'D1', 'I-beam']] }), /unknown section/);
  assert.throws(() => validateDesign(site, { nodes: [{ id: 'D0', x: 1, y: 0 }], members: [['D0', 'D1', SECTIONS[0].id]] }), /fixed/);
  const s = generateSite(27);
  assert.ok(s.keepOut);
  const k = s.keepOut, mid = (k.x0 + k.x1) / 2;
  assert.throws(() => validateDesign(s, { nodes: [{ id: 'Z', x: mid, y: (k.y0 + k.y1) / 2 }], members: [['D0', 'Z', SECTIONS[0].id]] }), /clearance/);
});

test('par holds every held-out unit and beats the reference engineer', () => {
  for (const seed of [1, 27, 42, 9001]) {
    const site = generateSite(seed), par = parDesign(site), ref = referenceDesign(site);
    assert.ok(par && ref, `seed ${seed} has par and reference`);
    assert.ok(par.mass <= ref.mass);
    const held = evaluateHeldOut(site, par.design, par.mass);
    assert.equal(held.delivered, 10);
    assert.ok(Math.abs(held.score - 100) < 0.2);
    assert.ok(practice(site, par.design, par.mass).ok);
  }
});

test('replies parse with or without a fence', () => {
  const d = { note: 'warren', nodes: [{ id: 'T1', x: 1, y: 1 }], members: [['D0', 'T1', 'CHS60.3x4']] };
  assert.deepEqual(parseStructuresReply('Here:\n```json\n' + JSON.stringify(d) + '\n```').design.members, d.members);
  assert.equal(parseStructuresReply(JSON.stringify(d)).note, 'warren');
  assert.equal(parseStructuresReply('no idea').design, null);
});

test('a structures run scores practice, held-out units and the reference', async () => {
  const seed = usableSeed(4242), site = generateSite(seed), par = parDesign(site);
  // Model A submits par, then a version with every member one size lighter;
  // model B submits nonsense, then a mechanism.
  const lighter = { nodes: par.design.nodes, members: par.design.members.map(([a, b, s]) => [a, b, SECTIONS[Math.max(0, SECTIONS.findIndex(x => x.id === s) - 1)].id]) };
  const replies = { openai: [par.design, lighter], mimo: ['no json here', { nodes: [], members: [['D0', 'D1', 'CHS60.3x4']] }] };
  const keys = [];
  const run = { id: 'r1', status: 'running', input: { seed, attempts: 2, models: ['openai', 'mimo'], providerSnapshot: [] }, result: {} };
  const call = async (r, p, key, prompt) => {
    keys.push(key);
    assert.match(prompt, /Lightest Structure/);
    const k = Number(key.split(':')[3]) - 1, reply = replies[p][k];
    return { text: typeof reply === 'string' ? reply : '```json\n' + JSON.stringify({ note: 'try', ...reply }) + '\n```' };
  };
  await structuresRun(run, { call, save: async () => {} });
  assert.equal(keys.length, 4);
  assert.equal(classifyCall(keys[0]).experiment, 'structures');
  const a = run.result.players.openai, b = run.result.players.mimo;
  assert.equal(a.attempts[0].score, 100);
  assert.equal(a.final.units.length, 10);
  assert.ok(a.final.score > 0);
  assert.equal(b.attempts[0].error, 'No JSON design with "members" found in the reply');
  assert.equal(b.attempts[1].ok, false);
  assert.ok(run.result.baselines.reference.final.delivered === 10);
  // The prompt for a later attempt carries the analysis report of the last one.
  assert.match(structuresPrompt(site, 2, a.attempts.slice(0, 1).map(x => ({ ...x, report: 'REPORT' })), par.mass), /REPORT/);
  const hidden = publicStructuresView({ ...run, status: 'running' });
  assert.equal(hidden.heldOut, null);
  assert.equal(hidden.result.par.design, undefined);
  const shown = publicStructuresView({ ...run, status: 'complete' });
  assert.equal(shown.heldOut.length, 10);
  assert.ok(shown.result.par.design);
});
