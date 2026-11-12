// Lightest Structure, structures-v3 (11 Nov 2026): the site in three dimensions.
//
// v2 was a bridge seen in elevation, scored against a textbook truss; low-cost
// models beat that par by 35–81% within eight attempts. v3 is a real 3D
// structure: a deck of a given width carried between four bearings, traffic
// that sits off-centre and twists it, wind that pushes it sideways, a traffic
// envelope no member may cross, compression chords that buckle sideways
// unless braced, and cables that may snap. It is scored against a lower bound
// on mass that no structure can reach, so 100 is unattainable and every point
// toward it is harder than the last.
//
// Axes: x along the bridge, y up, z across. The deck is at y = 0.
import { rng } from '../sandbox/world.mjs';
import { MATERIALS } from './site2.mjs';

export const STRUCTURES3_PROTOCOL = 'structures-v3';
export const HELD_OUT_UNITS = 10;
export const CASES_PER_UNIT = 8;
export const MAX_NODES = 120;
export const MAX_MEMBERS = 400;
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const between = (r, lo, hi) => lo + (hi - lo) * r();
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, list) => list[Math.floor(r() * list.length)];

export function generateSite3(seed) {
  const r = rng((seed * 2654435761 + 3301) >>> 0);
  const span = round(between(r, 18, 60), 1);
  const width = round(between(r, 4, 9), 1);
  const panels = Math.max(5, Math.min(16, Math.round(span / between(r, 3, 5))));
  const deck = [];
  for (let k = 0; k <= panels; k++) { const x = round(span * k / panels, 3); deck.push({ id: `L${k}`, x, y: 0, z: round(-width / 2, 3) }, { id: `R${k}`, x, y: 0, z: round(width / 2, 3) }); }
  const below = round(span * between(r, 1 / 12, 1 / 5), 2);
  const clearance = round(between(r, 4.5, 5.5), 1);
  let above = r() < 0.3 ? 0 : round(span * between(r, 1 / 10, 1 / 3), 2);
  if (above < clearance + 1) above = 0;
  const side = round(between(r, 0, 3), 1);
  const keepOuts = [{ id: 'traffic envelope', x0: 0, x1: span, y0: 0, y1: clearance, z0: -width / 2, z1: width / 2 }];
  if (r() < 0.6) {
    const clear = round(below * between(r, 0.4, 0.75), 2);
    keepOuts.push({ id: pick(r, ['shipping channel', 'railway', 'road']), x0: round(span * between(r, 0.2, 0.35), 2), x1: round(span * between(r, 0.65, 0.8), 2), y0: -below, y1: -clear, z0: -(width / 2 + side), z1: width / 2 + side });
  }
  // Four bearings under the deck corners. One is fixed; the others guide the
  // deck so it can breathe with temperature. Some sites anchor both ends.
  const anchored = r() < 0.35;
  const supports = [
    { id: 'L0', fix: 'xyz' }, { id: 'R0', fix: 'xy' },
    { id: `L${panels}`, fix: anchored ? 'xyz' : 'yz' }, { id: `R${panels}`, fix: anchored ? 'xy' : 'y' },
  ];
  for (const s of supports) { const d = deck.find(q => q.id === s.id); Object.assign(s, { x: d.x, y: d.y, z: d.z, type: s.fix.includes('x') ? 'pin' : 'roller' }); } // x, y, z and type are for drawing
  const soft = r() < 0.4;
  for (const s of supports) if (soft && r() < 0.7) s.kv = Math.round(between(r, 60, 500) * 1000); // kN/m, vertical spring
  const lanes = width >= 7 ? 2 : 1;
  const laneZ = lanes === 2 ? [round(-width / 4, 2), round(width / 4, 2)] : [round(between(r, -0.25, 0.25) * width, 2)];
  const weight = Math.round(between(r, 80, 400));
  const axles = r() < 0.7 ? 2 : 3;
  const spacingMin = round(between(r, 1.8, 3.6), 1);
  const site = {
    protocol: STRUCTURES3_PROTOCOL, seed, span, width, panels, deck, supports,
    region: { xMin: 0, xMax: span, yMin: -below, yMax: above, zMin: round(-(width / 2 + side), 3), zMax: round(width / 2 + side, 3) },
    keepOuts,
    loads: {
      deadKNm2: round(between(r, 1.5, 4.5), 1), // deck surfacing and slab, on the deck nodes
      lanes, laneZ,
      vehicle: { axles, weightMin: Math.round(weight / 3), weightMax: weight, spacingMin, spacingMax: round(spacingMin + between(r, 0.8, 2.4), 1), frontShare: axles === 2 ? 0.4 : 0.3, phi: round(between(r, 1.0, 1.4), 2) },
      crowdKNm2: round(between(r, 1, 5), 1), // may load any stretch, full width or one side only
      brakingShare: round(between(r, 0.1, 0.3), 2), // of the vehicle weight, along x, either way
      windKNm2: round(between(r, 0.5, 2), 2), // across the bridge (±z), on every member and on the deck edge
      deckWindDepth: round(between(r, 1.2, 3.2), 1), // m of deck edge, parapet and vehicles catching wind
      iceMm: r() < 0.5 ? 0 : int(r, 5, 40),
      tempRange: int(r, 15, 55),
      seismicAh: r() < 0.5 ? 0 : round(between(r, 0.05, 0.35), 2), // of g, along x or across z
      settlementMm: r() < 0.6 ? int(r, 5, 60) : 0,
    },
    limits: {
      fMin: round(Math.max(1.2, Math.min(4, between(r, 0.8, 1.5) * 70 / span)), 1), // lowest natural frequency, any direction
      deflRatio: pick(r, [300, 400, 500]), swayRatio: pick(r, [300, 400, 500]),
      alphaCr: pick(r, [3, 4, 5]), // global elastic buckling factor required under every factored case
      fatigueCycles: pick(r, [5e5, 1e6, 2e6, 5e6, 1e7]), corrosion: pick(r, ['C2', 'C3', 'C4', 'C5']), designLifeYears: pick(r, [25, 50, 100]),
    },
    factors: { gammaG: 1.35, gammaQ: 1.5, gammaM: round(between(r, 1.0, 1.25), 2), psiIce: 0.5, accidentalLive: 0.5 },
    fabrication: { maxMember: round(between(r, 11, 18), 1), minMember: 0.4, minAngleDeg: 12, maxAtJoint: 12, maxNodes: MAX_NODES, maxMembers: MAX_MEMBERS },
  };
  site.designCases = designCases3(site);
  return site;
}

