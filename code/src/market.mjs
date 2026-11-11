import { pool } from './db.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { addMonths, hash } from './protocol.mjs';
import { dateKey } from './investing.mjs';
import { fetchHistory } from './tracking.mjs';

// A broad, fixed candidate universe keeps the market-aware benchmark
// reproducible. The model can choose any number of instruments from this
// packet, while every model sees exactly the same prices and history summary.
// Mix is frozen at 250 US common stocks, 35 ETFs, and 15 crypto/other names.
export const MARKET_STOCKS = [
  'AAPL.US', 'MSFT.US', 'GOOGL.US', 'AMZN.US', 'META.US', 'NVDA.US', 'BRK-B.US', 'JPM.US', 'V.US', 'MA.US',
  'JNJ.US', 'PG.US', 'KO.US', 'PEP.US', 'WMT.US', 'COST.US', 'XOM.US', 'CVX.US', 'UNH.US', 'LLY.US',
  'HD.US', 'LOW.US', 'CAT.US', 'DE.US', 'NKE.US', 'DIS.US', 'NFLX.US', 'CSCO.US', 'IBM.US', 'INTC.US',
  'QCOM.US', 'TSM.US', 'AVGO.US', 'ORCL.US', 'CRM.US', 'ADBE.US', 'MCD.US', 'SBUX.US', 'TSLA.US', 'GOOG.US',
  'AMD.US', 'TXN.US', 'AMAT.US', 'INTU.US', 'NOW.US', 'PANW.US', 'CRWD.US', 'MU.US', 'LRCX.US', 'KLAC.US',
  'ADI.US', 'SNPS.US', 'CDNS.US', 'APH.US', 'ANET.US', 'PLTR.US', 'APP.US', 'DDOG.US', 'WDAY.US', 'DASH.US',
  'UBER.US', 'ABNB.US', 'COIN.US', 'HOOD.US', 'SMCI.US', 'DELL.US', 'FTNT.US', 'NXPI.US', 'MSI.US', 'ADSK.US',
  'BAC.US', 'WFC.US', 'GS.US', 'MS.US', 'C.US', 'AXP.US', 'BLK.US', 'BX.US', 'SCHW.US', 'PYPL.US',
  'COF.US', 'PGR.US', 'SPGI.US', 'MCO.US', 'ICE.US', 'CME.US', 'MSCI.US', 'ABBV.US', 'MRK.US', 'PFE.US',
  'ABT.US', 'TMO.US', 'DHR.US', 'AMGN.US', 'GILD.US', 'ISRG.US', 'SYK.US', 'BSX.US', 'MDT.US', 'BMY.US',
  'VRTX.US', 'REGN.US', 'ELV.US', 'CI.US', 'CVS.US', 'HCA.US', 'MCK.US', 'T.US', 'VZ.US', 'TMUS.US',
  'CMCSA.US', 'CHTR.US', 'GE.US', 'HON.US', 'RTX.US', 'LMT.US', 'BA.US', 'GD.US', 'NOC.US', 'UNP.US',
  'UPS.US', 'ADP.US', 'ETN.US', 'EMR.US', 'ITW.US', 'WM.US', 'RSG.US', 'FDX.US', 'NSC.US', 'CSX.US',
  'COP.US', 'SLB.US', 'EOG.US', 'MPC.US', 'PSX.US', 'VLO.US', 'WMB.US', 'KMI.US', 'NEE.US', 'DUK.US',
  'SO.US', 'D.US', 'AEP.US', 'SRE.US', 'CEG.US', 'LIN.US', 'SHW.US', 'APD.US', 'NEM.US', 'FCX.US',
  'AMT.US', 'PLD.US', 'CCI.US', 'EQIX.US', 'SPG.US', 'O.US', 'WELL.US', 'DLR.US', 'PSA.US', 'PM.US',
  'MO.US', 'MDLZ.US', 'CL.US', 'KMB.US', 'GIS.US', 'MNST.US', 'TJX.US', 'TGT.US', 'BKNG.US', 'CMG.US',
  'MAR.US', 'HLT.US', 'GM.US', 'F.US', 'RCL.US', 'ORLY.US', 'AZO.US', 'ROST.US', 'YUM.US', 'GEV.US',
  'XYZ.US', 'SHOP.US', 'MELI.US', 'PDD.US', 'SE.US', 'SPOT.US', 'SNOW.US', 'NET.US', 'TEAM.US', 'ZS.US',
  'OKTA.US', 'HUBS.US', 'RBLX.US', 'AIG.US', 'AFL.US', 'ALL.US', 'MET.US', 'PRU.US', 'PNC.US', 'USB.US',
  'TFC.US', 'BNY.US', 'AON.US', 'AJG.US', 'AMP.US', 'NDAQ.US', 'FITB.US', 'TROW.US', 'RJF.US', 'COR.US',
  'HUM.US', 'CNC.US', 'BDX.US', 'EW.US', 'IDXX.US', 'DXCM.US', 'ZTS.US', 'GEHC.US', 'BIIB.US', 'MRNA.US',
  'ALGN.US', 'IQV.US', 'A.US', 'RMD.US', 'CAH.US', 'TTWO.US', 'WBD.US', 'LYV.US', 'OMC.US', 'FOXA.US',
  'PH.US', 'CARR.US', 'OTIS.US', 'TT.US', 'IR.US', 'PCAR.US', 'URI.US', 'FAST.US', 'CTAS.US', 'PAYX.US',
  'VRSK.US', 'CPRT.US', 'ODFL.US', 'ROP.US', 'TDG.US', 'AXON.US', 'HWM.US', 'LHX.US', 'TDY.US', 'JCI.US',
];
export const MARKET_ETFS = [
  'IWM.US', 'QQQ.US', 'SPY.US', 'VTV.US', 'VUG.US', 'SCHD.US', 'VNQ.US', 'GLD.US', 'TLT.US', 'SHY.US',
  'XLK.US', 'XLF.US', 'XLE.US', 'XLV.US', 'XLI.US', 'XLY.US', 'XLP.US', 'XLU.US', 'XLRE.US', 'XLB.US',
  'XLC.US', 'VOO.US', 'VTI.US', 'DIA.US', 'EFA.US', 'EEM.US', 'VWO.US', 'LQD.US', 'HYG.US', 'AGG.US',
  'IEF.US', 'BND.US', 'SLV.US', 'USO.US', 'DBC.US',
];
export const MARKET_OTHER = [
  'BTC-USD.CC', 'ETH-USD.CC', 'SOL-USD.CC', 'XRP-USD.CC', 'DOGE-USD.CC', 'LINK-USD.CC',
  'ADA-USD.CC', 'AVAX-USD.CC', 'DOT-USD.CC', 'LTC-USD.CC', 'BCH-USD.CC', 'ATOM-USD.CC',
  'XLM-USD.CC', 'BNB-USD.CC', 'NEAR-USD.CC',
];
export const MARKET_UNIVERSE = [...MARKET_STOCKS, ...MARKET_ETFS, ...MARKET_OTHER];

