// structures-v2 analysis: a 2D frame solver (axial + bending, with end
// releases, rigid or pinned joints and tension-only cables) plus the checks a
// bridge engineer runs: section class, yield, flexural buckling on a buckling
// curve, bending interaction, shear, out-of-plane wind bending, deck
// deflection, lowest natural frequency, fatigue stress range, corrosion.
//
// Units inside: metres, kN, kN/m², kg. Section properties come in m-based.

import { MATERIALS, OPTIONS, JOINT_KG, JOINT_KG_PER_KGM, CORROSION_MM, G } from './site2.mjs';

const EPS = 1e-6;
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const DRAG = { CHS: 1.2, ROD: 1.2, WIRE: 1.2, SHS: 2.0, IPE: 2.0, HEB: 2.0, L: 2.0, FLAT: 2.0, TIMBER: 2.0 };
const ICE_KN_M3 = 8.83;

export class DesignError extends Error {}

// ---------------------------------------------------------------------------
// Validation. A design is { nodes: [{id,x,y,joint?}], joints?: {id: 'pin'|'rigid'},
// members: [[a,b,"MAT SECTION"] | {a,b,spec,ends?:'pin'}] }. Deck nodes and
// supports exist already; the model may set their joint type in `joints`.
export function fixedNodes(site) {
  const out = new Map();
  for (const d of site.deck) out.set(d.id, { id: d.id, x: d.x, y: d.y, deck: true, joint: 'pin' });
  for (const s of site.supports) out.set(s.id, { ...(out.get(s.id) || { id: s.id, x: s.x, y: s.y, joint: 'pin' }), support: s });
  return out;
}
function inside(k, x, y) { return x > k.x0 + EPS && x < k.x1 - EPS && y > k.y0 + EPS && y < k.y1 - EPS; }
function crosses(k, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a.x - (k.x0 + EPS)], [dx, (k.x1 - EPS) - a.x], [-dy, a.y - (k.y0 + EPS)], [dy, (k.y1 - EPS) - a.y]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 1e-9;
}

