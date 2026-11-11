// Sandbox scoring shared by the Lab page and the public release builder.
// Pure functions only: no React, so it can run anywhere.
import { fitBradleyTerry } from "./investing-analytics";
import { versionKey, versionedName } from "./model-versions";

export type Obstacle = { x: number; y: number; r: number };
export type TracePoint = { t: number; x: number; y: number; heading: number; speed: number; distanceAhead?: number; rays?: string; target?: number; left: number; right: number };
export type Attempt = { checkpoints?: string; attempt: number; code?: string; hypothesis?: string | null; error?: string; score: number; outcome: string; time: number; progress: number; message?: string | null; path?: [number, number][]; trace?: TracePoint[] };
export type Final = { attempt: number | null; score: number; goals: number; crashes: number; runs: { variant: number; score: number; outcome: string; time: number }[] };
export type Player = { attempts: Attempt[]; final: Final | null; stopped?: string };
export type Baseline = { name: string; final: Final; practice: { score: number; outcome: string; path?: [number, number][] } };
export type SandboxWorld = {
  id: string; status: string; error?: string | null; created_at: string;
  input: { seed: number; family: string; attempts: number; models: string[]; providerSnapshot: { id: string; name: string; model: string }[]; practice: { start: { x: number; y: number; heading: number }; goal: { x: number; y: number }; checkpoints?: { x: number; y: number }[]; obstacles: Obstacle[] }; arena: number; maxTime: number };
  hidden: null | { leftMotorGain: number; rightMotorGain: number; commandDelayTicks: number; traction: number; gravity: number; compassBiasDeg: number; rangeBias: number; rangeNoise: number; hills: { x: number; y: number; height: number; spread: number }[]; deadzone?: number; compassDriftDegPerS?: number; gpsNoise?: number; gpsRateHz?: number; rangeDropout?: number; sensorReach?: number; windSpeed?: number; windDirDeg?: number; gustAmplitude?: number; ice?: { x: number; y: number; r: number }[]; iceGrip?: number };
  result: { baselines?: Record<string, Baseline>; players?: Record<string, Player>; completedAt?: string };
  brief?: string;
  humans?: Record<string, { attempts: Attempt[]; final: Final | null }>;
};

export const BASELINE_IDS = new Set(["reference", "random", "idle"]);
export const REF = "reference";

// A world where no model returned any code measures the harness, not the
// models, so it is shown but left out of the ratings.
// A finished world where a model was stopped by provider trouble before
// using all its attempts is not rated until it is resumed and completed.
export function stoppedEarly(w: SandboxWorld) {
  if (w.status !== "complete" && w.status !== "failed") return [];
  const limit = w.input.attempts || 8;
  return Object.entries(w.result.players || {}).filter(([, p]) => p.attempts.length < limit).map(([id]) => id);
}
export function unrated(w: SandboxWorld) { const ps = Object.values(w.result.players || {}); return (ps.length > 0 && ps.every(p => !p.attempts.some(a => a.code))) || stoppedEarly(w).length > 0; }
// Learning score: the area under the best-so-far curve on the practice
// course, i.e. the mean of "best score so far" after each of the attempts.
// Rewards reaching a good controller early and keeping it; one late lucky run
// moves it little. Attempts a player never made keep their best so far.
export function learningScore(attempts: { score: number }[], limit = 8) {
  if (!attempts.length) return -15;
  let best = -Infinity, total = 0;
  for (let n = 0; n < limit; n++) { if (n < attempts.length) best = Math.max(best, attempts[n].score); total += best; }
  return total / limit;
}
export function learningBoard(worlds: SandboxWorld[]) {
  const sums: Record<string, { total: number; n: number }> = {};
  for (const w of worlds) {
    if (w.status !== "complete" || unrated(w)) continue;
    const limit = w.input.attempts || 8;
    for (const [provider, p] of Object.entries(w.result.players || {})) { const id = playerKey(w, provider); (sums[id] ||= { total: 0, n: 0 }); sums[id].total += learningScore(p.attempts, limit); sums[id].n++; }
  }
  return Object.fromEntries(Object.entries(sums).map(([id, v]) => [id, v.total / v.n]));
}
export function playerKey(w: SandboxWorld, provider: string) { const m = w.input.providerSnapshot.find(p => p.id === provider)?.model; return m ? versionKey(provider, m, w.created_at) : provider; }

// Elo across worlds: every pair of players in a finished world is a match on
// held-out score (within 3 points = draw). The reference controller is 1500.
export function sandboxElo(worlds: SandboxWorld[]) {
  const matches: { a: string; b: string; s: number }[] = [];
  const names: Record<string, string> = {};
  const counts: Record<string, number> = {};
  for (const w of worlds) {
    if (w.status !== "complete" || unrated(w)) continue;
    const field: { id: string; v: number }[] = [];
    for (const [id, b] of Object.entries(w.result.baselines || {})) { if (id === "idle") continue; field.push({ id, v: b.final.score }); names[id] ||= b.name; }
    for (const [provider, p] of Object.entries(w.result.players || {})) { if (!p.final) continue; const id = playerKey(w, provider); field.push({ id, v: p.final.score }); names[id] ||= versionedName(id, w.input.providerSnapshot.find(x => x.id === provider)?.name || provider); }
    for (const f of field) counts[f.id] = (counts[f.id] || 0) + 1;
    for (let i = 0; i < field.length; i++) for (let j = i + 1; j < field.length; j++) { const d = field[i].v - field[j].v; matches.push({ a: field[i].id, b: field[j].id, s: Math.abs(d) <= 3 ? 0.5 : d > 0 ? 1 : 0 }); }
  }
  const ids = Object.keys(names);
  const r = fitBradleyTerry(ids, ids.filter(id => id !== REF), matches);
  const k = Math.LN10 / 400, prior = 1 / (200 * 200);
  return ids.map(id => {
    let info = prior;
    for (const m of matches) if (m.a === id || m.b === id) { const p = 1 / (1 + Math.pow(10, (r[m.b] - r[m.a]) / 400)); info += k * k * p * (1 - p); }
    return { id, name: names[id], elo: Math.round(r[id]), ci: id === REF ? 0 : Math.round(1.96 / Math.sqrt(info)), worlds: counts[id] || 0, baseline: BASELINE_IDS.has(id) };
  }).sort((a, b) => b.elo - a.elo);
}

