import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSite, heldOutUnits, OPTIONS, OPTION_COUNT, MATERIALS, G, JOINT_KG, JOINT_KG_PER_KGM } from '../src/structures/site2.mjs';
import { validateDesign, analyse, nominalUnit, DesignError } from '../src/structures/frame.mjs';
import { parDesign, referenceDesign } from '../src/structures/par2.mjs';
import { structuresRun, parseStructuresReply, runProgram, practice, evaluateHeldOut, publicStructuresView, structuresPrompt } from '../src/structures/run2.mjs';
import { publicStructuresView as dispatchView, structuresRun as dispatchRun } from '../src/structures/run.mjs';
import { classifyCall } from '../src/spend.mjs';

// A bare 8 m deck on pin and roller with no loads but self weight: beam theory applies.
const L = 8, n = 8;
const beamSite = (right = 'roller') => ({ seed: 1, span: L, panels: n, deck: Array.from({ length: n + 1 }, (_, k) => ({ id: `D${k}`, x: L * k / n, y: 0 })),
  supports: [{ id: 'D0', x: 0, y: 0, type: 'pin' }, { id: `D${n}`, x: L, y: 0, type: right }], region: { xMin: 0, xMax: L, yMin: -2, yMax: 2 }, keepOuts: [],
  loads: { deadKNm: 0, lanes: 1, vehicle: { axles: 2, weightMin: 0, weightMax: 0, spacingMin: 1, spacingMax: 1, frontShare: 0.5, phi: 1 }, pedestrianKNm: 0, brakingKNm: 0, windKNm2: 0, iceMm: 0, tempRange: 30, seismicAh: 0, settlementMm: 0 },
  limits: { fMin: 1, deflRatio: 300, fatigueCycles: 2e6, corrosion: 'C2', designLifeYears: 50 }, factors: { gammaG: 1.35, gammaQ: 1.5, gammaM: 1, psiIce: 0.5 }, fabrication: { maxMember: 12, minMember: 0.4, minAngleDeg: 15, maxAtJoint: 8, maxNodes: 80, maxMembers: 250 } });
const spec = 'S355 CHS168.3x6.3', opt = OPTIONS[spec];
const rigidDeck = Object.fromEntries(Array.from({ length: n + 1 }, (_, k) => [`D${k}`, 'rigid']));
const chain = Array.from({ length: n }, (_, k) => [`D${k}`, `D${k + 1}`, spec]);
const G0 = { id: 'G', vehicles: [], ped: null, braking: 0, wind: 0, ice: 0, dT: 0, seismic: 0, settle: 0, combo: 'uls' };

test('the catalogue has hundreds of options and every site is deterministic', () => {
  assert.ok(OPTION_COUNT > 500, `${OPTION_COUNT} options`);
  assert.ok(OPTIONS['S355 CHS114.3x5'] && OPTIONS['WIRE WIRE16'] && OPTIONS['GL28 TIMBER140x270'] && OPTIONS['AL6082 IPE200']);
  assert.equal(OPTIONS['S235 WIRE16'], undefined);
  assert.deepEqual(generateSite(42), generateSite(42));
  assert.notDeepEqual(generateSite(42), generateSite(43));
  assert.deepEqual(heldOutUnits(generateSite(42)), heldOutUnits(generateSite(42)));
  assert.equal(heldOutUnits(generateSite(42)).length, 10);
  assert.equal(heldOutUnits(generateSite(42))[0].cases.length, 8);
});

test('frame solver matches beam theory: sag, moment, thermal force', () => {
  const site = beamSite();
  const d = validateDesign(site, { nodes: [], joints: rigidDeck, members: chain });
  const r = analyse(site, d, [G0]);
  const EI = opt.material.E * 1e3 * opt.section.Iy, w = opt.kgPerM * G / 1e3;
  const P = (JOINT_KG.rigid + JOINT_KG_PER_KGM * opt.kgPerM * 2) * G / 1e3;
  let delta = 5 * w * L ** 4 / (384 * EI), M = w * L * L / 8;
  for (let k = 1; k < n; k++) { let a = k * L / n; const x = L / 2; if (a < x) a = L - a; const b = L - a; delta += P * b * x * (L * L - b * b - x * x) / (6 * L * EI); M += P * x * (L - a) / L; }
  // Corrosion class C2 trims 0.1 mm of a 6.3 mm wall (1.6% stiffer in theory than built).
  assert.ok(Math.abs(r.sag / delta - 1) < 0.03, `sag ${r.sag} vs ${delta}`);
  assert.ok(Math.abs(r.members[3].moment / (1.35 * M) - 1) < 0.02, `moment ${r.members[3].moment} vs ${1.35 * M}`);
  assert.ok(r.frequency > 4 && r.frequency < 4.6, `f1 ${r.frequency}`);
  const pinned = beamSite('pin');
  const r2 = analyse(pinned, validateDesign(pinned, { nodes: [], joints: rigidDeck, members: chain }), [{ ...G0, id: 'T', dT: 30 }], nominalUnit(), { fatigue: false, frequency: false });
  const Nth = opt.material.E * 1e3 * opt.section.A * opt.material.alpha * 30;
  assert.ok(Math.abs(r2.members[0].compression / Nth - 1) < 0.03, `thermal ${r2.members[0].compression} vs ${Nth}`);
});

