// Validation and analysis for pin-jointed 2D steel trusses: direct stiffness
// method, axial members only, self-weight included. Checks are yield (tension
// and compression) and Euler buckling of each member with a safety factor of
// 1.5, plus deck deflection under the full load.

import { SECTION_BY_ID, NOMINAL, SAFETY, DEFLECTION_RATIO, MIN_MEMBER, MAX_MEMBER, MAX_NODES, MAX_MEMBERS, JOINT_KG, G, deckLoads } from './site.mjs';

const EPS = 1e-6;
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export class DesignError extends Error {}

// Fixed nodes come with the site: deck nodes and supports. A design adds its
// own nodes and lists members as [nodeA, nodeB, sectionId].
export function fixedNodes(site) {
  const out = new Map();
  for (const d of site.deck) out.set(d.id, { id: d.id, x: d.x, y: d.y, deck: true });
  for (const s of site.supports) out.set(s.id, { ...(out.get(s.id) || { id: s.id, x: s.x, y: s.y }), support: s.type });
  return out;
}

function insideKeepOut(k, x, y) {
  return k && x > k.x0 + EPS && x < k.x1 - EPS && y > k.y0 + EPS && y < k.y1 - EPS;
}
// Does segment a-b pass through the open keep-out rectangle? (Liang-Barsky)
function crossesKeepOut(k, a, b) {
  if (!k) return false;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a.x - (k.x0 + EPS)], [dx, (k.x1 - EPS) - a.x], [-dy, a.y - (k.y0 + EPS)], [dy, (k.y1 - EPS) - a.y]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 1e-9;
}

export function validateDesign(site, raw) {
  if (!raw || typeof raw !== 'object') throw new DesignError('The design must be a JSON object with "nodes" and "members".');
  const nodes = fixedNodes(site);
  const extra = Array.isArray(raw.nodes) ? raw.nodes : [];
  if (!Array.isArray(raw.members)) throw new DesignError('"members" must be a list of [nodeA, nodeB, sectionId].');
  const { xMin, xMax, yMin, yMax } = site.region;
  for (const n of extra) {
    const id = Array.isArray(n) ? n[0] : n?.id, x = Number(Array.isArray(n) ? n[1] : n?.x), y = Number(Array.isArray(n) ? n[2] : n?.y);
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,12}$/.test(id)) throw new DesignError(`Node id ${JSON.stringify(id)} is not valid: use 1-12 letters, digits, _ or -.`);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new DesignError(`Node ${id} needs numeric x and y.`);
    const fixed = nodes.get(id);
    if (fixed && (fixed.deck || fixed.support)) {
      if (Math.abs(fixed.x - x) > 1e-3 || Math.abs(fixed.y - y) > 1e-3) throw new DesignError(`Node ${id} is fixed by the site at (${fixed.x}, ${fixed.y}); it cannot be moved.`);
      continue;
    }
    if (fixed) throw new DesignError(`Node ${id} is listed twice.`);
    if (x < xMin - EPS || x > xMax + EPS || y < yMin - EPS || y > yMax + EPS) throw new DesignError(`Node ${id} at (${x}, ${y}) is outside the allowed region x ${xMin}..${xMax}, y ${yMin}..${yMax}.`);
    if (insideKeepOut(site.keepOut, x, y)) throw new DesignError(`Node ${id} at (${x}, ${y}) is inside the clearance zone.`);
    nodes.set(id, { id, x: round(x, 4), y: round(y, 4) });
  }
  if (nodes.size > MAX_NODES) throw new DesignError(`At most ${MAX_NODES} nodes, including the site's fixed nodes.`);
  if (!raw.members.length) throw new DesignError('The design has no members.');
  if (raw.members.length > MAX_MEMBERS) throw new DesignError(`At most ${MAX_MEMBERS} members.`);
  const seen = new Set(), members = [];
  for (const m of raw.members) {
    const [a, b, s] = Array.isArray(m) ? m : [m?.a, m?.b, m?.section];
    const na = nodes.get(a), nb = nodes.get(b), sec = SECTION_BY_ID[s];
    if (!na || !nb) throw new DesignError(`Member ${JSON.stringify(m)} refers to a node that does not exist.`);
    if (a === b) throw new DesignError(`Member ${a}-${b} joins a node to itself.`);
    if (!sec) throw new DesignError(`Member ${a}-${b} uses unknown section ${JSON.stringify(s)}.`);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) throw new DesignError(`Member ${a}-${b} is listed twice.`);
    seen.add(key);
    const len = Math.hypot(nb.x - na.x, nb.y - na.y);
    if (len < MIN_MEMBER) throw new DesignError(`Member ${a}-${b} is ${round(len, 2)} m long; the minimum is ${MIN_MEMBER} m.`);
    if (len > MAX_MEMBER) throw new DesignError(`Member ${a}-${b} is ${round(len, 2)} m long; pieces longer than ${MAX_MEMBER} m cannot be delivered.`);
    if (crossesKeepOut(site.keepOut, na, nb)) throw new DesignError(`Member ${a}-${b} crosses the clearance zone.`);
    members.push({ a, b, section: s, len });
  }
  const used = new Set(members.flatMap(m => [m.a, m.b]));
  for (const d of site.deck) if (!used.has(d.id)) throw new DesignError(`Deck node ${d.id} is not connected: every deck node carries load.`);
  for (const id of [...nodes.keys()]) if (!used.has(id) && !nodes.get(id).deck && !nodes.get(id).support) throw new DesignError(`Node ${id} has no members.`);
  const list = [...nodes.values()].filter(n => used.has(n.id));
  return { nodes: list, members };
}

