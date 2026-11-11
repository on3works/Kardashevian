// Lightest Structure, structures-v2: materials, section catalogue, site
// generator and load scenarios. Everything is seeded and deterministic.
//
// v2 (Oct 2026) replaces the 14-tube, two-variable v1 world with the kind of
// specification a bridge engineer actually works to: nine materials, eight
// section families (about 560 member options), rigid or pinned joints,
// cables, lanes of traffic with dynamic amplification, crowds, wind on every
// member, ice, temperature, support settlement, elastic supports, a seismic
// case, a vibration limit, fatigue, corrosion, partial safety factors and
// fabrication rules. Every built unit draws its own steel, timber, section
// thickness, imperfections, settlement and temperature from published bands.

import { rng } from '../sandbox/world.mjs';

export const STRUCTURES_PROTOCOL = 'structures-v2';
export const G = 9.81;
export const HELD_OUT_UNITS = 10;
export const CASES_PER_UNIT = 8;
export const MAX_NODES = 80;
export const MAX_MEMBERS = 250;

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const between = (r, lo, hi) => lo + (hi - lo) * r();
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, list) => list[Math.floor(r() * list.length)];

// ---------------------------------------------------------------------------
// Materials. E and fy in MPa, density kg/m³, alpha per K. fatigue = allowable
// stress range in MPa at 2 million cycles for a pinned (bolted) detail and a
// rigid (welded) detail. tol = half-width of the published band each built
// unit draws from (fraction of nominal).
export const MATERIALS = {
  S235: { id: 'S235', name: 'Steel S235', E: 210000, fy: 235, rho: 7850, alpha: 12e-6, fatigue: { pin: 90, rigid: 56 }, corrodes: true, weldable: true, families: ['CHS', 'SHS', 'IPE', 'HEB', 'L', 'FLAT', 'ROD'], tol: { fy: [0.95, 1.12], E: [0.97, 1.03], rho: [0.995, 1.005], t: [0.92, 1.03] } },
  S355: { id: 'S355', name: 'Steel S355', E: 210000, fy: 355, rho: 7850, alpha: 12e-6, fatigue: { pin: 90, rigid: 56 }, corrodes: true, weldable: true, families: ['CHS', 'SHS', 'IPE', 'HEB', 'L', 'FLAT', 'ROD'], tol: { fy: [0.94, 1.10], E: [0.97, 1.03], rho: [0.995, 1.005], t: [0.92, 1.03] } },
  S460: { id: 'S460', name: 'Steel S460', E: 210000, fy: 460, rho: 7850, alpha: 12e-6, fatigue: { pin: 90, rigid: 56 }, corrodes: true, weldable: true, families: ['CHS', 'SHS', 'IPE', 'HEB', 'L', 'FLAT', 'ROD'], tol: { fy: [0.93, 1.09], E: [0.97, 1.03], rho: [0.995, 1.005], t: [0.92, 1.03] } },
  S690: { id: 'S690', name: 'Steel S690 high-strength', E: 210000, fy: 690, rho: 7850, alpha: 12e-6, fatigue: { pin: 90, rigid: 50 }, corrodes: true, weldable: true, families: ['CHS', 'SHS', 'FLAT', 'ROD'], tol: { fy: [0.92, 1.08], E: [0.97, 1.03], rho: [0.995, 1.005], t: [0.92, 1.03] } },
  SS316: { id: 'SS316', name: 'Stainless 1.4404', E: 200000, fy: 240, rho: 8000, alpha: 16e-6, fatigue: { pin: 90, rigid: 56 }, corrodes: false, weldable: true, families: ['CHS', 'SHS', 'L', 'FLAT', 'ROD'], tol: { fy: [0.95, 1.20], E: [0.96, 1.04], rho: [0.995, 1.005], t: [0.92, 1.03] } },
  AL6082: { id: 'AL6082', name: 'Aluminium 6082-T6', E: 70000, fy: 260, rho: 2700, alpha: 23e-6, fatigue: { pin: 32, rigid: 18 }, corrodes: false, weldable: true, families: ['CHS', 'SHS', 'IPE'], tol: { fy: [0.93, 1.08], E: [0.97, 1.03], rho: [0.995, 1.005], t: [0.93, 1.03] } },
  AL7075: { id: 'AL7075', name: 'Aluminium 7075-T6', E: 72000, fy: 480, rho: 2810, alpha: 23e-6, fatigue: { pin: 32, rigid: 0 }, corrodes: false, weldable: false, families: ['CHS', 'SHS', 'ROD'], tol: { fy: [0.92, 1.08], E: [0.97, 1.03], rho: [0.995, 1.005], t: [0.93, 1.03] } },
  GL28: { id: 'GL28', name: 'Glulam GL28h', E: 12600, fy: 22, rho: 420, alpha: 5e-6, fatigue: { pin: 8, rigid: 6 }, corrodes: false, weldable: true, timber: true, families: ['TIMBER'], tol: { fy: [0.85, 1.20], E: [0.85, 1.15], rho: [0.9, 1.12], t: [0.98, 1.02] } },
  WIRE: { id: 'WIRE', name: 'Steel wire rope 1570', E: 160000, fy: 714, rho: 7850, alpha: 12e-6, fatigue: { pin: 110, rigid: 0 }, corrodes: true, weldable: false, cable: true, families: ['WIRE'], tol: { fy: [0.95, 1.10], E: [0.92, 1.05], rho: [0.99, 1.01], t: [0.97, 1.02] } },
};

