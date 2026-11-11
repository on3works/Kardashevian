// Builds a public release for kardashevian.com from what the Lab already
// shows, using the same scoring code, so the public numbers match the Lab's.
// A release holds numbers and names only: no prompts, replies, code or CVs
// (the backend refuses those fields).
import type { Cohort, Horizon, Risk } from "./investing-types";
import { cellObservations, earlyRead, HORIZONS, investorElo, isLiveModel, isMatrix, modelGrid, playerNames, RISKS, SPY_ID } from "./investing-analytics";
import { buildPatterns } from "./release-patterns";
import { learningBoard, learningScore, playerKey, sandboxElo, unrated, type SandboxWorld } from "./sandbox-scoring";
import { versionedName } from "./model-versions";

export const RELEASE_VERSION = "kardashevian-release-v1";
export const METHOD_VERSION = "1.0";

const PROVIDER_LABEL: Record<string, string> = { openai: "OpenAI", openai6: "OpenAI", deepseek: "DeepSeek", mimo: "Xiaomi", anthropic: "Anthropic", meta: "Meta", ember: "Meta" };
const round = (v: number | null | undefined, digits = 4) => v == null || !Number.isFinite(v) ? null : Number(v.toFixed(digits));
const slugOf = (id: string) => (id.split(":")[1] || id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type ReleaseModel = { id: string; name: string; provider: string; model: string; slug: string };
export type ReleaseDocument = ReturnType<typeof buildRelease>;

function downsample(path: [number, number][] | undefined, max = 80) {
  if (!path?.length) return [];
  const step = Math.max(1, Math.ceil(path.length / max));
  const out = path.filter((_, i) => i % step === 0);
  if (out.at(-1) !== path.at(-1)) out.push(path.at(-1)!);
  return out.map(([x, y]) => [Number(x.toFixed(1)), Number(y.toFixed(1))] as [number, number]);
}

export function buildRelease({ cohorts, worlds }: { cohorts: Cohort[]; worlds: SandboxWorld[] }) {
  const names: Record<string, string> = playerNames(cohorts);
  for (const w of worlds) for (const p of w.input.providerSnapshot || []) { const id = playerKey(w, p.id); names[id] ||= versionedName(id, p.name); }

  /* Markets */
  const obs = cellObservations(cohorts).filter(o => isLiveModel(o.providerId));
  const tracked = obs.filter(o => o.excess != null);
  const marketPlayers = [...new Set(tracked.map(o => o.provider))];
  const fit = investorElo(obs, marketPlayers);
  const grids = Object.fromEntries(marketPlayers.map(id => {
    const g = modelGrid(obs, id, "excess");
    return [id, Object.fromEntries(RISKS.map(r => [r, Object.fromEntries(HORIZONS.map(h => [h, { value: round(g[r][h].value), n: g[r][h].n, matured: g[r][h].matured }]))]))];
  })) as Record<string, Record<Risk, Record<Horizon, { value: number | null; n: number; matured: number }>>>;
  const books = cohorts.filter(c => isMatrix(c.input.protocol)).map(c => {
    const own = tracked.filter(o => o.cohortId === c.id);
    return { id: c.id.slice(0, 8), created: c.created_at, models: [...new Set(own.map(o => o.provider))], trackedCells: own.length, maturedCells: own.filter(o => o.matured).length, asOf: own.map(o => o.asOf).filter((d): d is string => Boolean(d)).sort().at(-1) || null };
  }).filter(b => b.trackedCells > 0);
  const markets = {
    provisional: fit.provisional,
    trackedCells: tracked.length,
    maturedCells: tracked.filter(o => o.matured).length,
    through: tracked.map(o => o.asOf).filter((d): d is string => Boolean(d)).sort().at(-1) || null,
    leaderboard: fit.rows.map(r => ({ id: r.id, elo: r.elo, ci: r.ci, cells: r.cells, maturedCells: r.maturedCells, beatsSpy: round(r.beatsSpy), avgExcess: round(r.avgExcess), anchor: r.id === SPY_ID })),
    grids,
    books,
    patterns: buildPatterns(obs, marketPlayers),
    early: earlyRead(obs, marketPlayers).map(e => ({ id: e.id, weeks: e.weeks, battingAverage: round(e.battingAverage), infoRatio: round(e.infoRatio, 2), drawdownChecks: e.drawdownChecks, drawdownKept: e.drawdownKept, confidence: e.confidence })),
  };

  /* Sandbox */
  const finished = worlds.filter(w => w.status === "complete").sort((a, b) => b.created_at.localeCompare(a.created_at));
  const learning = learningBoard(worlds);
  const sandboxRows = sandboxElo(worlds);
  const worldRows = finished.slice(0, 12).map(w => {
    const limit = w.input.attempts || 8;
    const players = Object.entries(w.result.players || {}).map(([provider, p]) => ({
      id: playerKey(w, provider), name: versionedName(playerKey(w, provider), w.input.providerSnapshot.find(x => x.id === provider)?.name || provider),
      final: round(p.final?.score ?? null, 2), goals: p.final?.goals ?? null,
      bestPractice: p.attempts.length ? round(Math.max(...p.attempts.map(a => a.score)), 2) : null,
      learning: round(learningScore(p.attempts, limit), 2), curve: p.attempts.map(a => round(a.score, 2)),
    })).sort((a, b) => (b.final ?? -999) - (a.final ?? -999));
    const baselines = Object.entries(w.result.baselines || {}).filter(([id]) => id !== "idle").map(([id, b]) => ({ id, name: b.name, final: round(b.final.score, 2) }));
    return { id: w.id.slice(0, 8), created: w.created_at, seed: w.input.seed, attempts: limit, rated: !unrated(w), players, baselines };
  });
  const latest = finished.find(w => !unrated(w));
  const course = latest ? {
    world: latest.id.slice(0, 8), arena: latest.input.arena,
    start: latest.input.practice.start, goal: latest.input.practice.goal,
    checkpoints: latest.input.practice.checkpoints || [], obstacles: latest.input.practice.obstacles.map(o => ({ x: round(o.x, 1), y: round(o.y, 1), r: round(o.r, 2) })),
    paths: Object.entries(latest.result.players || {}).map(([provider, p]) => {
      const best = [...p.attempts].filter(a => a.path?.length).sort((a, b) => b.score - a.score)[0];
      return { id: playerKey(latest, provider), attempt: best?.attempt ?? null, score: round(best?.score ?? null, 2), path: downsample(best?.path) };
    }).filter(p => p.path.length),
  } : null;
  const sandbox = {
    ratedWorlds: finished.filter(w => !unrated(w)).length,
    leaderboard: sandboxRows.map(r => ({ id: r.id, name: r.name, elo: r.elo, ci: r.ci, worlds: r.worlds, baseline: r.baseline, anchor: r.id === "reference", learning: round(learning[r.id] ?? null, 2) })),
    worlds: worldRows,
    course,
  };

  const ids = [...new Set([...marketPlayers, ...sandboxRows.filter(r => !r.baseline).map(r => r.id)])];
  const models: ReleaseModel[] = ids.map(id => ({ id, name: names[id] || id, provider: PROVIDER_LABEL[id.split(":")[0]] || id.split(":")[0], model: id.split(":")[1] || id, slug: slugOf(id) }));

  return { version: RELEASE_VERSION, methodVersion: METHOD_VERSION, builtAt: new Date().toISOString(), models, arenas: { markets, sandbox } };
}

export function releaseSummary(doc: ReleaseDocument) {
  return {
    models: doc.models.length,
    books: doc.arenas.markets.books.length,
    cells: doc.arenas.markets.trackedCells,
    matured: doc.arenas.markets.maturedCells,
    worlds: doc.arenas.sandbox.ratedWorlds,
  };
}
