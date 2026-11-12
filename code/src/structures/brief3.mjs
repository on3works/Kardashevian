// structures-v3: the brief a model works from.
import { MATERIALS, FAMILIES, OPTION_COUNT, JOINT_KG, JOINT_KG_PER_KGM, CORROSION_MM } from './site2.mjs';
import { STRUCTURES3_PROTOCOL, HELD_OUT_UNITS, CASES_PER_UNIT } from './site3.mjs';

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const fmtKg = v => (v < 1000 ? String(round(v, 1)) : Math.round(v).toLocaleString('en'));

function sectionTable() {
  const lines = [];
  for (const f of Object.values(FAMILIES)) {
    lines.push(`  ${f.id} (${f.name}): id | A cm² | Iy cm⁴ (strong axis) | Iz cm⁴ (weak axis) | Wy cm³ | Wz cm³ | depth mm | wall/thickness mm`);
    for (const s of f.sizes) lines.push(`    ${s.id} | ${round(s.A * 1e4, 2)} | ${round(s.Iy * 1e8, 1)} | ${round(s.Iz * 1e8, 1)} | ${round(s.Wy * 1e6, 1)} | ${round(s.Wz * 1e6, 1)} | ${Math.round(s.depth * 1e3)} | ${round(s.t * 1e3, 1)}`);
  }
  return lines.join('\n');
}
function materialTable() {
  return Object.values(MATERIALS).map(m => `  ${m.id} (${m.name}): E ${m.E.toLocaleString('en')} MPa, design strength ${m.fy} MPa, ${m.rho} kg/m³, α ${(m.alpha * 1e6).toFixed(0)}e-6/K, fatigue Δσ pinned ${m.fatigue.pin} / rigid ${m.fatigue.rigid || 'n/a'} MPa, ${m.corrodes ? 'corrodes' : 'no corrosion'}, ${m.weldable ? 'moment joints allowed' : 'pinned joints only'}${m.cable ? ', TENSION ONLY (slackens in compression, no bending)' : ''}; families ${m.families.join('/')}; built units draw strength ${Math.round(m.tol.fy[0] * 100)}–${Math.round(m.tol.fy[1] * 100)}%, E ${Math.round(m.tol.E[0] * 100)}–${Math.round(m.tol.E[1] * 100)}%, thickness ${Math.round(m.tol.t[0] * 100)}–${Math.round(m.tol.t[1] * 100)}% of nominal`).join('\n');
}
function caseLine(c) {
  const parts = [];
  for (const v of c.vehicles) parts.push(`${v.weight} kN vehicle in lane ${v.lane + 1} at x = ${v.center} m, axles ${v.spacing} m apart, front toward ${v.dir > 0 ? '+x' : '-x'}`);
  if (c.crowd) parts.push(`crowd on x ${c.crowd.x0}..${c.crowd.x1} m, ${c.crowd.side === 'both' ? 'full width' : `${c.crowd.side} half (z ${c.crowd.side === 'left' ? '<' : '>'} 0)`}`);
  if (c.braking) parts.push(`braking ${c.braking > 0 ? '+x' : '-x'}`);
  if (c.wind) parts.push(`wind ${c.wind > 0 ? '+z' : '-z'} at ${Math.round(Math.abs(c.wind) * 100)}%`);
  if (c.ice) parts.push('ice');
  if (c.dT) parts.push(`ΔT ${c.dT > 0 ? '+' : ''}${c.dT} K`);
  if (c.seismic) parts.push(`seismic (${c.seismic.x} x, ${c.seismic.z} z)`);
  if (c.settle) parts.push(`${c.settleAt} settles ${c.settle} mm`);
  return `${c.id} (${c.combo === 'seismic' ? 'seismic combination' : 'ULS'}): ${parts.join('; ') || 'permanent loads only'}`;
}

