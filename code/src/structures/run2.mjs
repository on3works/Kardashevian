import { RunStopped } from '../stop.mjs';
import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import { STRUCTURES_PROTOCOL, MATERIALS, FAMILIES, OPTION_COUNT, JOINT_KG, JOINT_KG_PER_KGM, CORROSION_MM, HELD_OUT_UNITS, CASES_PER_UNIT, generateSite, heldOutUnits } from './site2.mjs';
import { validateDesign, analyse, DesignError } from './frame.mjs';
import { parDesign, referenceDesign } from './par2.mjs';
import { askWithRetries, maxOutputFor, MAX_OUTPUT_TOKENS } from '../sandbox/run.mjs';

export const STRUCTURES_ATTEMPTS = 8;
export const ANALYSIS_BUDGET = 400; // analyse() calls a program may make per attempt
export const PROGRAM_MS = 90_000; // wall-clock budget for a program, host analysis included
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const fmtKg = v => Math.round(v).toLocaleString('en');
const label = m => `${m.a}-${m.b}`;

export function newStructuresInput({ models, seed, providerSnapshot, asOf }) {
  return { protocol: STRUCTURES_PROTOCOL, family: 'truss', seed, site: generateSite(seed), attempts: STRUCTURES_ATTEMPTS, maxOutputTokens: MAX_OUTPUT_TOKENS, providerMaxOutput: true, models, providerSnapshot, asOf };
}

// ---------------------------------------------------------------------------
// The brief.
function sectionTable() {
  const lines = [];
  for (const f of Object.values(FAMILIES)) {
    lines.push(`  ${f.id} (${f.name}): id | A cm² | Iy cm⁴ (in-plane) | Iz cm⁴ (out-of-plane) | Wy cm³ | Wz cm³ | depth mm | wall/thickness mm`);
    for (const s of f.sizes) lines.push(`    ${s.id} | ${round(s.A * 1e4, 2)} | ${round(s.Iy * 1e8, 1)} | ${round(s.Iz * 1e8, 1)} | ${round(s.Wy * 1e6, 1)} | ${round(s.Wz * 1e6, 1)} | ${Math.round(s.depth * 1e3)} | ${round(s.t * 1e3, 1)}`);
  }
  return lines.join('\n');
}
function materialTable() {
  return Object.values(MATERIALS).map(m => `  ${m.id} (${m.name}): E ${m.E.toLocaleString('en')} MPa, design strength ${m.fy} MPa, ${m.rho} kg/m³, α ${(m.alpha * 1e6).toFixed(0)}e-6/K, fatigue Δσ pinned ${m.fatigue.pin} / rigid ${m.fatigue.rigid || 'n/a'} MPa, ${m.corrodes ? 'corrodes' : 'no corrosion'}, ${m.weldable ? 'moment joints allowed' : 'pinned joints only'}${m.cable ? ', TENSION ONLY (slackens in compression, no bending)' : ''}; families ${m.families.join('/')}; built units draw strength ${Math.round(m.tol.fy[0] * 100)}–${Math.round(m.tol.fy[1] * 100)}%, E ${Math.round(m.tol.E[0] * 100)}–${Math.round(m.tol.E[1] * 100)}%, thickness ${Math.round(m.tol.t[0] * 100)}–${Math.round(m.tol.t[1] * 100)}% of nominal`).join('\n');
}
function caseLine(c) {
  const parts = [];
  for (const v of c.vehicles) parts.push(`${v.weight} kN vehicle at x = ${v.center} m, axles ${v.spacing} m apart, front toward ${v.dir > 0 ? '+x' : '-x'}`);
  if (c.ped) parts.push(`crowd on x ${c.ped.x0}..${c.ped.x1} m`);
  if (c.braking) parts.push(`braking ${c.braking > 0 ? '+x' : '-x'}`);
  if (c.wind) parts.push(`wind ${c.wind > 0 ? '+' : '-'}${Math.abs(c.wind) === 1 ? 'full' : Math.round(Math.abs(c.wind) * 100) + '%'}`);
  if (c.ice) parts.push('ice');
  if (c.dT) parts.push(`ΔT ${c.dT > 0 ? '+' : ''}${c.dT} K`);
  if (c.seismic) parts.push(`seismic ${c.seismic > 0 ? '+x' : '-x'}`);
  if (c.settle) parts.push(`${c.settleAt} settles ${c.settle} mm`);
  return `${c.id} (${c.combo === 'seismic' ? 'seismic combination' : 'ULS'}): ${parts.join('; ') || 'permanent loads only'}`;
}

