import test from 'node:test';
import assert from 'node:assert/strict';
import { activeProviders, generate, providers } from '../src/providers.mjs';
import { assertFreshSnapshot } from '../src/market.mjs';

const env = { ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-test', DEEPSEEK_API_KEY: 'd', MIMO_API_KEY: 'm' };
const haiku = () => providers(env).find(p => p.id === 'anthropic');

function sse(events) {
  const body = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream', 'request-id': 'req_1' }), body: (async function* () { yield new TextEncoder().encode(body); })() };
}
const reply = (stop = 'end_turn') => [
  { type: 'message_start', message: { id: 'msg_1', model: 'claude-haiku-5-5', usage: { input_tokens: 1200, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'private reasoning' } },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"ok":' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'true}' } },
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 900 } },
  { type: 'message_stop' },
];

test('Haiku 5.5 is offered; GPT-5.6 Luna is retired from new runs but still known', () => {
  const active = activeProviders(env).map(p => p.id);
  assert.ok(active.includes('anthropic'));
  assert.ok(!active.includes('openai'));
  assert.ok(providers(env).some(p => p.id === 'openai'));
  assert.equal(haiku().model, 'claude-haiku-5-5');
  assert.equal(haiku().reasoning, 'high');
});

test('Haiku effort: high by default, ANTHROPIC_EFFORT overrides, unknown values fall back', () => {
  const effort = extra => providers({ ...env, ...extra }).find(p => p.id === 'anthropic').reasoning;
  assert.equal(effort({}), 'high');
  assert.equal(effort({ ANTHROPIC_EFFORT: 'medium' }), 'medium');
  assert.equal(effort({ ANTHROPIC_EFFORT: ' XHIGH ' }), 'xhigh');
  assert.equal(effort({ ANTHROPIC_EFFORT: 'extreme' }), 'high');
});

test('Haiku request: Messages API, adaptive thinking at high effort, streamed, x-api-key', async () => {
  let seen;
  const fetcher = async (url, init) => { seen = { url, init }; return sse(reply()); };
  const out = await generate(haiku(), 'Return JSON', 32768, fetcher);
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(seen.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(seen.init.headers.Authorization, undefined);
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body.thinking, { type: 'adaptive' });
  assert.deepEqual(body.output_config, { effort: 'high' });
  assert.equal(body.max_tokens, 32768);
  assert.equal(body.stream, true);
  assert.equal(out.text, '{"ok":true}');
  assert.equal(out.inputTokens, 1200);
  assert.equal(out.outputTokens, 900);
  assert.equal(out.finishReason, 'end_turn');
  assert.ok(Math.abs(out.estimatedCost - (1200 * 0.10 + 900 * 0.50) / 1e6) < 1e-12);
});

test('a reply cut off at the output limit reads as "length", like the other providers', async () => {
  const out = await generate(haiku(), 'p', 1000, async () => sse(reply('max_tokens')));
  assert.equal(out.finishReason, 'length');
});

test('a stream that ends without message_stop is a dropped connection', async () => {
  const cut = reply().filter(e => e.type !== 'message_stop');
  await assert.rejects(() => generate(haiku(), 'p', 1000, async () => sse(cut)), err => err.code === 'provider_transport');
});

function refused(status, body, retryAfter = '0') {
  const text = JSON.stringify(body);
  const make = () => ({ ok: false, status, headers: new Headers({ 'content-type': 'application/json', 'retry-after': retryAfter }), json: async () => body, text: async () => text, clone: make, body: { cancel: async () => {} } });
  return make();
}

test('a rate-limited request (429) or an overloaded one (529) is sent again and then succeeds', async () => {
  const statuses = [];
  const replies = [refused(429, { type: 'error', error: { type: 'rate_limit_error', message: 'output tokens per minute' } }), refused(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })];
  const out = await generate(haiku(), 'p', 1000, async () => { const next = replies.shift() || sse(reply()); statuses.push(next.status); return next; });
  assert.deepEqual(statuses, [429, 529, 200]);
  assert.equal(out.text, '{"ok":true}');
});

test('a quota error is not retried, and a lasting rate limit gives up after six tries', async () => {
  let calls = 0;
  await assert.rejects(() => generate(haiku(), 'p', 1000, async () => { calls++; return refused(429, { error: { type: 'insufficient_quota', message: 'billing' } }); }), err => err.status === 429);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(() => generate(haiku(), 'p', 1000, async () => { calls++; return refused(429, { error: { type: 'rate_limit_error' } }); }), err => err.status === 429);
  assert.equal(calls, 6);
});

test('a stale market snapshot is refused for a new book', () => {
  const monday = '2026-10-19T12:00:00Z';
  assert.throws(() => assertFreshSnapshot({ through: '2026-09-18' }, monday), err => err.code === 'market_snapshot_stale' && /2026-10-16/.test(err.message));
  assert.throws(() => assertFreshSnapshot({ through: '2026-10-05' }, monday), /Upload a 12-month bootstrap for 2026-10-16/);
  assert.doesNotThrow(() => assertFreshSnapshot({ through: '2026-10-16' }, monday));
  assert.doesNotThrow(() => assertFreshSnapshot({ through: '2026-10-15' }, monday));
});
