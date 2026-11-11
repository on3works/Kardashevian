// Pulls Kardashevian's public data into data/. Run by .github/workflows/sync.yml
// every day after the lab's price check; anyone can run it: `node scripts/sync.mjs`.
//
//   data/releases/         every numbered release, exactly as kardashevian.com serves it
//   data/runs/index.json   every Markets book, Sandbox world and Structures site
//   data/runs/<arena>/<date>_<id>/
//       run.json           inputs, result, status, withdrawn reason, sealed portfolios
//       calls.csv          one row per model call: model, state, tokens, cost, latency
//       calls.jsonl.gz     the same calls with the exact prompt and the full reply
//       tracking.json      Markets only: daily valuations (and corrections) since the start
//
// Files are only rewritten when their content changes, so the git history shows what moved.

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const API = (process.env.KARDASHEVIAN_API_URL || 'https://alphaelo-backend-production.up.railway.app').replace(/\/$/, '');
const ROOT = new URL('../data/', import.meta.url).pathname;

async function get(path) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(180_000) });
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    if (attempt >= 4) throw new Error(`${path}: HTTP ${res.status}`);
    await new Promise(r => setTimeout(r, 5000 * attempt));
  }
}

let changed = 0;
async function put(file, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const before = await readFile(file).catch(() => null);
  const same = before && (file.endsWith('.gz') ? gunzipSync(before).equals(gunzipSync(buf)) : before.equals(buf));
  if (same) return;
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, buf);
  changed++;
}
const pretty = v => JSON.stringify(v, null, 2) + '\n';
const csvCell = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

async function releases() {
  const list = await get('/public/v1/releases');
  if (!list) return;
  await put(join(ROOT, 'releases', 'index.json'), pretty(list));
  const have = new Set(await readdir(join(ROOT, 'releases')).catch(() => []));
  for (const r of list.releases || []) {
    const n = r.n ?? r.number;
    const name = `release-${String(n).padStart(4, '0')}.json`;
    if (have.has(name)) continue; // releases are immutable
    const doc = await get(`/public/v1/releases/${n}`);
    if (doc) await put(join(ROOT, 'releases', name), pretty(doc));
  }
}

async function runs() {
  const index = await get('/public/v1/research');
  if (!index) { console.log('research export not available yet'); return; }
  await put(join(ROOT, 'runs', 'index.json'), pretty(index));
  for (const entry of index.runs) {
    const dir = join(ROOT, 'runs', entry.arena, `${String(entry.createdAt).slice(0, 10)}_${entry.id}`);
    const record = await get(`/public/v1/research/runs/${entry.id}`);
    if (!record) continue;
    const { calls = [], dailySnapshots, snapshotCorrections, ...run } = record;
    await put(join(dir, 'run.json'), pretty(run));
    const header = ['provider', 'key', 'state', 'created_at', 'returned_model', 'input_tokens', 'output_tokens', 'estimated_cost_usd', 'latency_ms', 'finish_reason', 'reply_chars', 'error'];
    const rows = calls.map(c => {
      const r = c.response || {};
      return [c.provider, c.key, c.state, c.createdAt, r.returnedModel, r.inputTokens, r.outputTokens, r.estimatedCost, r.latencyMs, r.finishReason, typeof r.text === 'string' ? r.text.length : '', r.error?.message].map(csvCell).join(',');
    });
    await put(join(dir, 'calls.csv'), [header.join(','), ...rows].join('\n') + '\n');
    await put(join(dir, 'calls.jsonl.gz'), gzipSync(calls.map(c => JSON.stringify(c)).join('\n') + '\n', { level: 9 }));
    if (dailySnapshots) await put(join(dir, 'tracking.json'), pretty({ dailySnapshots, corrections: snapshotCorrections || [] }));
  }
}

await releases();
await runs();
console.log(`${changed} file(s) changed`);