// A scenario lists what acts; the solver builds the factored and service
// load vectors from it.
//   vehicles: [{ center, lane, weight, spacing, dir }]   crowd: { x0, x1, side: 'both'|'left'|'right' }
//   braking, wind: -1..1   ice: 0|1   dT: K   seismic: { x, z } fractions   settle: mm at settleAt
//   combo: 'uls' (1.35 G + 1.5 Q) | 'seismic' (1.0 G + E + 0.3 Q)
const blank = { vehicles: [], crowd: null, braking: 0, wind: 0, ice: 0, dT: 0, seismic: null, settle: 0, combo: 'uls' };
function vehicleAt(site, f, lane, spacing, dir, share = 1) {
  const v = site.loads.vehicle, len = spacing * (v.axles - 1);
  return { center: round(Math.max(len / 2, Math.min(site.span - len / 2, site.span * f)), 2), lane, weight: Math.round(v.weightMax * share), spacing, dir };
}
// The proof load: the heaviest vehicle in every lane at midspan. Every built
// unit is tested with it, which is what makes the lower bound on mass valid.
function proofLoad(site, id) { return { ...blank, id, vehicles: site.loads.laneZ.map((_, lane) => vehicleAt(site, 0.5, lane, site.loads.vehicle.spacingMin, 1)) }; }
export function designCases3(site) {
  const L = site.span, T = site.loads.tempRange, v = site.loads.vehicle, two = site.loads.lanes === 2, out = [proofLoad(site, 'PL')];
  [0.2, 0.35, 0.5, 0.65, 0.8].forEach((f, i) => {
    const vehicles = [vehicleAt(site, f, i % site.loads.lanes, v.spacingMin, i % 2 ? -1 : 1)];
    if (two && i % 2 === 0) vehicles.push(vehicleAt(site, 1 - f, 1 - (i % 2), v.spacingMax, -1));
    out.push({ ...blank, id: `V${i + 1}`, vehicles, braking: i % 2 ? -1 : 1, wind: i % 2 ? -0.6 : 0.6 });
  });
  out.push({ ...blank, id: 'C1', crowd: { x0: 0, x1: L, side: 'both' }, wind: 0.6 });
  out.push({ ...blank, id: 'C2', crowd: { x0: 0, x1: round(L / 2, 2), side: 'left' }, wind: -0.6 });
  out.push({ ...blank, id: 'W+', wind: 1 }, { ...blank, id: 'W-', wind: -1 });
  out.push({ ...blank, id: 'T+', vehicles: [vehicleAt(site, 0.5, 0, v.spacingMin, 1)], dT: T }, { ...blank, id: 'T-', vehicles: [vehicleAt(site, 0.5, 0, v.spacingMin, 1)], dT: -T });
  if (site.loads.iceMm) out.push({ ...blank, id: 'I', vehicles: [vehicleAt(site, 0.5, 0, v.spacingMin, 1, site.factors.psiIce)], wind: 1, ice: 1, dT: -T });
  if (site.loads.seismicAh) out.push({ ...blank, id: 'Ex', vehicles: [vehicleAt(site, 0.5, 0, v.spacingMin, 1)], seismic: { x: 1, z: 0.3 }, combo: 'seismic' }, { ...blank, id: 'Ez', vehicles: [vehicleAt(site, 0.5, 0, v.spacingMin, 1)], seismic: { x: 0.3, z: 1 }, combo: 'seismic' });
  if (site.loads.settlementMm) out.push({ ...blank, id: 'S', vehicles: [vehicleAt(site, 0.5, 0, v.spacingMin, 1)], settle: site.loads.settlementMm, settleAt: site.supports[3].id });
  return out;
}