test('mechanisms, slack cables, settlement and geometry rules', () => {
  const site = beamSite();
  // A chain of pinned collinear bars is a mechanism.
  assert.equal(analyse(site, validateDesign(site, { nodes: [], members: chain }), [G0]).mechanism, true);
  // A king post under the deck halves the sag; inverted, its cables go slack.
  const post = (y) => validateDesign(site, { nodes: [{ id: 'K', x: 4, y }], joints: rigidDeck, members: [...chain, ['D4', 'K', 'S355 CHS60.3x4'], ['D0', 'K', 'WIRE WIRE16'], ['K', 'D8', 'WIRE WIRE16']] });
  const plain = analyse(site, validateDesign(site, { nodes: [], joints: rigidDeck, members: chain }), [G0]).sag;
  const under = analyse(site, post(-1.5), [G0]);
  assert.ok(under.sag < plain / 3 && under.members[9].tension > 0);
  const over = analyse(site, post(1.5), [G0]);
  assert.equal(over.members[9].slack, 1);
  // Settlement of a pier stresses a continuous deck.
  const s5 = beamSite(); s5.supports.push({ id: 'P1', x: 4, y: -1, type: 'pin', pier: true });
  const d5 = validateDesign(s5, { nodes: [], joints: rigidDeck, members: [...chain, ['D4', 'P1', 'S355 CHS114.3x5']] });
  const r5 = analyse(s5, d5, [G0, { ...G0, id: 'S', settle: 20, settleAt: 'P1' }], nominalUnit(), { fatigue: false, frequency: false });
  assert.ok(r5.cases[1].maxUtil > 2 * r5.cases[0].maxUtil);
  // Rules
  assert.throws(() => validateDesign(site, { nodes: [{ id: 'A', x: 2, y: 5 }], members: [['D0', 'A', spec]] }), /outside/);
  assert.throws(() => validateDesign(site, { nodes: [], members: [['D0', 'D1', 'S355 IPE999']] }), /unknown option/);
  assert.throws(() => validateDesign(site, { nodes: [{ id: 'A', x: 4, y: 1, joint: 'rigid' }], members: [['D0', 'A', 'AL7075 CHS60.3x4'], ['A', 'D8', 'AL7075 CHS60.3x4']] }), /rigid/);
  assert.throws(() => validateDesign(site, { nodes: [{ id: 'A', x: 4, y: 0.3 }], members: [['D0', 'A', spec], ['D4', 'A', spec]] }), /minimum/);
  const s = generateSite(22);
  assert.ok(s.keepOuts.length);
  const k = s.keepOuts[0];
  assert.throws(() => validateDesign(s, { nodes: [{ id: 'Z', x: (k.x0 + k.x1) / 2, y: (k.y0 + k.y1) / 2 }], members: [['D0', 'Z', spec]] }), /clearance/);
});

test('par holds every held-out unit and beats the reference engineer', () => {
  for (const seed of [1, 22]) {
    const site = generateSite(seed), par = parDesign(site), ref = referenceDesign(site);
    assert.ok(par && ref, `seed ${seed}`);
    assert.ok(par.mass < ref.mass);
    const held = evaluateHeldOut(site, par.design, par.mass);
    assert.equal(held.delivered, 10, JSON.stringify(held.units.filter(u => !u.ok).map(u => u.failure)));
    assert.ok(Math.abs(held.score - 100) < 0.2);
    assert.ok(practice(site, par.design, par.mass).ok);
  }
});

