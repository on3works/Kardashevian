import test from 'node:test';
import assert from 'node:assert/strict';
import { researchIndex, researchRun, RESEARCH_KINDS } from '../src/research.mjs';

const fakeDb = (rowsFor) => ({ queries: [], async query(sql, params) { this.queries.push({ sql, params }); return { rows: rowsFor(sql, params) }; } });

test('research export covers only the public arenas', async () => {
  assert.deepEqual(RESEARCH_KINDS, ['investing-once', 'sandbox', 'structures']);
  const db = fakeDb(() => [{ id: 'a', kind: 'sandbox', status: 'complete', created_at: 't', calls: 8, world_voided: 'cut off' }]);
  const index = await researchIndex(db);
  assert.deepEqual(db.queries[0].params, [RESEARCH_KINDS]);
  assert.equal(index.runs[0].arena, 'sandbox');
  assert.equal(index.runs[0].withdrawn, 'cut off');
});

test('a run outside the arenas, or a malformed id, is not exported', async () => {
  const db = fakeDb(() => []);
  assert.equal(await researchRun(db, 'not-a-uuid'), null);
  assert.equal(db.queries.length, 0);
  assert.equal(await researchRun(db, '11111111-1111-4111-8111-111111111111'), null);
  assert.deepEqual(db.queries[0].params[1], RESEARCH_KINDS);
});

test('a book exports its calls with prompts and replies, and its tracking', async () => {
  const db = fakeDb(sql => {
    if (sql.includes('FROM runs')) return [{ id: 'b', kind: 'investing-once', status: 'complete', input: { q: 1 }, result: {}, created_at: 't' }];
    if (sql.includes('FROM calls')) return [{ provider: 'deepseek', call_key: 'k', state: 'complete', prompt: 'P', response: { text: 'R', estimatedCost: 0.01 }, created_at: 't' }];
    if (sql.includes('FROM daily_snapshots')) return [{ day: '2026-11-10', document: {} }];
    return [];
  });
  const r = await researchRun(db, '11111111-1111-4111-8111-111111111111');
  assert.equal(r.arena, 'markets');
  assert.equal(r.calls[0].prompt, 'P');
  assert.equal(r.calls[0].response.text, 'R');
  assert.equal(r.dailySnapshots.length, 1);
  assert.ok(!('idempotency_key' in r));
});

test('old Sandbox and Structures versions are exported but labelled retired', async () => {
  const { retiredVersion } = await import('../src/research.mjs');
  assert.equal(retiredVersion('sandbox', { protocol: 'sandbox-v2' }).version, 'sandbox-v2');
  assert.equal(retiredVersion('sandbox', { protocol: 'sandbox-v3', family: 'expedition' }), null);
  assert.equal(retiredVersion('structures', { protocol: 'structures-v2' }).version, 'structures-v2');
  assert.equal(retiredVersion('structures', { protocol: 'structures-v3' }), null);
  assert.equal(retiredVersion('investing-once', { protocol: 'investing-v8' }), null);
});
