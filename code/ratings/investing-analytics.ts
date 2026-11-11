import type { Cohort, Horizon, MarketAsset, Risk, Score, Strategy, SnapshotDocument } from "./investing-types";
import { versionKey, versionedName } from "./model-versions";

/* ------------------------------------------------------------------ */
/* Shared constants                                                    */
/* ------------------------------------------------------------------ */

// Muse Spark (Meta) is retired. Archived books stay in the database, but the
// desk, scorecard and insights only show models that are still in the lab.
export const RETIRED_MODELS = new Set(["meta"]);
export const isLiveModel = (id: string) => !RETIRED_MODELS.has(id);

export const HORIZONS: Horizon[] = [1, 3, 9, 12, 24];
export const RISKS: Risk[] = ["low", "medium", "high"];
export const RISK_SHORT: Record<Risk, string> = { low: "Low", medium: "Medium", high: "High" };

// Players are "provider:model", so GPT-5.6 Luna and GPT-6 Luna stay separate
// investors. Each known model keeps one fixed color wherever it appears.
const MODEL_COLORS: Record<string, string> = {
  "gpt-5.6-luna": "#19536a",
  "gpt-6-luna": "#2a78d6",
  "deepseek-flash": "#d4692c",
  "mimo-v2.6-pro": "#1a9a6c",
  "mimo-v2.6-flash": "#1a9a6c",
  "claude-haiku-5-5": "#c0467a",
  "muse-ember-1.0": "#6b7f1f",
};
const PROVIDER_COLORS: Record<string, string> = { openai: "#2a78d6", deepseek: "#d4692c", mimo: "#1a9a6c", anthropic: "#c0467a", ember: "#6b7f1f" };
const SPARE_COLORS = ["#8a5cc8", "#c0467a", "#6b7f1f", "#19536a"];
export const SPY_COLOR = "#8e9aa6";
export function modelColor(id: string, order: string[] = []) {
  const [provider, model] = id.includes(":") ? id.split(":") : [id, ""];
  if (model && MODEL_COLORS[model]) return MODEL_COLORS[model];
  const siblings = order.filter(x => x.split(":")[0] === provider && !MODEL_COLORS[x.split(":")[1] || ""]);
  if (PROVIDER_COLORS[provider] && siblings.indexOf(id) <= 0) return PROVIDER_COLORS[provider];
  const spare = order.filter(x => !MODEL_COLORS[x.split(":")[1] || ""]);
  return SPARE_COLORS[Math.max(0, spare.indexOf(id)) % SPARE_COLORS.length];
}
export function playerId(cohort: Cohort, provider: string) {
  const model = cohort.input.providerSnapshot?.find(p => p.id === provider)?.model || cohort.portfolios.find(p => p.provider === provider)?.document.model || "";
  return model ? versionKey(provider, model, cohort.created_at) : provider;
}
export function playerNames(cohorts: Cohort[]) {
  const names: Record<string, string> = {};
  for (const c of cohorts) for (const p of c.input.providerSnapshot || []) { const id = playerId(c, p.id); names[id] ||= versionedName(id, p.name); }
  return names;
}

export function observationDays(cohort?: Cohort | null) {
  if (!cohort) return [];
  if (cohort.snapshots?.length) return cohort.snapshots;
  return cohort.snapshot ? [{ day: cohort.snapshot.checkedAt?.slice(0, 10) || "latest", document: cohort.snapshot }] : [];
}
export function latestDocument(cohort: Cohort): SnapshotDocument | null {
  return observationDays(cohort).at(-1)?.document || cohort.snapshot || null;
}
// Every book from investing-v5 on is a horizon × risk matrix. Match by
// version number so a new protocol (v8 added the 1-month horizon) is never
// mistaken for the old single-portfolio format again.
export const isMatrix = (protocol?: string) => { const v = /^investing-v(\d+)$/.exec(protocol || ""); return Boolean(v && Number(v[1]) >= 5); };