export function designMass(design) {
  const steel = design.members.reduce((s, m) => s + SECTION_BY_ID[m.section].kgPerM * m.len, 0);
  return steel + JOINT_KG * design.nodes.length;
}

// Factorises the stiffness matrix once; returns null for a mechanism.
function assemble(site, design, EF) {
  const index = new Map(design.nodes.map((n, i) => [n.id, i]));
  const N = design.nodes.length, dofs = 2 * N;
  const fixed = new Uint8Array(dofs);
  for (const n of design.nodes) {
    const i = index.get(n.id);
    if (n.support === 'pin') { fixed[2 * i] = 1; fixed[2 * i + 1] = 1; }
    else if (n.support === 'roller') fixed[2 * i + 1] = 1;
  }
  const map = new Int32Array(dofs).fill(-1); let F = 0;
  for (let d = 0; d < dofs; d++) if (!fixed[d]) map[d] = F++;
  const K = new Float64Array(F * F);
  const E = NOMINAL.E * EF * 1e3; // kN/m²
  const geo = design.members.map(m => {
    const a = design.nodes[index.get(m.a)], b = design.nodes[index.get(m.b)];
    const c = (b.x - a.x) / m.len, s = (b.y - a.y) / m.len;
    const k = E * SECTION_BY_ID[m.section].A / m.len;
    const d = [2 * index.get(m.a), 2 * index.get(m.a) + 1, 2 * index.get(m.b), 2 * index.get(m.b) + 1];
    const v = [-c, -s, c, s];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const p = map[d[i]], q = map[d[j]]; if (p >= 0 && q >= 0) K[p * F + q] += k * v[i] * v[j]; }
    return { d, v, k };
  });
  // Cholesky in place (lower triangle).
  let maxDiag = 0;
  for (let i = 0; i < F; i++) maxDiag = Math.max(maxDiag, K[i * F + i]);
  for (let j = 0; j < F; j++) {
    let sum = K[j * F + j];
    for (let k = 0; k < j; k++) sum -= K[j * F + k] ** 2;
    if (!(sum > maxDiag * 1e-10)) return null;
    const L = Math.sqrt(sum); K[j * F + j] = L;
    for (let i = j + 1; i < F; i++) { let s2 = K[i * F + j]; for (let k = 0; k < j; k++) s2 -= K[i * F + k] * K[j * F + k]; K[i * F + j] = s2 / L; }
  }
  const solve = rhs => {
    const y = new Float64Array(F);
    for (let i = 0; i < F; i++) { let s = rhs[i]; for (let k = 0; k < i; k++) s -= K[i * F + k] * y[k]; y[i] = s / K[i * F + i]; }
    for (let i = F - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < F; k++) s -= K[k * F + i] * y[k]; y[i] = s / K[i * F + i]; }
    return y;
  };
  return { index, map, F, geo, solve };
}