// ---------------------------------------------------------------------------
// Section families. Every section gets: A (m²), Iy (in-plane bending, m⁴),
// Wy, Iz (out-of-plane, m⁴), Wz, Av (shear area, m²), depth (exposed depth
// for wind and ice, m), perim (m), slender (the width-to-thickness ratio the
// local-buckling class is read from), t (governing thickness, m) and the
// buckling curve imperfection alpha.
function chs(D, t) {
  const d = D - 2 * t, A = Math.PI * (D * D - d * d) / 4, I = Math.PI * (D ** 4 - d ** 4) / 64;
  return { A: A / 1e6, Iy: I / 1e12, Wy: 2 * I / D / 1e9, Iz: I / 1e12, Wz: 2 * I / D / 1e9, Av: 2 * A / Math.PI / 1e6, depth: D / 1e3, perim: Math.PI * D / 1e3, slender: D / t, slenderLimit: 90, t: t / 1e3, alpha: 0.21, dims: `${D}x${t}` };
}
function shs(b, t) {
  const bi = b - 2 * t, A = b * b - bi * bi, I = (b ** 4 - bi ** 4) / 12;
  return { A: A / 1e6, Iy: I / 1e12, Wy: 2 * I / b / 1e9, Iz: I / 1e12, Wz: 2 * I / b / 1e9, Av: A / 2 / 1e6, depth: b / 1e3, perim: 4 * b / 1e3, slender: (b - 3 * t) / t, slenderLimit: 42, t: t / 1e3, alpha: 0.21, dims: `${b}x${t}` };
}
function isec(h, b, tw, tf, alphaW) {
  const A = 2 * b * tf + (h - 2 * tf) * tw;
  const Iy = (b * h ** 3 - (b - tw) * (h - 2 * tf) ** 3) / 12, Iz = (2 * tf * b ** 3 + (h - 2 * tf) * tw ** 3) / 12;
  return { A: A / 1e6, Iy: Iy / 1e12, Wy: 2 * Iy / h / 1e9, Iz: Iz / 1e12, Wz: 2 * Iz / b / 1e9, Av: (h - 2 * tf) * tw / 1e6, depth: h / 1e3, perim: (2 * h + 4 * b) / 1e3, slender: (b / 2 - tw / 2) / tf, slenderLimit: 14, t: tf / 1e3, alpha: alphaW, dims: `${h}` };
}
function angle(a, t) {
  // Equal angle from two rectangles; weak principal axis about 0.4 of the
  // leg-parallel value.
  const A1 = a * t, A2 = (a - t) * t, A = A1 + A2;
  const y1 = t / 2, y2 = t + (a - t) / 2, yc = (A1 * y1 + A2 * y2) / A;
  const I = a * t ** 3 / 12 + A1 * (yc - y1) ** 2 + t * (a - t) ** 3 / 12 + A2 * (yc - y2) ** 2;
  return { A: A / 1e6, Iy: I / 1e12, Wy: I / (a - yc) / 1e9, Iz: 0.4 * I / 1e12, Wz: 0.4 * I / (a - yc) / 1e9, Av: a * t / 1e6, depth: a / 1e3, perim: 4 * a / 1e3, slender: a / t, slenderLimit: 15, t: t / 1e3, alpha: 0.49, dims: `${a}x${t}` };
}
function flat(b, t) {
  return { A: b * t / 1e6, Iy: t * b ** 3 / 12 / 1e12, Wy: t * b * b / 6 / 1e9, Iz: b * t ** 3 / 12 / 1e12, Wz: b * t * t / 6 / 1e9, Av: b * t / 1e6, depth: b / 1e3, perim: 2 * (b + t) / 1e3, slender: b / t, slenderLimit: 1e9, t: t / 1e3, alpha: 0.76, dims: `${b}x${t}` };
}
function rod(d) {
  const A = Math.PI * d * d / 4, I = Math.PI * d ** 4 / 64;
  return { A: A / 1e6, Iy: I / 1e12, Wy: 2 * I / d / 1e9, Iz: I / 1e12, Wz: 2 * I / d / 1e9, Av: 0.85 * A / 1e6, depth: d / 1e3, perim: Math.PI * d / 1e3, slender: 1, slenderLimit: 1e9, t: d / 2e3, alpha: 0.49, dims: `${d}` };
}
function wire(d) {
  const A = 0.6 * Math.PI * d * d / 4;
  return { A: A / 1e6, Iy: 0, Wy: 0, Iz: 0, Wz: 0, Av: 0, depth: d / 1e3, perim: Math.PI * d / 1e3, slender: 1, slenderLimit: 1e9, t: d / 2e3, alpha: 0, dims: `${d}` };
}
function timber(b, h) {
  return { A: b * h / 1e6, Iy: b * h ** 3 / 12 / 1e12, Wy: b * h * h / 6 / 1e9, Iz: h * b ** 3 / 12 / 1e12, Wz: h * b * b / 6 / 1e9, Av: b * h / 1.5 / 1e6, depth: h / 1e3, perim: 2 * (b + h) / 1e3, slender: 1, slenderLimit: 1e9, t: b / 1e3, alpha: 0.49, dims: `${b}x${h}` };
}
const FAMILY_DEFS = {
  CHS: { name: 'Circular hollow section', sizes: [[33.7, 2.6], [42.4, 3.2], [48.3, 3.2], [60.3, 3.2], [60.3, 4], [76.1, 3.2], [76.1, 4], [88.9, 4], [88.9, 5], [114.3, 4], [114.3, 5], [139.7, 5], [139.7, 6.3], [168.3, 5], [168.3, 6.3], [193.7, 6.3], [193.7, 8], [219.1, 8], [244.5, 8], [273, 10], [323.9, 10], [355.6, 12.5], [406.4, 12.5], [457, 16]], make: chs },
  SHS: { name: 'Square hollow section', sizes: [[40, 3], [50, 3], [60, 4], [70, 4], [80, 5], [90, 5], [100, 5], [100, 8], [120, 6], [140, 6], [150, 8], [180, 8], [200, 10], [250, 10], [300, 12.5], [350, 16]], make: shs },
  IPE: { name: 'I-beam IPE', sizes: [[80, 46, 3.8, 5.2], [100, 55, 4.1, 5.7], [120, 64, 4.4, 6.3], [140, 73, 4.7, 6.9], [160, 82, 5, 7.4], [180, 91, 5.3, 8], [200, 100, 5.6, 8.5], [220, 110, 5.9, 9.2], [240, 120, 6.2, 9.8], [270, 135, 6.6, 10.2], [300, 150, 7.1, 10.7], [360, 170, 8, 12.7], [400, 180, 8.6, 13.5], [450, 190, 9.4, 14.6]], make: (h, b, tw, tf) => isec(h, b, tw, tf, 0.21) },
  HEB: { name: 'Wide-flange HEB', sizes: [[100, 100, 6, 10], [120, 120, 6.5, 11], [140, 140, 7, 12], [160, 160, 8, 13], [180, 180, 8.5, 14], [200, 200, 9, 15], [220, 220, 9.5, 16], [240, 240, 10, 17], [260, 260, 10, 17.5], [300, 300, 11, 19], [340, 300, 12, 21.5], [400, 300, 13.5, 24]], make: (h, b, tw, tf) => isec(h, b, tw, tf, 0.34) },
  L: { name: 'Equal angle', sizes: [[40, 4], [50, 5], [60, 6], [70, 7], [80, 8], [90, 9], [100, 10], [120, 12], [150, 15], [200, 20]], make: angle },
  FLAT: { name: 'Flat bar', sizes: [[40, 8], [50, 10], [60, 10], [80, 12], [100, 12], [100, 20], [150, 20], [200, 25]], make: flat },
  ROD: { name: 'Solid round bar', sizes: [[12], [16], [20], [25], [32], [40], [50], [64]], make: rod },
  WIRE: { name: 'Wire rope (tension only)', sizes: [[8], [10], [12], [16], [20], [24], [32], [40]], make: wire },
  TIMBER: { name: 'Glulam rectangle (b x h)', sizes: [[90, 180], [115, 225], [140, 270], [160, 315], [190, 360], [190, 450], [215, 540], [240, 630], [280, 720], [320, 900]], make: timber },
};
export const FAMILIES = Object.fromEntries(Object.entries(FAMILY_DEFS).map(([id, f]) => [id, { id, name: f.name, sizes: f.sizes.map(s => ({ id: `${id}${f.make(...s).dims}`, ...f.make(...s) })) }]));

