// structures-v3 analysis: a 3D frame solver (six degrees of freedom per rigid
// joint, pinned ends released, tension-only cables) and the checks:
// - members: yield, flexural buckling about both axes on a buckling curve,
//   biaxial bending interaction, shear, local bending under self-weight and wind
// - the structure: deck sag and sideways sway, lowest natural frequency,
//   GLOBAL elastic buckling (a compression chord that kicks sideways for lack
//   of bracing shows up here, not in any member check), fatigue stress range
// - robustness: any single cable or rod may snap
// Units inside: metres, kN, kN/m², kg.
import { MATERIALS, OPTIONS, JOINT_KG, JOINT_KG_PER_KGM, CORROSION_MM, G } from './site2.mjs';

const EPS = 1e-6;
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const DRAG = { CHS: 1.2, ROD: 1.2, WIRE: 1.2, SHS: 2.0, IPE: 2.0, HEB: 2.0, L: 2.0, FLAT: 2.0, TIMBER: 2.0 };
const ICE_KN_M3 = 8.83;
const RIGID_SUPPORT = 1e9; // kN/m: a bearing on rock
const SNAPPABLE = new Set(['WIRE', 'ROD']);
export class DesignError3 extends Error {}
const label = m => `${m.a}-${m.b}`;

// ---------------------------------------------------------------------------
// Validation. A design is { nodes: [{id,x,y,z,joint?}], joints?: {id: 'pin'|'rigid'},
// members: [[a,b,"MAT SECTION"] | {a,b,spec,ends?:'pin'}] }.
export function fixedNodes3(site) {
  const out = new Map();
  for (const d of site.deck) out.set(d.id, { id: d.id, x: d.x, y: d.y, z: d.z, deck: true, joint: 'pin' });
  for (const s of site.supports) out.get(s.id).support = s;
  return out;
}
// Does the open segment a-b pass through the open box k?
function crosses(k, a, b) {
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[a.x - b.x, a.x - (k.x0 + EPS)], [b.x - a.x, (k.x1 - EPS) - a.x], [a.y - b.y, a.y - (k.y0 + EPS)], [b.y - a.y, (k.y1 - EPS) - a.y], [a.z - b.z, a.z - (k.z0 + EPS)], [b.z - a.z, (k.z1 - EPS) - a.z]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 1e-9;
}
export function validateDesign3(site, raw) {
  if (!raw || typeof raw !== 'object') throw new DesignError3('The design must be a JSON object with "nodes" and "members".');
  const fab = site.fabrication, nodes = fixedNodes3(site), R = site.region;
  const extra = Array.isArray(raw.nodes) ? raw.nodes : [];
  if (!Array.isArray(raw.members)) throw new DesignError3('"members" must be a list of [nodeA, nodeB, "MATERIAL SECTION"].');
  const jointOf = v => (v === 'rigid' ? 'rigid' : v === 'pin' || v == null ? 'pin' : null);
  for (const n of extra) {
    const id = Array.isArray(n) ? n[0] : n?.id, x = Number(Array.isArray(n) ? n[1] : n?.x), y = Number(Array.isArray(n) ? n[2] : n?.y), z = Number(Array.isArray(n) ? n[3] : n?.z);
    const joint = jointOf(Array.isArray(n) ? n[4] : n?.joint);
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,12}$/.test(id)) throw new DesignError3(`Node id ${JSON.stringify(id)} is not valid: use 1-12 letters, digits, _ or -.`);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new DesignError3(`Node ${id} needs numeric x, y and z.`);
    if (!joint) throw new DesignError3(`Node ${id}: joint must be "pin" or "rigid".`);
    const fixed = nodes.get(id);
    if (fixed) {
      if (Math.abs(fixed.x - x) > 1e-3 || Math.abs(fixed.y - y) > 1e-3 || Math.abs(fixed.z - z) > 1e-3) throw new DesignError3(`Node ${id} is fixed by the site at (${fixed.x}, ${fixed.y}, ${fixed.z}); it cannot be moved or listed twice.`);
      fixed.joint = joint; continue;
    }
    if (x < R.xMin - EPS || x > R.xMax + EPS || y < R.yMin - EPS || y > R.yMax + EPS || z < R.zMin - EPS || z > R.zMax + EPS) throw new DesignError3(`Node ${id} at (${x}, ${y}, ${z}) is outside the allowed region x ${R.xMin}..${R.xMax}, y ${R.yMin}..${R.yMax}, z ${R.zMin}..${R.zMax}.`);
    for (const k of site.keepOuts) if (x > k.x0 + EPS && x < k.x1 - EPS && y > k.y0 + EPS && y < k.y1 - EPS && z > k.z0 + EPS && z < k.z1 - EPS) throw new DesignError3(`Node ${id} at (${x}, ${y}, ${z}) is inside the ${k.id}.`);
    nodes.set(id, { id, x: round(x, 4), y: round(y, 4), z: round(z, 4), joint });
  }
  if (raw.joints && typeof raw.joints === 'object') for (const [id, v] of Object.entries(raw.joints)) { const n = nodes.get(id); if (!n) throw new DesignError3(`joints: node ${id} does not exist.`); const j = jointOf(v); if (!j) throw new DesignError3(`joints: ${id} must be "pin" or "rigid".`); n.joint = j; }
  if (nodes.size > fab.maxNodes) throw new DesignError3(`At most ${fab.maxNodes} nodes, including the site's fixed nodes.`);
  if (!raw.members.length) throw new DesignError3('The design has no members.');
  if (raw.members.length > fab.maxMembers) throw new DesignError3(`At most ${fab.maxMembers} members.`);
  const seen = new Set(), members = [], atNode = new Map();
  for (const m of raw.members) {
    const [a, b, spec, endsRaw] = Array.isArray(m) ? m : [m?.a, m?.b, m?.spec ?? m?.section, m?.ends];
    const na = nodes.get(a), nb = nodes.get(b);
    if (!na || !nb) throw new DesignError3(`Member ${JSON.stringify(m)} refers to a node that does not exist.`);
    if (a === b) throw new DesignError3(`Member ${a}-${b} joins a node to itself.`);
    const opt = typeof spec === 'string' ? OPTIONS[spec.trim().replace(/\s+/g, ' ')] : null;
    if (!opt) throw new DesignError3(`Member ${a}-${b}: unknown option ${JSON.stringify(spec)}. Use "MATERIAL SECTION", e.g. "S355 CHS114.3x5".`);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) throw new DesignError3(`Member ${a}-${b} is listed twice.`);
    seen.add(key);
    const len = Math.hypot(nb.x - na.x, nb.y - na.y, nb.z - na.z);
    if (len < fab.minMember) throw new DesignError3(`Member ${a}-${b} is ${round(len, 2)} m long; the minimum is ${fab.minMember} m.`);
    if (len > fab.maxMember) throw new DesignError3(`Member ${a}-${b} is ${round(len, 2)} m long; nothing longer than ${fab.maxMember} m can be delivered to this site.`);
    for (const k of site.keepOuts) if (crosses(k, na, nb)) throw new DesignError3(`Member ${a}-${b} passes through the ${k.id}.`);
    const ends = endsRaw === 'pin' ? 'pin' : null, cable = Boolean(opt.material.cable);
    const fixA = na.joint === 'rigid' && !ends && !cable, fixB = nb.joint === 'rigid' && !ends && !cable;
    if ((fixA || fixB) && !opt.material.weldable) throw new DesignError3(`Member ${a}-${b}: ${opt.material.name} cannot be given a rigid (moment) connection; set ends: "pin" or use a pinned node.`);
    members.push({ a, b, spec: opt.key, opt, len, cable, fixA, fixB });
    for (const id of [a, b]) (atNode.get(id) || atNode.set(id, []).get(id)).push(members.length - 1);
  }
  for (const d of site.deck) if (!atNode.has(d.id)) throw new DesignError3(`Deck node ${d.id} is not connected: every deck node carries load.`);
  for (const [id, n] of nodes) if (!atNode.has(id) && !n.deck) throw new DesignError3(`Node ${id} has no members.`);
  const minCos = Math.cos(fab.minAngleDeg * Math.PI / 180);
  for (const [id, list] of atNode) {
    if (list.length > fab.maxAtJoint) throw new DesignError3(`Node ${id} has ${list.length} members; at most ${fab.maxAtJoint} can be connected at one joint.`);
    const n = nodes.get(id);
    const dirs = list.map(i => { const m = members[i], o = nodes.get(m.a === id ? m.b : m.a); return [(o.x - n.x) / m.len, (o.y - n.y) / m.len, (o.z - n.z) / m.len]; });
    for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
      const c = dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1] + dirs[i][2] * dirs[j][2];
      if (c > minCos + 1e-9) throw new DesignError3(`At node ${id}, members ${label(members[list[i]])} and ${label(members[list[j]])} meet at ${round(Math.acos(Math.min(1, c)) * 180 / Math.PI, 1)}°; the minimum joint angle is ${fab.minAngleDeg}°.`);
    }
  }
  return { nodes: [...nodes.values()], members };
}
export function designMass3(design) {
  let mass = 0;
  const atNode = new Map();
  for (const m of design.members) { mass += m.opt.kgPerM * m.len; for (const id of [m.a, m.b]) atNode.set(id, (atNode.get(id) || 0) + m.opt.kgPerM); }
  for (const n of design.nodes) mass += JOINT_KG[n.joint] + JOINT_KG_PER_KGM * (atNode.get(n.id) || 0);
  return mass;
}