// Analyses every case for one material draw. Returns per-case results and,
// per member, the worst utilisation with the case and mode that set it.
export function analyse(site, design, cases, material = { fyF: 1, EF: 1 }) {
  const sys = assemble(site, design, material.EF);
  const mass = designMass(design);
  if (!sys) return { mechanism: true, ok: false, mass, cases: cases.map(c => ({ id: c.id, ok: false, maxUtil: Infinity, governing: null, mode: 'mechanism', deflection: null })), members: design.members.map(() => ({ util: Infinity, mode: 'mechanism', case: null, tension: 0, compression: 0 })), deflectionLimit: site.span / DEFLECTION_RATIO };
  const { index, map, F, geo, solve } = sys;
  const fyd = NOMINAL.fy * material.fyF * 1e3 / SAFETY; // kN/m²
  const E = NOMINAL.E * material.EF * 1e3;
  const caps = design.members.map(m => { const s = SECTION_BY_ID[m.section]; return { yieldN: fyd * s.A, bucklingN: Math.PI ** 2 * E * s.I / (m.len ** 2) / SAFETY }; });
  // Self-weight of members and joints, lumped at the nodes.
  const base = new Float64Array(2 * design.nodes.length);
  design.members.forEach((m, i) => { const w = SECTION_BY_ID[m.section].kgPerM * m.len * G / 1000 / 2; base[geo[i].d[1]] -= w; base[geo[i].d[3]] -= w; });
  for (let i = 0; i < design.nodes.length; i++) base[2 * i + 1] -= JOINT_KG * G / 1000;
  const deckIdx = site.deck.map(d => index.get(d.id));
  const limit = site.span / DEFLECTION_RATIO;
  const members = design.members.map(() => ({ util: 0, mode: 'tension', case: null, tension: 0, compression: 0 }));
  const out = [];
  for (const c of cases) {
    const loads = Float64Array.from(base);
    deckLoads(site, c).forEach(([fx, fy], k) => { loads[2 * deckIdx[k]] += fx; loads[2 * deckIdx[k] + 1] += fy; });
    const rhs = new Float64Array(F);
    for (let d = 0; d < loads.length; d++) if (map[d] >= 0) rhs[map[d]] += loads[d];
    const u = solve(rhs);
    const disp = d => (map[d] >= 0 ? u[map[d]] : 0);
    let worst = 0, gov = null, mode = null;
    geo.forEach((g, i) => {
      const N = g.k * g.d.reduce((s, d, j) => s + g.v[j] * disp(d), 0); // + tension
      const cap = caps[i];
      const mu = N >= 0 ? { util: N / cap.yieldN, mode: 'tension' } : (() => { const y = -N / cap.yieldN, b = -N / cap.bucklingN; return b > y ? { util: b, mode: 'buckling' } : { util: y, mode: 'compression' }; })();
      const mem = members[i];
      if (N > mem.tension) mem.tension = N;
      if (-N > mem.compression) mem.compression = -N;
      if (mu.util > mem.util) { mem.util = mu.util; mem.mode = mu.mode; mem.case = c.id; }
      if (mu.util > worst) { worst = mu.util; gov = i; mode = mu.mode; }
    });
    const sag = Math.max(0, ...deckIdx.map(i => -disp(2 * i + 1)));
    out.push({ id: c.id, ok: worst <= 1 + 1e-9 && sag <= limit + 1e-9, maxUtil: round(worst, 3), governing: gov, mode, deflection: round(sag, 4) });
  }
  return { mechanism: false, ok: out.every(c => c.ok), mass, cases: out, members, deflectionLimit: limit };
}