// A member option is "<material> <section>". The catalogue is every allowed
// pairing; about 560 of them.
export const OPTIONS = {};
for (const m of Object.values(MATERIALS)) for (const fam of m.families) for (const s of FAMILIES[fam].sizes) OPTIONS[`${m.id} ${s.id}`] = { key: `${m.id} ${s.id}`, material: m, family: fam, section: s, kgPerM: round(m.rho * s.A, 3) };
export const OPTION_COUNT = Object.keys(OPTIONS).length;

export const JOINT_KG = { pin: 12, rigid: 28 }; // base connection steel per joint
export const JOINT_KG_PER_KGM = 0.35; // plus this much per kg/m of every member meeting there

// ---------------------------------------------------------------------------
// Site generator.
export function generateSite(seed) {
  const r = rng((seed * 2654435761 + 1013) >>> 0);
  const span = round(between(r, 14, 42), 1);
  const panels = Math.max(5, Math.min(16, Math.round(span / between(r, 2.4, 4.2))));
  const deck = Array.from({ length: panels + 1 }, (_, k) => ({ id: `D${k}`, x: round(span * k / panels, 3), y: 0 }));
  let above = r() < 0.25 ? 0 : round(between(r, span / 12, span / 4), 2);
  let below = above === 0 ? round(between(r, span / 8, span / 4), 2) : r() < 0.35 ? 0 : round(between(r, span / 10, span / 4), 2);
  if (above === 0 && below === 0) below = round(span / 6, 2);
  const keepOuts = [];
  if (below > 0 && r() < 0.7) {
    const clear = above === 0 ? round(between(r, span / 12, below * 0.75), 2) : round(between(r, 0, below * 0.6), 2);
    const k = { id: pick(r, ['road', 'river', 'railway', 'canal']), x0: round(span * between(r, 0.15, 0.35), 2), x1: round(span * between(r, 0.65, 0.85), 2), y0: -below, y1: -clear };
    if (k.y1 - k.y0 >= 0.3) keepOuts.push(k);
  }
  if (above > 0 && r() < 0.3) {
    // An overhead line or a building edge near one end.
    const w = round(span * between(r, 0.12, 0.25), 2), x0 = r() < 0.5 ? round(span * between(r, 0.02, 0.1), 2) : round(span * between(r, 0.65, 0.86), 2);
    keepOuts.push({ id: pick(r, ['power line', 'building', 'crane path']), x0, x1: round(Math.min(span - 0.5, x0 + w), 2), y0: round(above * between(r, 0.35, 0.65), 2), y1: above });
  }
  const supports = [];
  const abutments = below > 0 && r() < 0.35;
  const rightType = r() < 0.65 ? 'roller' : 'pin';
  let drop = 0;
  if (abutments) {
    drop = round(between(r, below * 0.4, below), 2);
    const road = keepOuts.find(k => k.y1 < 0);
    if (above === 0 && road && drop > -road.y1) drop = -road.y1;
    supports.push({ id: 'S1', x: 0, y: -drop, type: 'pin' }, { id: 'S2', x: span, y: -drop, type: rightType });
  } else {
    supports.push({ id: 'D0', x: 0, y: 0, type: 'pin' }, { id: `D${panels}`, x: span, y: 0, type: rightType });
  }
  if (below > 0 && !keepOuts.some(k => k.y1 < 0) && r() < 0.3) supports.push({ id: 'P1', x: round(span * between(r, 0.35, 0.65), 2), y: -below, type: 'pin', pier: true });
  // Soft ground: some supports sit on springs rather than rock.
  const soft = r() < 0.45;
  for (const s of supports) if (soft && r() < 0.7) s.kv = Math.round(between(r, 40, 400) * 1000); // kN/m
  const lanes = r() < 0.6 ? 1 : 2;
  const weight = Math.round(between(r, 60, 320));
  const axles = r() < 0.7 ? 2 : 3;
  const spacingMin = round(between(r, 1.8, 3.6), 1);
  const site = {
    seed, span, panels, deck, supports,
    region: { xMin: 0, xMax: span, yMin: -below, yMax: above },
    keepOuts,
    loads: {
      deadKNm: round(between(r, 3, 12), 1),
      lanes,
      vehicle: { axles, weightMin: Math.round(weight / 3), weightMax: weight, spacingMin, spacingMax: round(spacingMin + between(r, 0.8, 2.4), 1), frontShare: axles === 2 ? 0.4 : 0.3, phi: round(between(r, 1.0, 1.4), 2) },
      pedestrianKNm: round(between(r, 0, 5), 1), // crowd, may load part of the deck
      brakingKNm: round(between(r, 0.3, 2.5), 2), // longitudinal, either direction
      windKNm2: round(between(r, 0.4, 1.8), 2), // out-of-plane pressure on every member
      iceMm: r() < 0.5 ? 0 : int(r, 5, 40), // radial ice on members, combined with reduced live load
      tempRange: int(r, 15, 55), // ± uniform temperature change in K
      seismicAh: r() < 0.5 ? 0 : round(between(r, 0.05, 0.35), 2), // horizontal acceleration as a fraction of g
      settlementMm: r() < 0.6 ? int(r, 5, 60) : 0, // differential settlement of one support
    },
    limits: { fMin: round(Math.max(1.5, Math.min(4.5, between(r, 0.8, 1.6) * 70 / span)), 1), /* the vibration floor scales with span, as the codes' rules of thumb do */ deflRatio: pick(r, [250, 300, 400]), fatigueCycles: pick(r, [5e5, 1e6, 2e6, 5e6, 1e7]), corrosion: pick(r, ['C2', 'C3', 'C4', 'C5']), designLifeYears: pick(r, [50, 100]) },
    factors: { gammaG: 1.35, gammaQ: 1.5, gammaM: round(between(r, 1.0, 1.25), 2), psiIce: 0.5 },
    fabrication: { maxMember: round(between(r, 8, 16), 1), minMember: 0.4, minAngleDeg: 15, maxAtJoint: 8, maxNodes: MAX_NODES, maxMembers: MAX_MEMBERS },
  };
  site.designCases = designCases(site);
  return site;
}

