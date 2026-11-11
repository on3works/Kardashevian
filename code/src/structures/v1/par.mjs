// Par and reference designs. Par is our own optimizer: classic truss layouts
// (Pratt, Howe, Warren) above and below the deck at a sweep of depths, each
// member sized to the full load envelope with the weakest steel the tolerance
// allows, keeping the lightest design that also passes every held-out unit.
// Models can beat it: par is a yardstick, not a ceiling.
// The reference engineer builds a textbook Pratt truss with one section
// throughout: safe, simple and heavy.

import { SECTIONS, TOLERANCE, envelopeCases, heldOutUnits } from './site.mjs';
import { validateDesign, analyse, designMass } from './solver.mjs';

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const WEAKEST = { fyF: TOLERANCE.fyMin, EF: TOLERANCE.EMin };

// Builds the node and member lists (sections left blank) for one layout.
export function layout(site, { type, side, depth }) {
  const n = site.panels, L = site.span, a = L / n;
  const sign = side === 'above' ? 1 : -1, y = round(sign * depth, 4);
  const abut = site.supports.find(s => s.id === 'S1');
  const D = k => `D${k}`;
  const nodes = [], members = [];
  const add = (p, q) => members.push([p, q]);
  for (let k = 0; k < n; k++) add(D(k), D(k + 1));
  const hasO = k => !(k === 0 || k === n) || (abut && side === 'below');
  const O = k => (abut && side === 'below' && k === 0 ? 'S1' : abut && side === 'below' && k === n ? 'S2' : `O${k}`);
  if (type === 'warren') {
    const ids = [];
    for (let k = 0; k < n; k++) { const id = `M${k}`; nodes.push({ id, x: round(a * (k + 0.5), 4), y }); ids.push(id); add(D(k), id); add(id, D(k + 1)); }
    for (let k = 0; k + 1 < n; k++) add(ids[k], ids[k + 1]);
    if (abut && side === 'below') { add('S1', ids[0]); add(ids[n - 1], 'S2'); }
  } else {
    for (let k = 0; k <= n; k++) if (hasO(k) && !O(k).startsWith('S')) nodes.push({ id: O(k), x: round(a * k, 4), y });
    for (let k = 0; k < n; k++) {
      const p = hasO(k), q = hasO(k + 1);
      if (p && q) add(O(k), O(k + 1));
      // Diagonal orientation: Pratt and Howe mirror about mid-span.
      const leftHalf = k < n / 2;
      const down = (type === 'pratt') === leftHalf; // O(k) to D(k+1) when true
      if (p && q) { if (down) add(O(k), D(k + 1)); else add(D(k), O(k + 1)); }
      else if (!p && q) add(D(k), O(k + 1));
      else if (p && !q) add(O(k), D(k + 1));
    }
    for (let k = 0; k <= n; k++) if (hasO(k)) add(D(k), O(k));
  }
  // Abutments below the deck need posts and a brace to carry the deck ends.
  if (abut && !(side === 'below')) { add('S1', D(0)); add('S1', D(1)); add('S2', D(n)); add('S2', D(n - 1)); }
  if (abut && side === 'below' && type === 'warren') { add('S1', D(0)); add('S2', D(n)); }
  return { nodes, members };
}

function withSections(lay, sizes) {
  return { nodes: lay.nodes, members: lay.members.map((m, i) => [m[0], m[1], SECTIONS[sizes[i]].id]) };
}

