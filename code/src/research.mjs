// Public research export: everything behind the public arenas, call by call.
// Kardashevian publishes its full record (prompts, model replies, scores, tokens and
// costs) in the open repository on3works/kardashevian, which pulls from here.
// Only the arenas are exported. Recruiting, outreach and anything else that touches
// real people never appears here.

export const RESEARCH_KINDS = ['investing-once', 'sandbox', 'structures'];
const ARENA = { 'investing-once': 'markets', sandbox: 'sandbox', structures: 'structures' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function researchIndex(db) {
  const rows = (await db.query(`
    SELECT r.id, r.kind, r.status, r.created_at, r.updated_at,
      (SELECT reason FROM books_voided b WHERE b.run_id=r.id) AS book_voided,
      (SELECT reason FROM sandbox_voided s WHERE s.run_id=r.id) AS world_voided,
      (SELECT count(*)::int FROM calls c WHERE c.run_id=r.id) AS calls,
      (SELECT max(day) FROM daily_snapshots d WHERE d.run_id=r.id) AS last_tracked
    FROM runs r WHERE r.kind = ANY($1::text[]) ORDER BY r.created_at`, [RESEARCH_KINDS])).rows;
  return {
    note: 'Every run behind the public arenas. Fetch /public/v1/research/runs/{id} for the full record.',
    runs: rows.map(r => ({ id: r.id, arena: ARENA[r.kind], status: r.status, createdAt: r.created_at, updatedAt: r.updated_at ?? null, withdrawn: r.book_voided || r.world_voided || null, calls: r.calls, lastTracked: r.last_tracked ?? null })),
  };
}

export async function researchRun(db, id) {
  if (!UUID.test(id)) return null;
  const run = (await db.query('SELECT id, kind, status, input, result, error, created_at FROM runs WHERE id=$1 AND kind = ANY($2::text[])', [id, RESEARCH_KINDS])).rows[0];
  if (!run) return null;
  const calls = (await db.query('SELECT provider, call_key, state, prompt, response, created_at FROM calls WHERE run_id=$1 ORDER BY created_at, call_key', [id])).rows;
  const withdrawn = (await db.query('SELECT reason, voided_at FROM books_voided WHERE run_id=$1 UNION ALL SELECT reason, voided_at FROM sandbox_voided WHERE run_id=$1', [id])).rows[0] || null;
  const out = {
    arena: ARENA[run.kind], id: run.id, status: run.status, createdAt: run.created_at, error: run.error || null,
    withdrawn: withdrawn ? { reason: withdrawn.reason, at: withdrawn.voided_at } : null,
    input: run.input, result: run.result,
    calls: calls.map(c => ({ provider: c.provider, key: c.call_key, state: c.state, createdAt: c.created_at, prompt: c.prompt, response: c.response })),
  };
  if (run.kind === 'investing-once') {
    out.portfolios = (await db.query('SELECT provider, document, hash, sealed_at FROM portfolios WHERE run_id=$1 ORDER BY provider', [id])).rows;
    out.portfolioRecoveries = (await db.query('SELECT provider, document, hash, recovered_at FROM portfolio_recoveries WHERE run_id=$1 ORDER BY provider', [id])).rows;
    out.dailySnapshots = (await db.query('SELECT day, document FROM daily_snapshots WHERE run_id=$1 ORDER BY day', [id])).rows;
    out.snapshotCorrections = (await db.query('SELECT day, source_day, document, created_at FROM daily_snapshot_corrections WHERE run_id=$1 ORDER BY day, created_at', [id])).rows;
  }
  return out;
}