// Section properties as built: the unit's thickness draw, corrosion, section class.
function effective(site, m, unit) {
  const mat = m.opt.material, s = m.opt.section, uf = unit.material[mat.id], fam = m.opt.family;
  let tf = uf.tF;
  if (mat.corrodes) {
    const allowance = CORROSION_MM[site.limits.corrosion] * site.limits.designLifeYears / 50 / 1e3;
    tf *= fam === 'ROD' || fam === 'WIRE' ? Math.max(0.3, (1 - 2 * allowance / (2 * s.t)) ** 2) : Math.max(0.3, 1 - allowance / s.t);
  }
  let fy = mat.fy * uf.fyF;
  if (mat.timber && (site.limits.corrosion === 'C4' || site.limits.corrosion === 'C5')) fy *= 0.8;
  const E = mat.E * uf.EF, eps = Math.sqrt(235 / Math.max(fy, 1));
  const cls = Math.min(1, Math.sqrt(s.slenderLimit * (fam === 'CHS' ? eps * eps : eps) / Math.max(s.slender, 1e-9)));
  const J = fam === 'CHS' || fam === 'ROD' ? s.Iy + s.Iz : fam === 'SHS' ? 1.5 * s.Iy : fam === 'WIRE' ? 0 : fam === 'TIMBER' ? 0.2 * s.A * s.t * s.t : s.A * s.t * s.t / 3;
  return { A: s.A * tf, Ac: s.A * tf * cls, Iv: s.Iy * tf, Iw: s.Iz * tf, Wv: s.Wy * tf * cls, Ww: s.Wz * tf * cls, Av: s.Av * tf, J: J * tf, E, Gs: mat.timber ? E / 16 : E / 2.6, fy, rho: mat.rho * uf.rhoF, alpha: mat.alpha, cls };
}

