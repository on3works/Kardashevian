import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRelease, RELEASE_VERSION, releaseHash } from '../src/releases.mjs';

const good = () => ({
  version: RELEASE_VERSION,
  models: [{ id: 'openai6:gpt-6-luna', name: 'GPT-6 Luna', slug: 'gpt-6-luna' }],
  arenas: { markets: { leaderboard: [{ id: 'openai6:gpt-6-luna', elo: 1557, ci: 116 }, { id: 'spy', elo: 1500, anchor: true }] } },
});

test('a release of numbers and names passes', () => {
  assert.deepEqual(checkRelease(good()), []);
});

test('raw model output or private fields anywhere are refused', () => {
  const doc = good();
  doc.arenas.markets.books = [{ id: 'b', cells: [{ prompt: 'secret' }] }];
  assert.match(checkRelease(doc).join(' '), /private field \(arenas\.markets\.books\.0\.cells\.0\.prompt\)/);
  const doc2 = good(); doc2.arenas.sandbox = { leaderboard: [], worlds: [{ code: 'function act(){}' }] };
  assert.match(checkRelease(doc2).join(' '), /private field/);
});

test('every rating needs an interval except the anchor', () => {
  const doc = good(); delete doc.arenas.markets.leaderboard[0].ci;
  assert.match(checkRelease(doc).join(' '), /no interval/);
});

test('wrong version, no models or bad slugs are refused', () => {
  assert.ok(checkRelease({ ...good(), version: 'x' }).length);
  assert.ok(checkRelease({ ...good(), models: [] }).length);
  assert.ok(checkRelease({ ...good(), models: [{ id: 'a', name: 'A', slug: 'Bad Slug' }] }).length);
});

test('the hash is stable for the same document', () => {
  assert.equal(releaseHash(good()), releaseHash(good()));
});