export function validateDesign(site, raw) {
  if (!raw || typeof raw !== 'object') throw new DesignError('The design must be a JSON object with "nodes" and "members".');
  const fab = site.fabrication;
  const nodes = fixedNodes(site);
  const extra = Array.isArray(raw.nodes) ? raw.nodes : [];
  if (!Array.isArray(raw.members)) throw new DesignError('"members" must be a list of [nodeA, nodeB, "MATERIAL SECTION"].');
  const { xMin, xMax, yMin, yMax } = site.region;
  const jointOf = v => (v === 'rigid' ? 'rigid' : v === 'pin' || v == null ? 'pin' : null);
  for (const n of extra) {
    const id = Array.isArray(n) ? n[0] : n?.id, x = Number(Array.isArray(n) ? n[1] : n?.x), y = Number(Array.isArray(n) ? n[2] : n?.y);
    const joint = jointOf(Array.isArray(n) ? n[3] : n?.joint);
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,12}$/.test(id)) throw new DesignError(`Node id ${JSON.stringify(id)} is not valid: use 1-12 letters, digits, _ or -.`);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new DesignError(`Node ${id} needs numeric x and y.`);
    if (!joint) throw new DesignError(`Node ${id}: joint must be "pin" or "rigid".`);
    const fixed = nodes.get(id);
    if (fixed && (fixed.deck || fixed.support)) {
      if (Math.abs(fixed.x - x) > 1e-3 || Math.abs(fixed.y - y) > 1e-3) throw new DesignError(`Node ${id} is fixed by the site at (${fixed.x}, ${fixed.y}); it cannot be moved.`);
      fixed.joint = joint; continue;
    }
    if (fixed) throw new DesignError(`Node ${id} is listed twice.`);
    if (x < xMin - EPS || x > xMax + EPS || y < yMin - EPS || y > yMax + EPS) throw new DesignError(`Node ${id} at (${x}, ${y}) is outside the allowed region x ${xMin}..${xMax}, y ${yMin}..${yMax}.`);
    for (const k of site.keepOuts) if (inside(k, x, y)) throw new DesignError(`Node ${id} at (${x}, ${y}) is inside the ${k.id} clearance zone.`);
    nodes.set(id, { id, x: round(x, 4), y: round(y, 4), joint });
  }
  if (raw.joints && typeof raw.joints === 'object') for (const [id, v] of Object.entries(raw.joints)) { const n = nodes.get(id); if (!n) throw new DesignError(`joints: node ${id} does not exist.`); const j = jointOf(v); if (!j) throw new DesignError(`joints.${id} must be "pin" or "rigid".`); n.joint = j; }
  if (nodes.size > fab.maxNodes) throw new DesignError(`At most ${fab.maxNodes} nodes, including the site's fixed nodes.`);
  if (!raw.members.length) throw new DesignError('The design has no members.');
  if (raw.members.length > fab.maxMembers) throw new DesignError(`At most ${fab.maxMembers} members.`);
  const seen = new Set(), members = [], atNode = new Map();
  for (const m of raw.members) {
    const [a, b, spec, endsRaw] = Array.isArray(m) ? m : [m?.a, m?.b, m?.spec ?? m?.section, m?.ends];
    const na = nodes.get(a), nb = nodes.get(b);
    if (!na || !nb) throw new DesignError(`Member ${JSON.stringify(m)} refers to a node that does not exist.`);
    if (a === b) throw new DesignError(`Member ${a}-${b} joins a node to itself.`);
    const opt = typeof spec === 'string' ? OPTIONS[spec.trim().replace(/\s+/g, ' ')] : null;
    if (!opt) throw new DesignError(`Member ${a}-${b}: unknown option ${JSON.stringify(spec)}. Use "MATERIAL SECTION", e.g. "S355 CHS114.3x5".`);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) throw new DesignError(`Member ${a}-${b} is listed twice.`);
    seen.add(key);
    const len = Math.hypot(nb.x - na.x, nb.y - na.y);
    if (len < fab.minMember) throw new DesignError(`Member ${a}-${b} is ${round(len, 2)} m long; the minimum is ${fab.minMember} m.`);
    if (len > fab.maxMember) throw new DesignError(`Member ${a}-${b} is ${round(len, 2)} m long; nothing longer than ${fab.maxMember} m can be delivered to this site.`);
    for (const k of site.keepOuts) if (crosses(k, na, nb)) throw new DesignError(`Member ${a}-${b} crosses the ${k.id} clearance zone.`);
    const ends = endsRaw === 'pin' ? 'pin' : null;
    const cable = Boolean(opt.material.cable);
    // Fixed at an end only when that node is rigid, the member is not
    // pinned by choice and the material can take a moment connection.
    const fixA = na.joint === 'rigid' && !ends && !cable, fixB = nb.joint === 'rigid' && !ends && !cable;
    if ((fixA || fixB) && !opt.material.weldable) throw new DesignError(`Member ${a}-${b}: ${opt.material.name} cannot be given a rigid (moment) connection; set ends: "pin" or use a pinned node.`);
    members.push({ a, b, spec: opt.key, opt, len, cable, fixA, fixB });
    for (const id of [a, b]) { (atNode.get(id) || atNode.set(id, []).get(id)).push(members.length - 1); }
  }
  for (const d of site.deck) if (!atNode.has(d.id)) throw new DesignError(`Deck node ${d.id} is not connected: every deck node carries load.`);
  for (const [id, n] of nodes) if (!atNode.has(id) && !n.deck && !n.support) throw new DesignError(`Node ${id} has no members.`);
  // Fabrication: how many members meet at a joint, and the angle between them.
  const minAng = fab.minAngleDeg * Math.PI / 180;
  for (const [id, list] of atNode) {
    if (list.length > fab.maxAtJoint) throw new DesignError(`Node ${id} has ${list.length} members; at most ${fab.maxAtJoint} can be connected at one joint.`);
    const n = nodes.get(id);
    const dirs = list.map(i => { const m = members[i], o = nodes.get(m.a === id ? m.b : m.a); return Math.atan2(o.y - n.y, o.x - n.x); });
    for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
      let d = Math.abs(dirs[i] - dirs[j]); d = Math.min(d, 2 * Math.PI - d);
      if (d < minAng - 1e-9) throw new DesignError(`At node ${id}, members ${label(members[list[i]])} and ${label(members[list[j]])} meet at ${round(d * 180 / Math.PI, 1)}°; the minimum joint angle is ${fab.minAngleDeg}°.`);
    }
  }
  const used = new Set(atNode.keys());
  return { nodes: [...nodes.values()].filter(n => used.has(n.id)), members };
}
const label = m => `${m.a}-${m.b}`;

export function designMass(design) {
  let mass = 0;
  const atNode = new Map();
  for (const m of design.members) { mass += m.opt.kgPerM * m.len; for (const id of [m.a, m.b]) atNode.set(id, (atNode.get(id) || 0) + m.opt.kgPerM); }
  for (const n of design.nodes) mass += JOINT_KG[n.joint] + JOINT_KG_PER_KGM * (atNode.get(n.id) || 0);
  return mass;
}

