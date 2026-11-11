// Behaviour patterns for the public Markets page: how each model does at each
// risk level, what its portfolios hold, and which kinds of holdings have
// helped or hurt. Built from the same tracked cells as the Markets Elo.
// Only symbols and weights leave the lab, never the models' reasoning.
import type { CellObservation } from "./investing-analytics";
import type { Risk } from "./investing-types";

export const GROUPS = ["cash", "bonds", "gold", "defensive", "index", "energy", "tech", "crypto", "other"] as const;
export type Group = (typeof GROUPS)[number];

// Plain-language groups for the instruments models actually pick. Anything
// not listed (financials, industrials, consumer, real estate, unknown) counts
// as "other"; crypto pairs are recognised by their suffix.
const GROUP_MEMBERS: Record<Exclude<Group, "cash" | "crypto" | "other">, string> = {
  bonds: "SHY AGG TLT IEF BND LQD TIP BIL SGOV VGSH VGIT HYG MUB GOVT SCHO SCHR",
  gold: "GLD SLV DBC NEM FCX IAU GDX PPLT CPER",
  defensive: "XLV XLP XLU JNJ KO PEP PG MCD ABT UNH MRK ABBV PFE GIS CVS GILD MDT BSX ISRG TMO SYK LLY BMY MO KMB CL ELV VRTX REGN ZTS WMT COST VZ T TMUS NEE SO DUK AMGN",
  index: "VTV SCHD SPY EFA VTI VOO VWO IWM QQQ EEM DIA VEA VIG VYM IVV RSP MTUM QUAL USMV",
  energy: "XLE XOM CVX VLO SLB MPC COP PSX KMI WMB USO OXY EOG CEG VST OKE",
  tech: "ADBE ORCL INTU AMAT LRCX TSM KLAC GOOGL GOOG MSFT AVGO MU QCOM NFLX CRM PYPL AMD NXPI CHTR ADSK NVDA NOW ZS MELI PDD COIN META HUBS SE UBER SMCI DELL SPOT CSCO ANET TXN APP AAPL AMZN PANW SHOP SNOW WDAY IBM NET ADI XLK SMH SOXX ASML CRWD DDOG PLTR TSLA INTC MRVL ARM ABNB",
};
const GROUP_OF = new Map<string, Group>(Object.entries(GROUP_MEMBERS).flatMap(([g, list]) => list.split(" ").map(s => [s, g as Group] as const)));

export const ticker = (symbol: string) => symbol.replace(/\.US$/, "").replace(/-USD\.CC$/, "");
export function groupOf(symbol: string): Group {
  if (symbol.endsWith(".CC")) return "crypto";
  return GROUP_OF.get(symbol.replace(/\.US$/, "")) || "other";
}

// The seven largest US tech companies, as markets commonly group them.
const MAGNIFICENT_SEVEN: [string, string[]][] = [["AAPL", ["AAPL"]], ["MSFT", ["MSFT"]], ["NVDA", ["NVDA"]], ["AMZN", ["AMZN"]], ["GOOGL", ["GOOGL", "GOOG"]], ["META", ["META"]], ["TSLA", ["TSLA"]]];

const round = (v: number, digits = 4) => Number(v.toFixed(digits));
const RISKS: Risk[] = ["low", "medium", "high"];

type Cell = { player: string; risk: Risk; excess: number; spyRet: number | null; matured: boolean; cash: number; positions: { symbol: string; weight: number; ret: number | null }[] };

function cellsOf(obs: CellObservation[]): Cell[] {
  return obs.filter(o => o.excess != null).map(o => {
    const returns = new Map((o.score?.holdings || []).map(h => [h.symbol, h.return]));
    return {
      player: o.provider, risk: o.risk, excess: o.excess!, spyRet: o.spyRet ?? null, matured: o.matured,
      cash: o.strategy.pick.cashWeight ?? 0,
      positions: (o.strategy.pick.positions || []).map(p => ({ symbol: p.symbol, weight: p.weight, ret: returns.get(p.symbol) ?? null })),
    };
  });
}

function summary(cells: Cell[]) {
  if (!cells.length) return null;
  return { n: cells.length, avgExcess: round(cells.reduce((a, c) => a + c.excess, 0) / cells.length), ahead: round(cells.filter(c => c.excess > 0).length / cells.length, 3) };
}

// Average share of capital in each group, cash included (sums to about 1).
function mix(cells: Cell[]) {
  const out = Object.fromEntries(GROUPS.map(g => [g, 0])) as Record<Group, number>;
  if (!cells.length) return out;
  for (const c of cells) { out.cash += c.cash; for (const p of c.positions) out[groupOf(p.symbol)] += p.weight; }
  for (const g of GROUPS) out[g] = round(out[g] / cells.length, 3);
  return out;
}

export function buildPatterns(obs: CellObservation[], players: string[]) {
  const cells = cellsOf(obs).filter(c => players.includes(c.player));
  const byRisk = Object.fromEntries(["all", ...players].map(id => {
    const own = id === "all" ? cells : cells.filter(c => c.player === id);
    return [id, Object.fromEntries(RISKS.map(r => [r, summary(own.filter(c => c.risk === r))]))];
  }));

  // Holding returns are the latest close, so only portfolios still running
  // say what has helped: a matured portfolio was graded at its due date.
  const running = cells.filter(c => !c.matured && c.spyRet != null);
  const groupStats = new Map<Group, { w: number; e: number }>();
  for (const c of running) for (const p of c.positions) {
    if (p.ret == null) continue;
    const g = groupOf(p.symbol), s = groupStats.get(g) || { w: 0, e: 0 };
    s.w += p.weight; s.e += p.weight * (p.ret - c.spyRet!);
    groupStats.set(g, s);
  }
  const cashDrag = running.length ? -running.reduce((a, c) => a + c.spyRet!, 0) / running.length : null;
  const groups = GROUPS.map(g => {
    if (g === "cash") return { group: g, excess: cashDrag == null ? null : round(cashDrag), weight: mix(cells).cash };
    const s = groupStats.get(g);
    return { group: g, excess: s && s.w > 0 ? round(s.e / s.w) : null, weight: mix(cells)[g] };
  }).filter(g => g.weight > 0);

  const favourites = Object.fromEntries(players.map(id => {
    const own = cells.filter(c => c.player === id);
    const stats = new Map<string, { n: number; w: number }>();
    for (const c of own) for (const p of c.positions) { const s = stats.get(p.symbol) || { n: 0, w: 0 }; s.n++; s.w += p.weight; stats.set(p.symbol, s); }
    const top = [...stats].sort((a, b) => b[1].w - a[1].w).slice(0, 8)
      .map(([symbol, s]) => ({ symbol: ticker(symbol), group: groupOf(symbol), held: round(s.n / own.length, 3), weight: round(s.w / own.length, 3) }));
    return [id, { portfolios: own.length, instruments: stats.size, avgHoldings: own.length ? round(own.reduce((a, c) => a + c.positions.length, 0) / own.length, 1) : 0, top }];
  }));

  const total = cells.length;
  const rarelyHeld = MAGNIFICENT_SEVEN.map(([label, symbols]) => ({
    symbol: label,
    held: cells.filter(c => c.positions.some(p => symbols.includes(ticker(p.symbol)))).length,
  }));

  return {
    portfolios: total,
    running: running.length,
    byRisk,
    mix: {
      byRisk: Object.fromEntries(RISKS.map(r => [r, mix(cells.filter(c => c.risk === r))])),
      byModel: Object.fromEntries(players.map(id => [id, mix(cells.filter(c => c.player === id))])),
    },
    groups,
    favourites,
    rarelyHeld,
  };
}