export const CORROSION_MM = { C2: 0.1, C3: 0.3, C4: 0.6, C5: 1.2 };

// ---------------------------------------------------------------------------
// Scenarios. A scenario lists what acts; the solver builds the factored and
// unfactored load vectors from it.
//   vehicles: [{ center, weight, spacing, dir }] (one per lane at most)
//   ped: { x0, x1 } or null (crowd on that stretch of deck)
//   braking: -1..1 (fraction of brakingKNm, longitudinal)
//   wind: -1..1 (fraction of windKNm2)   ice: 0|1   dT: K   seismic: -1..1   settle: mm
//   combo: 'uls' (1.35G + 1.5Q) | 'seismic' (1.0G + E + 0.3Q)
function vehicleCases(site, positions) {
  const v = site.loads.vehicle, L = site.span, out = [];
  for (const [i, f] of positions.entries()) {
    const spacing = v.spacingMin, len = spacing * (v.axles - 1);
    const center = round(Math.max(len / 2, Math.min(L - len / 2, L * f)), 2);
    const vehicles = [{ center, weight: v.weightMax, spacing, dir: i % 2 ? -1 : 1 }];
    if (site.loads.lanes === 2) vehicles.push({ center: round(Math.max(len / 2, Math.min(L - len / 2, L * (1 - f) )), 2), weight: v.weightMax, spacing: v.spacingMax, dir: i % 2 ? 1 : -1 });
    out.push({ vehicles, ped: null, braking: i % 2 ? -1 : 1, wind: i % 2 ? -1 : 1, ice: 0, dT: 0, seismic: 0, settle: 0, combo: 'uls' });
  }
  return out;
}
export function designCases(site) {
  const L = site.span, T = site.loads.tempRange;
  const cases = vehicleCases(site, [0.2, 0.35, 0.5, 0.65, 0.8]).map((c, i) => ({ id: `V${i + 1}`, ...c }));
  cases.push({ id: 'P1', vehicles: [], ped: { x0: 0, x1: L }, braking: 0, wind: 1, ice: 0, dT: 0, seismic: 0, settle: 0, combo: 'uls' });
  cases.push({ id: 'P2', vehicles: [], ped: { x0: 0, x1: round(L / 2, 2) }, braking: 0, wind: -1, ice: 0, dT: 0, seismic: 0, settle: 0, combo: 'uls' });
  cases.push({ id: 'T+', vehicles: vehicleCases(site, [0.5])[0].vehicles, ped: null, braking: 0, wind: 0, ice: 0, dT: T, seismic: 0, settle: 0, combo: 'uls' });
  cases.push({ id: 'T-', vehicles: vehicleCases(site, [0.5])[0].vehicles, ped: null, braking: 0, wind: 0, ice: 0, dT: -T, seismic: 0, settle: 0, combo: 'uls' });
  if (site.loads.iceMm) cases.push({ id: 'I', vehicles: vehicleCases(site, [0.5])[0].vehicles.map(v => ({ ...v, weight: Math.round(v.weight * site.factors.psiIce) })), ped: null, braking: 0, wind: 1, ice: 1, dT: -T, seismic: 0, settle: 0, combo: 'uls' });
  if (site.loads.seismicAh) { cases.push({ id: 'E+', vehicles: vehicleCases(site, [0.5])[0].vehicles, ped: null, braking: 0, wind: 0, ice: 0, dT: 0, seismic: 1, settle: 0, combo: 'seismic' }); cases.push({ id: 'E-', vehicles: vehicleCases(site, [0.5])[0].vehicles, ped: null, braking: 0, wind: 0, ice: 0, dT: 0, seismic: -1, settle: 0, combo: 'seismic' }); }
  if (site.loads.settlementMm) cases.push({ id: 'S', vehicles: vehicleCases(site, [0.5])[0].vehicles, ped: null, braking: 0, wind: 0, ice: 0, dT: 0, seismic: 0, settle: site.loads.settlementMm, settleAt: site.supports[site.supports.length - 1].id, combo: 'uls' });
  return cases;
}