// Instruments that stopped trading because they were bought out for cash.
// From `from` onwards each is worth exactly `price`: daily uploads may leave
// it out (it is filled in) or send that price, and new books no longer offer
// it to the models. Days before `from` are unaffected.
export const SETTLED = {
  'WBD.US': { price: 31.0167, from: '2026-10-06', reason: 'Cash buyout by Paramount Skydance at $31.0167 a share, closed 6 Oct 2026' },
};
export const isSettled = (symbol, day) => Boolean(SETTLED[symbol] && day >= SETTLED[symbol].from);
export const liveUniverse = day => MARKET_UNIVERSE.filter(symbol => !isSettled(symbol, day));

// Daily closes for `date`: settled instruments are removed if sent at their
// settlement price and appended at it either way, so a 299- or 300-price
// upload produces the same stored document. A different price is an error.
export function settleDailyPrices(date, prices) {
  const kept = [], errors = [];
  for (const row of prices) {
    if (!isSettled(row.symbol, date)) { kept.push(row); continue; }
    if (Math.abs(row.close - SETTLED[row.symbol].price) > 0.00005) errors.push(`${row.symbol} was bought out for cash at ${SETTLED[row.symbol].price} on ${SETTLED[row.symbol].from}. Send ${SETTLED[row.symbol].price} or leave it out.`);
  }
  const settled = Object.keys(SETTLED).filter(symbol => isSettled(symbol, date)).map(symbol => ({ symbol, close: SETTLED[symbol].price, settled: true }));
  return { prices: [...kept, ...settled], errors };
}
const bundledBootstrap = JSON.parse(readFileSync(new URL('./market-bootstrap-2026-09-21.json', import.meta.url), 'utf8'));
const bundledEodRecovery = JSON.parse(readFileSync(new URL('./market-eod-2026-09-18.json', import.meta.url), 'utf8'));

const DAY_MS = 86400000;
export const marketAssetClass = symbol => symbol.endsWith('.CC') ? 'crypto' : symbol.endsWith('.US') ? 'stock_or_etf' : 'other';

