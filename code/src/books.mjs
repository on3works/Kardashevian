import { randomUUID } from 'node:crypto';
import { pool } from './db.mjs';
import { publicProviders } from './providers.mjs';
import { DEFAULT_QUESTION, INVESTING_PROTOCOL, RISK_DEFINITIONS } from './investing.mjs';

// Seals a new investing book. Used by the "New book" button and by the weekly
// schedule, so both paths create identical runs.
export async function createInvestingBook({ models, question = DEFAULT_QUESTION, key, source = 'manual' }, db = pool) {
  const available = publicProviders();
  const id = randomUUID(), asOf = new Date().toISOString();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(768332)');
    const existing = (await client.query('SELECT id FROM runs WHERE idempotency_key=$1', [key])).rows[0];
    if (existing) { await client.query('COMMIT'); return { id: existing.id, created: false }; }
    await client.query('INSERT INTO runs(id,kind,status,input,result,idempotency_key) VALUES($1,$2,$3,$4,$5,$6)', [id, 'investing-once', 'queued', JSON.stringify({ models, question, asOf, source, protocol: INVESTING_PROTOCOL, marketAware: true, riskDefinitions: RISK_DEFINITIONS, providerSnapshot: available.filter(p => models.includes(p.id)) }), '{}', key]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  return { id, created: true };
}

// ISO week key such as 2026-W40, used to make the weekly book idempotent
// across restarts and replicas.
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - yearStart) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

// Weekly schedule: Tuesday from 07:00 UTC, after Monday's close is stored.
export const WEEKLY_BOOK_DAY = 2;
export const WEEKLY_BOOK_HOUR = 7;
export async function maybeWeeklyBook(now = new Date(), db = pool) {
  if (now.getUTCDay() !== WEEKLY_BOOK_DAY || now.getUTCHours() < WEEKLY_BOOK_HOUR) return null;
  const settings = (await db.query('SELECT * FROM settings WHERE id=1')).rows[0];
  if (!settings?.weekly_books) return null;
  const models = publicProviders().filter(p => p.configured).map(p => p.id);
  if (!models.length) return null;
  return createInvestingBook({ models, key: `weekly-book:${isoWeek(now)}`, source: 'weekly' }, db);
}