/* ------------------------------------------------------------------ */
/* One observation per model × book × horizon × risk                   */
/* ------------------------------------------------------------------ */

export type CellObservation = {
  cohortId: string;
  created: string;
  provider: string; // player id: "provider:model"
  providerId: string;
  horizon: Horizon;
  risk: Risk;
  strategy: Strategy;
  score?: Score;
  tracked: boolean;
  matured: boolean;
  asOf?: string;
  ret?: number;
  spyRet?: number;
  excess?: number;
  maxDrawdown?: number;
  expectedMaxDrawdown: number;
  expectedReturn?: number;
  absError?: number | null;
  directionCorrect?: boolean | null;
  elapsed: number; // share of the horizon already observed, 0–1
};

const DAY = 86_400_000;
function daysBetween(a: string, b: string) { return (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY; }

export function cellObservations(cohorts: Cohort[]): CellObservation[] {
  const out: CellObservation[] = [];
  for (const cohort of cohorts) {
    if (!isMatrix(cohort.input.protocol)) continue;
    const doc = latestDocument(cohort);
    for (const entry of cohort.portfolios) {
      if (!isLiveModel(entry.provider) || !entry.document.strategies?.length) continue;
      for (const strategy of entry.document.strategies) {
        const score = doc?.portfolios.find(p => p.provider === entry.provider && p.horizonMonths === strategy.horizonMonths && p.riskLevel === strategy.riskLevel);
        const tracked = Boolean(score && score.status === "tracked" && score.return != null);
        const forecast = score?.forecasts?.find(f => f.months === strategy.horizonMonths) || strategy.pick.forecasts.find(f => f.months === strategy.horizonMonths);
        const matured = Boolean(forecast?.actualReturn != null);
        let ret = score?.return, spyRet = score?.benchmarkReturn, asOf = score?.asOf;
        // At maturity the benchmark result is frozen at the due date, not the latest close.
        if (matured && forecast?.observedDate && score?.series) {
          const point = score.series.find(p => p.date === forecast.observedDate);
          if (point) { ret = point.return; spyRet = point.benchmarkReturn; asOf = point.date; }
        }
        if (spyRet == null && ret != null && score?.excessReturn != null) spyRet = ret - score.excessReturn;
        const baseline = score?.baseline || score?.series?.[0]?.date;
        const horizonDays = strategy.horizonMonths * 30.44;
        const elapsed = baseline && asOf ? Math.max(0, Math.min(1, daysBetween(baseline, asOf) / horizonDays)) : 0;
        out.push({
          cohortId: cohort.id, created: cohort.created_at, provider: playerId(cohort, entry.provider), providerId: entry.provider,
          horizon: strategy.horizonMonths, risk: strategy.riskLevel, strategy, score, tracked, matured, asOf,
          ret: tracked ? ret : undefined, spyRet: tracked ? spyRet : undefined,
          excess: tracked && ret != null && spyRet != null ? ret - spyRet : undefined,
          maxDrawdown: tracked ? score?.maxDrawdown : undefined,
          expectedMaxDrawdown: strategy.expectedMaxDrawdown,
          expectedReturn: forecast?.expectedReturn,
          absError: forecast?.absoluteError ?? null,
          directionCorrect: forecast?.directionCorrect ?? null,
          elapsed,
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Bradley–Terry fit shared by the investor and sandbox Elo             */
/* ------------------------------------------------------------------ */

// Maximum a-posteriori Elo for weighted pairwise results (s = 1 win, 0.5 draw,
// 0 loss) with a weak prior toward 1500. Players not in `free` stay at 1500
// (the anchor). Each pass moves every free player by a Newton step (gradient
// over curvature), so the result is the same however many passes it takes.
// A fixed learning rate used to overshoot and oscillate, which left the
// ratings depending on where an arbitrary last step happened to land.
export function fitBradleyTerry(ids: string[], free: string[], matches: { a: string; b: string; s: number; w?: number }[]) {
  const r: Record<string, number> = Object.fromEntries(ids.map(id => [id, 1500]));
  const k = Math.LN10 / 400, prior = 1 / (200 * 200);
  for (let pass = 0; pass < 500; pass++) {
    let moved = 0;
    for (const id of free) {
      let grad = -prior * (r[id] - 1500), curv = prior;
      for (const m of matches) {
        if (m.a !== id && m.b !== id) continue;
        const w = m.w ?? 1, p = 1 / (1 + Math.pow(10, (r[m.b] - r[m.a]) / 400));
        grad += (m.a === id ? 1 : -1) * w * k * (m.s - p);
        curv += w * k * k * p * (1 - p);
      }
      const step = Math.max(-200, Math.min(200, grad / curv));
      r[id] += step;
      moved = Math.max(moved, Math.abs(step));
    }
    if (moved < 0.01) break;
  }
  return r;
}

/* ------------------------------------------------------------------ */
/* Investor Elo: every cell is a match                                 */
/* ------------------------------------------------------------------ */

export const SPY_ID = "spy";
export const DRAW_BAND = 0.005; // 0.5 percentage points
export type EloRow = { id: string; elo: number; ci: number; matches: number; weight: number; cells: number; maturedCells: number; beatsSpy: number | null; avgExcess: number | null; anchor?: boolean };
export type EloFit = { rows: EloRow[]; matches: number; provisional: boolean; cells: number };

type Match = { a: string; b: string; score: number; w: number };

export function investorElo(obs: CellObservation[], players: string[]): EloFit {
  const cells = new Map<string, CellObservation[]>();
  for (const o of obs) {
    if (o.excess == null || !players.includes(o.provider)) continue;
    const key = `${o.cohortId}|${o.horizon}|${o.risk}`;
    cells.set(key, [...(cells.get(key) || []), o]);
  }
  const matches: Match[] = [];
  // The 12 cells of one book share a start date and a market, so they are not
  // 12 independent games. Each book is worth about three matches per pair,
  // and a matured cell counts twice as much as a provisional one.
  const cellsPerBook = new Map<string, number>();
  for (const key of cells.keys()) { const book = key.split("|")[0]; cellsPerBook.set(book, (cellsPerBook.get(book) || 0) + 1); }
  for (const [key, entries] of cells) {
    const w = (entries.every(e => e.matured) ? 2 : 1) * 3 / (cellsPerBook.get(key.split("|")[0]) || 1);
    const field = [...entries.map(e => ({ id: e.provider, v: e.excess! })), { id: SPY_ID, v: 0 }];
    for (let i = 0; i < field.length; i++) for (let j = i + 1; j < field.length; j++) {
      const d = field[i].v - field[j].v;
      matches.push({ a: field[i].id, b: field[j].id, score: Math.abs(d) <= DRAW_BAND ? 0.5 : d > 0 ? 1 : 0, w });
    }
  }
  const ids = [...players, SPY_ID];
  const r: Record<string, number> = Object.fromEntries(ids.map(id => [id, 1500]));
  const k = Math.LN10 / 400, prior = 1 / (200 * 200);
  // Weighted Bradley–Terry with a weak prior toward 1500; SPY is pinned at 1500.
  Object.assign(r, fitBradleyTerry(ids, players, matches.map(m => ({ a: m.a, b: m.b, s: m.score, w: m.w }))));
  const rows: EloRow[] = ids.map(id => {
    const mine = matches.filter(m => m.a === id || m.b === id);
    let info = prior;
    for (const m of mine) { const p = 1 / (1 + Math.pow(10, (r[m.b] - r[m.a]) / 400)); info += m.w * k * k * p * (1 - p); }
    const own = obs.filter(o => o.provider === id && o.excess != null);
    const vsSpy = own.length ? own.filter(o => o.excess! > DRAW_BAND).length / own.length : null;
    return {
      id, elo: Math.round(r[id]), ci: id === SPY_ID ? 0 : Math.round(1.96 / Math.sqrt(info)), matches: mine.length,
      weight: mine.reduce((s, m) => s + m.w, 0), cells: own.length, maturedCells: own.filter(o => o.matured).length,
      beatsSpy: id === SPY_ID ? null : vsSpy, avgExcess: own.length ? mean(own.map(o => o.excess!)) : null, anchor: id === SPY_ID,
    };
  }).sort((a, b) => b.elo - a.elo);
  const tracked = obs.filter(o => o.excess != null);
  return { rows, matches: matches.length, cells: cells.size, provisional: !tracked.some(o => o.matured) };
}

/* ------------------------------------------------------------------ */
/* Return vs SPY: one number for "is it making money?"                  */
/* ------------------------------------------------------------------ */

// The average return of every portfolio a model has built, against SPY's
// return over exactly the same dates (a matured portfolio at its due date, a
// live one at the latest close). Equal weight per portfolio, so the edge is
// the same "Avg vs SPY" the Elo table shows.
export type ReturnRow = { id: string; portfolios: number; matured: number; ret: number; spyRet: number; edge: number; beats: number };
function returnsOf(id: string, own: CellObservation[]): ReturnRow {
  const n = own.length || 1;
  const ret = own.reduce((s, o) => s + o.ret!, 0) / n, spyRet = own.reduce((s, o) => s + o.spyRet!, 0) / n;
  return { id, portfolios: own.length, matured: own.filter(o => o.matured).length, ret, spyRet, edge: ret - spyRet, beats: own.filter(o => o.ret! > o.spyRet!).length };
}
export function returnVsSpy(obs: CellObservation[], players: string[]) {
  const priced = obs.filter(o => o.tracked && o.ret != null && o.spyRet != null && players.includes(o.provider));
  const rows = players.map(id => returnsOf(id, priced.filter(o => o.provider === id))).filter(r => r.portfolios).sort((a, b) => b.edge - a.edge);
  return { all: returnsOf("all", priced), rows };
}

/* ------------------------------------------------------------------ */
/* Per-cell aggregates for the 4×3 grid                                */
/* ------------------------------------------------------------------ */

export type GridMetric = "excess" | "return" | "drawdown" | "error";
export const GRID_METRICS: Record<GridMetric, { label: string; note: string; higherIsBetter: boolean; span: number; center: number; lo: string; hi: string }> = {
  excess: { label: "vs SPY", note: "average excess return over SPY", higherIsBetter: true, span: 0.06, center: 0, lo: "behind SPY", hi: "ahead of SPY" },
  return: { label: "Return", note: "average return since baseline", higherIsBetter: true, span: 0.08, center: 0, lo: "losing", hi: "gaining" },
  drawdown: { label: "Drawdown vs promise", note: "predicted max drawdown minus observed drawdown", higherIsBetter: true, span: 0.08, center: 0, lo: "deeper than promised", hi: "within promise" },
  error: { label: "Forecast error", note: "absolute error at maturity, matured books only", higherIsBetter: false, span: 0.1, center: 0, lo: "large error", hi: "accurate" },
};
export type GridCell = { value: number | null; n: number; matured: number };

export function cellValue(o: CellObservation, metric: GridMetric): number | null {
  if (metric === "excess") return o.excess ?? null;
  if (metric === "return") return o.ret ?? null;
  if (metric === "drawdown") return o.maxDrawdown == null ? null : o.expectedMaxDrawdown + o.maxDrawdown; // maxDrawdown is ≤ 0
  return o.matured && o.absError != null ? o.absError : null;
}
export function modelGrid(obs: CellObservation[], provider: string, metric: GridMetric): Record<Risk, Record<Horizon, GridCell>> {
  const grid = {} as Record<Risk, Record<Horizon, GridCell>>;
  for (const risk of RISKS) {
    grid[risk] = {} as Record<Horizon, GridCell>;
    for (const horizon of HORIZONS) {
      const own = obs.filter(o => o.provider === provider && o.risk === risk && o.horizon === horizon);
      const vals = own.map(o => cellValue(o, metric)).filter((v): v is number => v != null);
      grid[risk][horizon] = { value: vals.length ? mean(vals) : null, n: vals.length, matured: own.filter(o => o.matured).length };
    }
  }
  return grid;
}
export function cellWinners(grids: Record<string, Record<Risk, Record<Horizon, GridCell>>>, metric: GridMetric) {
  const better = GRID_METRICS[metric].higherIsBetter;
  const out = {} as Record<Risk, Record<Horizon, { id: string | null; ranked: { id: string; value: number }[] }>>;
  for (const risk of RISKS) {
    out[risk] = {} as Record<Horizon, { id: string | null; ranked: { id: string; value: number }[] }>;
    for (const horizon of HORIZONS) {
      const ranked = Object.entries(grids).map(([id, g]) => ({ id, value: g[risk][horizon].value })).filter((x): x is { id: string; value: number } => x.value != null).sort((a, b) => better ? b.value - a.value : a.value - b.value);
      out[risk][horizon] = { id: ranked[0]?.id ?? null, ranked };
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

const ETF_GROUPS: Record<string, string[]> = {
  "Broad equity ETF": ["IWM", "QQQ", "SPY", "VTV", "VUG", "SCHD", "VOO", "VTI", "DIA", "EFA", "EEM", "VWO"],
  "Sector ETF": ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLRE", "XLB", "XLC", "VNQ"],
  "Bonds": ["TLT", "SHY", "LQD", "HYG", "AGG", "IEF", "BND"],
  "Commodities": ["GLD", "SLV", "USO", "DBC"],
};
const SECTORS: Record<string, string[]> = {
  "Technology": ["AAPL", "MSFT", "NVDA", "CSCO", "IBM", "INTC", "QCOM", "TSM", "AVGO", "ORCL", "CRM", "ADBE", "AMD", "TXN", "AMAT", "INTU", "NOW", "PANW", "CRWD", "MU", "LRCX", "KLAC", "ADI", "SNPS", "CDNS", "APH", "ANET", "PLTR", "APP", "DDOG", "WDAY", "SMCI", "DELL", "FTNT", "NXPI", "MSI", "ADSK", "SHOP", "SNOW", "NET", "TEAM", "ZS", "OKTA", "HUBS", "ROP"],
  "Communication": ["GOOGL", "GOOG", "META", "NFLX", "DIS", "T", "VZ", "TMUS", "CMCSA", "CHTR", "SPOT", "RBLX", "TTWO", "WBD", "LYV", "OMC", "FOXA"],
  "Consumer discretionary": ["AMZN", "HD", "LOW", "NKE", "MCD", "SBUX", "TSLA", "DASH", "UBER", "ABNB", "TJX", "TGT", "BKNG", "CMG", "MAR", "HLT", "GM", "F", "RCL", "ORLY", "AZO", "ROST", "YUM", "MELI", "PDD", "SE"],
  "Consumer staples": ["PG", "KO", "PEP", "WMT", "COST", "PM", "MO", "MDLZ", "CL", "KMB", "GIS", "MNST"],
  "Financials": ["BRK-B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "C", "AXP", "BLK", "BX", "SCHW", "PYPL", "COF", "PGR", "SPGI", "MCO", "ICE", "CME", "MSCI", "COIN", "HOOD", "XYZ", "AIG", "AFL", "ALL", "MET", "PRU", "PNC", "USB", "TFC", "BNY", "AON", "AJG", "AMP", "NDAQ", "FITB", "TROW", "RJF"],
  "Health care": ["JNJ", "UNH", "LLY", "ABBV", "MRK", "PFE", "ABT", "TMO", "DHR", "AMGN", "GILD", "ISRG", "SYK", "BSX", "MDT", "BMY", "VRTX", "REGN", "ELV", "CI", "CVS", "HCA", "MCK", "COR", "HUM", "CNC", "BDX", "EW", "IDXX", "DXCM", "ZTS", "GEHC", "BIIB", "MRNA", "ALGN", "IQV", "A", "RMD", "CAH"],
  "Industrials": ["CAT", "DE", "GE", "HON", "RTX", "LMT", "BA", "GD", "NOC", "UNP", "UPS", "ADP", "ETN", "EMR", "ITW", "WM", "RSG", "FDX", "NSC", "CSX", "GEV", "PH", "CARR", "OTIS", "TT", "IR", "PCAR", "URI", "FAST", "CTAS", "PAYX", "VRSK", "CPRT", "ODFL", "TDG", "AXON", "HWM", "LHX", "TDY", "JCI"],
  "Energy": ["XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PSX", "VLO", "WMB", "KMI"],
  "Utilities": ["NEE", "DUK", "SO", "D", "AEP", "SRE", "CEG"],
  "Materials": ["LIN", "SHW", "APD", "NEM", "FCX"],
  "Real estate": ["AMT", "PLD", "CCI", "EQIX", "SPG", "O", "WELL", "DLR", "PSA"],
};
const GROUP_OF = new Map<string, string>();
for (const [g, list] of Object.entries({ ...SECTORS, ...ETF_GROUPS })) for (const s of list) GROUP_OF.set(s, g);
export function groupOf(symbol: string) {
  if (symbol.endsWith(".CC")) return "Crypto";
  return GROUP_OF.get(symbol.replace(/\.US$/, "")) || "Other";
}
export function assetClassOf(symbol: string) {
  if (symbol.endsWith(".CC")) return "Crypto";
  const g = groupOf(symbol);
  return ETF_GROUPS[g] ? "ETF" : "Stock";
}

export const THEMES: { id: string; label: string; re: RegExp }[] = [
  { id: "rates", label: "Rates & inflation", re: /\b(rates?|inflation|yields?|fed|monetary|disinflation|central bank|term premium)\b/ },
  { id: "ai", label: "AI & compute capex", re: /\b(ai|artificial intelligence|capex|semiconductors?|chips?|data cent(er|re)s?|compute|hyperscal\w*)\b/ },
  { id: "growth", label: "Growth & recession", re: /\b(recession|slowdown|soft landing|growth|labou?r|consumer spending|unemployment|earnings cycle)\b/ },
  { id: "energy", label: "Energy & commodities", re: /\b(energy|oil|commodit\w*|natural gas|power|electricity|grid|uranium|copper)\b/ },
  { id: "policy", label: "Fiscal & policy", re: /\b(fiscal|deficits?|tariffs?|polic\w*|industrial|reshoring|government|regulat\w*|election)\b/ },
  { id: "geo", label: "Geopolitics & defense", re: /\b(geopolit\w*|wars?|china|conflict|defen[cs]e|security|sanctions?)\b/ },
  { id: "dollar", label: "Dollar & hard assets", re: /\b(dollar|currenc\w*|gold|debasement|hard assets?|precious)\b/ },
  { id: "crypto", label: "Crypto & digital assets", re: /\b(crypto\w*|bitcoin|digital assets?|stablecoins?|blockchain|ethereum)\b/ },
  { id: "valuation", label: "Valuation & concentration", re: /\b(valuations?|concentrat\w*|expensive|breadth|bubble|multiples?|market structure|mega-?cap)\b/ },
  { id: "health", label: "Demographics & health", re: /\b(demograph\w*|aging|ageing|health\w*|obesity|glp-?1)\b/ },
];

export type HoldingRow = {
  cohortId: string; provider: string; horizon: Horizon; risk: Risk;
  symbol: string; name: string; weight: number; ret: number | null; contribution: number | null;
  group: string; assetClass: string; theses: string[];
  range52w: number | null; return12m: number | null;
};

export function holdingRows(cohorts: Cohort[], obs: CellObservation[]): HoldingRow[] {
  const packets = new Map(cohorts.map(c => [c.id, new Map((c.input.marketSnapshot?.assets || []).map(a => [a.symbol, a] as [string, MarketAsset]))]));
  return obs.flatMap(o => o.strategy.pick.positions.map(h => {
    const asset = packets.get(o.cohortId)?.get(h.symbol);
    const ret = o.tracked ? o.score?.holdings?.find(x => x.symbol === h.symbol)?.return ?? null : null;
    const span = asset ? asset.high52w - asset.low52w : 0;
    return {
      cohortId: o.cohortId, provider: o.provider, horizon: o.horizon, risk: o.risk,
      symbol: h.symbol, name: h.name, weight: h.weight, ret, contribution: ret == null ? null : ret * h.weight,
      group: groupOf(h.symbol), assetClass: assetClassOf(h.symbol),
      theses: (h.appliesThesisIds || []).map(id => o.strategy.pick.theses?.find(t => t.id === id)?.title || id),
      range52w: asset && span > 0 ? Math.max(0, Math.min(1, (asset.price - asset.low52w) / span)) : null,
      return12m: asset?.return12m ?? null,
    };
  }));
}

export function universeStats(cohorts: Cohort[]) {
  const assets = cohorts.flatMap(c => c.input.marketSnapshot?.assets || []);
  const latest = new Map<string, MarketAsset>();
  for (const a of assets) latest.set(a.symbol, a);
  const list = [...latest.values()];
  const ranges = list.map(a => a.high52w - a.low52w > 0 ? (a.price - a.low52w) / (a.high52w - a.low52w) : null).filter((v): v is number => v != null);
  const r12 = list.map(a => a.return12m).filter((v): v is number => v != null);
  return { range52w: ranges.length ? mean(ranges) : null, return12m: r12.length ? mean(r12) : null, count: list.length };
}

export function themeCounts(obs: CellObservation[], provider: string) {
  const counts = Object.fromEntries(THEMES.map(t => [t.id, 0])) as Record<string, number>;
  let total = 0;
  for (const o of obs.filter(x => x.provider === provider)) {
    for (const thesis of o.strategy.pick.theses || []) {
      total++;
      // The title names the thesis; the long world-view text mentions many
      // themes in passing, so it is only used when the title matches none.
      const title = thesis.title.toLowerCase();
      let hits = THEMES.filter(t => t.re.test(title));
      if (!hits.length) hits = THEMES.filter(t => t.re.test(thesis.worldView.toLowerCase()));
      for (const t of hits) counts[t.id]++;
    }
  }
  return { counts, total };
}

export function mean(values: number[]) { return values.reduce((s, v) => s + v, 0) / values.length; }
export function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const signed = (v: number, digits: number) => { const x = Number((v * 100).toFixed(digits)); return `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`; };
export const pct = (v: number | null | undefined, digits = 1) => v == null || !Number.isFinite(v) ? "—" : `${signed(v, digits)}%`;
export const pp = (v: number | null | undefined, digits = 1) => v == null || !Number.isFinite(v) ? "—" : `${signed(v, digits)} pp`;
export const share = (v: number | null | undefined, digits = 0) => v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

/* ------------------------------------------------------------------ */
/* Early read: signals that settle in weeks, not at maturity           */
/* ------------------------------------------------------------------ */

export type Confidence = "early" | "building" | "reliable";
export type EarlyRow = {
  id: string;
  weeks: number; // longest weekly history behind this model
  weeklyObs: number;
  battingAverage: number | null; // share of portfolio-weeks ahead of SPY
  infoRatio: number | null; // annualised mean weekly excess / its volatility
  volByRisk: Record<Risk, number | null>; // annualised realised volatility
  spyVol: number | null;
  drawdownChecks: number;
  drawdownKept: number; // portfolios whose drawdown so far is within the promised maximum
  ladderChecks: number;
  ladderKept: number; // books where low ≤ medium ≤ high volatility (10% tolerance)
  confidence: Confidence;
};

function isoWeekKey(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return `${d.getUTCFullYear()}-${Math.ceil(((d.getTime() - start) / 86400000 + 1) / 7)}`;
}
function sd(values: number[]) {
  if (values.length < 2) return null;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

type Weekly = { excess: number[]; weeks: number };
function weeklyExcess(o: CellObservation): Weekly {
  const series = o.score?.series || [];
  const byWeek = new Map<string, { idx: number; spy: number }>();
  for (const p of series) if (p.benchmarkReturn != null) byWeek.set(isoWeekKey(p.date), { idx: p.index / 100, spy: 1 + p.benchmarkReturn });
  const points = [{ idx: 1, spy: 1 }, ...byWeek.values()];
  const excess: number[] = [];
  for (let i = 1; i < points.length; i++) excess.push((points[i].idx / points[i - 1].idx - 1) - (points[i].spy / points[i - 1].spy - 1));
  return { excess, weeks: excess.length };
}
function dailyVols(o: CellObservation) {
  const series = o.score?.series || [];
  if (series.length < 8) return null;
  const port: number[] = [], spy: number[] = [];
  for (let i = 1; i < series.length; i++) {
    port.push(series[i].index / series[i - 1].index - 1);
    if (series[i].benchmarkReturn != null && series[i - 1].benchmarkReturn != null) spy.push((1 + series[i].benchmarkReturn!) / (1 + series[i - 1].benchmarkReturn!) - 1);
  }
  const p = sd(port), s = sd(spy);
  return { port: p == null ? null : p * Math.sqrt(252), spy: s == null ? null : s * Math.sqrt(252) };
}

export function earlyRead(obs: CellObservation[], players: string[]): EarlyRow[] {
  return players.map(id => {
    const own = obs.filter(o => o.provider === id && o.tracked);
    const weekly = own.map(weeklyExcess);
    const allExcess = weekly.flatMap(w => w.excess);
    const weeks = Math.max(0, ...weekly.map(w => w.weeks));
    const vols = new Map(own.map(o => [o, dailyVols(o)]));
    const volByRisk = Object.fromEntries(RISKS.map(r => {
      const v = own.filter(o => o.risk === r).map(o => vols.get(o)?.port).filter((x): x is number => x != null);
      return [r, v.length ? mean(v) : null];
    })) as Record<Risk, number | null>;
    const spyVols = own.map(o => vols.get(o)?.spy).filter((x): x is number => x != null);
    const dd = own.filter(o => o.maxDrawdown != null);
    let ladderChecks = 0, ladderKept = 0;
    const groups = new Map<string, Partial<Record<Risk, number>>>();
    for (const o of own) { const v = vols.get(o)?.port; if (v == null) continue; const k = `${o.cohortId}|${o.horizon}`; groups.set(k, { ...(groups.get(k) || {}), [o.risk]: v }); }
    for (const g of groups.values()) {
      if (g.low == null || g.medium == null || g.high == null) continue;
      ladderChecks++;
      if (g.low <= g.medium * 1.1 && g.medium <= g.high * 1.1) ladderKept++;
    }
    const excessSd = sd(allExcess);
    const confidence: Confidence = weeks >= 13 ? "reliable" : weeks >= 4 ? "building" : "early";
    return {
      id, weeks, weeklyObs: allExcess.length,
      battingAverage: allExcess.length ? allExcess.filter(e => e > 0).length / allExcess.length : null,
      // Needs at least 4 weeks; with fewer the ratio swings wildly.
      infoRatio: weeks >= 4 && excessSd ? mean(allExcess) / excessSd * Math.sqrt(52) : null,
      volByRisk, spyVol: spyVols.length ? mean(spyVols) : null,
      drawdownChecks: dd.length,
      drawdownKept: dd.filter(o => -o.maxDrawdown! <= o.expectedMaxDrawdown + 1e-9).length,
      ladderChecks, ladderKept, confidence,
    };
  });
}