export function structuresBrief(site, attempts, parMass) {
  const v = site.loads.vehicle, l = site.limits, f = site.factors, fab = site.fabrication;
  const sup = site.supports.map(s => `${s.id} at (${s.x}, ${s.y}) ${s.type === 'pin' ? 'pinned' : 'roller'}${s.kv ? `, on soft ground: vertical spring ${(s.kv / 1000).toFixed(0)} kN/mm` : ''}${s.pier ? ' (pier)' : ''}`).join('; ');
  return `Kardashevian lab · Lightest Structure (${STRUCTURES_PROTOCOL})
Design the lightest bridge structure, seen in elevation (2D), that carries every load below on every one of ${HELD_OUT_UNITS} built units. x runs along the bridge in metres, y is up, the deck is at y = 0. You choose nodes, members, each member's material and section (${OPTION_COUNT} options), and whether each joint is pinned or rigid.

SITE
- Span ${site.span} m. Fixed deck nodes, which carry the deck loads: ${site.deck.map(d => `${d.id} (${d.x}, 0)`).join(', ')}.
- Supports: ${sup}. A pinned support holds x and y; a roller holds y only. A spring support moves under load (and settles).
- Allowed region: x ${site.region.xMin}..${site.region.xMax}, y ${site.region.yMin}..${site.region.yMax}${site.region.yMax === 0 ? ' (nothing above the deck)' : ''}${site.region.yMin === 0 ? ' (nothing below the deck)' : ''}.
${site.keepOuts.length ? site.keepOuts.map(k => `- Clearance zone (${k.id}): nothing inside x ${k.x0}..${k.x1}, y ${k.y0}..${k.y1}; members may touch its edges.`).join('\n') : '- No clearance zones.'}

LOADS (kN, kN/m, kN/m²)
- Permanent: deck dead load ${site.loads.deadKNm} kN/m on the deck nodes; your members' own weight (density × area) and ${JOINT_KG.pin} kg per pinned joint or ${JOINT_KG.rigid} kg per rigid joint plus ${JOINT_KG_PER_KGM} kg per kg/m of every member meeting there. All of that is added by us.
- Traffic: ${site.loads.lanes} lane${site.loads.lanes > 1 ? 's, so up to two vehicles at once' : ''}. A vehicle has ${v.axles} axles (front axle ${Math.round(v.frontShare * 100)}% of its weight), weight ${v.weightMin}–${v.weightMax} kN, axle spacing ${v.spacingMin}–${v.spacingMax} m, either direction, anywhere with all axles on the deck, multiplied by a dynamic factor Φ = ${v.phi}. Axles between deck nodes are shared between them by distance.
- Crowd: ${site.loads.pedestrianKNm} kN/m on any stretch of the deck.
- Braking: up to ${site.loads.brakingKNm} kN/m along the deck, either direction.
- Wind: up to ${site.loads.windKNm2} kN/m² out of plane on every member, drag 1.2 for round sections and 2.0 for the rest, acting on the member's depth. It bends each member about its weak axis (Iz, Wz) between its two nodes.
${site.loads.iceMm ? `- Ice: up to ${site.loads.iceMm} mm radial ice on every member (weight ${8.83} kN/m³ on the iced perimeter, and it widens the face the wind sees); combined with traffic reduced to ${Math.round(f.psiIce * 100)}%.` : '- No ice at this site.'}
- Temperature: uniform ±${site.loads.tempRange} K on every member (thermal strain α·ΔT; restrained members and mixed materials pick up force).
${site.loads.seismicAh ? `- Seismic: horizontal acceleration ${site.loads.seismicAh} g on every mass (members, joints, deck dead load), either direction, combined with 1.0 × permanent and 0.3 × traffic.` : '- No seismic case at this site.'}
${site.loads.settlementMm ? `- Settlement: any one support may settle up to ${site.loads.settlementMm} mm.` : '- No support settlement at this site.'}
- Combinations: strength checks use ${f.gammaG} × permanent + ${f.gammaQ} × variable (thermal and settlement at 1.0); the seismic combination is 1.0 × permanent + seismic + 0.3 × traffic. Deflection uses unfactored loads. Frequency uses permanent mass only.

CHECKS (every one must pass on every built unit)
- Section class: the plate slenderness limit (90ε² for round tubes, 42ε for square, 14ε for flanges, 15ε for angles, ε = √(235/fy)) reduces the compression and bending capacity of thin sections.
- Resistance with partial factor γM = ${f.gammaM}: tension N ≤ A·fy/γM; compression N ≤ χ·A·fy/γM with χ from a buckling curve (λ̄ = √(A fy / Ncr), Ncr = π²EI_min/(KL)², Φ = 0.5[1 + α(λ̄ − 0.2) + λ̄²], χ = 1/(Φ + √(Φ² − λ̄²))), K = 1.0 pinned both ends, 0.85 one rigid end, 0.7 both rigid; α = 0.21 round and square tubes and IPE, 0.34 HEB, 0.49 angles/rods/timber, 0.76 flat bars, multiplied by each unit's imperfection factor (0.8–1.5); I_min is the weak axis, nothing is braced out of plane.
- Interaction: N/Nb + k·My/MyRd + Mz/MzRd ≤ 1 (k = 1/(1 − N/Ncr) in compression), My from the in-plane frame analysis (self weight, loads and any moments rigid joints carry), Mz from wind on the member.
- Shear V ≤ Av·fy/(√3 γM).
- Deck sag ≤ span/${l.deflRatio} = ${round(site.span / l.deflRatio * 1000, 1)} mm, relative to the end supports, under any unfactored case.
- Lowest natural frequency ≥ ${l.fMin} Hz (permanent mass, nominal stiffness of the unit).
- Fatigue: the stress range from a vehicle crossing (unfactored, with Φ) ≤ the material's Δσ for the joint type × (2·10⁶ / ${l.fatigueCycles.toLocaleString('en')})^(1/3). A member is 'rigid' for fatigue if either end has a moment connection.
- Corrosion class ${l.corrosion}, design life ${l.designLifeYears} years: carbon steel loses ${round(CORROSION_MM[l.corrosion] * l.designLifeYears / 50, 2)} mm of wall for capacity (not for mass); stainless and aluminium none; timber outdoors (C4/C5) loses 20% strength.
- Stability: no mechanism. Cables that go into compression simply slacken (re-analysed without them).
- Fabrication: members ${fab.minMember}–${fab.maxMember} m, at least ${fab.minAngleDeg}° between members at a joint, at most ${fab.maxAtJoint} members per joint, ${fab.maxNodes} nodes and ${fab.maxMembers} members. Members may cross without a node (different planes).

MATERIALS
${materialTable()}

SECTIONS (member option = "MATERIAL SECTION", e.g. "S460 CHS139.7x6.3", "WIRE WIRE16", "GL28 TIMBER140x270"; mass = density × A)
${sectionTable()}

JOINTS
- Each node is "pin" (default) or "rigid". At a rigid node, members of weldable materials are moment-connected (continuity, K = 0.7 buckling, but welded fatigue category); a member may opt out with ends: "pin". Cables are always pinned. Deck nodes and supports are pinned unless you list them in "joints".

PUBLISHED DESIGN CASES (feedback after each attempt uses these with nominal materials)
${site.designCases.map(caseLine).join('\n')}

SCORING
You get ${attempts} attempts. After each you see mass, score and an analysis report. Your best practice design is then built ${HELD_OUT_UNITS} times; each unit draws its own material strength, stiffness, density and thickness inside the bands above, its own imperfection factor, and ${CASES_PER_UNIT} unseen load cases from the ranges above (vehicles of any weight, spacing and position, partial crowds, wind and temperature anywhere in range, ice, seismic and settlement where the site has them). A unit that fails any check scores 0; a unit that holds scores 100 × par mass ÷ your mass. Par for this site is ${parMass ? `${fmtKg(parMass)} kg` : 'set by our optimizer'}: our optimizer's lightest classic pinned S355 tube truss that holds every unit. Beating par scores above 100; there is no ceiling but physics. Design for the whole ranges and the weakest unit, not for the published cases.`;
}