// A broad sweep of the envelope for sizing par: vehicles at every deck node
// with both spacings and both directions, crossed with wind, temperature and
// the other actions at their extremes.
export function envelopeCases(site) {
  const v = site.loads.vehicle, L = site.span, T = site.loads.tempRange, out = [];
  const spacings = [v.spacingMin, v.spacingMax];
  for (const spacing of spacings) {
    const len = spacing * (v.axles - 1);
    for (const d of site.deck) for (const off of [len / 2, -len / 2]) {
      const c = round(d.x + off, 3);
      if (c < len / 2 - 1e-9 || c > L - len / 2 + 1e-9) continue;
      for (const dir of [1, -1]) {
        const vehicles = [{ center: c, weight: v.weightMax, spacing, dir }];
        if (site.loads.lanes === 2) vehicles.push({ center: round(L - c, 3), weight: v.weightMax, spacing: spacings[1 - spacings.indexOf(spacing)], dir: -dir });
        for (const [wind, dT] of [[1, T], [-1, -T], [1, -T], [-1, T]]) out.push({ id: `E${out.length}`, vehicles, ped: null, braking: dir, wind, ice: 0, dT, seismic: 0, settle: 0, combo: 'uls' });
      }
    }
  }
  for (const [x0, x1] of [[0, L], [0, L / 2], [L / 2, L], [L / 4, 3 * L / 4]]) for (const wind of [1, -1]) out.push({ id: `E${out.length}`, vehicles: [], ped: { x0, x1 }, braking: 0, wind, ice: 0, dT: wind * T, seismic: 0, settle: 0, combo: 'uls' });
  if (site.loads.iceMm) for (const f of [0.3, 0.5, 0.7]) out.push({ id: `E${out.length}`, vehicles: vehicleCases(site, [f])[0].vehicles.map(x => ({ ...x, weight: Math.round(x.weight * site.factors.psiIce) })), ped: null, braking: 0, wind: 1, ice: 1, dT: -T, seismic: 0, settle: 0, combo: 'uls' });
  if (site.loads.seismicAh) for (const s of [1, -1]) for (const f of [0.3, 0.7]) out.push({ id: `E${out.length}`, vehicles: vehicleCases(site, [f])[0].vehicles, ped: null, braking: 0, wind: 0, ice: 0, dT: 0, seismic: s, settle: 0, combo: 'seismic' });
  if (site.loads.settlementMm) for (const s of site.supports) for (const f of [0.3, 0.5, 0.7]) out.push({ id: `E${out.length}`, vehicles: vehicleCases(site, [f])[0].vehicles, ped: null, braking: 0, wind: 1, ice: 0, dT: T, seismic: 0, settle: site.loads.settlementMm, settleAt: s.id, combo: 'uls' });
  return out;
}

