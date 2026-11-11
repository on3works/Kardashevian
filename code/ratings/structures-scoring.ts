// Lightest Structure scoring shared by the Lab page (and later the public
// release builder). Pure functions only.
import { fitBradleyTerry } from "./investing-analytics";
import { learningScore } from "./sandbox-scoring";
import { versionKey, versionedName } from "./model-versions";

export type RawDesign = { nodes: ({ id: string; x: number; y: number; joint?: string } | [string, number, number, string?])[]; joints?: Record<string, string>; members: ([string, string, string] | { a: string; b: string; spec?: string; section?: string; ends?: string })[] };
export type StructAttempt = { attempt: number; outputTokens?: number | null; note?: string | null; design?: RawDesign; program?: string; analyses?: number; elapsedMs?: number; programError?: string; error?: string; ok?: boolean; mass?: number; score: number; maxUtil?: number | null; maxSag?: number | null; sag?: number; sagLimit?: number; frequency?: number | null; fMin?: number; fatigueWorst?: number | null; failure?: string | null; utils?: number[] | null };
export type HeldOut = { attempt?: number | null; score: number; delivered: number; mass: number | null; units: { unit: number; ok: boolean; score: number; failure: string | null; frequency?: number | null; sag?: number }[]; error?: string };
export type StructPlayer = { attempts: StructAttempt[]; final: HeldOut | null; stopped?: string };
export type KeepOut = { id?: string; x0: number; x1: number; y0: number; y1: number };
export type Site = {
  seed: number; span: number; panels: number;
  deck: { id: string; x: number; y: number }[];
  supports: { id: string; x: number; y: number; type: "pin" | "roller"; kv?: number; pier?: boolean }[];
  region: { xMin: number; xMax: number; yMin: number; yMax: number };
  keepOut?: KeepOut | null; keepOuts?: KeepOut[];
  loads: { deadKNm: number; windKNm?: number; windKNm2?: number; lanes?: number; pedestrianKNm?: number; brakingKNm?: number; iceMm?: number; tempRange?: number; seismicAh?: number; settlementMm?: number; vehicle: { axles?: number; weightMin: number; weightMax: number; frontShare: number; spacingMin: number; spacingMax: number; phi?: number } };
  limits?: { fMin: number; deflRatio: number; fatigueCycles: number; corrosion: string; designLifeYears: number };
  factors?: { gammaG: number; gammaQ: number; gammaM: number };
};
export type HeldOutUnit = { unit: number; material: Record<string, { fyF: number; EF: number; rhoF?: number; tF?: number }> | { fyF: number; EF: number }; imperfection?: number };
export type StructuresWorld = {
  id: string; status: string; error?: string | null; created_at: string;
  input: { protocol?: string; seed: number; attempts: number; models: string[]; providerSnapshot: { id: string; name: string; model: string }[] };
  site: Site;
  heldOut: HeldOutUnit[] | null;
  brief?: string;
  result: {
    par?: { mass: number; layout?: { type: string; side: string; depth: number }; design?: RawDesign };
    best?: { player: string; attempt: number | null; mass: number; score: number } | null;
    baselines?: { reference?: { name: string; design: RawDesign; layout: { type: string; side: string; depth: number }; practice: StructAttempt; final: HeldOut } };
    players?: Record<string, StructPlayer>;
    completedAt?: string;
  };
};

export const keepOutsOf = (site: Site): KeepOut[] => site.keepOuts || (site.keepOut ? [site.keepOut] : []);
export const isV2 = (w: StructuresWorld) => w.input.protocol !== "structures-v1";

export const REF = "reference";
export function playerKey(w: StructuresWorld, provider: string) { const m = w.input.providerSnapshot.find(p => p.id === provider)?.model; return m ? versionKey(provider, m, w.created_at) : provider; }
export function stoppedEarly(w: StructuresWorld) {
  if (!["complete", "failed", "paused"].includes(w.status)) return [];
  const limit = w.input.attempts || 8;
  return Object.entries(w.result.players || {}).filter(([, p]) => p.attempts.length < limit).map(([id]) => id);
}
// A site where no model returned a design measures the harness, not the models.
export function unrated(w: StructuresWorld) { const ps = Object.values(w.result.players || {}); return (ps.length > 0 && ps.every(p => !p.attempts.some(a => a.design))) || stoppedEarly(w).length > 0; }
export const rated = (w: StructuresWorld) => w.status === "complete" && !unrated(w);