const REPLY_FORMAT = `Reply in ONE of two ways:
(A) A design, in a \`\`\`json block:
{"note": "one sentence on your idea and what you changed", "nodes": [{"id": "T1", "x": 3.5, "y": 2.0, "joint": "pin"}, ...], "joints": {"D3": "rigid"}, "members": [["D0", "T1", "S355 CHS114.3x5"], {"a": "T1", "b": "T2", "spec": "WIRE WIRE16"}, ...]}
List only your own nodes in "nodes"; deck nodes and supports exist already. "joints" (optional) sets the joint type of existing nodes.
(B) A program, in a \`\`\`javascript block, that searches for a design using our analysis engine:
function design(site, analyse) { ... return { note, nodes, joints, members }; }
analyse(design) returns { ok, mass, score, maxUtil, failure, sag, sagLimit, frequency, fMin, fatigueWorst, members: [{ id, util, mode, tension, compression }], cases: [{ id, maxUtil, governing, mode, sag }] } for the published cases on nominal materials, or { error } for an invalid design. \`site\` is this site as JSON with a \`catalogue\` of materials and sections (numbers in m, m², m⁴, m³). Plain JavaScript, no imports, no network. Budget: ${ANALYSIS_BUDGET} analyse() calls and ${PROGRAM_MS / 1000} seconds in total; the design your function returns is the attempt. Start with "NOTE: one sentence" before the block.`;