// 12x12 beam stiffness in local axes. dofs: u v w rx ry rz at each end.
// v bends about the lateral axis with EIv (vertical plane), w with EIw.
function beamLocal(EA, EIv, EIw, GJ, L) {
  const k = Array.from({ length: 12 }, () => new Float64Array(12));
  const set = (i, j, v) => { k[i][j] = v; k[j][i] = v; };
  set(0, 0, EA / L); set(6, 6, EA / L); set(0, 6, -EA / L);
  set(3, 3, GJ / L); set(9, 9, GJ / L); set(3, 9, -GJ / L);
  const a = EIv / L ** 3, b = EIw / L ** 3;
  set(1, 1, 12 * a); set(1, 5, 6 * a * L); set(1, 7, -12 * a); set(1, 11, 6 * a * L); set(5, 5, 4 * a * L * L); set(5, 7, -6 * a * L); set(5, 11, 2 * a * L * L); set(7, 7, 12 * a); set(7, 11, -6 * a * L); set(11, 11, 4 * a * L * L);
  set(2, 2, 12 * b); set(2, 4, -6 * b * L); set(2, 8, -12 * b); set(2, 10, -6 * b * L); set(4, 4, 4 * b * L * L); set(4, 8, 6 * b * L); set(4, 10, 2 * b * L * L); set(8, 8, 12 * b); set(8, 10, 6 * b * L); set(10, 10, 4 * b * L * L);
  return k;
}
// Condense out released dofs: the two bending rotations at a pinned end. (Twist
// is left tied there, so a member fixed at one end only cannot spin freely.)
function condense(k, rel) {
  if (!rel.length) return k;
  const keep = [...Array(12).keys()].filter(i => !rel.includes(i)), n = rel.length;
  const a = rel.map(i => rel.map(j => k[i][j])), inv = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let c = 0; c < n; c++) { // Gauss-Jordan on a tiny matrix
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]]; [inv[c], inv[p]] = [inv[p], inv[c]];
    const d = a[c][c] || 1e-30;
    for (let j = 0; j < n; j++) { a[c][j] /= d; inv[c][j] /= d; }
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c]; for (let j = 0; j < n; j++) { a[r][j] -= f * a[c][j]; inv[r][j] -= f * inv[c][j]; } }
  }
  const out = Array.from({ length: 12 }, () => new Float64Array(12));
  for (const i of keep) for (const j of keep) { let v = k[i][j]; for (let p = 0; p < n; p++) for (let q = 0; q < n; q++) v -= k[i][rel[p]] * inv[p][q] * k[rel[q]][j]; out[i][j] = v; }
  return out;
}
// Dense Cholesky. Returns null when the matrix is not positive definite: a mechanism.
function factor(K, n) {
  const Lm = new Float64Array(K);
  let big = 0; for (let i = 0; i < n; i++) big = Math.max(big, Lm[i * n + i]);
  for (let j = 0; j < n; j++) {
    let d = Lm[j * n + j];
    for (let k = 0; k < j; k++) d -= Lm[j * n + k] * Lm[j * n + k];
    if (!(d > big * 1e-10)) return null;
    d = Math.sqrt(d); Lm[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let s = Lm[i * n + j]; const ri = i * n, rj = j * n;
      for (let k = 0; k < j; k++) s -= Lm[ri + k] * Lm[rj + k];
      Lm[ri + j] = s / d;
    }
  }
  return Lm;
}
function solve(Lm, n, b) {
  const x = new Float64Array(b);
  for (let i = 0; i < n; i++) { let s = x[i]; const ri = i * n; for (let k = 0; k < i; k++) s -= Lm[ri + k] * x[k]; x[i] = s / Lm[ri + i]; }
  for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let k = i + 1; k < n; k++) s -= Lm[k * n + i] * x[k]; x[i] = s / Lm[i * n + i]; }
  return x;
}

export function nominalUnit3() {
  const material = {};
  for (const m of Object.values(MATERIALS)) material[m.id] = { fyF: 1, EF: 1, rhoF: 1, tF: 1 };
  return { unit: 0, material, imperfection: 1, cases: [] };
}

