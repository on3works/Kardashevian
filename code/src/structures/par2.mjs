// Par and reference designs for structures-v2. Par: classic truss layouts
// (Pratt, Howe, Warren) above or below the deck at several depths, pinned
// joints, S355 circular tubes, every member sized by iteration against the
// load envelope on the weakest steel the bands allow, then verified on every
// held-out unit. Models may use any material, section family, rigid joints
// or cables to beat it. The reference engineer: a textbook Pratt with one
// tube size throughout.

import { MATERIALS, FAMILIES, envelopeCases, heldOutUnits } from './site2.mjs';
import { validateDesign, analyse, designMass, DesignError } from './frame.mjs';

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const PAR_MATERIAL = 'S355';
const SIZES = FAMILIES.CHS.sizes.map(s => s.id);

// The least favourable built unit the bands allow.
export function weakestUnit() {
  const material = {};
  for (const m of Object.values(MATERIALS)) material[m.id] = { fyF: m.tol.fy[0], EF: m.tol.E[0], rhoF: m.tol.rho[1], tF: m.tol.t[0] };
  return { unit: -1, material, imperfection: 1.5, cases: [] };
}

// The chord dips under (or over) a clearance zone: nodes within one panel
// of it sit just clear of its edge, and the chord climbs back at one panel
// depth per panel so that no chord segment cuts the zone.
function allowedDepth(site, side, x, depth) {
  const a = site.span / site.panels;
  let d = depth;
  for (const k of site.keepOuts) {
    const edge = side === 'above' ? k.y0 : -k.y1;
    if (side === 'above' ? k.y0 <= 0 : k.y1 >= 0) continue; // the zone is on the other side of the deck
    if (edge >= depth) continue;
    const dist = Math.max(0, k.x0 - x, x - k.x1);
    const limit = dist <= a ? edge - 0.05 : edge - 0.05 + (dist - a) * (depth / a);
    d = Math.min(d, limit);
  }
  return Math.max(0, d);
}

export function layout(site, { type, side, depth }) {
  const n = site.panels, L = site.span, a = L / n;
  const sign = side === 'above' ? 1 : -1;
  const yAt = x => round(sign * allowedDepth(site, side, x, depth), 4);
  const abut = site.supports.find(s => s.id === 'S1');
  const D = k => `D${k}`;
  const nodes = [], members = [];
  const add = (p, q) => members.push([p, q]);
  for (let k = 0; k < n; k++) add(D(k), D(k + 1));
  const hasO = k => !(k === 0 || k === n) || (abut && side === 'below');
  const O = k => (abut && side === 'below' && k === 0 ? 'S1' : abut && side === 'below' && k === n ? 'S2' : `O${k}`);
  if (type === 'warren') {
    const ids = [];
    for (let k = 0; k < n; k++) { const id = `M${k}`; const x = round(a * (k + 0.5), 4); nodes.push({ id, x, y: yAt(x) }); ids.push(id); add(D(k), id); add(id, D(k + 1)); }
    for (let k = 0; k + 1 < n; k++) add(ids[k], ids[k + 1]);
    if (abut && side === 'below') { add('S1', ids[0]); add(ids[n - 1], 'S2'); add('S1', D(0)); add('S2', D(n)); }
  } else {
    for (let k = 0; k <= n; k++) if (hasO(k) && !O(k).startsWith('S')) { const x = round(a * k, 4); nodes.push({ id: O(k), x, y: yAt(x) }); }
    for (let k = 0; k < n; k++) {
      const p = hasO(k), q = hasO(k + 1);
      if (p && q) add(O(k), O(k + 1));
      const leftHalf = k < n / 2;
      const down = (type === 'pratt') === leftHalf;
      if (p && q) { if (down) add(O(k), D(k + 1)); else add(D(k), O(k + 1)); }
      else if (!p && q) add(D(k), O(k + 1));
      else if (p && !q) add(O(k), D(k + 1));
    }
    for (let k = 0; k <= n; k++) if (hasO(k)) add(D(k), O(k));
  }
  if (abut && side !== 'below') { add('S1', D(0)); add('S1', D(1)); add('S2', D(n)); add('S2', D(n - 1)); }
  const pier = site.supports.find(s => s.pier);
  if (pier) {
    // Tie the pier to the nearest deck node(s) with a post and braces.
    const k = Math.round(pier.x / a);
    add('P1', D(Math.max(0, Math.min(n, k))));
    if (k - 1 >= 0) add('P1', D(k - 1));
    if (k + 1 <= n) add('P1', D(k + 1));
  }
  return { nodes, members };
}