// Secret built units: each draws its own material factors, imperfection
// factor and load cases from the published bands.
export function heldOutUnits(site) {
  const r = rng((site.seed * 40503 + 211) >>> 0);
  const v = site.loads.vehicle, L = site.span, T = site.loads.tempRange;
  return Array.from({ length: HELD_OUT_UNITS }, (_, u) => {
    const material = {};
    for (const m of Object.values(MATERIALS)) material[m.id] = { fyF: round(between(r, ...m.tol.fy), 3), EF: round(between(r, ...m.tol.E), 3), rhoF: round(between(r, ...m.tol.rho), 4), tF: round(between(r, ...m.tol.t), 3) };
    const imperfection = round(between(r, 0.8, 1.5), 2); // multiplies every buckling curve's alpha
    const cases = Array.from({ length: CASES_PER_UNIT }, (_, i) => {
      const kind = r();
      const spacing = round(between(r, v.spacingMin, v.spacingMax), 2), len = spacing * (v.axles - 1);
      const veh = () => ({ center: round(between(r, len / 2, L - len / 2), 2), weight: Math.round(between(r, v.weightMin, v.weightMax)), spacing, dir: r() < 0.5 ? 1 : -1 });
      const vehicles = kind < 0.85 ? [veh()] : [];
      if (vehicles.length && site.loads.lanes === 2 && r() < 0.7) vehicles.push(veh());
      const ped = r() < 0.4 ? (() => { const a = round(between(r, 0, L * 0.6), 2); return { x0: a, x1: round(between(r, a + L * 0.2, L), 2) }; })() : null;
      const seismic = site.loads.seismicAh && r() < 0.2 ? (r() < 0.5 ? 1 : -1) : 0;
      const ice = site.loads.iceMm && r() < 0.2 ? 1 : 0;
      const settle = site.loads.settlementMm && r() < 0.3 ? Math.round(between(r, 0, site.loads.settlementMm)) : 0;
      return { id: `U${u + 1}.${i + 1}`, vehicles: ice ? vehicles.map(x => ({ ...x, weight: Math.round(x.weight * site.factors.psiIce) })) : vehicles, ped, braking: round(between(r, -1, 1), 2), wind: round(between(r, -1, 1), 2), ice, dT: Math.round(between(r, -T, T)), seismic, settle, settleAt: settle ? pick(r, site.supports).id : undefined, combo: seismic ? 'seismic' : 'uls' };
    });
    return { unit: u + 1, material, imperfection, cases };
  });
}