// Fully stressed sizing against a set of cases, then deflection and held-out
// checks. Returns { design, mass } or null when the layout cannot work.
export function sizeLayout(site, lay, { cases = envelopeCases(site), units = heldOutUnits(site), uniform = false } = {}) {
  let sizes = lay.members.map(() => 0);
  let checked;
  try { checked = validateDesign(site, withSections(lay, sizes)); } catch { return null; }
  const pick = (m, mem) => {
    const need = s => { const A = s.A, fyd = 355e3 * WEAKEST.fyF / 1.5, E = 210e6 * WEAKEST.EF; return mem.tension <= fyd * A && mem.compression <= fyd * A && mem.compression <= Math.PI ** 2 * E * s.I / m.len ** 2 / 1.5; };
    const i = SECTIONS.findIndex(need);
    return i < 0 ? SECTIONS.length : i;
  };
  for (let it = 0; it < 30; it++) {
    const design = { ...checked, members: checked.members.map((m, i) => ({ ...m, section: SECTIONS[Math.min(sizes[i], SECTIONS.length - 1)].id })) };
    const res = analyse(site, design, cases, WEAKEST);
    if (res.mechanism) return null;
    let next = design.members.map((m, i) => pick(m, res.members[i]));
    if (next.some(s => s >= SECTIONS.length)) return null;
    if (uniform) next = next.map(() => Math.max(...next));
    if (it > 15) next = next.map((s, i) => Math.max(s, sizes[i])); // stop oscillating
    const same = next.every((s, i) => s === sizes[i]);
    sizes = next;
    if (same) break;
  }
  // Stiffen until the deck sag and every held-out unit pass.
  const allChecks = [{ material: WEAKEST, cases }, ...units.map(u => ({ material: u.material, cases: u.cases }))];
  for (let bump = 0; bump < 40; bump++) {
    const design = { ...checked, members: checked.members.map((m, i) => ({ ...m, section: SECTIONS[sizes[i]].id })) };
    const fails = new Set(); let sagFail = false;
    for (const chk of allChecks) {
      const res = analyse(site, design, chk.cases, chk.material);
      if (res.mechanism) return null;
      res.members.forEach((m, i) => { if (m.util > 1) fails.add(i); });
      if (res.cases.some(c => c.deflection > res.deflectionLimit)) sagFail = true;
    }
    if (!fails.size && !sagFail) return { design: { nodes: lay.nodes, members: design.members.map(m => [m.a, m.b, m.section]) }, mass: round(designMass(design), 1) };
    if (uniform) { if (sizes[0] + 1 >= SECTIONS.length) return null; sizes = sizes.map(s => s + 1); continue; }
    // Stiffness: grow the members working hardest (they strain the most).
    if (sagFail) { const res = analyse(site, design, cases, WEAKEST); const order = res.members.map((m, i) => [m.util, i]).sort((x, y) => y[0] - x[0]); for (const [, i] of order.slice(0, Math.max(2, Math.ceil(order.length / 4)))) fails.add(i); }
    for (const i of fails) { if (sizes[i] + 1 >= SECTIONS.length) return null; sizes[i]++; }
  }
  return null;
}

export function candidateLayouts(site) {
  const out = [], { yMin, yMax } = site.region;
  const sides = [];
  if (yMax > 0) sides.push(['above', yMax]);
  if (yMin < 0) sides.push(['below', -yMin]);
  for (const [side, room] of sides) {
    const depths = new Set([room, room * 0.8, room * 0.6, room * 0.45, site.span / 10, site.span / 8].filter(d => d > 0.5 && d <= room + 1e-9).map(d => round(d, 3)));
    if (side === 'below' && site.keepOut) depths.add(round(-site.keepOut.y1, 3));
    const abut = site.supports.find(s => s.id === 'S1');
    if (side === 'below' && abut) depths.add(round(-abut.y, 3));
    for (const depth of depths) {
      if (depth < 0.5) continue;
      if (abut && side === 'below' && Math.abs(depth + abut.y) > 1e-6) continue; // the lower chord must meet the abutments
      for (const type of ['pratt', 'howe', 'warren']) out.push({ type, side, depth });
    }
  }
  return out;
}

export function parDesign(site) {
  const units = heldOutUnits(site), cases = envelopeCases(site);
  let best = null;
  for (const c of candidateLayouts(site)) {
    const r = sizeLayout(site, layout(site, c), { cases, units });
    if (r && (!best || r.mass < best.mass)) best = { ...r, layout: c };
  }
  return best;
}

export function referenceDesign(site) {
  const units = heldOutUnits(site), cases = envelopeCases(site);
  const { yMin, yMax } = site.region;
  const abut = site.supports.find(s => s.id === 'S1');
  const tries = [];
  if (yMax > 0) tries.push({ type: 'pratt', side: 'above', depth: round(Math.min(yMax, site.span / 8), 3) });
  if (yMin < 0) tries.push({ type: 'pratt', side: 'below', depth: round(abut ? -abut.y : Math.min(-yMin, site.keepOut ? -site.keepOut.y1 : Infinity, site.span / 8), 3) });
  for (const c of tries) {
    if (c.depth < 0.5) continue;
    const r = sizeLayout(site, layout(site, c), { cases, units, uniform: true });
    if (r) return { ...r, layout: c };
  }
  return null;
}