// ---------------------------------------------------------------------------
export function analyse3(site, design, cases, unit = nominalUnit3(), { fatigue = true, frequency = true, stability = true, robustness = true } = {}) {
  const index = new Map(design.nodes.map((n, i) => [n.id, i]));
  const rot = new Set();
  for (const m of design.members) { if (m.fixA) rot.add(m.a); if (m.fixB) rot.add(m.b); }
  const dof = []; let n = 0;
  for (const nd of design.nodes) { const d = [n, n + 1, n + 2, -1, -1, -1]; n += 3; if (rot.has(nd.id)) { d[3] = n; d[4] = n + 1; d[5] = n + 2; n += 3; } dof.push(d); }
  const gammaM = site.factors.gammaM, iceT = site.loads.iceMm / 1e3;
  const props = design.members.map(m => effective(site, m, unit));
  const el = design.members.map((m, i) => {
    const a = design.nodes[index.get(m.a)], b = design.nodes[index.get(m.b)], p = props[i], L = m.len;
    const ex = [(b.x - a.x) / L, (b.y - a.y) / L, (b.z - a.z) / L];
    let ez = Math.abs(ex[1]) > 0.999 ? [0, 0, 1] : [-ex[2], 0, ex[0]]; // ex × Y: horizontal
    const zl = Math.hypot(...ez); ez = ez.map(v => v / zl);
    const ey = [ez[1] * ex[2] - ez[2] * ex[1], ez[2] * ex[0] - ez[0] * ex[2], ez[0] * ex[1] - ez[1] * ex[0]];
    const R = [ex, ey, ez], beam = m.fixA || m.fixB;
    const EA = p.E * 1e3 * p.A;
    const kl = beam ? condense(beamLocal(EA, p.E * 1e3 * p.Iv, p.E * 1e3 * p.Iw, p.Gs * 1e3 * p.J, L), [...(m.fixA ? [] : [4, 5]), ...(m.fixB ? [] : [10, 11])]) : null;
    const map = [...dof[index.get(m.a)], ...dof[index.get(m.b)]];
    const horiz = Math.hypot(b.x - a.x, b.y - a.y); // length seen by a wind blowing across (z)
    const plan = Math.hypot(b.x - a.x, b.z - a.z); // length seen by gravity
    return { plan, ia: index.get(m.a), ib: index.get(m.b), L, ex, R, beam, EA, kl, map, horiz, depth: m.opt.section.depth, drag: DRAG[m.opt.family] || 2 };
  });
  // Lumped node masses (kg): members, joints, deck surfacing.
  const mass = new Float64Array(design.nodes.length);
  const perNode = new Map();
  design.members.forEach((m, i) => { const kg = props[i].rho * props[i].A * m.len; mass[el[i].ia] += kg / 2; mass[el[i].ib] += kg / 2; for (const id of [m.a, m.b]) perNode.set(id, (perNode.get(id) || 0) + m.opt.kgPerM); });
  design.nodes.forEach((nd, i) => { mass[i] += JOINT_KG[nd.joint] + JOINT_KG_PER_KGM * (perNode.get(nd.id) || 0); });
  const structureMass = designMass3(design);
  const panel = site.span / site.panels;
  const trib = d => (d.x < EPS || d.x > site.span - EPS ? panel / 2 : panel) * site.width / 2; // m² of deck per deck node
  const deckIdx = site.deck.map(d => index.get(d.id));
  site.deck.forEach((d, k) => { mass[deckIdx[k]] += site.loads.deadKNm2 * trib(d) * 1000 / G; });

  // Assemble the stiffness with a given set of slack cables and removed members.
  function assemble(slack, removed = -1) {
    const K = new Float64Array(n * n);
    design.members.forEach((m, i) => {
      if (i === removed) return;
      const e = el[i];
      if (!e.beam) {
        const k = (m.cable && slack.has(i) ? 1e-6 : 1) * e.EA / e.L, da = dof[e.ia], db = dof[e.ib];
        for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) { const v = k * e.ex[p] * e.ex[q]; K[da[p] * n + da[q]] += v; K[db[p] * n + db[q]] += v; K[da[p] * n + db[q]] -= v; K[db[p] * n + da[q]] -= v; }
        return;
      }
      // global = Tᵀ k T, T = diag(R, R, R, R)
      const g = Array.from({ length: 12 }, () => new Float64Array(12)), tmp = Array.from({ length: 12 }, () => new Float64Array(12));
      for (let i2 = 0; i2 < 12; i2++) for (let bj = 0; bj < 4; bj++) for (let c = 0; c < 3; c++) { let s = 0; for (let r = 0; r < 3; r++) s += e.kl[i2][bj * 3 + r] * e.R[r][c]; tmp[i2][bj * 3 + c] = s; }
      for (let bi = 0; bi < 4; bi++) for (let c = 0; c < 3; c++) for (let j = 0; j < 12; j++) { let s = 0; for (let r = 0; r < 3; r++) s += e.R[r][c] * tmp[bi * 3 + r][j]; g[bi * 3 + c][j] = s; }
      for (let p = 0; p < 12; p++) { if (e.map[p] < 0) continue; for (let q = 0; q < 12; q++) if (e.map[q] >= 0) K[e.map[p] * n + e.map[q]] += g[p][q]; }
    });
    for (const s of site.supports) { const d = dof[index.get(s.id)]; if (s.fix.includes('x')) K[d[0] * n + d[0]] += RIGID_SUPPORT; if (s.fix.includes('y')) K[d[1] * n + d[1]] += s.kv || RIGID_SUPPORT; if (s.fix.includes('z')) K[d[2] * n + d[2]] += RIGID_SUPPORT; }
    return K;
  }
  // Load vectors for one scenario: permanent, variable, and what does not get a load factor.
  function loads(c) {
    const perm = new Float64Array(n), live = new Float64Array(n), other = new Float64Array(n);
    design.nodes.forEach((_, i) => { perm[dof[i][1]] -= mass[i] * G / 1000; });
    const w = site.loads.windKNm2 * (c.wind || 0);
    design.members.forEach((m, i) => {
      const e = el[i];
      if (w) { const f = w * e.drag * (e.depth + (c.ice ? 2 * iceT : 0)) * e.horiz / 2; live[dof[e.ia][2]] += f; live[dof[e.ib][2]] += f; }
      if (c.ice && iceT) { const f = ICE_KN_M3 * Math.PI * (e.depth + iceT) * iceT * e.L / 2; live[dof[e.ia][1]] -= f; live[dof[e.ib][1]] -= f; }
      if (c.dT) { const f = e.EA * props[i].alpha * c.dT; for (let p = 0; p < 3; p++) { other[dof[e.ia][p]] -= f * e.ex[p]; other[dof[e.ib][p]] += f * e.ex[p]; } }
    });
    site.deck.forEach((d, k) => {
      const i = deckIdx[k], t = trib(d);
      if (w) live[dof[i][2]] += w * site.loads.deckWindDepth * (t / (site.width / 2)) / 2;
      if (c.crowd && (c.crowd.side === 'both' || (c.crowd.side === 'left') === (d.z < 0))) {
        const half = (d.x < EPS || d.x > site.span - EPS ? panel / 2 : panel) / 2, lo = Math.max(c.crowd.x0, d.x - half), hi = Math.min(c.crowd.x1, d.x + half);
        if (hi > lo) live[dof[i][1]] -= site.loads.crowdKNm2 * (hi - lo) * site.width / 2;
      }
    });
    const v = site.loads.vehicle;
    for (const veh of c.vehicles || []) {
      const len = veh.spacing * (v.axles - 1), z = site.loads.laneZ[veh.lane] ?? 0, right = (z + site.width / 2) / site.width;
      for (let j = 0; j < v.axles; j++) {
        const x = Math.max(0, Math.min(site.span, veh.center + veh.dir * (len / 2 - j * veh.spacing)));
        const P = veh.weight * v.phi * (j === 0 ? v.frontShare : (1 - v.frontShare) / (v.axles - 1));
        const k0 = Math.min(site.panels - 1, Math.floor(x / panel)), f = x / panel - k0;
        for (const [k, share] of [[k0, 1 - f], [k0 + 1, f]]) { live[dof[deckIdx[2 * k]][1]] -= P * share * (1 - right); live[dof[deckIdx[2 * k + 1]][1]] -= P * share * right; }
      }
      if (c.braking) for (const i of deckIdx) live[dof[i][0]] += c.braking * site.loads.brakingShare * veh.weight / deckIdx.length;
    }
    if (c.seismic) design.nodes.forEach((_, i) => { const f = mass[i] * G / 1000 * site.loads.seismicAh; other[dof[i][0]] += f * c.seismic.x; other[dof[i][2]] += f * c.seismic.z; });
    if (c.settle) { const s = site.supports.find(q => q.id === c.settleAt); if (s) other[dof[index.get(s.id)][1]] -= (s.kv || RIGID_SUPPORT) * c.settle / 1000; }
    return { perm, live, other };
  }
  const combine = (l, c) => { const out = new Float64Array(n), gG = c.combo === 'seismic' ? 1 : site.factors.gammaG, gQ = c.combo === 'seismic' ? 0.3 : site.factors.gammaQ; for (let i = 0; i < n; i++) out[i] = gG * l.perm[i] + gQ * l.live[i] + l.other[i]; return out; };
  // Member end forces from a displacement vector.
  function forces(u, c, i) {
    const e = el[i], ug = e.map.map(d => (d >= 0 ? u[d] : 0));
    const thermal = c?.dT ? e.EA * props[i].alpha * c.dT : 0;
    if (!e.beam) { let d = 0; for (let p = 0; p < 3; p++) d += (ug[6 + p] - ug[p]) * e.ex[p]; return { N: e.EA / e.L * d - thermal, Mv: 0, Mw: 0, V: 0 }; }
    const ul = new Float64Array(12);
    for (let bk = 0; bk < 4; bk++) for (let r = 0; r < 3; r++) ul[bk * 3 + r] = e.R[r][0] * ug[bk * 3] + e.R[r][1] * ug[bk * 3 + 1] + e.R[r][2] * ug[bk * 3 + 2];
    const f = new Float64Array(12);
    for (let p = 0; p < 12; p++) { let s = 0; for (let q = 0; q < 12; q++) s += e.kl[p][q] * ul[q]; f[p] = s; }
    return { N: f[6] - thermal, Mv: Math.max(Math.abs(f[5]), Math.abs(f[11])), Mw: Math.max(Math.abs(f[4]), Math.abs(f[10])), V: Math.max(Math.hypot(f[1], f[2]), Math.hypot(f[7], f[8])) };
  }
  // Utilisation of one member under one set of forces.
  function check(i, F, c, gM = gammaM, amp = 1) {
    const m = design.members[i], p = props[i], e = el[i], fyd = p.fy * 1e3 / gM;
    if (m.cable) return F.N <= 0 ? { util: 0, mode: 'slack' } : { util: F.N / (p.A * fyd), mode: 'tension' };
    // Local bending between the joints: self-weight (and ice) in the vertical plane, wind across.
    const gG = c?.combo === 'seismic' ? 1 : site.factors.gammaG, gQ = c?.combo === 'seismic' ? 0.3 : site.factors.gammaQ;
    const wv = (gG * p.rho * p.A * G / 1000 + (c?.ice ? gQ * ICE_KN_M3 * Math.PI * (e.depth + iceT) * iceT : 0)) * (e.plan / e.L);
    const ww = gQ * Math.abs(site.loads.windKNm2 * (c?.wind || 0)) * e.drag * (e.depth + (c?.ice ? 2 * iceT : 0)) * (e.horiz / e.L);
    const Mv = F.Mv + wv * e.L * e.L / 8, Mw = F.Mw + ww * e.L * e.L / 8;
    const bend = (p.Wv > 0 ? Mv / (p.Wv * fyd) : 0) + (p.Ww > 0 ? Mw / (p.Ww * fyd) : 0);
    const shear = p.Av > 0 ? F.V / (p.Av * fyd / Math.sqrt(3)) : 0;
    if (F.N >= 0) { const t = F.N / (p.A * fyd), util = Math.max(t + bend, shear); return { util, mode: shear > t + bend ? 'shear' : bend > t ? 'bending' : 'tension' }; }
    const Nc = -F.N, alpha = m.opt.section.alpha * unit.imperfection;
    let chi = 1;
    for (const I of [p.Iv, p.Iw]) {
      const Ncr = Math.PI ** 2 * p.E * 1e3 * I / (e.L * e.L), lam = Math.sqrt(p.Ac * p.fy * 1e3 / Math.max(Ncr, 1e-9));
      const Phi = 0.5 * (1 + alpha * (lam - 0.2) + lam * lam);
      chi = Math.min(chi, 1 / (Phi + Math.sqrt(Math.max(0, Phi * Phi - lam * lam))));
    }
    const b = Nc / (chi * p.Ac * fyd), util = Math.max(amp * (b + bend), shear);
    return { util, mode: shear > amp * (b + bend) ? 'shear' : bend > b ? 'bending' : chi < 0.95 ? 'buckling' : 'compression' };
  }
  const factors = new Map(); // one factorisation per set of slack cables, shared by every scenario
  // Solve one scenario, letting slack cables drop out. Returns null for a mechanism.
  function run(c, removed = -1, rhsOf = combine) {
    const l = loads(c), slack = new Set();
    for (let it = 0; it < 6; it++) {
      const key = `${removed}|${[...slack].sort((a, b) => a - b).join(',')}`;
      if (!factors.has(key)) factors.set(key, factor(assemble(slack, removed), n));
      const Lm = factors.get(key);
      if (!Lm) return null;
      const u = solve(Lm, n, rhsOf(l, c));
      const F = design.members.map((_, i) => (i === removed ? { N: 0, Mv: 0, Mw: 0, V: 0 } : forces(u, c, i)));
      let changed = false;
      design.members.forEach((m, i) => { if (m.cable && i !== removed && !slack.has(i) && F[i].N < -1e-6) { slack.add(i); changed = true; } });
      if (!changed) return { Lm, u, F, l, slack };
    }
    return null;
  }
  // Global elastic buckling factor for the axial forces F: the smallest
  // λ > 0 with det(K + λ Kg) = 0, by shifted power iteration on -K⁻¹Kg.
  function alphaCr(Lm, F) {
    const kg = v => {
      const out = new Float64Array(n);
      design.members.forEach((_, i) => {
        const e = el[i], q = F[i].N / e.L; if (!q) return;
        const da = dof[e.ia], db = dof[e.ib], d = [v[db[0]] - v[da[0]], v[db[1]] - v[da[1]], v[db[2]] - v[da[2]]];
        const along = d[0] * e.ex[0] + d[1] * e.ex[1] + d[2] * e.ex[2];
        for (let p = 0; p < 3; p++) { const t = q * (d[p] - along * e.ex[p]); out[db[p]] += t; out[da[p]] -= t; }
      });
      return out;
    };
    const iterate = (shift, steps) => {
      let v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = Math.sin(1 + 7.3 * i) + 0.3;
      let mu = 0;
      for (let s = 0; s < steps; s++) {
        const g = kg(v); for (let i = 0; i < n; i++) g[i] = -g[i];
        const w = solve(Lm, n, g);
        let dotp = 0, vv = 0, norm = 0;
        for (let i = 0; i < n; i++) { w[i] += shift * v[i]; dotp += w[i] * v[i]; vv += v[i] * v[i]; }
        mu = dotp / vv;
        for (let i = 0; i < n; i++) norm += w[i] * w[i];
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < n; i++) v[i] = w[i] / norm;
      }
      return mu;
    };
    const rho = Math.abs(iterate(0, 25));
    if (rho < 1e-9) return Infinity;
    const top = iterate(rho, 60) - rho; // most positive eigenvalue of -K⁻¹Kg
    return top > 1e-9 ? 1 / top : Infinity;
  }

  const result = { mass: round(structureMass, 1), mechanism: false, ok: true, cases: [], members: design.members.map(() => ({ util: 0, mode: '-', tension: 0, compression: 0, moment: 0, case: null })), sag: 0, sagLimit: site.span / site.limits.deflRatio, sway: 0, swayLimit: site.span / site.limits.swayRatio, alphaCr: null, frequency: null, fatigue: null, robustness: null };
  const stress = design.members.map(() => [0, 0]); // live axial stress range for fatigue
  const solved = [];
  for (const c of cases) {
    const r = run(c);
    if (!r) { result.mechanism = true; result.ok = false; result.cases.push({ id: c.id, ok: false, maxUtil: Infinity, governing: null, mode: 'mechanism', sag: null, alphaCr: null }); continue; }
    solved.push({ c, r });
  }
  if (result.mechanism) { result.cases = cases.map(c => ({ id: c.id, ok: false, maxUtil: Infinity, governing: null, mode: 'mechanism', sag: null, alphaCr: null })); return result; }
  // Stability on the cases with the most compression (each one costs many solves).
  const compression = s => s.r.F.reduce((t, f, i) => t + (f.N < 0 ? -f.N * el[i].L : 0), 0);
  const stab = new Map();
  if (stability) for (const s of [...solved].sort((a, b) => compression(b) - compression(a)).slice(0, 3)) stab.set(s.c.id, alphaCr(s.r.Lm, s.r.F));
  const lowest = stab.size ? Math.min(...stab.values()) : Infinity;
  if (stability) result.alphaCr = Number.isFinite(lowest) ? round(lowest, 2) : null;
  const amp = lowest < 10 && lowest > 1 ? 1 / (1 - 1 / lowest) : 1; // second-order amplification of compression
  for (const { c, r } of solved) {
    let maxUtil = 0, governing = null, mode = '-';
    design.members.forEach((m, i) => {
      const F = r.F[i], k = check(i, F, c, gammaM, amp), mem = result.members[i];
      if (F.N > mem.tension) mem.tension = F.N; if (-F.N > mem.compression) mem.compression = -F.N; if (Math.max(F.Mv, F.Mw) > mem.moment) mem.moment = Math.max(F.Mv, F.Mw);
      if (k.util > mem.util) { mem.util = k.util; mem.mode = k.mode; mem.case = c.id; }
      if (k.util > maxUtil) { maxUtil = k.util; governing = i; mode = k.mode; }
    });
    // Service state: movement of the deck under the variable loads alone.
    const us = solve(r.Lm, n, r.l.live);
    let sag = 0, sway = 0;
    for (const i of deckIdx) { sag = Math.max(sag, Math.abs(us[dof[i][1]])); sway = Math.max(sway, Math.abs(us[dof[i][2]])); }
    if ((c.vehicles || []).length) design.members.forEach((_, i) => { const s = forces(us, null, i).N / props[i].A / 1e3; if (s > stress[i][1]) stress[i][1] = s; if (s < stress[i][0]) stress[i][0] = s; });
    result.sag = Math.max(result.sag, sag); result.sway = Math.max(result.sway, sway);
    const a = stab.get(c.id) ?? null;
    const ok = maxUtil <= 1 + 1e-9 && sag <= result.sagLimit && sway <= result.swayLimit && (a == null || a >= site.limits.alphaCr);
    if (!ok) result.ok = false;
    result.cases.push({ id: c.id, ok, maxUtil: round(maxUtil, 3), governing, mode, sag, sway, alphaCr: a == null || !Number.isFinite(a) ? null : round(a, 2) });
  }
  if (frequency) { // lowest natural frequency by inverse iteration, all cables working
    if (!factors.has('-1|')) factors.set('-1|', factor(assemble(new Set()), n));
    const Lm = factors.get('-1|');
    if (!Lm) { result.mechanism = true; result.ok = false; return result; }
    const M = new Float64Array(n);
    design.nodes.forEach((_, i) => { for (let p = 0; p < 3; p++) M[dof[i][p]] = mass[i] / 1000; }); // tonnes, so ω² comes out in 1/s²
    let v = new Float64Array(n).map((_, i) => 1 + 0.37 * Math.sin(i * 1.7)), w2 = 0;
    for (let s = 0; s < 40; s++) {
      const b = new Float64Array(n); for (let i = 0; i < n; i++) b[i] = M[i] * v[i];
      const w = solve(Lm, n, b);
      let num = 0, den = 0; for (let i = 0; i < n; i++) { num += v[i] * M[i] * v[i]; den += w[i] * M[i] * v[i]; }
      w2 = num / den;
      const nrm = Math.sqrt(w.reduce((t, q, i) => t + q * q * (M[i] || 0), 0)) || 1;
      v = w.map(q => q / nrm);
    }
    result.frequency = round(Math.sqrt(Math.max(0, w2)) / (2 * Math.PI), 3);
    if (result.frequency < site.limits.fMin) result.ok = false;
  }
  if (fatigue) {
    const cyc = Math.cbrt(2e6 / site.limits.fatigueCycles);
    let worst = 0, gov = null;
    const members = design.members.map((m, i) => {
      const range = stress[i][1] - stress[i][0], allow = m.opt.material.fatigue[m.fixA || m.fixB ? 'rigid' : 'pin'] * cyc, util = allow > 0 ? range / allow : range > 0 ? Infinity : 0;
      if (util > worst) { worst = util; gov = i; }
      if (util > result.members[i].util) { result.members[i].util = util; result.members[i].mode = 'fatigue'; result.members[i].case = 'traffic'; }
      return { range: round(range, 1), allow: round(allow, 1), util: round(util, 3) };
    });
    result.fatigue = { ok: worst <= 1 + 1e-9, worst: round(worst, 3), governing: gov, members };
    if (!result.fatigue.ok) result.ok = false;
  }
  if (robustness) { // any one cable or rod may snap: the rest must hold dead load and half the traffic, at material strength
    const snap = design.members.map((m, i) => i).filter(i => SNAPPABLE.has(design.members[i].opt.family)).sort((a, b) => result.members[b].tension - result.members[a].tension).slice(0, 40);
    const base = cases.find(c => (c.vehicles || []).length) || cases[0];
    let bad = null;
    if (base) for (const gone of snap) {
      const r = run({ ...base, wind: 0, braking: 0, dT: 0, combo: 'uls' }, gone, l => { const out = new Float64Array(n); for (let i = 0; i < n; i++) out[i] = l.perm[i] + site.factors.accidentalLive * l.live[i]; return out; });
      if (!r) { bad = { member: gone, failure: 'the structure becomes a mechanism' }; break; }
      let top = 0, at = -1, mode = '';
      r.F.forEach((F, i) => { if (i === gone) return; const k = check(i, F, null, 1); if (k.util > top) { top = k.util; at = i; mode = k.mode; } });
      if (top > 1 + 1e-9) { bad = { member: gone, failure: `${label(design.members[at])} reaches ${round(top, 2)}× its strength (${mode})` }; break; }
    }
    result.robustness = { ok: !bad, checked: snap.length, lost: bad ? label(design.members[bad.member]) : null, failure: bad?.failure || null };
    if (bad) result.ok = false;
  }
  return result;
}