// A broad sweep of what a built unit may see, for sizing the reference design.
export function envelopeCases3(site) {
  const L = site.span, T = site.loads.tempRange, v = site.loads.vehicle, out = [...designCases3(site)];
  const add = c => out.push({ ...blank, ...c, id: `E${out.length}` });
  for (let k = 1; k < site.panels; k++) for (let lane = 0; lane < site.loads.lanes; lane++) {
    const f = k / site.panels, first = vehicleAt(site, f, lane, k % 2 ? v.spacingMin : v.spacingMax, k % 2 ? 1 : -1);
    const vehicles = site.loads.lanes === 2 && k % 2 ? [first, vehicleAt(site, 1 - f, 1 - lane, v.spacingMax, -1)] : [first];
    add({ vehicles, braking: k % 2 ? 1 : -1, wind: lane ? 0.7 : -0.7, dT: (k % 3 - 1) * T });
  }
  for (const side of ['both', 'left', 'right']) for (const [x0, x1] of [[0, L], [0, L / 2], [L / 2, L], [L / 4, 3 * L / 4]]) add({ crowd: { x0, x1, side }, wind: side === 'left' ? -0.7 : 0.7 });
  for (const wind of [1, -1]) for (const dT of [T, -T]) add({ wind, dT });
  if (site.loads.iceMm) for (const f of [0.3, 0.7]) add({ vehicles: [vehicleAt(site, f, 0, v.spacingMin, 1, site.factors.psiIce)], wind: f < 0.5 ? 1 : -1, ice: 1, dT: -T });
  if (site.loads.seismicAh) for (let a = 0; a < 8; a++) add({ vehicles: [vehicleAt(site, 0.3 + 0.05 * a, a % site.loads.lanes, v.spacingMin, 1)], seismic: { x: round(Math.cos(a * Math.PI / 4), 2), z: round(Math.sin(a * Math.PI / 4), 2) }, combo: 'seismic' });
  if (site.loads.settlementMm) for (const s of site.supports) for (const dT of [T, -T]) add({ vehicles: [vehicleAt(site, 0.5, 0, v.spacingMin, 1)], settle: site.loads.settlementMm, settleAt: s.id, dT });
  return out;
}