function priorDate(date, days) {
  return dateKey(new Date(new Date(`${date}T00:00:00.000Z`).getTime() - days * DAY_MS));
}
export function latestCompletedEquityDate(asOf) {
  const instant = new Date(asOf);
  // 22:00 UTC is after the regular US close in either daylight or standard
  // time, leaving time for an end-of-day feed to finish publishing.
  let day = instant.getUTCHours() >= 22 ? dateKey(instant) : priorDate(dateKey(instant), 1);
  while ([0, 6].includes(new Date(`${day}T00:00:00.000Z`).getUTCDay())) day = priorDate(day, 1);
  return day;
}

function returnFrom(rows, targetDate, latest) {
  const base = rows.find(row => row.date >= targetDate) || rows[0];
  return base ? latest.adjusted_close / base.adjusted_close - 1 : null;
}

export function summarizeMarketHistory(symbol, rows) {
  if (!rows?.length) throw new Error(`No market history for ${symbol}`);
  const latest = rows.at(-1);
  const high52w = Math.max(...rows.map(row => row.adjusted_close));
  const low52w = Math.min(...rows.map(row => row.adjusted_close));
  return {
    symbol,
    assetClass: marketAssetClass(symbol),
    price: latest.adjusted_close,
    priceDate: latest.date,
    return3m: returnFrom(rows, addMonths(`${latest.date}T00:00:00.000Z`, -3).slice(0, 10), latest),
    return12m: returnFrom(rows, addMonths(`${latest.date}T00:00:00.000Z`, -12).slice(0, 10), latest),
    high52w,
    low52w,
    observations: rows.length,
  };
}