// The members to grow when the structure is strong enough but too flexible:
// the 40% carrying the most axial force, which is where the chords are.
function stiffeners(res, forFrequency = false) {
  const score = forFrequency && res.modeEnergy ? res.modeEnergy : res.members.map(m => m.tension + m.compression);
  return score.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]).slice(0, Math.max(3, Math.ceil(res.members.length * 0.4))).map(x => x[1]);
}

function withSizes(lay, sizes, material = PAR_MATERIAL) {
  return { nodes: lay.nodes, members: lay.members.map((m, i) => [m[0], m[1], `${material} ${SIZES[sizes[i]]}`]) };
}

// Sizes a layout: step members up while they fail, down while they idle,
// against `cases` on the weakest unit; then verify on the held-out units
// and the nominal frequency/fatigue, stepping up what fails.
export function sizeLayout(site, lay, { cases, units, uniform = false, maxIter = 40 } = {}) {
  let sizes = lay.members.map(() => Math.min(4, SIZES.length - 1));
  const locked = lay.members.map(() => false);
  const weak = weakestUnit();
  try { validateDesign(site, withSizes(lay, sizes)); } catch (e) { if (e instanceof DesignError) return null; throw e; }
  const build = () => validateDesign(site, withSizes(lay, sizes));
  // Feasibility first: if the heaviest tubes everywhere cannot hold the
  // sizing cases on the weakest unit, no lighter choice will. Only strength
  // counts here: sag, frequency and fatigue depend on mass as well as size.
  const heaviest = analyse(site, validateDesign(site, withSizes(lay, lay.members.map(() => SIZES.length - 1))), cases, weak, { fatigue: false, frequency: false });
  if (heaviest.mechanism || heaviest.members.some(m => m.util > 1.2)) return null;
  for (let it = 0; it < maxIter; it++) {
    const res = analyse(site, build(), cases, weak, { fatigue: true, frequency: true });
    if (res.mechanism) return null;
    let changed = false;
    const sagBad = res.sag > res.sagLimit, fBad = res.frequency != null && res.frequency < site.limits.fMin;
    if (uniform) {
      const worst = Math.max(...res.members.map(m => m.util));
      if (worst > 1 || sagBad || fBad) { if (sizes[0] + 1 >= SIZES.length) return null; sizes = sizes.map(s => s + 1); changed = true; }
      else if (worst < 0.82 && it < maxIter - 5 && !locked[0]) { if (sizes[0] > 0) { sizes = sizes.map(s => s - 1); changed = true; } }
      if (!changed) break;
      if (worst > 1 || sagBad || fBad) locked[0] = true;
      continue;
    }
    res.members.forEach((m, i) => {
      if (m.util > 1) { if (sizes[i] + 1 < SIZES.length) { sizes[i]++; locked[i] = true; changed = true; } }
      else if (m.util < 0.6 && !locked[i] && sizes[i] > 0) { sizes[i]--; changed = true; }
    });
    if (sagBad || fBad) {
      // Stiffness comes from the chords: grow the members carrying the most force.
      for (const i of stiffeners(res, fBad)) if (sizes[i] + 1 < SIZES.length) { sizes[i]++; locked[i] = true; changed = true; }
    }
    if (!changed) break;
  }
  // Verification on every held-out unit; bump whatever fails, a few rounds.
  for (let bump = 0; bump < 30; bump++) {
    const design = build();
    const fails = new Set(); let soft = false;
    const nominal = analyse(site, design, cases.slice(0, 1), undefined, { fatigue: true, frequency: true });
    if (nominal.frequency < site.limits.fMin || !nominal.fatigue.ok) soft = true;
    for (const u of units) {
      const r = analyse(site, design, u.cases, u, { fatigue: true, frequency: true });
      if (r.mechanism) return null;
      r.members.forEach((m, i) => { if (m.util > 1) fails.add(i); });
      if (r.sag > r.sagLimit || r.frequency < site.limits.fMin || !r.fatigue.ok) soft = true;
      if (r.fatigue && r.fatigue.governing != null && !r.fatigue.ok) fails.add(r.fatigue.governing);
    }
    if (!fails.size && !soft) return { design: withSizes(lay, sizes), mass: round(designMass(design), 1) };
    if (uniform) { if (sizes[0] + 1 >= SIZES.length) return null; sizes = sizes.map(s => s + 1); continue; }
    if (soft && !fails.size) { const r = analyse(site, design, cases, weak); for (const i of stiffeners(r, r.frequency < site.limits.fMin)) fails.add(i); }
    let bumped = false;
    for (const i of fails) if (sizes[i] + 1 < SIZES.length) { sizes[i]++; bumped = true; }
    if (!bumped) return null;
  }
  return null;
}