// Secret built units: each draws its own material factors, imperfection
// factor and load cases from the published bands.
export function heldOutUnits3(site) {
  const r = rng((site.seed * 40503 + 977) >>> 0);
  const v = site.loads.vehicle, L = site.span, T = site.loads.tempRange;
  return Array.from({ length: HELD_OUT_UNITS }, (_, u) => {
    const material = {};
    for (const m of Object.values(MATERIALS)) material[m.id] = { fyF: round(between(r, ...m.tol.fy), 3), EF: round(between(r, ...m.tol.E), 3), rhoF: round(between(r, ...m.tol.rho), 4), tF: round(between(r, ...m.tol.t), 3) };
    const imperfection = round(between(r, 0.8, 1.5), 2);
    const cases = Array.from({ length: CASES_PER_UNIT }, (_, i) => {
      const kind = r(), id = `U${u + 1}.${i + 1}`;
      if (i === 0) return proofLoad(site, id);
      const truck = () => vehicleAt(site, between(r, 0.05, 0.95), int(r, 0, site.loads.lanes - 1), round(between(r, v.spacingMin, v.spacingMax), 2), r() < 0.5 ? 1 : -1, between(r, 0.75, 1));
      if (kind < 0.45) { const vehicles = [truck()]; if (site.loads.lanes === 2 && r() < 0.6) vehicles.push({ ...truck(), lane: 1 - vehicles[0].lane }); return { ...blank, id, vehicles, braking: round(between(r, -1, 1), 2), wind: round(between(r, -0.7, 0.7), 2), dT: Math.round(between(r, -T, T)) }; }
      if (kind < 0.6) { const x0 = round(between(r, 0, L * 0.6), 2); return { ...blank, id, crowd: { x0, x1: round(Math.min(L, x0 + between(r, L * 0.3, L)), 2), side: pick(r, ['both', 'left', 'right']) }, wind: round(between(r, -0.7, 0.7), 2) }; }
      if (kind < 0.72) return { ...blank, id, wind: r() < 0.5 ? 1 : -1, dT: Math.round(between(r, -T, T)) };
      if (kind < 0.82 && site.loads.iceMm) return { ...blank, id, vehicles: [vehicleAt(site, between(r, 0.2, 0.8), 0, v.spacingMin, 1, site.factors.psiIce)], wind: r() < 0.5 ? 1 : -1, ice: 1, dT: -T };
      if (kind < 0.92 && site.loads.seismicAh) { const a = between(r, 0, 2 * Math.PI); return { ...blank, id, vehicles: [truck()], seismic: { x: round(Math.cos(a), 2), z: round(Math.sin(a), 2) }, combo: 'seismic' }; }
      if (site.loads.settlementMm) return { ...blank, id, vehicles: [truck()], settle: Math.round(between(r, 0.3, 1) * site.loads.settlementMm), settleAt: pick(r, site.supports).id, dT: Math.round(between(r, -T, T)) };
      return { ...blank, id, vehicles: [truck()], braking: r() < 0.5 ? 1 : -1, wind: round(between(r, -0.7, 0.7), 2) };
    });
    return { unit: u + 1, material, imperfection, cases };
  });
}