export function structuresBrief3(site, attempts, boundMass) {
  const v = site.loads.vehicle, l = site.limits, f = site.factors, fab = site.fabrication, R = site.region;
  const fixWord = s => `${s.id} holds ${s.fix.split('').join(', ')}${s.kv ? ` (on soft ground: vertical spring ${(s.kv / 1000).toFixed(0)} kN/mm)` : ''}`;
  return `Kardashevian lab · Lightest Structure (${STRUCTURES3_PROTOCOL})
Design the lightest three-dimensional bridge structure that carries every load below on every one of ${HELD_OUT_UNITS} built units. Axes: x along the bridge, y up, z across, in metres. The deck is the plane y = 0. You choose nodes, members, each member's material and section (${OPTION_COUNT} options), and whether each joint is pinned or rigid.

SITE
- Span ${site.span} m, deck width ${site.width} m. Fixed deck nodes, which carry the deck loads, in two edge lines: L0..L${site.panels} at z = ${-site.width / 2} and R0..R${site.panels} at z = ${site.width / 2}, at x = ${site.deck.filter((_, i) => i % 2 === 0).map(d => d.x).join(', ')}.
- Bearings (the only supports): ${site.supports.map(fixWord).join('; ')}. Any direction a bearing does not hold is free to slide. Four bearings make the structure statically indeterminate: a stiff structure fights temperature and settlement, a flexible one gives.
- Allowed region for your nodes: x ${R.xMin}..${R.xMax}, y ${R.yMin}..${R.yMax}${R.yMax === 0 ? ' (nothing above the deck)' : ''}, z ${R.zMin}..${R.zMax}.
${site.keepOuts.map(k => `- Keep clear (${k.id}): no node inside and no member through the box x ${k.x0}..${k.x1}, y ${round(k.y0, 2)}..${round(k.y1, 2)}, z ${round(k.z0, 2)}..${round(k.z1, 2)}; members may lie on its faces.`).join('\n')}

LOADS (kN, kN/m, kN/m²)
- Permanent: deck dead load ${site.loads.deadKNm2} kN/m² over the deck, shared by the deck nodes; your members' own weight (density × area) and ${JOINT_KG.pin} kg per pinned joint or ${JOINT_KG.rigid} kg per rigid joint plus ${JOINT_KG_PER_KGM} kg per kg/m of every member meeting there. All added by us.
- Traffic: ${site.loads.lanes} lane${site.loads.lanes > 1 ? 's' : ''}, centred at z = ${site.loads.laneZ.join(' and ')} m. A vehicle has ${v.axles} axles (front axle ${Math.round(v.frontShare * 100)}% of its weight), weight ${v.weightMin}–${v.weightMax} kN, axle spacing ${v.spacingMin}–${v.spacingMax} m, either direction, multiplied by a dynamic factor Φ = ${v.phi}. Each axle is shared between the two deck lines by its lane's position (an off-centre lane twists the bridge) and between the neighbouring deck nodes by distance.
- Crowd: ${site.loads.crowdKNm2} kN/m² on any stretch of the deck, over the full width or over one half only.
- Braking: ${Math.round(site.loads.brakingShare * 100)}% of each vehicle's weight along x, either way, shared by all deck nodes.
- Wind: up to ${site.loads.windKNm2} kN/m² across the bridge (±z) on every member (drag 1.2 round, 2.0 others, on the member's depth and its length seen from the side), plus the same pressure on ${site.loads.deckWindDepth} m of deck edge, parapet and vehicles, applied at the deck nodes. Each member also bends under it between its two nodes.
${site.loads.iceMm ? `- Ice: up to ${site.loads.iceMm} mm radial ice on every member (8.83 kN/m³; it also widens the face the wind sees), combined with traffic reduced to ${Math.round(f.psiIce * 100)}%.` : '- No ice at this site.'}
- Temperature: uniform ±${site.loads.tempRange} K on every member.
${site.loads.seismicAh ? `- Seismic: ${site.loads.seismicAh} g on every mass in any horizontal direction, combined with 1.0 × permanent and 0.3 × traffic.` : '- No seismic case at this site.'}
${site.loads.settlementMm ? `- Settlement: any one bearing may settle up to ${site.loads.settlementMm} mm.` : '- No bearing settlement at this site.'}
- Combinations: strength checks use ${f.gammaG} × permanent + ${f.gammaQ} × variable (thermal and settlement at 1.0); seismic is 1.0 × permanent + seismic + 0.3 × traffic.

CHECKS (every one must pass on every built unit)
- Members, with partial factor γM = ${f.gammaM}: tension N ≤ A·fy/γM. Compression N ≤ χ·A·fy/γM with χ the lower of the two axes: λ̄ = √(A fy / Ncr), Ncr = π²EI/L² with L the member's full length, Φ = 0.5[1 + α(λ̄ − 0.2) + λ̄²], χ = 1/(Φ + √(Φ² − λ̄²)); α = 0.21 tubes and IPE, 0.34 HEB, 0.49 angles/rods/timber, 0.76 flat bars, times each unit's imperfection factor (0.8–1.5). Section class reduces thin sections (limit 90ε² round tubes, 42ε square, 14ε flanges, 15ε angles, ε = √(235/fy)).
- Interaction: N/NRd + My/MyRd + Mz/MzRd ≤ 1. Moments come from rigid joints and from the member's own weight (and ice) and wind between its nodes (wL²/8). A member's strong axis (Iy) resists bending in the vertical plane through it. Shear V ≤ Av·fy/(√3 γM).
- GLOBAL BUCKLING: under every factored case the whole structure's elastic buckling factor α_cr must be at least ${l.alphaCr}. A compression chord with nothing holding it sideways fails here even if every member passes on its own. Below α_cr = 10, compression utilisations are amplified by 1/(1 − 1/α_cr).
- No mechanism in any direction. In 3D that needs bracing across the bridge as well as along it. Cables that go into compression slacken and are left out.
- Deck sag ≤ span/${l.deflRatio} = ${round(site.span / l.deflRatio * 1000, 1)} mm and sideways sway ≤ span/${l.swayRatio} = ${round(site.span / l.swayRatio * 1000, 1)} mm under the unfactored variable loads of any case.
- Lowest natural frequency, in any direction including twisting, ≥ ${l.fMin} Hz.
- Fatigue: each member's axial stress range from traffic (unfactored, with Φ) ≤ its material's Δσ for the joint type × (2·10⁶ / ${l.fatigueCycles.toLocaleString('en')})^(1/3).
- ROBUSTNESS: any single wire rope or solid rod may snap. With it gone, the rest must carry 1.0 × permanent + ${f.accidentalLive} × the first traffic case without a mechanism and within material strength (γM = 1).
- Corrosion class ${l.corrosion}, design life ${l.designLifeYears} years: carbon steel loses ${round(CORROSION_MM[l.corrosion] * l.designLifeYears / 50, 2)} mm of wall for capacity (not for mass); stainless and aluminium none; timber outdoors (C4/C5) loses 20% strength.
- Fabrication: members ${fab.minMember}–${fab.maxMember} m, at least ${fab.minAngleDeg}° between members at a joint, at most ${fab.maxAtJoint} members per joint, ${fab.maxNodes} nodes and ${fab.maxMembers} members in all. Members may cross without a node.

MATERIALS
${materialTable()}

SECTIONS (member option = "MATERIAL SECTION", e.g. "S460 CHS139.7x6.3", "WIRE WIRE16", "GL28 TIMBER140x270"; mass = density × A)
${sectionTable()}

JOINTS
- Each node is "pin" (default) or "rigid". At a rigid node, members of weldable materials are moment-connected in all directions; a member may opt out with ends: "pin". Cables are always pinned. Deck nodes are pinned unless you list them in "joints".

PUBLISHED DESIGN CASES (feedback after each attempt uses these with nominal materials)
${site.designCases.map(caseLine).join('\n')}

SCORING
You get ${attempts} attempts. After each you see mass, score and an analysis report. Your best practice design is then built ${HELD_OUT_UNITS} times; each unit draws its own material strength, stiffness, density and thickness inside the bands above, its own imperfection factor, and ${CASES_PER_UNIT} load cases: the proof load PL, then unseen cases from the ranges above (vehicles of any weight, spacing, lane and position, partial and one-sided crowds, wind and temperature anywhere in range, ice, seismic in any direction and settlement of any bearing where the site has them). A unit that fails any check scores 0.
A unit that holds scores 100 × M_min ÷ your mass, where M_min = ${boundMass ? `${fmtKg(boundMass)} kg` : 'a computed lower bound'} is a lower bound on the mass of ANY structure for this site: the deck dead load and the proof load alone produce a bending moment M(x) that must be carried within the allowed depth H, so the forces crossing each section satisfy Σ|N| ≥ |M|/H and the material weighs at least (ρ/f)·∫|M|/H dx with the best density-to-strength ratio in the catalogue. Everything else (the other cases, self-weight, buckling, stiffness, bracing, joints, robustness) only adds mass, so 100 cannot be reached and real designs score a few points at most. Every kilogram you remove is worth more than the last. Design for the whole ranges and the weakest unit, not for the published cases.`;
}