export function structuresPrompt(site, attempts, history, parMass, maxOutputTokens = MAX_OUTPUT_TOKENS) {
  const lines = [structuresBrief(site, attempts, parMass), '', `This is attempt ${history.length + 1} of ${attempts}.`];
  if (history.length) {
    lines.push('', 'Results so far (nominal materials, published cases):');
    history.forEach(h => lines.push(`Attempt ${h.attempt}${h.program ? ' (program)' : ''}: ${h.error ? `invalid (${h.error})` : `${fmtKg(h.mass)} kg, ${h.ok ? 'passes every check' : `fails (${h.failure})`}, score ${h.score}${h.analyses != null ? `, ${h.analyses} analyses used` : ''}`}${h.note ? ` · your note: ${h.note}` : ''}`));
    const recent = history.slice(-2);
    for (const h of recent) {
      if (h.program) lines.push('', `Program of attempt ${h.attempt}:`, '```javascript', h.program, '```');
      if (h.design) lines.push('', `Design of attempt ${h.attempt}${h.program ? ' (returned by the program)' : ''}:`, '```json', JSON.stringify(h.design), '```');
    }
    const last = [...history].reverse().find(h => h.report);
    if (last) lines.push('', `Analysis of attempt ${last.attempt}:`, last.report);
  }
  lines.push('', `Budget: each reply may use at most ${maxOutputTokens.toLocaleString('en')} output tokens, and your reasoning counts toward it. A reply that runs out before the block is complete scores as a failed attempt. Do not try to compute member forces in your head: either reason about load paths and let the report correct you, or write a program and let analyse() do the arithmetic. Write the block before any long explanation.`, '', REPLY_FORMAT);
  return lines.join('\n');
}

