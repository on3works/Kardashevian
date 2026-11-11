// Lightest Structure arena (structures-v1): design a 2D steel truss bridge that
// carries a generated site's loads at the lowest mass. Every site is seeded,
// so the same seed gives the same site, load envelope and held-out units on
// every machine. Models see the site, the load envelope, the published design
// cases and the material tolerances; the held-out units (their material
// draws and load cases) stay secret until every model has finished.

import { rng } from '../../sandbox/world.mjs';

export const STRUCTURES_PROTOCOL = 'structures-v1';
export const NOMINAL = { fy: 355, E: 210000, density: 7850 }; // MPa, MPa, kg/m³
// Each built unit's steel is drawn inside these bounds (fractions of nominal).
export const TOLERANCE = { fyMin: 0.92, fyMax: 1.05, EMin: 0.95, EMax: 1.03 };
export const SAFETY = 1.5; // on yield and on Euler buckling
export const DEFLECTION_RATIO = 300; // deck may sag at most span / 300
export const MIN_MEMBER = 0.5; // m
export const MAX_MEMBER = 12; // m, longest piece that can be delivered
export const MAX_NODES = 80;
export const MAX_MEMBERS = 250;
export const JOINT_KG = 15; // connection steel per joint with members
export const HELD_OUT_UNITS = 10;
export const CASES_PER_UNIT = 6;
export const G = 9.81;

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const between = (r, lo, hi) => lo + (hi - lo) * r();

// Circular hollow sections (outer diameter × wall, mm), lightest first.
const CHS = [[48.3, 3.2], [60.3, 4], [76.1, 4], [88.9, 5], [114.3, 5], [139.7, 6.3], [168.3, 6.3], [193.7, 8], [219.1, 8], [273, 10], [323.9, 10], [355.6, 12.5], [406.4, 12.5], [457, 16]];
export const SECTIONS = CHS.map(([D, t]) => {
  const d = D - 2 * t;
  const A = Math.PI * (D * D - d * d) / 4 / 1e6; // m²
  const I = Math.PI * (D ** 4 - d ** 4) / 64 / 1e12; // m⁴
  return { id: `CHS${D}x${t}`, D, t, A, I, kgPerM: round(NOMINAL.density * A, 2) };
}).sort((a, b) => a.A - b.A);
export const SECTION_BY_ID = Object.fromEntries(SECTIONS.map(s => [s.id, s]));

export function generateSite(seed) {
  const r = rng((seed * 2654435761 + 97) >>> 0);
  const span = round(between(r, 12, 36), 1);
  const panels = Math.max(4, Math.min(12, Math.round(span / between(r, 2.5, 4.5))));
  const deck = Array.from({ length: panels + 1 }, (_, k) => ({ id: `D${k}`, x: round(span * k / panels, 3), y: 0 }));
  let above = r() < 0.3 ? 0 : round(between(r, span / 10, span / 4), 2);
  let below = above === 0 ? round(between(r, span / 8, span / 4), 2) : r() < 0.4 ? 0 : round(between(r, span / 10, span / 4), 2);
  if (above === 0 && below === 0) below = round(span / 6, 2);
  // A clearance envelope under the middle of the span (a road or a river):
  // no node or member may enter it.
  let keepOut = null;
  if (below > 0 && r() < 0.65) {
    const clear = above === 0 ? round(between(r, span / 12, below * 0.75), 2) : round(between(r, 0, below * 0.6), 2);
    keepOut = { x0: round(span * between(r, 0.18, 0.35), 2), x1: round(span * between(r, 0.65, 0.82), 2), y0: -below, y1: -clear };
    if (keepOut.y1 - keepOut.y0 < 0.3) keepOut = null;
  }
  const supports = [];
  const abutments = below > 0 && r() < 0.35;
  const rightType = r() < 0.7 ? 'roller' : 'pin';
  if (abutments) {
    let drop = round(between(r, below * 0.4, below), 2);
    // With nothing allowed above the deck, the abutments sit no deeper than the
    // clearance so a deck truss can reach them.
    if (above === 0 && keepOut && drop > -keepOut.y1) drop = -keepOut.y1;
    supports.push({ id: 'S1', x: 0, y: -drop, type: 'pin' }, { id: 'S2', x: span, y: -drop, type: rightType });
  } else {
    supports.push({ id: 'D0', x: 0, y: 0, type: 'pin' }, { id: `D${panels}`, x: span, y: 0, type: rightType });
  }
  if (below > 0 && !keepOut && r() < 0.3) supports.push({ id: 'P1', x: round(span * between(r, 0.35, 0.65), 2), y: -below, type: 'pin' });
  const weight = Math.round(between(r, 60, 240)); // kN, a loaded lorry at most
  const spacingMin = round(between(r, 2.5, 3.5), 1);
  const loads = {
    deadKNm: round(between(r, 3, 9), 1), // deck slab and surfacing, always present
    vehicle: { weightMin: Math.round(weight / 2), weightMax: weight, frontShare: 0.4, spacingMin, spacingMax: round(spacingMin + between(r, 1, 2.5), 1) },
    windKNm: round(between(r, 0.5, 2), 2), // horizontal on the deck, either direction, any value up to this
  };
  const site = { seed, span, panels, deck, supports, region: { xMin: 0, xMax: span, yMin: -below, yMax: above }, keepOut, loads };
  site.designCases = designCases(site);
  return site;
}

