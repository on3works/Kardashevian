import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MARKET_UNIVERSE, SETTLED, buildUploadedMarketSnapshot, isSettled, liveUniverse, settleDailyPrices } from '../src/market.mjs';

const prices = (date, omit = []) => MARKET_UNIVERSE.filter(s => !omit.includes(s)).map(symbol => ({ symbol, close: symbol === 'WBD.US' ? 30.95 : 100 }));
const wbd = SETTLED['WBD.US'];

test('WBD is live before its buyout and settled from 6 Oct', () => {
  assert.equal(isSettled('WBD.US', '2026-10-05'), false);
  assert.equal(isSettled('WBD.US', '2026-10-06'), true);
  assert.equal(liveUniverse('2026-10-05').length, MARKET_UNIVERSE.length);
  assert.equal(liveUniverse('2026-10-07').length, MARKET_UNIVERSE.length - 1);
});

test('a daily upload may leave WBD out; it is filled at the cash price', () => {
  const out = settleDailyPrices('2026-10-07', prices('2026-10-07', ['WBD.US']));
  assert.deepEqual(out.errors, []);
  assert.equal(out.prices.length, MARKET_UNIVERSE.length);
  assert.deepEqual(out.prices.find(r => r.symbol === 'WBD.US'), { symbol: 'WBD.US', close: wbd.price, settled: true });
});

test('sending WBD at the cash price gives the same prices as leaving it out', () => {
  const sent = prices('2026-10-07').map(r => r.symbol === 'WBD.US' ? { ...r, close: wbd.price } : r);
  const a = settleDailyPrices('2026-10-07', sent), b = settleDailyPrices('2026-10-07', prices('2026-10-07', ['WBD.US']));
  assert.deepEqual(a.errors, []);
  assert.deepEqual(a.prices, b.prices);
});

test('sending WBD at any other price after the buyout is refused', () => {
  const out = settleDailyPrices('2026-10-07', prices('2026-10-07'));
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /31\.0167/);
});

test('days before the buyout are untouched', () => {
  const input = prices('2026-10-05');
  const out = settleDailyPrices('2026-10-05', input);
  assert.deepEqual(out, { prices: input, errors: [] });
});

const bootstrap = asOfDate => {
  const value = JSON.parse(readFileSync(new URL('../src/market-bootstraps/2026-10-05.json', import.meta.url), 'utf8'));
  return { ...value, asOfDate, instruments: value.instruments.map(r => ({ ...r, asOfDate })) };
};

test('a bootstrap after the buyout leaves WBD out of what models see, sent or not', () => {
  const withWbd = buildUploadedMarketSnapshot(bootstrap('2026-10-07'));
  const value = bootstrap('2026-10-07');
  const withoutWbd = buildUploadedMarketSnapshot({ ...value, instruments: value.instruments.filter(r => r.symbol !== 'WBD.US') }, new Date(withWbd.asOf));
  for (const doc of [withWbd, withoutWbd]) {
    assert.equal(doc.assets.length, MARKET_UNIVERSE.length - 1);
    assert.ok(!doc.assets.some(a => a.symbol === 'WBD.US'));
  }
  assert.deepEqual(withWbd.assets, withoutWbd.assets);
});

test('the stored 5 Oct bootstrap still offers WBD', () => {
  const doc = buildUploadedMarketSnapshot(bootstrap('2026-10-05'));
  assert.equal(doc.assets.length, MARKET_UNIVERSE.length);
  assert.ok(doc.assets.some(a => a.symbol === 'WBD.US'));
});

test('a bootstrap missing a live instrument is still refused', () => {
  const value = bootstrap('2026-10-07');
  assert.throws(() => buildUploadedMarketSnapshot({ ...value, instruments: value.instruments.filter(r => r.symbol !== 'AAPL.US') }), /Exactly 299/);
});
