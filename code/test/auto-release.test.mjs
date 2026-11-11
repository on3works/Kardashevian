import test from 'node:test';
import assert from 'node:assert/strict';
import { maybeRequestRelease } from '../src/auto-release.mjs';

// A tiny stand-in for the two tables the trigger reads and writes.
function fakeDb({ job }) {
  const state = { job, request: null, clock: Date.parse('2026-10-16T09:00:00Z') };
  return {
    state,
    async query(sql, params) {
      if (sql.startsWith('SELECT state, finished_at FROM daily_jobs')) return { rows: state.job ? [state.job] : [] };
      if (sql.startsWith('SELECT requested_at, attempts, status FROM release_requests')) return { rows: state.request ? [state.request] : [] };
      if (sql.startsWith('INSERT INTO release_requests')) { state.request = { requested_at: new Date(state.clock).toISOString(), attempts: params[1], status: 'requested' }; return { rows: [] }; }
      if (sql.startsWith('UPDATE release_requests')) { Object.assign(state.request, { status: params[1], detail: params[2] }); return { rows: [] }; }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}
const lab = (body, ok = true) => { const calls = []; const fn = async (url, init) => { calls.push({ url, auth: init.headers.Authorization }); return { ok, status: ok ? 200 : 500, json: async () => body }; }; fn.calls = calls; return fn; };
const now = new Date('2026-10-16T09:00:00Z');
const finishedJob = { state: 'complete', finished_at: '2026-10-16T08:30:00Z' };

test('no request until the day\'s price check has finished', async () => {
  for (const job of [null, { state: 'running', finished_at: null }, { state: 'failed', finished_at: '2026-10-16T08:30:00Z' }]) {
    const fetchImpl = lab({ published: true });
    assert.equal(await maybeRequestRelease(now, { db: fakeDb({ job }), token: 't', fetchImpl, labUrl: 'https://lab' }), null);
    assert.equal(fetchImpl.calls.length, 0);
  }
});

test('asks the Lab once after the check, with the backend token', async () => {
  const db = fakeDb({ job: finishedJob }), fetchImpl = lab({ published: true, n: 3 });
  const first = await maybeRequestRelease(now, { db, token: 'secret-token', fetchImpl, labUrl: 'https://lab' });
  assert.equal(first.status, 'published');
  assert.deepEqual(fetchImpl.calls, [{ url: 'https://lab/api/release/auto', auth: 'Bearer secret-token' }]);
  assert.equal(await maybeRequestRelease(new Date(now.getTime() + 60_000), { db, token: 'secret-token', fetchImpl, labUrl: 'https://lab' }), null);
  assert.equal(fetchImpl.calls.length, 1);
});

test('an unchanged release is recorded as skipped and not asked again', async () => {
  const db = fakeDb({ job: finishedJob }), fetchImpl = lab({ published: false, reason: 'unchanged' });
  assert.equal((await maybeRequestRelease(now, { db, token: 't', fetchImpl, labUrl: 'https://lab' })).status, 'skipped');
  assert.equal(await maybeRequestRelease(new Date(now.getTime() + 30 * 60_000), { db, token: 't', fetchImpl, labUrl: 'https://lab' }), null);
});

test('a failed request is retried after 15 minutes, at most 3 times', async () => {
  const db = fakeDb({ job: finishedJob }), fetchImpl = lab({ error: 'down' }, false);
  assert.equal((await maybeRequestRelease(now, { db, token: 't', fetchImpl, labUrl: 'https://lab' })).status, 'failed');
  assert.equal(await maybeRequestRelease(new Date(now.getTime() + 5 * 60_000), { db, token: 't', fetchImpl, labUrl: 'https://lab' }), null);
  for (const minutes of [16, 32]) {
    db.state.clock = now.getTime() + minutes * 60_000;
    const r = await maybeRequestRelease(new Date(db.state.clock), { db, token: 't', fetchImpl, labUrl: 'https://lab' });
    assert.equal(r.status, 'failed');
  }
  db.state.clock = now.getTime() + 48 * 60_000;
  assert.equal(await maybeRequestRelease(new Date(db.state.clock), { db, token: 't', fetchImpl, labUrl: 'https://lab' }), null);
  assert.equal(fetchImpl.calls.length, 3);
});

test('a later re-run of the check (late upload) asks again', async () => {
  const db = fakeDb({ job: finishedJob }), fetchImpl = lab({ published: true });
  await maybeRequestRelease(now, { db, token: 't', fetchImpl, labUrl: 'https://lab' });
  db.state.job = { state: 'complete', finished_at: '2026-10-16T11:00:00Z' };
  db.state.clock = Date.parse('2026-10-16T11:01:00Z');
  assert.equal((await maybeRequestRelease(new Date(db.state.clock), { db, token: 't', fetchImpl, labUrl: 'https://lab' })).attempts, 1);
  assert.equal(fetchImpl.calls.length, 2);
});
