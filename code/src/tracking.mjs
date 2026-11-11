import { pool } from './db.mjs';
import { dateKey, nextDate, validatePrices, scorePortfolio, portfolioStrategies, mergeRecoveredPortfolios } from './investing.mjs';

function firstEligibleEquityDate(day) {
  let candidate = day;
  while ([0, 6].includes(new Date(`${candidate}T00:00:00.000Z`).getUTCDay())) candidate = nextDate(candidate);
  return candidate;
}

function baselineForRun(run) {
  // Market-aware books already have a frozen research cutoff. Use that close
  // as the immutable starting point so a late EOD upload can rebuild the
  // complete path from the assessment date. Legacy books retain the former
  // next-session rule because they have no frozen market cutoff to anchor.
  const packetThrough = run.input?.marketSnapshot?.through;
  if (/^\d{4}-\d{2}-\d{2}$/.test(packetThrough || '')) return packetThrough;
  return firstEligibleEquityDate(nextDate(run.result.lockedAt));
}

export async function fetchHistory(symbol, from, to, token, fetcher = fetch) {
  const url = new URL(`https://eodhd.com/api/eod/${encodeURIComponent(symbol)}`);
  url.search = new URLSearchParams({ api_token: token, fmt: 'json', period: 'd', from, to, order: 'a' }).toString();
  let response;
  try { response = await fetcher(url, { signal: AbortSignal.timeout(30000), redirect: 'error' }); }
  catch { throw new Error(`Price connection failed for ${symbol}`); }
  if (!response.ok) throw new Error(`Price provider returned HTTP ${response.status} for ${symbol}`);
  try { return validatePrices(await response.json()); }
  catch { throw new Error(`Invalid daily price history for ${symbol}`); }
}

