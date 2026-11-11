import { createHash } from 'node:crypto';

// Public releases: a numbered, immutable snapshot of results that the Lab
// chooses to publish. kardashevian.com reads only these, never live tables.

export const RELEASE_VERSION = 'kardashevian-release-v1';
export const MAX_RELEASE_BYTES = 2_000_000;

// Keys that would carry raw model output, prompts or private recruiting data.
// A release is numbers and names; any of these anywhere in it is refused.
const FORBIDDEN_KEYS = new Set(['prompt', 'prompts', 'code', 'text', 'reply', 'response', 'raw', 'brief', 'hypothesis', 'thesis', 'cv', 'cvs', 'candidate', 'candidates', 'email', 'trace', 'hidden', 'recruiting']);

function findForbidden(value, path = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) { const hit = findForbidden(value[i], [...path, i]); if (hit) return hit; }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) return [...path, key].join('.');
      const hit = findForbidden(child, [...path, key]);
      if (hit) return hit;
    }
  }
  return null;
}

const finite = v => typeof v === 'number' && Number.isFinite(v);

// Returns a list of problems; an empty list means the release may be stored.
export function checkRelease(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['The release must be a JSON object.'];
  const bytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
  if (bytes > MAX_RELEASE_BYTES) problems.push(`The release is ${bytes} bytes; the limit is ${MAX_RELEASE_BYTES}.`);
  if (doc.version !== RELEASE_VERSION) problems.push(`version must be ${RELEASE_VERSION}.`);
  if (!Array.isArray(doc.models) || !doc.models.length) problems.push('models must list at least one model.');
  else for (const m of doc.models) if (!m || typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.slug !== 'string' || !/^[a-z0-9-]+$/.test(m.slug)) { problems.push('Every model needs an id, a name and a lowercase slug.'); break; }
  const markets = doc.arenas?.markets, sandbox = doc.arenas?.sandbox;
  if (!markets && !sandbox) problems.push('arenas must include markets or sandbox.');
  for (const [name, arena] of [['markets', markets], ['sandbox', sandbox]]) {
    if (!arena) continue;
    if (!Array.isArray(arena.leaderboard)) { problems.push(`${name}.leaderboard must be a list.`); continue; }
    for (const row of arena.leaderboard) {
      if (!finite(row?.elo)) { problems.push(`${name}: every leaderboard row needs a numeric elo.`); break; }
      if (!row.anchor && !(finite(row.ci) && row.ci > 0)) { problems.push(`${name}: ${row.id} has no interval; every rating must show one.`); break; }
    }
  }
  const forbidden = findForbidden(doc);
  if (forbidden) problems.push(`The release contains a private field (${forbidden}); only numbers and names may be published.`);
  return problems;
}

export function releaseHash(doc) { return createHash('sha256').update(JSON.stringify(doc)).digest('hex'); }

export const RELEASES_SQL = `CREATE TABLE IF NOT EXISTS public_releases (n serial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), note text, document jsonb NOT NULL, hash text NOT NULL UNIQUE);`;

export async function storeRelease(db, doc, note) {
  const digest = releaseHash(doc);
  const existing = (await db.query('SELECT n FROM public_releases WHERE hash=$1', [digest])).rows[0];
  if (existing) return { n: existing.n, created: false };
  const row = (await db.query('INSERT INTO public_releases(note,document,hash) VALUES($1,$2,$3) RETURNING n, created_at', [note || null, JSON.stringify(doc), digest])).rows[0];
  return { n: row.n, created: true, createdAt: row.created_at };
}

export async function listReleases(db) {
  return (await db.query('SELECT n, created_at, note FROM public_releases ORDER BY n DESC LIMIT 200')).rows.map(r => ({ n: r.n, releasedAt: r.created_at, note: r.note }));
}

export async function loadRelease(db, n) {
  const row = n === 'latest'
    ? (await db.query('SELECT n, created_at, note, document FROM public_releases ORDER BY n DESC LIMIT 1')).rows[0]
    : (await db.query('SELECT n, created_at, note, document FROM public_releases WHERE n=$1', [n])).rows[0];
  if (!row) return null;
  return { ...row.document, n: row.n, releasedAt: row.created_at, note: row.note };
}