// Published cases: the heaviest vehicle at five positions with full wind,
// alternating direction, plus dead load and wind alone.
export function designCases(site) {
  const v = site.loads.vehicle, L = site.span, w = site.loads.windKNm;
  const cases = [0.18, 0.32, 0.5, 0.68, 0.82].map((f, i) => ({ id: `C${i + 1}`, vehicle: { center: round(L * f, 2), weight: v.weightMax, spacing: v.spacingMin, dir: i % 2 ? -1 : 1 }, wind: i % 2 ? -w : w }));
  cases.push({ id: 'C6', vehicle: null, wind: w });
  return cases;
}

// Every case the vehicle envelope allows, sampled finely enough that a design
// passing all of them passes any held-out case. Used for par and reference.
// Member forces are linear in each axle's position between deck nodes, so the
// worst case always has an axle on a deck node and the spacing at a limit or
// at a whole number of panels. Weight between 0 and the maximum is covered by
// the no-vehicle cases and the full-weight ones (forces are linear in weight).
export function envelopeCases(site) {
  const v = site.loads.vehicle, L = site.span, w = site.loads.windKNm, a = L / site.panels;
  const out = [{ id: 'E-w+', vehicle: null, wind: w }, { id: 'E-w-', vehicle: null, wind: -w }];
  const spacings = new Set([v.spacingMin, v.spacingMax]);
  for (let k = 1; k * a <= v.spacingMax; k++) if (k * a >= v.spacingMin) spacings.add(round(k * a, 4));
  for (const spacing of spacings) {
    const centers = new Set();
    for (const d of site.deck) for (const off of [spacing / 2, -spacing / 2]) { const c = round(d.x + off, 4); if (c >= spacing / 2 - 1e-9 && c <= L - spacing / 2 + 1e-9) centers.add(c); }
    for (const c of centers) for (const dir of [1, -1]) for (const wind of [w, -w]) out.push({ id: `E${out.length}`, vehicle: { center: c, weight: v.weightMax, spacing, dir }, wind });
  }
  return out;
}

// Secret held-out units: each is one built bridge with its own steel and its
// own six load cases drawn from the published envelope.
export function heldOutUnits(site) {
  const r = rng((site.seed * 40503 + 7) >>> 0);
  const v = site.loads.vehicle, L = site.span;
  return Array.from({ length: HELD_OUT_UNITS }, (_, u) => {
    const material = { fyF: round(between(r, TOLERANCE.fyMin, TOLERANCE.fyMax), 3), EF: round(between(r, TOLERANCE.EMin, TOLERANCE.EMax), 3) };
    const cases = Array.from({ length: CASES_PER_UNIT }, (_, i) => {
      const spacing = round(between(r, v.spacingMin, v.spacingMax), 2);
      const vehicle = r() < 0.9 ? { center: round(between(r, spacing / 2, L - spacing / 2), 2), weight: Math.round(between(r, v.weightMin, v.weightMax)), spacing, dir: r() < 0.5 ? 1 : -1 } : null;
      return { id: `U${u + 1}.${i + 1}`, vehicle, wind: round(between(r, -site.loads.windKNm, site.loads.windKNm), 2) };
    });
    return { unit: u + 1, material, cases };
  });
}

// Loads a case puts on the deck nodes, in kN: [fx, fy] per deck index. Deck
// stringers span between deck nodes, so an axle between two nodes is shared
// between them in proportion to distance; dead load and wind are shared by
// tributary length.
export function deckLoads(site, c) {
  const n = site.panels, a = site.span / n;
  const f = Array.from({ length: n + 1 }, () => [0, 0]);
  for (let k = 0; k <= n; k++) {
    const trib = (k === 0 || k === n ? 0.5 : 1) * a;
    f[k][1] -= site.loads.deadKNm * trib;
    f[k][0] += (c.wind || 0) * trib;
  }
  if (c.vehicle) {
    const { center, weight, spacing, dir } = c.vehicle;
    const front = site.loads.vehicle.frontShare;
    for (const [x, P] of [[center + dir * spacing / 2, weight * front], [center - dir * spacing / 2, weight * (1 - front)]]) {
      const pos = Math.max(0, Math.min(site.span, x)) / a;
      const k = Math.min(n - 1, Math.floor(pos)), t = pos - k;
      f[k][1] -= P * (1 - t);
      f[k + 1][1] -= P * t;
    }
  }
  return f;
}