export function structuresLearningBoard(worlds: StructuresWorld[]) {
  const sums: Record<string, { total: number; n: number }> = {};
  for (const w of worlds) {
    if (!rated(w)) continue;
    for (const [provider, p] of Object.entries(w.result.players || {})) { const id = playerKey(w, provider); (sums[id] ||= { total: 0, n: 0 }); sums[id].total += learningScore(p.attempts, w.input.attempts || 8); sums[id].n++; }
  }
  return Object.fromEntries(Object.entries(sums).map(([id, v]) => [id, v.total / v.n]));
}

// Elo across sites: every pair of players in a finished site is a match on
// held-out score (within 2 points = draw). The reference engineer is 1500.
export function structuresElo(worlds: StructuresWorld[]) {
  const matches: { a: string; b: string; s: number }[] = [];
  const names: Record<string, string> = {}, counts: Record<string, number> = {}, scores: Record<string, number[]> = {}, delivered: Record<string, number> = {};
  for (const w of worlds) {
    if (!rated(w)) continue;
    const field: { id: string; v: number; d: number }[] = [];
    const ref = w.result.baselines?.reference;
    if (ref) { field.push({ id: REF, v: ref.final.score, d: ref.final.delivered }); names[REF] ||= ref.name; }
    for (const [provider, p] of Object.entries(w.result.players || {})) { if (!p.final) continue; const id = playerKey(w, provider); field.push({ id, v: p.final.score, d: p.final.delivered }); names[id] ||= versionedName(id, w.input.providerSnapshot.find(x => x.id === provider)?.name || provider); }
    for (const f of field) { counts[f.id] = (counts[f.id] || 0) + 1; (scores[f.id] ||= []).push(f.v); delivered[f.id] = (delivered[f.id] || 0) + f.d; }
    for (let i = 0; i < field.length; i++) for (let j = i + 1; j < field.length; j++) { const d = field[i].v - field[j].v; matches.push({ a: field[i].id, b: field[j].id, s: Math.abs(d) <= 2 ? 0.5 : d > 0 ? 1 : 0 }); }
  }
  const ids = Object.keys(names);
  const r = fitBradleyTerry(ids, ids.filter(id => id !== REF), matches);
  const k = Math.LN10 / 400, prior = 1 / (200 * 200);
  return ids.map(id => {
    let info = prior;
    for (const m of matches) if (m.a === id || m.b === id) { const p = 1 / (1 + Math.pow(10, (r[m.b] - r[m.a]) / 400)); info += k * k * p * (1 - p); }
    const s = scores[id] || [];
    return { id, name: names[id], elo: Math.round(r[id]), ci: id === REF ? 0 : Math.round(1.96 / Math.sqrt(info)), sites: counts[id] || 0, meanScore: s.length ? s.reduce((a, b) => a + b, 0) / s.length : null, delivered: delivered[id] || 0, baseline: id === REF };
  }).sort((a, b) => b.elo - a.elo);
}

// Node coordinates, joint types and member list of a stored design, with the
// site's fixed nodes filled in, for drawing.
export function sectionDepthMm(spec: string) { const m = /(?:CHS|SHS|IPE|HEB|L|FLAT|ROD|WIRE|TIMBER)(\d+(?:\.\d+)?)/.exec(spec); return m ? Number(m[1]) : 100; }
export function resolveDesign(site: Site, design: RawDesign | undefined) {
  if (!design) return null;
  const pos = new Map<string, { x: number; y: number; joint: string }>();
  for (const d of site.deck) pos.set(d.id, { ...d, joint: "pin" });
  for (const s of site.supports) pos.set(s.id, { x: s.x, y: s.y, joint: "pin" });
  for (const n of design.nodes || []) { const [id, x, y, j] = Array.isArray(n) ? n : [n.id, n.x, n.y, n.joint]; if (typeof id === "string" && Number.isFinite(+x) && Number.isFinite(+y)) { const prev = pos.get(id); pos.set(id, { x: prev ? prev.x : +x, y: prev ? prev.y : +y, joint: j === "rigid" ? "rigid" : "pin" }); } }
  for (const [id, j] of Object.entries(design.joints || {})) { const p = pos.get(id); if (p) p.joint = j === "rigid" ? "rigid" : "pin"; }
  const used = new Set<string>();
  const members = (design.members || []).map(m => { const [a, b, spec] = Array.isArray(m) ? m : [m.a, m.b, m.spec || m.section || ""]; used.add(a); used.add(b); return { a: pos.get(a), b: pos.get(b), spec: String(spec), cable: /\bWIRE\b/.test(String(spec)), label: `${a}-${b}` }; }).filter(m => m.a && m.b) as { a: { x: number; y: number }; b: { x: number; y: number }; spec: string; cable: boolean; label: string }[];
  return { members, nodes: [...pos.entries()].filter(([id]) => used.has(id)).map(([id, p]) => ({ id, ...p })) };
}