export function buildUploadedMarketSnapshot(value, receivedAt = new Date()) {
  if (!value || !Array.isArray(value.instruments)) throw new Error('The bootstrap must contain an instruments array.');
  // Settled (bought-out) instruments are optional and never offered to models.
  const instruments = value.instruments.filter(row => !isSettled(row?.symbol, value.asOfDate));
  const live = liveUniverse(value.asOfDate);
  if (instruments.length !== live.length) throw new Error(`Exactly ${live.length} bootstrap instruments are required${live.length < MARKET_UNIVERSE.length ? ` (settled: ${MARKET_UNIVERSE.filter(s => isSettled(s, value.asOfDate)).join(', ')} may be left out)` : ''}.`);
  const expected = new Set(live);
  const seen = new Set();
  for (const row of instruments) {
    if (!row || !expected.has(row.symbol)) throw new Error(`Unknown bootstrap symbol: ${row?.symbol || 'missing'}.`);
    if (seen.has(row.symbol)) throw new Error(`Duplicate bootstrap symbol: ${row.symbol}.`);
    seen.add(row.symbol);
    if (row.asOfDate !== value.asOfDate) throw new Error(`The date for ${row.symbol} does not match the bootstrap date.`);
    for (const field of ['adjClose', 'return3m', 'return12m', 'high52w', 'low52w', 'nObs']) {
      if (!Number.isFinite(row[field])) throw new Error(`Invalid ${field} for ${row.symbol}.`);
    }
    if (row.adjClose <= 0 || row.high52w <= 0 || row.low52w <= 0) throw new Error(`Prices must be positive for ${row.symbol}.`);
    if (row.return3m <= -1 || row.return12m <= -1) throw new Error(`Returns cannot be below -100% for ${row.symbol}.`);
    if (row.high52w < row.adjClose || row.low52w > row.adjClose || row.high52w < row.low52w) throw new Error(`The 52-week range is inconsistent for ${row.symbol}.`);
    // Some uploaded crypto summaries sample weekdays. Preserve that limitation
    // in the packet instead of asserting that 252 rows cover every crypto day.
    const minimumObservations = 200;
    if (!Number.isInteger(row.nObs) || row.nObs < minimumObservations || row.nObs > 400) {
      throw new Error(`${row.symbol} needs at least ${minimumObservations} observations for a 12-month summary.`);
    }
  }
  const source = String(value.source || '').trim();
  if (!source) throw new Error('The bootstrap source is required.');
  const asOf = receivedAt.toISOString();
  return {
    version: 'market-aware-v1',
    source: `${source} adjusted daily close (uploaded bootstrap)`,
    asOf,
    from: addMonths(`${value.asOfDate}T00:00:00.000Z`, -12).slice(0, 10),
    through: value.asOfDate,
    coverageNote: instruments.some(row => row.symbol.endsWith('.CC') && row.nObs < 300)
      ? 'Crypto history has fewer than 300 observations, consistent with weekday sampling; its 52-week range may omit weekend extremes.' : null,
    assets: instruments.map(row => ({
      symbol: row.symbol,
      assetClass: marketAssetClass(row.symbol),
      price: row.adjClose,
      priceDate: row.asOfDate,
      return3m: row.return3m,
      return12m: row.return12m,
      high52w: row.high52w,
      low52w: row.low52w,
      observations: row.nObs,
    })).sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
}

export function bundledMarketSnapshot(asOf, existing = null) {
  const through = latestCompletedEquityDate(asOf);
  if (bundledBootstrap.asOfDate !== through || (existing?.through && existing.through >= through)) return null;
  return buildUploadedMarketSnapshot(bundledBootstrap, new Date(asOf));
}

// Keep the earliest supplied close available to the worker even when the
// original upload happened before a deployment. The insert is idempotent and
// never replaces an existing immutable daily record.
const bundledDailyRecovery = {
  version: 'market-eod-v1',
  source: `${bundledBootstrap.source} adjusted daily close (uploaded bootstrap)`,
  asOf: '2026-09-21T23:59:59.000Z',
  through: bundledBootstrap.asOfDate,
  assets: bundledBootstrap.instruments.map(row => ({
    symbol: row.symbol,
    assetClass: marketAssetClass(row.symbol),
    price: row.adjClose,
    priceDate: row.asOfDate,
  })),
};

export async function seedBundledMarketIngest({ db = pool } = {}) {
  // Keep both supplied closes in the immutable daily ledger. The bootstrap
  // was already used for model prompts; it is also a complete Sep 21 close
  // for performance tracking.
  const documents = [bundledEodRecovery, bundledDailyRecovery];
  let storedAny = false;
  for (const document of documents) {
    const existing = (await db.query('SELECT hash FROM market_ingests WHERE day=$1', [document.through])).rows[0];
    if (existing) continue;
    const digest = hash(document);
    await db.query('INSERT INTO market_ingests(day,document,hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [document.through, JSON.stringify(document), digest]);
    storedAny = true;
  }
  return { stored: storedAny, date: bundledEodRecovery.through, symbols: bundledEodRecovery.assets.length };
}

// Bootstraps shipped in src/market-bootstraps/ are stored on startup exactly
// as if they had been POSTed to /v1/admin/market-bootstrap: same validation,
// same hash, never replacing a record already stored for that date. Each one
// also records its closes in the daily ledger when that day is missing.
const BOOTSTRAP_DIR = new URL('./market-bootstraps/', import.meta.url);
export async function seedBundledBootstraps({ db = pool, dir = BOOTSTRAP_DIR, now = new Date() } = {}) {
  let files = [];
  try { files = readdirSync(dir).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort(); } catch { return []; }
  const results = [];
  for (const name of files) {
    const value = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    const document = buildUploadedMarketSnapshot(value, now);
    const day = value.asOfDate;
    const digest = hash(value);
    const existing = (await db.query('SELECT hash FROM market_bootstraps WHERE day=$1', [day])).rows[0];
    if (!existing) await db.query('INSERT INTO market_bootstraps(day,document,hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [day, JSON.stringify(document), digest]);
    const daily = {
      version: 'market-eod-v1', source: document.source, asOf: `${day}T23:59:59.000Z`, through: day,
      assets: value.instruments.map(row => ({ symbol: row.symbol, assetClass: marketAssetClass(row.symbol), price: row.adjClose, priceDate: row.asOfDate })),
    };
    const existingDaily = (await db.query('SELECT hash FROM market_ingests WHERE day=$1', [day])).rows[0];
    if (!existingDaily) await db.query('INSERT INTO market_ingests(day,document,hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [day, JSON.stringify(daily), hash(daily)]);
    results.push({ day, bootstrap: existing ? (existing.hash === digest ? 'already stored' : 'kept existing') : 'stored', daily: existingDaily ? 'kept existing' : 'stored' });
  }
  return results;
}

export async function fetchMarketSnapshot(asOf, token = process.env.EODHD_API_KEY, getHistory = fetchHistory) {
  if (!token) throw new Error('Market-aware mode needs EODHD_API_KEY before any model requests can start.');
  const through = priorDate(dateKey(asOf), 1);
  const from = priorDate(through, 366);
  const assets = [], errors = [];
  // Keep a small amount of concurrency so one daily packet is fast without
  // turning a provider hiccup into a burst of uncontrolled requests.
  const universe = liveUniverse(through);
  for (let i = 0; i < universe.length; i += 8) {
    const batch = await Promise.allSettled(universe.slice(i, i + 8).map(async symbol => summarizeMarketHistory(symbol, await getHistory(symbol, from, through, token))));
    batch.forEach(result => result.status === 'fulfilled' ? assets.push(result.value) : errors.push(result.reason?.message || 'Market history request failed'));
  }
  if (errors.length || assets.length !== universe.length) {
    const detail = errors.slice(0, 3).join('; ');
    throw new Error(`Market snapshot unavailable for ${universe.length - assets.length} instruments${detail ? `: ${detail}` : ''}`);
  }
  return { version: 'market-aware-v1', source: 'EODHD adjusted daily close', asOf, from, through, assets: assets.sort((a, b) => a.symbol.localeCompare(b.symbol)) };
}

// A book must start from current prices. When the price provider fails, the
// fallback below reuses an older snapshot; on 13 Oct 2026 that silently gave
// a book prices from 18 Sep. A snapshot more than MAX_SNAPSHOT_AGE_DAYS
// calendar days older than the last completed US close is refused, so the
// book pauses with a clear message until a fresh bootstrap is uploaded.
export const MAX_SNAPSHOT_AGE_DAYS = 4;
export function assertFreshSnapshot(document, asOf) {
  const expected = latestCompletedEquityDate(asOf);
  const through = document?.through;
  const ageDays = through ? Math.round((Date.parse(`${expected}T00:00:00Z`) - Date.parse(`${through}T00:00:00Z`)) / DAY_MS) : Infinity;
  if (ageDays > MAX_SNAPSHOT_AGE_DAYS) {
    const error = new Error(`The newest market snapshot is from ${through || 'an unknown date'}, but the last completed US close is ${expected}. Upload a 12-month bootstrap for ${expected}, then resume this book.`);
    error.code = 'market_snapshot_stale';
    throw error;
  }
  return document;
}

export async function getOrCreateDailyMarketSnapshot(asOf, options = {}) {
  return assertFreshSnapshot(await resolveDailyMarketSnapshot(asOf, options), asOf);
}

async function resolveDailyMarketSnapshot(asOf, { db = pool, token = process.env.EODHD_API_KEY, getSnapshot = fetchMarketSnapshot } = {}) {
  const day = dateKey(asOf);
  const existing = (await db.query('SELECT document FROM market_snapshots WHERE day=$1', [day])).rows[0];
  const existingDocument = existing ? (typeof existing.document === 'string' ? JSON.parse(existing.document) : existing.document) : null;
  const uploaded = (await db.query('SELECT document FROM market_bootstraps WHERE day <= $1 ORDER BY day DESC LIMIT 1', [latestCompletedEquityDate(asOf)])).rows[0];
  const uploadedDocument = uploaded ? (typeof uploaded.document === 'string' ? JSON.parse(uploaded.document) : uploaded.document) : null;
  if (uploadedDocument && uploadedDocument.through >= latestCompletedEquityDate(asOf) && (!existingDocument || uploadedDocument.through >= existingDocument.through)) return uploadedDocument;
  const bundled = bundledMarketSnapshot(asOf, existingDocument);
  if (bundled) return bundled;
  if (existingDocument) return existingDocument;
  let document;
  try {
    document = await getSnapshot(asOf, token);
  } catch (error) {
    const carryForward = /402/.test(String(error?.message || '')) && process.env.MARKET_SNAPSHOT_CARRY_FORWARD === 'true';
    if (!carryForward) throw error;
    const previous = (await db.query('SELECT day, document FROM market_snapshots WHERE day < $1 ORDER BY day DESC LIMIT 1', [day])).rows[0];
    if (!previous) throw error;
    const source = typeof previous.document === 'string' ? JSON.parse(previous.document) : previous.document;
    document = {
      ...source,
      asOf,
      source: `${source.source || 'EODHD adjusted daily close'} (carried forward)`,
      carriedForward: true,
      carriedForwardFrom: previous.day,
    };
    console.warn(`Carrying forward market snapshot ${previous.day} as ${day} after provider HTTP 402`);
  }
  await db.query('INSERT INTO market_snapshots(day,document,hash) VALUES($1,$2,$3) ON CONFLICT(day) DO NOTHING', [day, JSON.stringify(document), hash(document)]);
  const saved = (await db.query('SELECT document FROM market_snapshots WHERE day=$1', [day])).rows[0];
  return typeof saved.document === 'string' ? JSON.parse(saved.document) : saved.document;
}