test('replies parse as a design or a program; programs run with a budget', async () => {
  const d = { note: 'x', nodes: [{ id: 'T1', x: 1, y: 1 }], members: [['D0', 'T1', 'S355 CHS60.3x4']] };
  assert.deepEqual(parseStructuresReply('```json\n' + JSON.stringify(d) + '\n```').design.members, d.members);
  const prog = 'NOTE: try\n```javascript\nfunction design(site, analyse) { return { nodes: [], members: [] }; }\n```';
  assert.match(parseStructuresReply(prog).program, /function design/);
  assert.equal(parseStructuresReply(prog).note, 'try');
  const site = generateSite(61), par = parDesign(site); // seed 61 has no clearance zone
  const ran = await runProgram(site, `function design(site, analyse) { let last; for (let i = 0; i < 1000; i++) { const r = analyse({ nodes: [], members: site.deck.slice(1).map((d, k) => ['D' + k, d.id, 'S355 CHS114.3x5']) }); if (r.error) throw new Error(r.error); last = r; } return null; }`, par.mass, { budget: 5 });
  assert.match(ran.error, /budget of 5/);
  const loop = await runProgram(site, 'function design(site, analyse) { while (true) {} }', par.mass, { ms: 500 });
  assert.match(loop.error, /budget exhausted/);
  const escape = await runProgram(site, 'function design(site, analyse) { if (typeof process !== "undefined" || typeof require !== "undefined") throw new Error("escaped"); return { nodes: [], members: [["D0", "D1", "S355 CHS114.3x5"]] }; }', par.mass);
  assert.ok(escape.design);
  const good = await runProgram(site, `function design(site, analyse) { const n = site.panels, a = site.span / n, h = Math.min(site.region.yMax, 1.2); const nodes = [], members = []; for (let k = 0; k < n; k++) nodes.push({ id: 'M' + k, x: a * (k + 0.5), y: h }); for (let k = 0; k < n; k++) { members.push(['D' + k, 'D' + (k + 1), 'S355 CHS168.3x6.3']); members.push(['D' + k, 'M' + k, 'S355 CHS114.3x5']); members.push(['M' + k, 'D' + (k + 1), 'S355 CHS114.3x5']); } for (let k = 0; k + 1 < n; k++) members.push(['M' + k, 'M' + (k + 1), 'S355 CHS168.3x6.3']); const r = analyse({ nodes, members }); return { note: 'warren ' + r.mass, nodes, members }; }`, par.mass);
  assert.ok(good.design && good.analyses === 1 && /warren \d/.test(good.note));
});

test('a v2 run scores designs and programs, tracks the best, and keeps v1 sites on v1', async () => {
  const site = generateSite(1), par = parDesign(site);
  const prog = `function design(site, analyse) { return ${JSON.stringify(par.design)}; }`;
  const replies = { openai: ['```json\n' + JSON.stringify({ note: 'par', ...par.design }) + '\n```', '```javascript\n' + prog + '\n```'], mimo: ['', 'nonsense'] };
  const keys = [];
  const run = { id: 'r2', status: 'running', input: { protocol: 'structures-v2', seed: 1, site, attempts: 2, models: ['openai', 'mimo'], providerSnapshot: [] }, result: {} };
  const call = async (r, p, key) => { keys.push(key); const k = Number(key.split(':')[3]) - 1; const text = replies[p][k]; return { text, finishReason: text ? 'stop' : 'length' }; };
  await dispatchRun(run, { call, save: async () => {} });
  assert.equal(keys.length, 4);
  assert.equal(classifyCall(keys[0]).experiment, 'structures');
  const a = run.result.players.openai, b = run.result.players.mimo;
  assert.equal(a.attempts[0].score, 100);
  assert.ok(a.attempts[1].program && a.attempts[1].score === 100);
  assert.equal(a.final.delivered, 10);
  assert.equal(b.attempts[0].error, 'Used the whole output budget thinking and returned nothing');
  assert.match(b.attempts[1].error, /No JSON design/);
  assert.equal(run.result.best.mass, a.final.mass);
  assert.match(structuresPrompt(site, 2, a.attempts, par.mass), /Program of attempt 2/);
  const hidden = dispatchView({ ...run, status: 'running' });
  assert.equal(hidden.heldOut, null);
  assert.equal(hidden.result.par.design, undefined);
  assert.equal(hidden.site.span, site.span);
  const shown = dispatchView({ ...run, status: 'complete' });
  assert.equal(shown.heldOut.length, 10);
  // v1 sites keep their generator
  const v1 = dispatchView({ id: 'old', status: 'complete', created_at: 'x', input: { protocol: 'structures-v1', seed: 31337, attempts: 8, models: [], providerSnapshot: [] }, result: {} });
  assert.equal(v1.site.span, 17.9);
});