export function candidateLayouts(site) {
  const out = [], { yMin, yMax } = site.region;
  const sides = [];
  if (yMax > 0) sides.push(['above', yMax]);
  if (yMin < 0) sides.push(['below', -yMin]);
  const abut = site.supports.find(s => s.id === 'S1');
  for (const [side, room] of sides) {
    const depths = new Set([room, room * 0.75, room * 0.5, site.span / 10, site.span / 7].filter(d => d > 0.5 && d <= room + 1e-9).map(d => round(d, 3)));
    for (const k of site.keepOuts) if (side === 'below' && k.y1 < 0) depths.add(round(-k.y1, 3));
    if (side === 'below' && abut) depths.add(round(-abut.y, 3));
    for (const depth of depths) {
      if (depth < 0.5) continue;
      if (abut && side === 'below' && Math.abs(depth + abut.y) > 1e-6) continue;
      for (const type of ['warren', 'pratt', 'howe']) out.push({ type, side, depth });
    }
  }
  return out;
}

// A reduced envelope for sizing (held-out verification covers the rest).
export function sizingCases(site) {
  const all = envelopeCases(site);
  return all.filter((c, i) => i % 2 === 0);
}

// Layouts are tried deepest first (usually lightest); after `budgetMs` the
// best so far stands, so a site never holds the worker for long.
export function parDesign(site, { onProgress, budgetMs = 120_000 } = {}) {
  const units = heldOutUnits(site), cases = sizingCases(site);
  const started = Date.now();
  let best = null;
  for (const c of candidateLayouts(site)) {
    if ((best && Date.now() - started > budgetMs) || Date.now() - started > 2.5 * budgetMs) break;
    const r = sizeLayout(site, layout(site, c), { cases, units });
    if (r && (!best || r.mass < best.mass)) best = { ...r, layout: c };
    onProgress?.(c, r);
  }
  return best;
}

// The reference engineer: a Pratt truss with one tube size throughout. When
// no uniform Pratt works, any uniform classic layout; failing that, the par
// layout with every member two sizes heavier (safe, and heavy).
export function referenceDesign(site, par = null) {
  const units = heldOutUnits(site), cases = sizingCases(site);
  const { yMin, yMax } = site.region;
  const abut = site.supports.find(s => s.id === 'S1');
  const tries = [];
  if (yMax > 0) tries.push({ type: 'pratt', side: 'above', depth: round(Math.min(yMax, site.span / 8), 3) });
  if (yMin < 0) tries.push({ type: 'pratt', side: 'below', depth: round(abut ? -abut.y : Math.min(-yMin, ...site.keepOuts.filter(k => k.y1 < 0).map(k => -k.y1), site.span / 8), 3) });
  for (const c of [...tries, ...candidateLayouts(site)]) {
    if (c.depth < 0.5) continue;
    const r = sizeLayout(site, layout(site, c), { cases, units, uniform: true });
    if (r) return { ...r, layout: c };
  }
  if (par) {
    const up = { nodes: par.design.nodes, members: par.design.members.map(([a, b, spec]) => { const [mat, sec] = spec.split(' '); const k = SIZES.indexOf(sec); return [a, b, `${mat} ${SIZES[Math.min(SIZES.length - 1, k + 2)]}`]; }) };
    const d = validateDesign(site, up);
    const held = units.every(u => analyse(site, d, u.cases, u).ok);
    if (held) return { design: up, mass: round(designMass(d), 1), layout: { ...par.layout, note: 'par layout, two sizes up' } };
  }
  return null;
}