// ---------------------------------------------------------------------------
// Effective section properties for one built unit: corrosion, section class
// and the unit's thickness draw.
function effective(site, m, unit) {
  const mat = m.opt.material, s = m.opt.section;
  const uf = unit.material[mat.id];
  let tf = uf.tF; // thickness factor applies to thin-walled area and stiffness
  if (mat.corrodes) {
    const allowance = CORROSION_MM[site.limits.corrosion] * site.limits.designLifeYears / 50 / 1e3;
    tf *= m.opt.family === 'ROD' || m.opt.family === 'WIRE' ? Math.max(0.3, (1 - 2 * allowance / (2 * s.t)) ** 2) : Math.max(0.3, 1 - allowance / s.t);
  }
  let fy = mat.fy * uf.fyF;
  if (mat.timber && (site.limits.corrosion === 'C4' || site.limits.corrosion === 'C5')) fy *= 0.8; // outdoor service class
  const E = mat.E * uf.EF;
  const eps = Math.sqrt(235 / Math.max(fy, 1));
  const limit = s.slenderLimit * (m.opt.family === 'CHS' ? eps * eps : eps);
  const cls = Math.min(1, Math.sqrt(limit / Math.max(s.slender, 1e-9))); // class-4 reduction on compression and bending
  return { A: s.A * tf, Ac: s.A * tf * cls, Iy: s.Iy * tf, Iz: s.Iz * tf, Wy: s.Wy * tf * cls, Wz: s.Wz * tf * cls, Av: s.Av * tf, E, fy, rho: mat.rho * uf.rhoF, alpha: mat.alpha, cls };
}

// ---------------------------------------------------------------------------
// Element stiffness in local coordinates with end releases condensed out.
// Returns { k (6x6), fe (fixed-end vector for unit transverse load), ... }.
function localStiffness(EA, EI, L, fixA, fixB) {
  const k = Array.from({ length: 6 }, () => new Float64Array(6));
  k[0][0] = k[3][3] = EA / L; k[0][3] = k[3][0] = -EA / L;
  if (EI > 0) {
    const a = 12 * EI / L ** 3, b = 6 * EI / L ** 2, c = 4 * EI / L, d = 2 * EI / L;
    k[1][1] = a; k[1][2] = b; k[1][4] = -a; k[1][5] = b;
    k[2][1] = b; k[2][2] = c; k[2][4] = -b; k[2][5] = d;
    k[4][1] = -a; k[4][2] = -b; k[4][4] = a; k[4][5] = -b;
    k[5][1] = b; k[5][2] = d; k[5][4] = -b; k[5][5] = c;
  }
  const released = [];
  if (EI > 0 && !fixA) released.push(2);
  if (EI > 0 && !fixB) released.push(5);
  return { k, released };
}
// Static condensation of released dofs: k_cc - k_cr k_rr^-1 k_rc, and the
// matching reduction of a load vector f.
function condense(k, f, released) {
  if (!released.length) return { k, f, recover: () => [] };
  const n = 6, rel = released, keep = [0, 1, 2, 3, 4, 5].filter(i => !rel.includes(i));
  // k_rr is 1x1 or 2x2
  const krr = rel.map(i => rel.map(j => k[i][j]));
  let inv;
  if (rel.length === 1) inv = [[1 / krr[0][0]]];
  else { const det = krr[0][0] * krr[1][1] - krr[0][1] * krr[1][0]; inv = [[krr[1][1] / det, -krr[0][1] / det], [-krr[1][0] / det, krr[0][0] / det]]; }
  const kc = Array.from({ length: n }, () => new Float64Array(n));
  const fc = new Float64Array(n);
  for (const i of keep) {
    for (const j of keep) {
      let v = k[i][j];
      for (let p = 0; p < rel.length; p++) for (let q = 0; q < rel.length; q++) v -= k[i][rel[p]] * inv[p][q] * k[rel[q]][j];
      kc[i][j] = v;
    }
    let fv = f[i];
    for (let p = 0; p < rel.length; p++) for (let q = 0; q < rel.length; q++) fv -= k[i][rel[p]] * inv[p][q] * f[rel[q]];
    fc[i] = fv;
  }
  // Recover released rotations from the kept displacements: u_r = -k_rr^-1 (k_rc u_c + f_r)
  const recover = u => rel.map((ri, p) => { let s = 0; for (let q = 0; q < rel.length; q++) { let t = f[rel[q]]; for (const j of keep) t += k[rel[q]][j] * u[j]; s += inv[p][q] * t; } return -s; });
  return { k: kc, f: fc, recover };
}

// ---------------------------------------------------------------------------
// Analysis of one design for one built unit (material draws + imperfection)
// over a list of load cases. `unit` defaults to nominal.
export function nominalUnit() {
  const material = {};
  for (const m of Object.values(MATERIALS)) material[m.id] = { fyF: 1, EF: 1, rhoF: 1, tF: 1 };
  return { unit: 0, material, imperfection: 1, cases: [] };
}