export const REPLY_FORMAT3 = `Reply in ONE of two ways:
(A) A design, in a \`\`\`json block:
{"note": "one sentence on your idea and what you changed", "nodes": [{"id": "T1", "x": 3.5, "y": 2.0, "z": -2.4, "joint": "pin"}, ...], "joints": {"L3": "rigid"}, "members": [["L0", "T1", "S355 CHS114.3x5"], {"a": "T1", "b": "T2", "spec": "WIRE WIRE16"}, ...]}
List only your own nodes in "nodes"; the deck nodes L0.. and R0.. exist already. "joints" (optional) sets the joint type of existing nodes.
(B) A program, in a \`\`\`javascript block, that searches for a design using our analysis engine:
function design(site, analyse) { ... return { note, nodes, joints, members }; }
analyse(design) returns { ok, mass, score, maxUtil, failure, sag, sagLimit, sway, swayLimit, alphaCr, alphaCrMin, frequency, fMin, fatigueWorst, robustness, members: [{ id, util, mode, tension, compression, moment }], cases: [{ id, maxUtil, governing, mode, sag }] } for the published cases on nominal materials, or { error } for an invalid design. \`site\` is this site as JSON with a \`catalogue\` of materials and sections. You may call analyse at most 400 times and the program must finish within 90 s.`;