// ---------------------------------------------------------------------------
// The physics limit. At any section x the loads produce a bending moment M(x)
// that the structure must carry inside the allowed depth H. Whatever its
// shape, the forces crossing that section satisfy Σ|N| ≥ |M|/H, so the
// material along the span weighs at least (ρ/f) ∫|M|/H dx, with ρ/f the best
// density-to-strength ratio in the catalogue. The other load cases, self-weight, buckling,
// stiffness, joints, wind, fatigue and robustness all only add to that.
export function lowerBound3(site) {
  const H = site.region.yMax - site.region.yMin, L = site.span, v = site.loads.vehicle, steps = 240;
  const best = Math.min(...Object.values(MATERIALS).map(m => m.rho * m.tol.rho[0] / (m.fy * m.tol.fy[1] * 1e3 / site.factors.gammaM)));
  const gG = site.factors.gammaG, gQ = site.factors.gammaQ;
  // Simply supported moment diagram for a set of point loads [x, P] plus a uniform load q on [x0, x1].
  const integral = (points, strips) => {
    let total = 0;
    for (let s = 0; s <= steps; s++) {
      const x = L * s / steps; let M = 0;
      for (const [a, P] of points) M += a <= x ? P * a * (L - x) / L : P * x * (L - a) / L;
      for (const [x0, x1, q] of strips) { const n2 = 24; for (let j = 0; j < n2; j++) { const a = x0 + (x1 - x0) * (j + 0.5) / n2, P = q * (x1 - x0) / n2; M += a <= x ? P * a * (L - x) / L : P * x * (L - a) / L; } }
      total += Math.abs(M) * (s === 0 || s === steps ? 0.5 : 1) * L / steps;
    }
    return total;
  };
  // Only loads every built unit is certain to see: the deck's own dead load and
  // the proof load PL (the heaviest vehicle in every lane at midspan).
  const points = [], len = v.spacingMin * (v.axles - 1), c = Math.max(len / 2, Math.min(L - len / 2, L * 0.5));
  for (let lane = 0; lane < site.loads.lanes; lane++) for (let j = 0; j < v.axles; j++) points.push([c + len / 2 - j * v.spacingMin, gQ * v.weightMax * v.phi * (j === 0 ? v.frontShare : (1 - v.frontShare) / (v.axles - 1))]);
  const worst = integral(points, [[0, L, gG * site.loads.deadKNm2 * site.width]]);
  return { mass: round(best * worst / H, 1), depth: round(H, 2), momentArea: round(worst, 0) };
}