export function analyse(site, design, cases, unit = nominalUnit(), { fatigue = true, frequency = true } = {}) {
  const N = design.nodes.length;
  const index = new Map(design.nodes.map((n, i) => [n.id, i]));
  // dof numbering: ux, uy for every node; theta only for rigid nodes
  const dofOf = design.nodes.map(() => [-1, -1, -1]);
  const needsTheta = new Set();
  for (const m of design.members) { if (m.fixA) needsTheta.add(m.a); if (m.fixB) needsTheta.add(m.b); }
  let ndof = 0;
  design.nodes.forEach((n, i) => { dofOf[i][0] = ndof++; dofOf[i][1] = ndof++; if (n.joint === 'rigid' && needsTheta.has(n.id)) dofOf[i][2] = ndof++; });
  const gammaM = site.factors.gammaM;
  const props = design.members.map(m => effective(site, m, unit));
  const iceT = site.loads.iceMm / 1e3;
  // Per-member geometry and element matrices
  // Transform local to global: u_local = T u_global
  const T = e => [[e.c, e.s, 0, 0, 0, 0], [-e.s, e.c, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0], [0, 0, 0, e.c, e.s, 0], [0, 0, 0, -e.s, e.c, 0], [0, 0, 0, 0, 0, 1]];
  const el = design.members.map((m, i) => {
    const a = design.nodes[index.get(m.a)], b = design.nodes[index.get(m.b)];
    const c = (b.x - a.x) / m.len, s = (b.y - a.y) / m.len;
    const p = props[i];
    const EA = p.E * 1e3 * p.A, EI = m.cable ? 0 : p.E * 1e3 * p.Iy; // kN, kN·m²
    const fixA = m.fixA && dofOf[index.get(m.a)][2] >= 0, fixB = m.fixB && dofOf[index.get(m.b)][2] >= 0;
    const { k, released } = localStiffness(EA, EI, m.len, fixA, fixB);
    const dofs = [dofOf[index.get(m.a)][0], dofOf[index.get(m.a)][1], dofOf[index.get(m.a)][2], dofOf[index.get(m.b)][0], dofOf[index.get(m.b)][1], dofOf[index.get(m.b)][2]];
    const selfKNm = p.rho * p.A * G / 1e3; // kN/m
    const iceKNm = iceT ? ICE_KN_M3 * iceT * (m.opt.section.perim + Math.PI * iceT) : 0;
    const depthIce = m.opt.section.depth + 2 * iceT;
    const e = { c, s, k, released, dofs, EA, EI, fixA, fixB, selfKNm, iceKNm, depthIce, p };
    const { k: kc } = condense(k, new Float64Array(6), released);
    const Tm = T(e), kg = Array.from({ length: 6 }, () => new Float64Array(6));
    for (let i2 = 0; i2 < 6; i2++) for (let j = 0; j < 6; j++) { let v = 0; for (let p2 = 0; p2 < 6; p2++) for (let q = 0; q < 6; q++) v += Tm[p2][i2] * kc[p2][q] * Tm[q][j]; kg[i2][j] = v; }
    e.kg = kg; e.T = Tm;
    return e;
  });
  // Lumped nodal masses (kg) for seismic and frequency: members, joints, deck dead load.
  const nodeMass = new Float64Array(N);
  const kgAt = new Map();
  design.members.forEach((m, i) => { const w = el[i].p.rho * el[i].p.A * m.len / 2; nodeMass[index.get(m.a)] += w; nodeMass[index.get(m.b)] += w; for (const id of [m.a, m.b]) kgAt.set(id, (kgAt.get(id) || 0) + m.opt.kgPerM); });
  design.nodes.forEach((n, i) => { nodeMass[i] += JOINT_KG[n.joint] + JOINT_KG_PER_KGM * (kgAt.get(n.id) || 0); });
  const a0 = site.span / site.panels;
  const deckIdx = site.deck.map(d => index.get(d.id));
  deckIdx.forEach((i, k) => { nodeMass[i] += site.loads.deadKNm * 1e3 / G * (k === 0 || k === site.panels ? a0 / 2 : a0); });
  const mass = designMass(design);

  // Support conditions
  const fixedDof = new Set(); const spring = new Map(); const supportDof = new Map();
  for (const n of design.nodes) {
    if (!n.support) continue;
    const i = index.get(n.id), s = n.support;
    if (s.type === 'pin') fixedDof.add(dofOf[i][0]);
    if (s.kv) spring.set(dofOf[i][1], s.kv); else fixedDof.add(dofOf[i][1]);
    supportDof.set(s.id, dofOf[i][1]);
  }
  const free = []; const map = new Int32Array(ndof).fill(-1);
  for (let d = 0; d < ndof; d++) if (!fixedDof.has(d)) { map[d] = free.length; free.push(d); }
  const F = free.length;

  // Assemble K for the current set of active members (cables may go slack).
  function assemble(active) {
    const K = new Float64Array(ndof * ndof);
    el.forEach((e, i) => {
      if (!active[i]) return;
      const kg = e.kg;
      for (let p = 0; p < 6; p++) { const dp = e.dofs[p]; if (dp < 0) continue; for (let q = 0; q < 6; q++) { const dq = e.dofs[q]; if (dq < 0) continue; K[dp * ndof + dq] += kg[p][q]; } }
    });
    for (const [d, kv] of spring) K[d * ndof + d] += kv;
    // Free-free block, Cholesky
    const Kff = new Float64Array(F * F);
    for (let i = 0; i < F; i++) for (let j = 0; j < F; j++) Kff[i * F + j] = K[free[i] * ndof + free[j]];
    let maxDiag = 0;
    for (let i = 0; i < F; i++) maxDiag = Math.max(maxDiag, Kff[i * F + i]);
    for (let j = 0; j < F; j++) {
      let sum = Kff[j * F + j];
      for (let k = 0; k < j; k++) sum -= Kff[j * F + k] ** 2;
      if (!(sum > maxDiag * 1e-11)) return null;
      const L = Math.sqrt(sum); Kff[j * F + j] = L;
      for (let i = j + 1; i < F; i++) { let s2 = Kff[i * F + j]; for (let k = 0; k < j; k++) s2 -= Kff[i * F + k] * Kff[j * F + k]; Kff[i * F + j] = s2 / L; }
    }
    const solve = rhs => {
      const y = new Float64Array(F);
      for (let i = 0; i < F; i++) { let s = rhs[i]; for (let k = 0; k < i; k++) s -= Kff[i * F + k] * y[k]; y[i] = s / Kff[i * F + i]; }
      for (let i = F - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < F; k++) s -= Kff[k * F + i] * y[k]; y[i] = s / Kff[i * F + i]; }
      return y;
    };
    return { K, solve };
  }
  const allActive = el.map(() => true);
  const base = assemble(allActive);
  const result = { mechanism: !base, ok: false, mass, cases: [], members: design.members.map(() => ({ util: 0, mode: null, case: null, tension: 0, compression: 0, moment: 0, slack: 0 })), sag: 0, sagLimit: site.span / site.limits.deflRatio, frequency: null, fMin: site.limits.fMin, fatigue: null };
  if (!base) { result.cases = cases.map(c => ({ id: c.id, ok: false, maxUtil: Infinity, governing: null, mode: 'mechanism', sag: null })); result.members.forEach(m => { m.util = Infinity; m.mode = 'mechanism'; }); return result; }

  // Load vector for a scenario. Returns { P (ndof), q (per element: [wx, wy] global kN/m), dT, settle }
  const vehicleLoads = (vehicles, phi) => {
    const f = new Float64Array(site.panels + 1);
    for (const vh of vehicles || []) {
      const n = site.loads.vehicle.axles, shares = n === 2 ? [site.loads.vehicle.frontShare, 1 - site.loads.vehicle.frontShare] : [site.loads.vehicle.frontShare, (1 - site.loads.vehicle.frontShare) / 2, (1 - site.loads.vehicle.frontShare) / 2];
      const len = vh.spacing * (n - 1);
      for (let k = 0; k < n; k++) {
        const x = Math.max(0, Math.min(site.span, vh.center + vh.dir * (len / 2 - k * vh.spacing)));
        const pos = x / a0, i = Math.min(site.panels - 1, Math.floor(pos)), t = pos - i;
        f[i] += vh.weight * shares[k] * phi * (1 - t); f[i + 1] += vh.weight * shares[k] * phi * t;
      }
    }
    return f;
  };
  const deckUDL = (kNm, x0, x1) => {
    const f = new Float64Array(site.panels + 1);
    for (let k = 0; k <= site.panels; k++) {
      const lo = Math.max(x0, (k - 0.5) * a0, 0), hi = Math.min(x1, (k + 0.5) * a0, site.span);
      if (hi > lo) f[k] += kNm * (hi - lo);
    }
    return f;
  };
  function buildLoads(c, factored) {
    const gG = factored ? (c.combo === 'seismic' ? 1 : site.factors.gammaG) : 1;
    const gQ = factored ? (c.combo === 'seismic' ? 0.3 : site.factors.gammaQ) : (c.combo === 'seismic' ? 0.3 : 1);
    const P = new Float64Array(ndof);
    const q = el.map(e => [0, -(gG * e.selfKNm + gQ * c.ice * e.iceKNm)]);
    design.nodes.forEach((n, i) => { P[dofOf[i][1]] -= gG * (JOINT_KG[n.joint] + JOINT_KG_PER_KGM * (kgAt.get(n.id) || 0)) * G / 1e3; });
    const dead = deckUDL(site.loads.deadKNm, 0, site.span);
    const veh = vehicleLoads(c.vehicles, site.loads.vehicle.phi);
    const ped = c.ped ? deckUDL(site.loads.pedestrianKNm, c.ped.x0, c.ped.x1) : null;
    const brake = deckUDL(site.loads.brakingKNm * (c.braking || 0), 0, site.span);
    deckIdx.forEach((i, k) => { P[dofOf[i][1]] -= gG * dead[k] + gQ * (veh[k] + (ped ? ped[k] : 0)); P[dofOf[i][0]] += gQ * brake[k]; });
    if (c.seismic) { const ah = site.loads.seismicAh * c.seismic; design.nodes.forEach((n, i) => { P[dofOf[i][0]] += ah * nodeMass[i] * G / 1e3; }); }
    return { P, q, dT: (c.dT || 0), settle: c.settle ? { dof: supportDof.get(c.settleAt) ?? supportDof.get(site.supports[site.supports.length - 1].id), mm: c.settle } : null, gQ };
  }

  // Solve one scenario (iterating slack cables). Returns per-member forces.
  function solveCase(c, factored) {
    const { P, q, dT, settle, gQ } = buildLoads(c, factored);
    let active = allActive.slice(), sys = base;
    for (let iter = 0; iter < 8; iter++) {
      // Fixed-end forces per element in global, condensed, plus thermal.
      const Pf = Float64Array.from(P);
      const fe = el.map((e, i) => {
        if (!active[i]) return null;
        const [wx, wy] = q[i];
        const qa = wx * e.c + wy * e.s, qt = -wx * e.s + wy * e.c; // local axial, transverse
        const f = new Float64Array(6);
        const L = design.members[i].len;
        f[0] = -qa * L / 2; f[3] = -qa * L / 2;
        if (e.EI > 0) { f[1] = -qt * L / 2; f[4] = -qt * L / 2; f[2] = -qt * L * L / 12; f[5] = qt * L * L / 12; } else { f[1] = -qt * L / 2; f[4] = -qt * L / 2; }
        const th = e.EA * e.p.alpha * dT; // restrained thermal strain
        f[0] += th; f[3] -= th;
        const cond = condense(e.k, f, e.released);
        return { full: f, cond };
      });
      el.forEach((e, i) => { if (!fe[i]) return; const Tm = e.T, fc = fe[i].cond.f; for (let p = 0; p < 6; p++) { const dp = e.dofs[p]; if (dp < 0) continue; let v = 0; for (let r = 0; r < 6; r++) v += Tm[r][p] * fc[r]; Pf[dp] -= v; } });
      // Prescribed displacements (settlement) and spring base movement.
      const u = new Float64Array(ndof);
      if (settle) {
        const d = settle.dof, delta = -settle.mm / 1e3;
        if (spring.has(d)) Pf[d] += spring.get(d) * delta;
        else { u[d] = delta; for (let i = 0; i < ndof; i++) if (map[i] >= 0) Pf[i] -= sys.K[i * ndof + d] * delta; }
      }
      const rhs = new Float64Array(F);
      for (let i = 0; i < F; i++) rhs[i] = Pf[free[i]];
      const uf = sys.solve(rhs);
      for (let i = 0; i < F; i++) u[free[i]] = uf[i];
      // Member end forces in local coordinates
      const forces = el.map((e, i) => {
        if (!active[i]) return { N: 0, Nmax: 0, Nmin: 0, M: 0, V: 0, slack: true };
        const Tm = e.T, ug = e.dofs.map(d => (d >= 0 ? u[d] : 0)), ul = new Float64Array(6);
        for (let p = 0; p < 6; p++) { let v = 0; for (let r = 0; r < 6; r++) v += Tm[p][r] * ug[r]; ul[p] = v; }
        const rec = fe[i].cond.recover(ul);
        e.released.forEach((ri, p) => { ul[ri] = rec[p]; });
        const Fl = new Float64Array(6);
        for (let p = 0; p < 6; p++) { let v = fe[i].full[p]; for (let r = 0; r < 6; r++) v += e.k[p][r] * ul[r]; Fl[p] = v; }
        const L = design.members[i].len, [wx, wy] = q[i], qt = -wx * e.s + wy * e.c;
        const Na = -Fl[0], Nb = Fl[3];
        let M = Math.max(Math.abs(Fl[2]), Math.abs(Fl[5]));
        if (e.EI > 0 && Math.abs(qt) > 1e-12) { const xs = -Fl[1] / qt; if (xs > 0 && xs < L) M = Math.max(M, Math.abs(xs * Fl[1] + qt * xs * xs / 2 - Fl[2])); }
        const V = Math.max(Math.abs(Fl[1]), Math.abs(Fl[4]));
        return { N: (Na + Nb) / 2, Nmax: Math.max(Na, Nb), Nmin: Math.min(Na, Nb), M, V, slack: false };
      });
      const slack = el.map((e, i) => design.members[i].cable && active[i] && forces[i].N < -1e-6);
      if (!slack.some(Boolean)) return { u, forces, gQ, active };
      slack.forEach((s, i) => { if (s) active[i] = false; });
      sys = assemble(active);
      if (!sys) return null; // removing a cable made it a mechanism
    }
    return null;
  }

  // Capacities and utilisation for one member under given forces, with the
  // out-of-plane wind moment added.
  function utilisation(i, f, windFrac, gQ) {
    const m = design.members[i], e = el[i], p = e.p, s = m.opt.section;
    const fyd = p.fy * 1e3 / gammaM; // kN/m²
    const Nt = p.A * fyd;
    if (m.cable) { if (f.slack) return { util: 0, mode: 'slack' }; return { util: f.Nmax / Nt, mode: 'tension' }; }
    const Imin = Math.min(p.Iy, p.Iz);
    const K = e.fixA && e.fixB ? 0.7 : e.fixA || e.fixB ? 0.85 : 1.0;
    const Ncr = Math.PI ** 2 * p.E * 1e3 * Imin / (K * m.len) ** 2;
    const lam = Math.sqrt(p.Ac * p.fy * 1e3 / Ncr);
    const alpha = s.alpha * unit.imperfection;
    const Phi = 0.5 * (1 + alpha * Math.max(0, lam - 0.2) + lam * lam);
    const chi = Math.min(1, 1 / (Phi + Math.sqrt(Math.max(0, Phi * Phi - lam * lam))));
    const Nb = chi * p.Ac * fyd;
    const MyRd = p.Wy * fyd, MzRd = p.Wz * fyd;
    // Out-of-plane wind bending (and ice-widened face), per metre
    const qw = Math.abs(windFrac) * site.loads.windKNm2 * DRAG[m.opt.family] * e.depthIce * gQ;
    const Mz = qw * m.len ** 2 / (e.fixA && e.fixB ? 12 : 8);
    const My = f.M;
    let util, mode;
    if (f.Nmin < 0) {
      const Nc = -f.Nmin, amp = Math.min(10, 1 / Math.max(1e-6, 1 - Nc / Ncr));
      const ub = Nc / Nb + amp * My / MyRd + Mz / MzRd;
      util = ub; mode = chi < 0.95 && Nc / Nb > amp * My / MyRd + Mz / MzRd ? 'buckling' : My / MyRd > Nc / Nb ? 'bending' : Mz / MzRd > Nc / Nb ? 'wind bending' : 'compression';
    } else { util = 0; mode = 'tension'; }
    const ut = f.Nmax / Nt + My / MyRd + Mz / MzRd;
    if (ut > util) { util = ut; mode = f.Nmax / Nt >= My / MyRd && f.Nmax / Nt >= Mz / MzRd ? 'tension' : My / MyRd >= Mz / MzRd ? 'bending' : 'wind bending'; }
    const uv = p.Av > 0 ? f.V / (p.Av * fyd / Math.sqrt(3)) : 0;
    if (uv > util) { util = uv; mode = 'shear'; }
    return { util, mode };
  }

  const sagOf = u => {
    const sA = site.supports[0], sB = site.supports.find(s => s.id !== sA.id && Math.abs(s.x - site.span) < 1e-6) || site.supports[1];
    const uA = u[dofOf[index.get(sA.id)][1]], uB = u[dofOf[index.get(sB.id)][1]];
    let worst = 0;
    deckIdx.forEach((i, k) => { const x = site.deck[k].x, line = uA + (uB - uA) * x / site.span; worst = Math.max(worst, line - u[dofOf[i][1]]); });
    return worst;
  };

  let allOk = true;
  for (const c of cases) {
    const uls = solveCase(c, true);
    const sls = solveCase(c, false);
    if (!uls || !sls) { result.cases.push({ id: c.id, ok: false, maxUtil: Infinity, governing: null, mode: 'mechanism', sag: null }); allOk = false; continue; }
    let worst = 0, gov = null, mode = null;
    uls.forces.forEach((f, i) => {
      const { util, mode: md } = utilisation(i, f, c.wind || 0, uls.gQ);
      const mem = result.members[i];
      if (f.Nmax > mem.tension) mem.tension = f.Nmax;
      if (-f.Nmin > mem.compression) mem.compression = -f.Nmin;
      if (f.M > mem.moment) mem.moment = f.M;
      if (f.slack) mem.slack++;
      if (util > mem.util) { mem.util = util; mem.mode = md; mem.case = c.id; }
      if (util > worst) { worst = util; gov = i; mode = md; }
    });
    const sag = sagOf(sls.u);
    result.sag = Math.max(result.sag, sag);
    const ok = worst <= 1 + 1e-9 && sag <= result.sagLimit + 1e-9;
    if (!ok) allOk = false;
    result.cases.push({ id: c.id, ok, maxUtil: round(worst, 3), governing: gov, mode, sag: round(sag, 4) });
  }

  // Lowest natural frequency: inverse iteration on K (permanent state) with
  // lumped translational mass.
  if (frequency) {
    const Mv = new Float64Array(F);
    for (let i = 0; i < F; i++) { const d = free[i]; const node = dofOf.findIndex(dd => dd[0] === d || dd[1] === d); if (node >= 0) Mv[i] = nodeMass[node]; }
    let x = new Float64Array(F).fill(1);
    let omega2 = 0;
    for (let it = 0; it < 60; it++) {
      const rhs = new Float64Array(F); for (let i = 0; i < F; i++) rhs[i] = Mv[i] * x[i] / 1e3; // kg -> t so that K[kN/m] / M[t] = 1/s²
      const y = base.solve(rhs);
      let num = 0, den = 0; for (let i = 0; i < F; i++) { num += x[i] * rhs[i]; den += y[i] * rhs[i]; }
      const next = den > 0 ? num / den : 0;
      let norm = 0; for (let i = 0; i < F; i++) norm = Math.max(norm, Math.abs(y[i]));
      if (norm > 0) for (let i = 0; i < F; i++) x[i] = y[i] / norm;
      if (it > 5 && Math.abs(next - omega2) < 1e-6 * Math.max(1, next)) { omega2 = next; break; }
      omega2 = next;
    }
    result.frequency = round(Math.sqrt(Math.max(0, omega2)) / (2 * Math.PI), 3);
    if (result.frequency < site.limits.fMin) allOk = false;
    // Where the lowest mode strains the structure: each member's share of
    // the modal strain energy (axial). Stiffening the high-share members is
    // what raises the frequency.
    const xu = new Float64Array(ndof); for (let i = 0; i < F; i++) xu[free[i]] = x[i];
    const energy = el.map((e, i) => { const d = e.dofs; const ex = (xu[d[3]] - xu[d[0]]) * e.c + (xu[d[4]] - xu[d[1]]) * e.s; return e.EA / design.members[i].len * ex * ex; });
    const total = energy.reduce((a, b) => a + b, 0) || 1;
    result.modeEnergy = energy.map(v => round(v / total, 4));
  }

  // Fatigue: stress range from a vehicle sweep (unfactored, with Φ), per member.
  if (fatigue) {
    const v = site.loads.vehicle, len = v.spacingMin * (v.axles - 1);
    const sweep = [{ vehicles: [] }, ...site.deck.map((d, k) => ({ vehicles: [{ center: Math.max(len / 2, Math.min(site.span - len / 2, d.x)), weight: v.weightMax, spacing: v.spacingMin, dir: k % 2 ? -1 : 1 }] }))].map((s, i) => ({ id: `F${i}`, ...s, ped: null, braking: 0, wind: 0, ice: 0, dT: 0, seismic: 0, settle: 0, combo: 'uls' }));
    const hi = design.members.map(() => -Infinity), lo = design.members.map(() => Infinity);
    let okSweep = true;
    for (const c of sweep) {
      const r = solveCase(c, false);
      if (!r) { okSweep = false; break; }
      r.forces.forEach((f, i) => { const p = el[i].p; const sN = f.N / p.A / 1e3, sM = p.Wy > 0 ? f.M / p.Wy / 1e3 : 0; hi[i] = Math.max(hi[i], sN + sM); lo[i] = Math.min(lo[i], sN - sM); });
    }
    const cyc = Math.cbrt(2e6 / site.limits.fatigueCycles);
    let worst = 0, gov = null;
    const ranges = design.members.map((m, i) => {
      if (!okSweep) return { range: null, allow: null, util: Infinity };
      const joint = el[i].fixA || el[i].fixB ? 'rigid' : 'pin';
      const allow = m.opt.material.fatigue[joint] * cyc;
      const range = Math.max(0, hi[i] - lo[i]);
      const util = allow > 0 ? range / allow : Infinity;
      if (util > worst) { worst = util; gov = i; }
      return { range: round(range, 1), allow: round(allow, 1), util: round(util, 3) };
    });
    result.fatigue = { ok: worst <= 1 + 1e-9, worst: round(worst, 3), governing: gov, members: ranges };
    if (!result.fatigue.ok) allOk = false;
    result.members.forEach((mem, i) => { if (ranges[i].util > mem.util) { mem.util = ranges[i].util; mem.mode = 'fatigue'; mem.case = 'sweep'; } });
  }
  result.sag = round(result.sag, 4);
  result.ok = allOk && !result.mechanism;
  return result;
}
