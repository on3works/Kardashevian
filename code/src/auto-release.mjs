import { dateKey } from './investing.mjs';

// Automatic public releases. Once a day's price check has finished, ask the
// Lab to publish a release to kardashevian.com. The Lab builds it with the
// same code as its "Public releases" card, skips it when nothing changed,
// and sends it back to POST /v1/releases, where it is checked for private
// fields like any other release. One request per finished check; a late
// upload that re-runs the check asks again. A failed request is retried up
// to 3 times, 15 minutes apart.
export const LAB_URL = (process.env.ALPHAELO_LAB_URL || 'https://alphaelo.vercel.app').replace(/\/$/, '');
export const RELEASE_REQUESTS_SQL = 'CREATE TABLE IF NOT EXISTS release_requests (day date PRIMARY KEY, requested_at timestamptz NOT NULL, attempts int NOT NULL DEFAULT 1, status text NOT NULL, detail text)';
const RETRY_AFTER_MS = 15 * 60_000, MAX_ATTEMPTS = 3;

export async function maybeRequestRelease(now = new Date(), { db, token = process.env.ALPHAELO_BACKEND_TOKEN, fetchImpl = fetch, labUrl = LAB_URL } = {}) {
  const day = dateKey(now);
  const job = (await db.query('SELECT state, finished_at FROM daily_jobs WHERE day=$1', [day])).rows[0];
  if (!job?.finished_at || !['complete', 'partial'].includes(job.state)) return null;
  const finished = new Date(job.finished_at).getTime();
  const prior = (await db.query('SELECT requested_at, attempts, status FROM release_requests WHERE day=$1', [day])).rows[0];
  const sameCheck = prior && new Date(prior.requested_at).getTime() >= finished;
  if (sameCheck && !(prior.status === 'failed' && prior.attempts < MAX_ATTEMPTS && now.getTime() - new Date(prior.requested_at).getTime() >= RETRY_AFTER_MS)) return null;
  const attempts = sameCheck ? prior.attempts + 1 : 1;
  await db.query("INSERT INTO release_requests(day, requested_at, attempts, status) VALUES($1, now(), $2, 'requested') ON CONFLICT(day) DO UPDATE SET requested_at=now(), attempts=$2, status='requested', detail=NULL", [day, attempts]);
  let status, detail;
  try {
    const res = await fetchImpl(`${labUrl}/api/release/auto`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(90_000) });
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    status = res.ok ? (body.published ? 'published' : 'skipped') : 'failed';
    detail = JSON.stringify(body).slice(0, 500);
  } catch (error) {
    status = 'failed';
    detail = String(error?.message || error).slice(0, 300);
  }
  await db.query('UPDATE release_requests SET status=$2, detail=$3 WHERE day=$1', [day, status, detail]);
  return { day, attempts, status, detail };
}

export async function lastReleaseRequest(db) {
  const row = (await db.query('SELECT day, requested_at, attempts, status, detail FROM release_requests ORDER BY day DESC LIMIT 1')).rows[0];
  return row ? { day: dateKey(new Date(row.day)), requestedAt: row.requested_at, attempts: row.attempts, status: row.status, detail: row.detail } : null;
}