// Called by the existing always-on Railway worker, under its database lock.
// A durable daily claim prevents duplicate jobs across restarts or replicas.
export async function trackDaily(now = new Date(), { db = pool, token = process.env.EODHD_API_KEY, getHistory = fetchHistory } = {}) {
  if (now.getUTCHours() < 6) return;
  // Sunday has no new completed US close. Monday’s EU observation carries
  // forward Friday’s completed close until Monday’s US session is finished.
  if (now.getUTCDay() === 0) return;
  const runs = (await db.query("SELECT * FROM runs r WHERE kind='investing-once' AND status='complete' AND NOT EXISTS (SELECT 1 FROM books_voided v WHERE v.run_id=r.id) ORDER BY created_at")).rows;
  if (!runs.length) return;
  const day = dateKey(now), through = dateKey(new Date(now.getTime() - 86400000));
  if (runs.every(r => baselineForRun(r) > through)) return;
  const from = runs.map(baselineForRun).sort()[0];
  const ingests = (await db.query('SELECT day,document FROM market_ingests WHERE day >= $1 AND day <= $2 ORDER BY day ASC', [from, through])).rows;
  if (!ingests.length && !token) return;
  const claimed = await db.query("INSERT INTO daily_jobs(day,state) VALUES($1,'running') ON CONFLICT DO NOTHING RETURNING day", [day]);
  let correction = false;
  if (!claimed.rowCount) {
    // A late upload may repair an incomplete morning check or correct a completed
    // snapshot recorded before the packet baseline was available. The original
    // evidence remains immutable; the repaired result is appended separately.
    const retry = await db.query(`
      UPDATE daily_jobs SET state='running',error=NULL,started_at=now(),finished_at=NULL
      WHERE day=$1
        AND (
          state IN ('partial','failed','complete')
          OR (state = 'running' AND started_at < now() - interval '5 minutes')
        )
        AND (
          finished_at < (SELECT MAX(created_at) FROM market_ingests WHERE day <= $2)
          OR EXISTS (
            SELECT 1
            FROM daily_snapshots snapshot
            JOIN runs run ON run.id = snapshot.run_id
            WHERE snapshot.day = $1
              AND run.kind = 'investing-once'
              AND NOT EXISTS (
                SELECT 1
                FROM daily_snapshot_corrections correction
                WHERE correction.run_id = snapshot.run_id
                  AND correction.day = snapshot.day
              )
              AND run.input->'marketSnapshot'->>'through' IS NOT NULL
              AND COALESCE(snapshot.document->>'baseline','') <> run.input->'marketSnapshot'->>'through'
          )
          OR EXISTS (
            SELECT 1
            FROM (
              SELECT DISTINCT ON (run_id, day) run_id, day, document
              FROM daily_snapshot_corrections
              WHERE day = $1
              ORDER BY run_id, day, created_at DESC
            ) correction
            JOIN runs run ON run.id = correction.run_id
            WHERE run.kind = 'investing-once'
              AND run.input->'marketSnapshot'->>'through' IS NOT NULL
              AND COALESCE(correction.document->>'baseline','') <> run.input->'marketSnapshot'->>'through'
          )
        )
      RETURNING day
    `, [day, through]);
    if (!retry.rowCount) return;
    correction = true;
  }
  try {
    const records = (await db.query('SELECT * FROM portfolios WHERE run_id=ANY($1::uuid[])', [runs.map(r => r.id)])).rows;
    const recoveries = (await db.query('SELECT * FROM portfolio_recoveries WHERE run_id=ANY($1::uuid[])', [runs.map(r => r.id)])).rows;
    const effectiveRecords = mergeRecoveredPortfolios(records, recoveries);
    // Keep the complete matrix identity with every observation. The frontend
    // resolves a score by provider + horizon + risk; dropping the horizon here
    // makes otherwise valid daily scores appear to be missing.
    const valid = effectiveRecords.filter(p => p.document.status === 'sealed').flatMap(p => portfolioStrategies(p.document).map(s => ({
      run_id: p.run_id,
      provider: p.provider,
      horizonMonths: s.horizonMonths ?? null,
      riskLevel: s.riskLevel ?? 'standard',
      pick: s.pick,
    })));
    const symbols = [...new Set(['SPY.US', ...valid.flatMap(p => p.pick.positions.map(h => h.symbol))])];
    const histories = {}, errors = [], uploadedRows = new Map();
    for (const row of ingests) {
      const document = typeof row.document === 'string' ? JSON.parse(row.document) : row.document;
      for (const asset of document.assets || []) {
        const rows = uploadedRows.get(asset.symbol) || [];
        rows.push({ date: asset.priceDate || document.through, adjusted_close: asset.price });
        uploadedRows.set(asset.symbol, rows);
      }
    }
    // An upload is a usable source only when it covers every symbol needed by
    // the sealed books. Partial uploads fall back to EODHD when configured;
    // without a provider key they produce an explicit incomplete-data state.
    const uploadedComplete = ingests.length > 0 && symbols.every(symbol => uploadedRows.get(symbol)?.length);
    const source = uploadedComplete ? 'Uploaded adjusted daily close' : uploadedRows.size ? 'Uploaded adjusted daily close + EODHD' : 'EODHD adjusted daily close';
    const sourceDay = ingests.at(-1)?.day ? dateKey(ingests.at(-1).day) : through;
    // A correction is append-only. If the same market ingest already produced
    // a correction, advance the audit key while keeping the actual source date
    // in the evidence document.
    const correctionSourceDay = correction ? nextDate(sourceDay) : sourceDay;
    let providerDenied = false, missingCount = 0;
    for (const symbol of symbols) {
      try {
        if (uploadedRows.has(symbol)) histories[symbol] = validatePrices(uploadedRows.get(symbol));
        else if (providerDenied) { missingCount++; continue; }
        else if (token) histories[symbol] = await getHistory(symbol, from, through, token);
        else throw new Error(`No complete uploaded prices for ${symbol} and EODHD is not configured`);
        const evidence = JSON.stringify({ source, fetchedAt: new Date().toISOString(), from, through, rows: histories[symbol] });
        if (correction) await db.query('INSERT INTO price_evidence_corrections(day,source_day,symbol,document) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [day, correctionSourceDay, symbol, evidence]);
        else await db.query('INSERT INTO price_evidence(day,symbol,document) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [day, symbol, evidence]);
      } catch (e) {
        missingCount++;
        if (/HTTP 402/.test(e.message)) providerDenied = true;
        else if (errors.length < 3) errors.push(e.message);
      }
    }
    if (providerDenied) errors.unshift(`Market-data provider denied history (HTTP 402); ${missingCount} symbols still need uploaded closes.`);
    else if (missingCount && !errors.length) errors.push(`${missingCount} symbols still need uploaded closes.`);
    let incomplete = false;
    for (const run of runs) {
      const picks = valid.filter(p => p.run_id === run.id), start = baselineForRun(run);
      const allSymbols = [...new Set(['SPY.US', ...picks.flatMap(p => p.pick.positions.map(h => h.symbol))])];
      const repairedPrevious = (await db.query('SELECT day,document FROM daily_snapshot_corrections WHERE run_id=$1 AND day < $2 ORDER BY day DESC, created_at DESC LIMIT 1', [run.id, day])).rows[0];
      const originalPrevious = (await db.query('SELECT day,document FROM daily_snapshots WHERE run_id=$1 AND day < $2 ORDER BY day DESC LIMIT 1', [run.id, day])).rows[0];
      const previous = repairedPrevious && (!originalPrevious || dateKey(repairedPrevious.day) >= dateKey(originalPrevious.day)) ? repairedPrevious.document : originalPrevious?.document;
      // A lone later upload cannot silently move the original baseline. The
      // market packet cutoff remains the baseline even when the next observed
      // close is several calendar days later.
      const expectedBaseline = start;
      const common = histories['SPY.US']?.find(r => r.date === expectedBaseline && allSymbols.every(s => histories[s]?.some(h => h.date === r.date)))?.date;
      // Prefer the packet's common close when a late upload makes it available;
      // only carry forward the previous baseline when the common close is still missing.
      const baseline = common || previous?.baseline || null;
      const portfolios = picks.map(p => ({
        provider: p.provider,
        horizonMonths: p.horizonMonths,
        riskLevel: p.riskLevel,
        ...(baseline && ['SPY.US', ...p.pick.positions.map(h => h.symbol)].every(s => histories[s]?.length)
          ? scorePortfolio(p.pick, histories, start, through, baseline)
          : { status: baseline ? 'missing_prices' : 'awaiting_baseline', message: baseline ? 'Waiting for this book’s complete prices.' : 'Waiting for the first common market close.' }),
      }));
      if (portfolios.some(portfolio => portfolio.status !== 'tracked')) incomplete = true;
      const document = JSON.stringify({ checkedAt: now.toISOString(), marketDate: histories['SPY.US']?.at(-1)?.date || null, baseline, source, errors, portfolios });
      if (correction) await db.query('INSERT INTO daily_snapshot_corrections(run_id,day,source_day,document) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [run.id, day, correctionSourceDay, document]);
      else await db.query('INSERT INTO daily_snapshots(run_id,day,document) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [run.id, day, document]);
    }
    await db.query("UPDATE daily_jobs SET state=$2,error=$3,finished_at=now() WHERE day=$1", [day, errors.length || incomplete ? 'partial' : 'complete', errors.join('; ') || (incomplete ? 'Some books are waiting for a common close or complete prices.' : null)]);
  } catch (e) {
    await db.query("UPDATE daily_jobs SET state='failed',error=$2,finished_at=now() WHERE day=$1", [day, 'Daily price check failed; the next price check is tomorrow. Models are not asked again.']);
    console.error('Daily tracking failed');
  }
}

