import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSite3, heldOutUnits3, designCases3, STRUCTURES3_PROTOCOL } from '../src/structures/site3.mjs';
import { validateDesign3, analyse3, lowerBound3, designMass3, DesignError3 } from '../src/structures/frame3.mjs';
import { referenceDesign3, referenceLayout3 } from '../src/structures/ref3.mjs';
import { newStructuresInput, structuresRun, practice, evaluateHeldOut, publicStructuresView, runProgram, structuresPrompt } from '../src/structures/run2.mjs';

const site = generateSite3(2), ref = referenceDesign3(site), bound = lowerBound3(site);

test('a site is deterministic, three-dimensional and always carries the proof load', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(generateSite3(2))), JSON.parse(JSON.stringify(site)));
  assert.equal(site.protocol, STRUCTURES3_PROTOCOL);
  assert.equal(site.deck.length, 2 * (site.panels + 1));
  assert.ok(site.deck.some(d => d.z < 0) && site.deck.some(d => d.z > 0));
  assert.equal(site.keepOuts[0].id, 'traffic envelope');
  assert.equal(designCases3(site)[0].id, 'PL');
  for (const u of heldOutUnits3(site)) { assert.equal(u.cases.length, 8); assert.equal(u.cases[0].vehicles.length, site.loads.lanes); }
});

test('the reference engineer holds every built unit and sits far above the lower bound', () => {
  assert.ok(ref, 'reference design exists');
  const d = validateDesign3(site, ref.design);
  assert.ok(analyse3(site, d, site.designCases).ok);
  for (const u of heldOutUnits3(site)) assert.ok(analyse3(site, d, u.cases, u).ok, `unit ${u.unit}`);
  assert.ok(bound.mass > 0 && bound.mass < ref.mass / 5, `bound ${bound.mass} vs reference ${ref.mass}`);
});

test('a plane truss with no bracing across the bridge is a mechanism', () => {
  const lay = referenceLayout3(site);
  const flat = { nodes: lay.nodes, members: lay.members.filter(m => m.group === 'chord' || m.group === 'web').map(m => [m.a, m.b, 'S355 CHS219.1x8']) };
  // connect every deck node so validation passes, but leave the two trusses unbraced
  const res = analyse3(site, validateDesign3(site, flat), site.designCases);
  assert.equal(res.mechanism, true); assert.equal(res.ok, false);
});

test('thin members fail, and the failure names the member and the mode', () => {
  const thin = { nodes: ref.design.nodes, members: ref.design.members.map(([a, b]) => [a, b, 'S355 CHS33.7x2.6']) };
  const p = practice(site, thin, bound.mass);
  assert.equal(p.ok, false); assert.equal(p.score, 0);
  assert.match(p.failure, /capacity|buckles|sags|sways|frequency|fatigue/);
});

test('geometry rules: region, traffic envelope, member length, unknown options', () => {
  const base = ref.design, mid = Math.floor(site.panels / 2);
  assert.throws(() => validateDesign3(site, { nodes: [...base.nodes, { id: 'X', x: 1, y: 2, z: 0 }], members: [...base.members, ['L0', 'X', 'S355 CHS114.3x5']] }), DesignError3);
  assert.throws(() => validateDesign3(site, { nodes: base.nodes, members: [...base.members, [`L${mid}`, `R${mid + 1}`, 'S355 NOPE']] }), /unknown option/);
  // a brace from one deck line up and across the roadway passes through the envelope
  if (site.region.yMax > 0) assert.throws(() => validateDesign3(site, { nodes: [...base.nodes, { id: 'T', x: site.deck[2].x, y: site.region.yMax, z: site.width / 2 }], members: [...base.members, ['L1', 'T', 'S355 CHS114.3x5']] }), /traffic envelope/);
  assert.throws(() => validateDesign3(site, { nodes: base.nodes, members: [...base.members, ['L0', `L${site.panels}`, 'S355 CHS114.3x5']] }), /long/);
});

test('a snapped rod is checked: a design hanging on single rods fails robustness or holds with spares', () => {
  const lay = referenceLayout3(site);
  const rods = { nodes: lay.nodes, members: lay.members.map((m, i) => [m.a, m.b, m.group === 'web' && /^[LR]\d+$/.test(m.a) && /^B/.test(m.b) && m.a.slice(1) !== m.b.slice(2) ? 'S355 ROD64' : ref.design.members[i][2]]) };
  const res = analyse3(site, validateDesign3(site, rods), site.designCases);
  assert.ok(res.robustness.checked > 0);
  assert.equal(typeof res.robustness.ok, 'boolean');
  if (!res.robustness.ok) assert.equal(res.ok, false);
});

test('scores are 100 × bound ÷ mass on units that hold, and programs can call the 3D analysis', async () => {
  const f = evaluateHeldOut(site, ref.design, bound.mass);
  assert.equal(f.delivered, 10);
  assert.ok(Math.abs(f.score - 100 * bound.mass / designMass3(validateDesign3(site, ref.design))) < 0.01);
  const program = `function design(site, analyse) { var d = ${JSON.stringify(ref.design)}; var r = analyse(d); d.note = 'ok=' + r.ok + ' acr=' + r.alphaCr; return d; }`;
  const ran = await runProgram(site, program, bound.mass);
  assert.equal(ran.analyses, 1); assert.match(ran.note, /ok=true/);
});

test('a v3 site runs end to end with a stubbed model, and v2 sites still do', async () => {
  const input = newStructuresInput({ models: ['deepseek'], seed: 2, providerSnapshot: [], asOf: 'now' });
  assert.equal(input.protocol, STRUCTURES3_PROTOCOL);
  const run = { id: 's', kind: 'structures', status: 'running', input: { ...input, attempts: 2 }, result: {} };
  const prompts = [];
  const call = async (r, provider, key, prompt) => { prompts.push(prompt); return { text: '```json\n' + JSON.stringify({ note: 'copy the reference', ...run.result.baselines.reference.design }) + '\n```', finishReason: 'stop' }; };
  await structuresRun(run, { call, save: async () => {} });
  const p = run.result.players.deepseek;
  assert.equal(p.attempts.length, 2); assert.ok(p.attempts[0].ok); assert.equal(p.final.delivered, 10);
  assert.ok(run.result.par.bound && run.result.par.mass > 0);
  assert.match(prompts[0], /GLOBAL BUCKLING/); assert.match(prompts[0], /lower bound on the mass of ANY structure/); assert.match(prompts[1], /Analysis of attempt 1/);
  const view = publicStructuresView({ ...run, status: 'complete' });
  assert.equal(view.heldOut.length, 10); assert.match(view.brief, /structures-v3/);
  assert.equal(newStructuresInput({ models: ['deepseek'], seed: 5, providerSnapshot: [], asOf: 'now', protocol: 'structures-v2' }).protocol, 'structures-v2');
  assert.match(structuresPrompt(generateSite3(2), 8, [], 100), /attempt 1 of 8/);
});