export function parseStructuresReply(text) {
  if (typeof text !== 'string' || !text.trim()) return { design: null, program: null, note: null, error: 'Empty reply' };
  const note = text.match(/NOTE:\s*(.+)/i)?.[1]?.trim().slice(0, 300) || null;
  const js = [...text.matchAll(/```(?:javascript|js)\s*\n([\s\S]*?)```/gi)].map(m => m[1]).find(b => /function\s+design\s*\(/.test(b));
  if (js) return { design: null, program: js.trim(), note, error: null };
  if (/function\s+design\s*\(/.test(text) && !/```json/i.test(text)) return { design: null, program: text.slice(text.search(/function\s+design\s*\(/)).trim(), note, error: null };
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)].map(m => m[1]);
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start >= 0 && end > start) blocks.push(text.slice(start, end + 1));
  for (const b of blocks) {
    try {
      const obj = JSON.parse(b);
      if (obj && typeof obj === 'object' && Array.isArray(obj.members)) return { design: { nodes: Array.isArray(obj.nodes) ? obj.nodes : [], joints: obj.joints && typeof obj.joints === 'object' ? obj.joints : undefined, members: obj.members }, program: null, note: typeof obj.note === 'string' ? obj.note.slice(0, 300) : note, error: null };
    } catch {}
  }
  return { design: null, program: null, note, error: 'No JSON design with "members" and no function design(site, analyse) found in the reply' };
}

// ---------------------------------------------------------------------------
// Analysis report for the model and the Lab.
function compactReport(site, design, res, parMass) {
  const ok = res.ok;
  return {
    ok, mass: round(res.mass), score: ok ? round(100 * parMass / res.mass, 2) : 0,
    maxUtil: res.mechanism ? null : round(Math.max(...res.members.map(m => m.util)), 3),
    failure: ok ? null : failureOf(design, res, site),
    sag: round(res.sag * 1000, 1), sagLimit: round(res.sagLimit * 1000, 1), frequency: res.frequency, fMin: site.limits.fMin,
    fatigueWorst: res.fatigue ? res.fatigue.worst : null,
    members: design.members.map((m, i) => ({ id: label(m), spec: m.spec, util: round(res.members[i].util, 3), mode: res.members[i].mode, tension: round(res.members[i].tension), compression: round(res.members[i].compression), moment: round(res.members[i].moment, 2) })),
    cases: res.cases.map(c => ({ id: c.id, maxUtil: c.maxUtil === Infinity ? null : c.maxUtil, governing: c.governing != null ? label(design.members[c.governing]) : null, mode: c.mode, sag: c.sag != null ? round(c.sag * 1000, 1) : null })),
  };
}
function failureOf(design, res, site) {
  if (res.mechanism) return 'mechanism: part of the structure can move without straining any member';
  const bad = res.cases.filter(c => !c.ok);
  if (bad.length) {
    const worst = bad.reduce((a, b) => (b.maxUtil > a.maxUtil ? b : a), bad[0]);
    if (worst.maxUtil > 1) return `${worst.id}: ${label(design.members[worst.governing])} at ${worst.maxUtil}× capacity (${worst.mode})`;
    return `${worst.id}: deck sags ${round(worst.sag * 1000, 1)} mm, limit ${round(res.sagLimit * 1000, 1)} mm`;
  }
  if (res.frequency != null && res.frequency < site.limits.fMin) return `natural frequency ${res.frequency} Hz, below the ${site.limits.fMin} Hz limit`;
  if (res.fatigue && !res.fatigue.ok) return `fatigue: ${label(design.members[res.fatigue.governing])} stress range ${res.fatigue.members[res.fatigue.governing].range} MPa, allowed ${res.fatigue.members[res.fatigue.governing].allow} MPa`;
  return 'fails a check';
}
function reportText(site, design, res, c) {
  const lines = [`mass ${fmtKg(res.mass)} kg · ${res.ok ? 'passes every check' : 'FAILS: ' + c.failure}`, `deck sag ${c.sag} mm (limit ${c.sagLimit}) · natural frequency ${c.frequency ?? '?'} Hz (min ${c.fMin}) · fatigue worst ${c.fatigueWorst ?? '?'} of 1.0`, '', 'case | max utilisation | governing member (mode) | sag mm'];
  for (const k of c.cases) lines.push(`${k.id} | ${k.maxUtil ?? 'mechanism'} | ${k.governing ? `${k.governing} (${k.mode})` : '-'} | ${k.sag ?? '-'}`);
  if (!res.mechanism) {
    const top = c.members.map((m, i) => ({ ...m, i })).sort((a, b) => b.util - a.util).slice(0, 20);
    lines.push('', 'Most loaded members: member | option | length m | max tension kN | max compression kN | max moment kNm | utilisation (mode, case)');
    for (const m of top) lines.push(`${m.id} | ${m.spec} | ${round(design.members[m.i].len, 2)} | ${m.tension} | ${m.compression} | ${m.moment} | ${m.util} (${m.mode}${res.members[m.i].case ? ', ' + res.members[m.i].case : ''})`);
    const idle = c.members.filter(m => m.util < 0.3).length;
    if (idle) lines.push('', `${idle} member${idle === 1 ? '' : 's'} work below 30% of capacity.`);
  } else lines.push('', 'The structure is a mechanism. Triangulate it or add rigid joints.');
  return lines.join('\n');
}

export function practice(site, raw, parMass) {
  let design;
  try { design = validateDesign(site, raw); }
  catch (e) { if (e instanceof DesignError) return { ok: false, error: e.message, score: 0 }; throw e; }
  const res = analyse(site, design, site.designCases);
  const c = compactReport(site, design, res, parMass);
  return { ...c, utils: res.mechanism ? null : res.members.map(m => round(m.util, 3)), report: reportText(site, design, res, c) };
}

export function evaluateHeldOut(site, raw, parMass) {
  let design;
  try { design = validateDesign(site, raw); } catch (e) { return { score: 0, delivered: 0, mass: null, units: [], error: e.message }; }
  const units = heldOutUnits(site).map(u => {
    const res = analyse(site, design, u.cases, u);
    return { unit: u.unit, ok: res.ok, score: res.ok ? round(100 * parMass / res.mass, 2) : 0, failure: res.ok ? null : failureOf(design, res, site), frequency: res.frequency, sag: round(res.sag * 1000, 1) };
  });
  const mass = analyse(site, design, [], undefined, { fatigue: false, frequency: false }).mass;
  return { score: round(units.reduce((s, u) => s + u.score, 0) / units.length, 2), delivered: units.filter(u => u.ok).length, mass: round(mass), units };
}

// ---------------------------------------------------------------------------
// Program mode: the model's function runs in QuickJS with a host analyse().
function catalogueForProgram() {
  return {
    materials: Object.fromEntries(Object.values(MATERIALS).map(m => [m.id, { E: m.E, fy: m.fy, rho: m.rho, alpha: m.alpha, fatigue: m.fatigue, corrodes: m.corrodes, weldable: m.weldable, cable: Boolean(m.cable), families: m.families, tol: m.tol }])),
    families: Object.fromEntries(Object.values(FAMILIES).map(f => [f.id, f.sizes.map(s => ({ id: s.id, A: s.A, Iy: s.Iy, Iz: s.Iz, Wy: s.Wy, Wz: s.Wz, Av: s.Av, depth: s.depth, t: s.t, alpha: s.alpha }))])),
  };
}
let quickjs;
async function engine() { return (quickjs ||= await getQuickJS()); }

export async function runProgram(site, source, parMass, { budget = ANALYSIS_BUDGET, ms = PROGRAM_MS } = {}) {
  if (typeof source !== 'string' || source.length > 60_000) return { error: 'Program is longer than 60,000 characters' };
  const q = await engine();
  const runtime = q.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const vm = runtime.newContext();
  const started = Date.now(), deadline = started + ms;
  let analyses = 0, lastDesign = null, lastOk = null;
  const host = vm.newFunction('__analyse', h => {
    const raw = vm.dump(h);
    let out;
    if (Date.now() > deadline) out = { error: 'time budget exhausted' };
    else if (analyses >= budget) out = { error: `analysis budget of ${budget} calls exhausted` };
    else {
      analyses++;
      try {
        const parsed = JSON.parse(raw);
        const design = validateDesign(site, parsed);
        const res = analyse(site, design, site.designCases);
        out = compactReport(site, design, res, parMass);
        delete out.failure; out.failure = res.ok ? null : failureOf(design, res, site);
        lastDesign = parsed; lastOk = out.ok;
      } catch (e) { out = { error: e instanceof DesignError ? e.message : 'invalid design' }; }
    }
    return vm.newString(JSON.stringify(out));
  });
  vm.setProp(vm.global, '__analyse', host); host.dispose();
  const run = (code) => {
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
    const r = vm.evalCode(code);
    if (r.error) { const err = vm.dump(r.error); r.error.dispose(); throw new Error(typeof err === 'object' ? `${err.name || 'Error'}: ${err.message || ''}${err.stack ? '\n' + String(err.stack).split('\n').slice(0, 3).join('\n') : ''}` : String(err)); }
    const v = vm.dump(r.value); r.value.dispose(); return v;
  };
  try {
    const pub = { ...site, catalogue: catalogueForProgram() };
    run(`var __site = ${JSON.stringify(pub)}; function analyse(d) { return JSON.parse(__analyse(JSON.stringify(d))); }`);
    run(`${source}\n;if (typeof design !== 'function') throw new Error('Define function design(site, analyse)');`);
    const out = run('JSON.stringify(design(__site, analyse) || null)');
    const design = out ? JSON.parse(out) : null;
    if (!design || typeof design !== 'object' || !Array.isArray(design.members)) return { error: 'The program returned no design with "members"', analyses, elapsedMs: Date.now() - started, lastDesign };
    return { design: { nodes: Array.isArray(design.nodes) ? design.nodes : [], joints: design.joints && typeof design.joints === 'object' ? design.joints : undefined, members: design.members }, note: typeof design.note === 'string' ? design.note.slice(0, 300) : null, analyses, elapsedMs: Date.now() - started };
  } catch (e) {
    const msg = String(e.message || e).slice(0, 400);
    return { error: /interrupted/i.test(msg) ? `Program stopped: ${ms / 1000} s budget exhausted` : `Program error: ${msg}`, analyses, elapsedMs: Date.now() - started, lastDesign: lastOk ? lastDesign : null };
  } finally { try { vm.dispose(); } catch {} try { runtime.dispose(); } catch {} }
}

// ---------------------------------------------------------------------------
function bestAttempt(player) {
  return player.attempts.filter(a => a.design && !a.error).reduce((best, a) => (!best || a.score > best.score || (a.score === best.score && (a.maxUtil ?? 99) < (best.maxUtil ?? 99)) ? a : best), null);
}
function slim(p) { const { report, ...rest } = p; return rest; }

export async function structuresRun(run, { call, save, retryDelayMs = 20_000 }) {
  // Par first; a site with no deliverable par is replaced by the next seed.
  if (!run.result.par) {
    for (let tries = 0; tries < 40; tries++) {
      if (!run.input.site || run.input.site.seed !== run.input.seed) run.input.site = generateSite(run.input.seed);
      const par = parDesign(run.input.site);
      if (par) { run.result.par = { mass: par.mass, layout: par.layout, design: par.design }; break; }
      run.input.seed = (run.input.seed % (2 ** 31 - 2)) + 1;
      run.input.site = generateSite(run.input.seed);
    }
    if (!run.result.par) throw new Error('Could not find a solvable site');
  }
  const site = run.input.site, parMass = run.result.par.mass;
  run.result.baselines ||= {};
  if (!run.result.baselines.reference) {
    const ref = referenceDesign(site, run.result.par);
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
      const prompt = structuresPrompt(site, attempts, player.attempts, parMass, run.input.providerMaxOutput ? maxOutputFor(provider) : MAX_OUTPUT_TOKENS);
      let entry;
      try {
        // Sites from 27 Oct give each model its provider's full output ceiling; the thinking is paid for in cost and time.
        const maxTokens = run.input.providerMaxOutput ? maxOutputFor(provider) : MAX_OUTPUT_TOKENS;
        const response = await askWithRetries(run, provider, `${run.id}:structures:${provider}:${n}`, prompt, { call, retryDelayMs, maxTokens });
        const parsed = parseStructuresReply(response.text);
        const cutOff = /length|incomplete|max_output/i.test(String(response.finishReason));
        const base = { attempt: n, note: parsed.note, finishReason: response.finishReason || null, outputTokens: response.outputTokens ?? null };
        if (parsed.program) {
          const ran = await runProgram(site, parsed.program, parMass);
          if (ran.design) entry = { ...base, program: parsed.program, analyses: ran.analyses, elapsedMs: ran.elapsedMs, design: ran.design, note: ran.note || parsed.note, ...practice(site, ran.design, parMass) };
          else if (ran.lastDesign) entry = { ...base, program: parsed.program, analyses: ran.analyses, elapsedMs: ran.elapsedMs, design: ran.lastDesign, programError: ran.error, ...practice(site, ran.lastDesign, parMass) };
          else entry = { ...base, program: parsed.program, analyses: ran.analyses ?? 0, elapsedMs: ran.elapsedMs, error: ran.error, score: 0 };
        } else if (parsed.design) entry = { ...base, design: parsed.design, ...practice(site, parsed.design, parMass) };
        else entry = { ...base, error: cutOff ? (response.text ? 'Reply was cut off at the output limit before the block was complete' : 'Used the whole output budget thinking and returned nothing') : parsed.error, score: 0 };
      } catch (e) {
        if (e instanceof RunStopped) throw e;
        player.stopped = String(e.message || e).slice(0, 300);
        break;
      }
      player.attempts.push(entry);
      for (const a of player.attempts) if (a !== entry) delete a.report;
      await save(run);
    }
    const best = bestAttempt(player);
    player.final = best ? { attempt: best.attempt, ...evaluateHeldOut(site, best.design, parMass) } : { attempt: null, score: 0, delivered: 0, mass: null, units: [] };
    await save(run);
  }));
  // Best known design that held every unit, across players and the reference.
  const contenders = [...Object.entries(run.result.players).map(([id, p]) => ({ player: id, attempt: p.final?.attempt, final: p.final })), { player: 'reference', attempt: null, final: run.result.baselines.reference?.final }].filter(c => c.final && c.final.delivered === HELD_OUT_UNITS && c.final.mass);
  const best = contenders.reduce((b, c) => (!b || c.final.mass < b.final.mass ? c : b), null);
  run.result.best = best ? { player: best.player, attempt: best.attempt, mass: best.final.mass, score: best.final.score } : null;
  run.result.completedAt = new Date().toISOString();
}

export function publicStructuresView(run) {
  const done = run.status === 'complete';
  const site = run.input.site || generateSite(run.input.seed);
  const result = { ...run.result };
  if (!done && result.par) result.par = { mass: result.par.mass };
  if (result.players) result.players = Object.fromEntries(Object.entries(result.players).map(([id, p]) => [id, { ...p, attempts: p.attempts.map(a => { const { report, ...rest } = a; return rest; }) }]));
  return {
    id: run.id, status: run.status, error: run.error, created_at: run.created_at,
    input: { ...run.input, site: undefined }, site,
    heldOut: done ? heldOutUnits(site) : null,
    brief: structuresBrief(site, run.input.attempts || STRUCTURES_ATTEMPTS, run.result.par?.mass),
    result,
  };
}
