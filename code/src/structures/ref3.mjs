// structures-v3 reference engineer: a conventional braced truss hung under
// the deck, every member a round S355 tube sized by iteration. It is the
// hand-made anchor of the rating (1500), not a target: it is safe and dull.
import { OPTIONS, FAMILIES } from './site2.mjs';
import { heldOutUnits3, envelopeCases3 } from './site3.mjs';
import { validateDesign3, analyse3, nominalUnit3, designMass3 } from './frame3.mjs';

const TUBES = FAMILIES.CHS.sizes.map(s => `S355 ${s.id}`).sort((a, b) => OPTIONS[a].section.A - OPTIONS[b].section.A);

export function referenceLayout3(site) {
  const below = site.keepOuts.filter(k => k.y1 < 0);
  const depth = Math.min(-site.region.yMin, ...below.map(k => -k.y1));
  if (depth < 1.2) return null;
  const n = site.panels, nodes = [], members = [];
  const L = k => `L${k}`, R = k => `R${k}`, BL = k => `BL${k}`, BR = k => `BR${k}`;
  for (let k = 0; k <= n; k++) { const x = site.deck[2 * k].x; nodes.push({ id: BL(k), x, y: -depth, z: -site.width / 2 }, { id: BR(k), x, y: -depth, z: site.width / 2 }); }
  const add = (a, b, group) => members.push({ a, b, group });
  for (let k = 0; k < n; k++) {
    add(L(k), L(k + 1), 'chord'); add(R(k), R(k + 1), 'chord'); add(BL(k), BL(k + 1), 'chord'); add(BR(k), BR(k + 1), 'chord');
    // No bracing in the bottom plane: an open section twists freely, so one
    // bearing can settle without wringing the whole truss.
    if (k % 2 === 0) { add(L(k), BL(k + 1), 'web'); add(R(k), BR(k + 1), 'web'); add(L(k), R(k + 1), 'lateral'); }
    else { add(BL(k), L(k + 1), 'web'); add(BR(k), R(k + 1), 'web'); add(R(k), L(k + 1), 'lateral'); }
  }
  for (let k = 0; k <= n; k++) { add(L(k), BL(k), 'web'); add(R(k), BR(k), 'web'); add(L(k), R(k), 'cross'); add(BL(k), BR(k), 'cross'); add(k % 2 ? L(k) : R(k), k % 2 ? BR(k) : BL(k), 'cross'); }
  return { depth, nodes, members };
}

// Size every member for a pessimistic unit, then confirm on the real held-out units.
export function referenceDesign3(site) {
  const layout = referenceLayout3(site);
  if (!layout) return null;
  const size = layout.members.map(() => Math.floor(TUBES.length / 2));
  const build = () => ({ nodes: layout.nodes, members: layout.members.map((m, i) => [m.a, m.b, TUBES[size[i]]]) });
  const harsh = nominalUnit3();
  for (const k of Object.keys(harsh.material)) harsh.material[k] = { fyF: 0.93, EF: 0.96, rhoF: 1.005, tF: 0.92 };
  harsh.imperfection = 1.5;
  const TARGET = 0.8, envelope = envelopeCases3(site);
  let design;
  try { design = validateDesign3(site, build()); } catch (e) { if (process.env.STRUCT_DEBUG) console.log('reference layout rejected:', e.message); return null; }
  for (let pass = 0; pass < 24; pass++) {
    const res = analyse3(site, design, envelope, harsh);
    if (res.mechanism) return null;
    let changed = false;
    const globalBad = res.sag > res.sagLimit || res.sway > res.swayLimit || (res.frequency != null && res.frequency < site.limits.fMin) || (res.alphaCr != null && res.alphaCr < site.limits.alphaCr * 1.15);
    res.members.forEach((m, i) => {
      const A = OPTIONS[TUBES[size[i]]].section.A;
      let next = size[i];
      const need = A * Math.min(4, Math.max(0.25, m.util / (TARGET * 0.92)));
      if (m.util > TARGET) { while (next < TUBES.length - 1 && OPTIONS[TUBES[next]].section.A < need) next++; if (next === size[i] && next < TUBES.length - 1) next++; }
      else if (globalBad && next < TUBES.length - 1 && (layout.members[i].group === 'chord' || res.alphaCr < site.limits.alphaCr * 1.15)) next++;
      else if (!globalBad && m.util < TARGET * 0.8 && pass < 16) { while (next > 0 && next > size[i] - 4 && OPTIONS[TUBES[next - 1]].section.A >= need) next--; }
      if (next !== size[i]) { size[i] = next; changed = true; }
    });
    design = validateDesign3(site, build());
    if (!changed) break;
  }
  // Confirm on every built unit; if any fails, thicken everything a step and try again.
  for (let bump = 0; bump < 5; bump++) {
    const fails = [...heldOutUnits3(site).map(u => analyse3(site, design, u.cases, u)), analyse3(site, design, site.designCases)].filter(r => !r.ok);
    if (process.env.STRUCT_DEBUG && fails.length) console.log('bump', bump, fails.length, 'fail:', fails.slice(0, 3).map(r => r.cases.filter(c => !c.ok).map(c => `${c.id} util ${c.maxUtil} ${c.mode} sag ${c.sag?.toFixed(3)}/${r.sagLimit.toFixed(3)} sway ${c.sway?.toFixed(3)}/${r.swayLimit.toFixed(3)} acr ${c.alphaCr}`).join('; ') + ` f ${r.frequency} fat ${r.fatigue?.worst}`).join(' | '));
    const ok = !fails.length;
    if (ok) return { design: build(), mass: designMass3(design), layout: `braced open truss under the deck, ${layout.depth} m deep`, depth: layout.depth };
    for (let i = 0; i < size.length; i++) size[i] = Math.min(TUBES.length - 1, size[i] + 1);
    design = validateDesign3(site, build());
  }
  return null;
}
