import { Agent, fetch as undiciFetch } from 'undici';

// Node's built-in fetch gives up after 300 s without response headers, and a
// non-streaming reasoning call sends no headers until it has finished. GPT-5.6
// Luna sometimes thinks for longer than that, so provider calls use their own
// connection pool with no header/body deadline; the per-provider AbortSignal
// in generate() is the only time limit.
const providerAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0, keepAliveTimeout: 10_000 });
export const providerFetch = (url, init = {}) => undiciFetch(url, { ...init, dispatcher: providerAgent });

// Per-request time limits. MiMo streams its answer slowly, so it gets the
// longest limit.
// Every arena now allows up to 128k output tokens; MiMo took 35 minutes for
// 64k. Every provider gets 90 minutes per request (see PROVIDER_TIMEOUT_MS).
// 90 minutes: at the 128k output ceiling the slowest thinker (MiMo, about
// 35 tokens a second) needs about an hour for a full-length reply.
const PROVIDER_TIMEOUT_MS = { deepseek: 5_400_000, openai: 5_400_000, openai6: 5_400_000, mimo: 5_400_000, anthropic: 5_400_000 };

// Haiku 5.5 at "max" effort thinks until the output budget runs out and
// returns no answer (19 Oct weekly book: 15 of 15 Markets replies empty at
// 32,768 tokens; Sandbox empty at 100,000). Anthropic recommends "high" for
// demanding work and "xhigh"/"max" only where evals show a gain.
const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export function anthropicEffort(env = process.env) {
  const value = String(env.ANTHROPIC_EFFORT || '').trim().toLowerCase();
  return ANTHROPIC_EFFORTS.includes(value) ? value : 'high';
}

export function providers(env = process.env) {
  // Meta's current public API documents Responses as the canonical endpoint.
  // Keep an explicit env override for deployments that use a compatible gateway,
  // and infer the request shape from that endpoint rather than assuming chat.
  const metaUrl = env.META_RELAY_URL || env.META_API_URL || 'https://api.meta.ai/v1/responses';
  const metaKind = /\/responses\/?(?:\?.*)?$/.test(metaUrl) ? 'responses' : 'chat';
  return [
    // Both OpenAI models run side by side on the same OPENAI_API_KEY.
    // "openai" keeps GPT-5.6 Luna so its earlier books stay one continuous player.
    { id: 'openai', name: 'GPT-5.6 Luna', model: env.OPENAI_MODEL || 'gpt-5.6-luna', key: env.OPENAI_API_KEY, url: 'https://api.openai.com/v1/responses', kind: 'responses', inputRate: Number(env.OPENAI_INPUT_RATE || 0.2), outputRate: Number(env.OPENAI_OUTPUT_RATE || 1.2) },
    { id: 'openai6', name: 'GPT-6 Luna', model: env.OPENAI6_MODEL || 'gpt-6-luna', key: env.OPENAI_API_KEY, url: 'https://api.openai.com/v1/responses', kind: 'responses', inputRate: Number(env.OPENAI6_INPUT_RATE || 0.10), outputRate: Number(env.OPENAI6_OUTPUT_RATE || 0.50) },
    { id: 'deepseek', name: 'DeepSeek Flash', model: env.DEEPSEEK_MODEL || 'deepseek-flash', key: env.DEEPSEEK_API_KEY, url: 'https://api.deepseek.com/chat/completions', kind: 'chat', inputRate: 0.3, outputRate: 1.2 },
    { id: 'meta', name: 'Meta Muse Spark Contributor', model: env.META_MODEL || 'muse-spark-1.3-contributor', key: env.META_API_KEY, url: metaUrl, kind: metaKind, relay: Boolean(env.META_RELAY_URL), inputRate: Number(env.META_INPUT_RATE || 0.10), outputRate: Number(env.META_OUTPUT_RATE || 0.20) },
    // Xiaomi MiMo: OpenAI-compatible chat completions with its own thinking switch.
    { id: 'mimo', name: 'MiMo V2.6 Pro', model: env.MIMO_MODEL || 'mimo-v2.6-pro', key: env.MIMO_API_KEY, url: env.MIMO_API_URL || 'https://api.xiaomimimo.com/v1/chat/completions', kind: 'chat', inputRate: Number(env.MIMO_INPUT_RATE || 0.435), outputRate: Number(env.MIMO_OUTPUT_RATE || 0.87) },
    // Anthropic's cheapest model, through the Messages API with adaptive
    // thinking at max effort (thinking counts toward max_tokens). Prices are
    // for prompts up to 100k tokens; longer prompts cost $0.50 / $2.50.
    { id: 'anthropic', name: 'Claude Haiku 5.5', model: env.ANTHROPIC_MODEL || 'claude-haiku-5-5', key: env.ANTHROPIC_API_KEY, url: 'https://api.anthropic.com/v1/messages', kind: 'messages', inputRate: Number(env.ANTHROPIC_INPUT_RATE || 0.10), outputRate: Number(env.ANTHROPIC_OUTPUT_RATE || 0.50) },
    // Meta Muse Ember (9 Nov 2026): Meta's small model, on the public Meta Model API
    // (Responses), with the same META_API_KEY as Muse Spark. $0.10 / $0.50 per million
    // tokens; up to 512k output, held to the shared 128k like everyone else.
    { id: 'ember', name: 'Muse Ember', model: env.EMBER_MODEL || 'muse-ember-1.0', key: env.EMBER_API_KEY || env.META_API_KEY, url: env.EMBER_API_URL || 'https://api.meta.ai/v1/responses', kind: 'responses', stream: env.EMBER_STREAM !== 'false', inputRate: Number(env.EMBER_INPUT_RATE || 0.10), outputRate: Number(env.EMBER_OUTPUT_RATE || 0.50) },
  ].map(p => ({ ...p, configured: Boolean(p.key && p.model && p.url), reasoning: p.id === 'meta' ? (env.META_REASONING_EFFORT || 'xhigh') : p.id === 'ember' ? (env.EMBER_REASONING_EFFORT || 'xhigh') : p.id === 'mimo' ? 'thinking' : p.id === 'anthropic' ? anthropicEffort(env) : 'max' }));
}
// Retired providers are not offered for new books, worlds or games; their
// adapters stay so earlier runs keep running, resuming and scoring.
// - Muse Spark: its API needed a relay, retries and catalogue probes to work
//   reliably. ALPHAELO_ENABLE_META=true restores it.
// - GPT-5.6 Luna (19 Oct 2026): superseded by GPT-6 Luna; its place goes to
//   Claude Haiku 5.5. Its existing portfolios still count until they mature.
export const RETIRED_PROVIDERS = ['meta', 'openai'];
export function activeProviders(env = process.env) {
  const retired = env.ALPHAELO_ENABLE_META === 'true' ? RETIRED_PROVIDERS.filter(id => id !== 'meta') : RETIRED_PROVIDERS;
  return providers(env).filter(p => !retired.includes(p.id));
}
export function publicProviders(env = process.env) { return activeProviders(env).map(({ key, url, ...p }) => ({ ...p, keyPresent: Boolean(key), endpointConfigured: Boolean(url), pricing: 'conservative estimate; not an invoice' })); }
export function estimateReservation(provider, prompt, maxTokens) {
  // UTF-8 bytes conservatively bound input tokens; output includes hidden reasoning tokens.
  return Math.ceil(((Buffer.byteLength(prompt, 'utf8') + 4096) * provider.inputRate + maxTokens * provider.outputRate) / 100) / 10000;
}

function cleanDiagnostic(value, limit = 300) {
  return typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').slice(0, limit) : '';
}

function responseHeader(response, name) {
  try { return response?.headers?.get?.(name) || null; } catch { return null; }
}

function providerLog(level, event, details) {
  // Intentionally omit request bodies, prompts, credentials and response text.
  // A single JSON line makes Railway logs searchable without leaking benchmark evidence.
  const record = JSON.stringify({ scope: 'provider', event, ...details });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(`AlphaElo provider ${record}`);
}

function validatedProviderUrl(provider) {
  const url = new URL(provider.url);
  const privateMetaRelay = provider.id === 'meta' && provider.relay && url.protocol === 'http:' && ['meta-relay.railway.internal', 'meta-relay-live.railway.internal'].includes(url.hostname) && url.port === '8080' && url.pathname === '/v1/responses' && !url.search && !url.hash;
  if ((!privateMetaRelay && url.protocol !== 'https:') || url.username || url.password) throw new Error('Provider endpoint must be HTTPS');
  if (['meta', 'ember'].includes(provider.id) && !privateMetaRelay && !['api.meta.ai', 'api.llama.com'].includes(url.hostname)) throw new Error('Meta endpoint requires an approved Meta API host');
  return url;
}

// A rate limit (HTTP 429), or Anthropic's "overloaded" (529), is refused
// before the model generates anything and is not billed, so it is always
// safe to send again. On 19 Oct four of Haiku's format corrections were
// refused by Anthropic's per-minute output limit while the other cells were
// still writing, and those portfolio cells failed without the model ever
// seeing its correction. Quota errors ("insufficient_quota") are not
// retried: they do not clear by waiting.
const RATE_LIMIT_ATTEMPTS = 6;
async function rateLimitRetryable(provider, response) {
  if (response.status !== 429 && !(provider.kind === 'messages' && response.status === 529)) return false;
  try {
    const data = await response.clone().json();
    if (/insufficient_quota|billing|credit/i.test(`${data?.error?.code || ''} ${data?.error?.type || ''} ${data?.error?.message || ''}`)) return false;
  } catch { /* An unreadable 429 body is still a rate limit. */ }
  return true;
}

async function requestProvider(provider, body, fetcher, timeoutMs) {
  const maxAttempts = provider.id === 'meta' ? 8 : RATE_LIMIT_ATTEMPTS;
  const signal = AbortSignal.timeout(timeoutMs);
  const payload = JSON.stringify(body);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const headers = provider.kind === 'messages'
      ? { 'x-api-key': provider.key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      : { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' };
    const response = await fetcher(provider.url, { method: 'POST', headers, body: payload, signal, redirect: 'error' });
    let retryReason = null;
    let retryAfterMs = null;
    if (provider.id === 'meta' && attempt < maxAttempts && (response.status === 404 || response.status === 503)) {
      try {
        const data = await response.clone().json();
        const code = data?.error?.code;
        // Meta has intermittently returned model_not_found while the catalog
        // still lists the model. It also returns transient 503s during routing
        // or serving instability. Both are pre-inference responses with no id
        // or usage, so retrying is safe and can bridge a short rollout window.
        if (response.status === 404 && code === 'model_not_found' && !data.id && !data.usage) retryReason = 'model_not_found';
        if (response.status === 503 && !data.id && !data.usage) retryReason = code || 'http_503';
      } catch { /* Unknown 404 bodies are not safe to retry. */ }
      const header = response.headers?.get?.('retry-after');
      const seconds = header == null ? NaN : Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.min(seconds * 1000, 30_000);
    } else if (provider.id !== 'meta' && attempt < maxAttempts && await rateLimitRetryable(provider, response)) {
      retryReason = `http_${response.status}`;
      const seconds = Number(response.headers?.get?.('retry-after'));
      retryAfterMs = Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 60_000) : Math.min(5_000 * 2 ** (attempt - 1), 60_000);
    }
    if (!retryReason) return { response, attempts: attempt };
    await response.body?.cancel();
    const baseDelay = retryReason === 'model_not_found' ? 1000 : 2000;
    const delayMs = retryAfterMs ?? Math.min(baseDelay * 2 ** (attempt - 1), 16_000);
    providerLog('warn', provider.id === 'meta' ? 'meta_retry' : 'rate_limit_retry', { provider: provider.id, model: provider.model, attempt, maxAttempts, retryReason, delayMs });
    await new Promise(resolve => setTimeout(resolve, delayMs));
    signal.throwIfAborted();
  }
}

export async function checkMetaAvailability(fetcher = fetch, env = process.env) {
  const provider = providers(env).find(item => item.id === 'meta');
  if (!provider?.configured) throw new Error('Meta provider is not configured');
  const url = validatedProviderUrl(provider);
  const response = await fetcher(new URL('/v1/models', url), {
    headers: { Authorization: `Bearer ${provider.key}` },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Meta model catalog returned HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data?.data)) throw new Error('Meta model catalog had an invalid response');
  if (data.data.some(item => item?.id === provider.model)) return { available: true, model: provider.model };
  // Meta's catalogue has omitted 1.3 Contributor even when the same key and
  // endpoint successfully complete a Responses call. Confirm with a tiny real
  // request before rejecting a benchmark run on a false-negative listing.
  const probe = await metaProbeRequest(provider, 'availability', {
    model: provider.model,
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'Reply with exactly META_OK.' }] }],
    max_output_tokens: 32768,
    reasoning: { effort: provider.reasoning },
    store: false,
    stream: false,
  }, fetcher);
  if (probe.ok && probe.responseStatus === 'completed') return { available: true, model: provider.model };
  if (probe.status !== 404) throw new Error(`Meta availability probe failed with HTTP ${probe.status ?? 'unknown'}`);
  return { available: false, model: provider.model };
}

async function metaProbeRequest(provider, name, body, fetcher) {
  const started = Date.now();
  const { response } = await requestProvider(provider, body, fetcher, 60000);
  let data = null;
  try { data = await response.json(); } catch { /* The status and headers still identify a non-JSON failure. */ }
  const providerMessage = cleanDiagnostic(data?.error?.message || data?.message || '');
  const text = response.ok
    ? (data?.output || []).flatMap(item => item?.content || []).filter(item => item?.type === 'output_text').map(item => item.text).join('') || data?.output_text || ''
    : '';
  const result = { name, ok: response.ok, status: response.status, latencyMs: Date.now() - started, requestId: data?.id || responseHeader(response, 'x-request-id') || responseHeader(response, 'request-id'), providerMessage: providerMessage || null, responseStatus: data?.status || null, inputTokens: data?.usage?.input_tokens || 0, outputTokens: data?.usage?.output_tokens || 0, textLength: typeof text === 'string' ? text.length : 0 };
  providerLog(result.ok ? 'info' : 'warn', 'meta_probe', { provider: provider.id, model: provider.model, endpoint: new URL(provider.url).hostname + new URL(provider.url).pathname, ...result });
  return result;
}

export async function diagnoseMeta(fetcher = fetch, env = process.env, { forceProbe = false } = {}) {
  const provider = providers(env).find(item => item.id === 'meta');
  if (!provider?.configured) throw new Error('Meta provider is not configured');
  if (provider.kind !== 'responses') throw new Error('Meta diagnostic requires the Responses endpoint');
  let availableModels = [];
  let catalogError = null;
  try {
    const catalogUrl = new URL('/v1/models', provider.url).toString();
    const response = await fetcher(catalogUrl, { headers: { 'Authorization': `Bearer ${provider.key}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    const data = await response.json();
    availableModels = Array.isArray(data?.data) ? data.data.map(item => item?.id).filter(item => typeof item === 'string').slice(0, 100) : [];
    if (!response.ok) catalogError = cleanDiagnostic(data?.error?.message || data?.message || `HTTP ${response.status}`);
  } catch (cause) { catalogError = cleanDiagnostic(cause?.message || cause?.name || 'catalog request failed'); }
  const modelAvailable = availableModels.includes(provider.model);
  providerLog(modelAvailable ? 'info' : 'warn', 'meta_catalog', { provider: provider.id, configuredModel: provider.model, modelAvailable, availableModels, catalogError });
  if (availableModels.length && !modelAvailable && !forceProbe) return { provider: provider.id, model: provider.model, endpoint: `${new URL(provider.url).hostname}${new URL(provider.url).pathname}`, reasoning: provider.reasoning, modelAvailable, availableModels, catalogError, results: [] };
  const input = [{ role: 'user', content: [{ type: 'input_text', text: 'Reply with exactly META_OK.' }] }];
  const base = { model: provider.model, input, stream: false };
  const probes = [
    ['minimal', base],
    ['with_output_limit', { ...base, max_output_tokens: 64 }],
    ['with_reasoning', { ...base, max_output_tokens: 64, reasoning: { effort: provider.reasoning } }],
    ['configured_shape', { ...base, max_output_tokens: 64, reasoning: { effort: provider.reasoning }, store: false }],
  ];
  const results = [];
  for (const [name, body] of modelAvailable || !forceProbe ? probes : probes.slice(0, 1)) {
    try { results.push(await metaProbeRequest(provider, name, body, fetcher)); }
    catch (cause) {
      const result = { name, ok: false, status: null, latencyMs: null, requestId: null, providerMessage: cleanDiagnostic(cause?.message || cause?.name || 'transport failure'), responseStatus: null, inputTokens: 0, outputTokens: 0, textLength: 0 };
      providerLog('error', 'meta_probe_transport', { provider: provider.id, model: provider.model, ...result });
      results.push(result);
    }
  }
  return { provider: provider.id, model: provider.model, endpoint: `${new URL(provider.url).hostname}${new URL(provider.url).pathname}`, reasoning: provider.reasoning, modelAvailable, availableModels, catalogError, results };
}

// Reads an OpenAI-style chat completion stream (server-sent events) and
// rebuilds the shape of a non-streamed reply. Reasoning deltas are counted
// by the provider's usage figures but not kept.
export async function readChatStream(response, deadlineAt = Infinity) {
  const decoder = new TextDecoder();
  let buffer = '', content = '', finish = null, usage = null, id = null, model = null, fingerprint = null, sawData = false;
  const handle = line => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    const chunk = JSON.parse(payload);
    sawData = true;
    if (chunk.error) { const e = new Error(`Stream error: ${chunk.error.message || 'unknown'}`); throw e; }
    id ||= chunk.id; model ||= chunk.model; fingerprint ||= chunk.system_fingerprint || null;
    if (chunk.usage) usage = chunk.usage;
    for (const choice of chunk.choices || []) {
      if (typeof choice.delta?.content === 'string') content += choice.delta.content;
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  };
  for await (const part of response.body) {
    if (Date.now() > deadlineAt) throw Object.assign(new Error('Timed out while reading the reply'), { name: 'TimeoutError' });
    buffer += decoder.decode(part, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handle(buffer);
  // A stream that stops without a finish reason was cut off by the server
  // (MiMo once returned an empty stream after 17 minutes): treat it as a
  // dropped connection, not as a reply without code.
  if (!sawData || !finish) throw new Error('The stream was terminated before a finish signal');
  return { id, model, system_fingerprint: fingerprint, usage, choices: [{ message: { content }, finish_reason: finish }] };
}

// Reads an OpenAI Responses stream. The final response.completed /
// response.incomplete event carries the whole response object (output items,
// status and usage), which is returned as if the call had not been streamed.
// GPT-5.6 Luna's long non-streamed calls were dropped by OpenAI with HTTP 502
// after 5-8 minutes of silence; a stream keeps the connection busy.
export async function readResponsesStream(response, deadlineAt = Infinity) {
  const decoder = new TextDecoder();
  let buffer = '', final = null, sawData = false;
  const handle = line => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    const event = JSON.parse(payload);
    sawData = true;
    if (event.type === 'error') throw new Error(`The stream was terminated by a provider error: ${event.message || event.error?.message || 'unknown'}`);
    if (event.type === 'response.failed') throw new Error(`The stream was terminated: the response failed (${event.response?.error?.message || 'no reason given'})`);
    if (event.type === 'response.completed' || event.type === 'response.incomplete') final = event.response;
  };
  for await (const part of response.body) {
    if (Date.now() > deadlineAt) throw Object.assign(new Error('Timed out while reading the reply'), { name: 'TimeoutError' });
    buffer += decoder.decode(part, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handle(buffer);
  if (!sawData || !final) throw new Error('The stream was terminated before the response finished');
  return final;
}

// Reads an Anthropic Messages stream and rebuilds a non-streamed message:
// text deltas are kept, thinking deltas are dropped (their tokens are still
// counted in usage.output_tokens), and message_delta carries the stop reason.
export async function readMessagesStream(response, deadlineAt = Infinity) {
  const decoder = new TextDecoder();
  let buffer = '', text = '', id = null, model = null, stop = null, usage = { input_tokens: 0, output_tokens: 0 }, sawData = false, done = false;
  const handle = line => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload) return;
    const event = JSON.parse(payload);
    sawData = true;
    if (event.type === 'error') throw new Error(`The stream was terminated by a provider error: ${event.error?.message || 'unknown'}`);
    if (event.type === 'message_start') { id = event.message?.id || id; model = event.message?.model || model; usage = { ...usage, ...(event.message?.usage || {}) }; }
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') text += event.delta.text || '';
    if (event.type === 'message_delta') { stop = event.delta?.stop_reason ?? stop; if (event.usage) usage = { ...usage, ...event.usage }; }
    if (event.type === 'message_stop') done = true;
  };
  for await (const part of response.body) {
    if (Date.now() > deadlineAt) throw Object.assign(new Error('Timed out while reading the reply'), { name: 'TimeoutError' });
    buffer += decoder.decode(part, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handle(buffer);
  if (!sawData || !done) throw new Error('The stream was terminated before the message finished');
  return { id, model, stop_reason: stop, content: [{ type: 'text', text }], usage };
}

export async function generate(provider, prompt, maxTokens, fetcher = providerFetch, options = {}) {
  if (!provider.configured) throw new Error(`Provider ${provider.id} is not configured`);
  const url = validatedProviderUrl(provider);
  const body = provider.kind === 'messages'
    // JSON is requested in the prompt itself; the Messages API has no
    // response_format switch, so options.responseFormat is ignored here.
    ? { model: provider.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }], thinking: { type: 'adaptive' }, output_config: { effort: provider.reasoning }, stream: true }
    : provider.kind === 'responses'
    ? { model: provider.model, input: ['meta', 'ember'].includes(provider.id) ? [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] : prompt, max_output_tokens: maxTokens, reasoning: { effort: provider.reasoning }, store: false, stream: provider.id !== 'meta' && provider.stream !== false }
    : provider.id === 'mimo'
      // MiMo has no reasoning_effort; thinking is switched on explicitly and the
      // output ceiling is max_completion_tokens (reasoning tokens included).
      // Streamed: MiMo's gateway drops a connection after 15 minutes without
      // data, and a long reply without streaming sends nothing until it ends.
      ? { model: provider.model, messages: [{ role: 'user', content: prompt }], max_completion_tokens: maxTokens, thinking: { type: 'enabled' }, stream: true, stream_options: { include_usage: true }, ...(options.responseFormat ? { response_format: options.responseFormat } : {}) }
      : { model: provider.model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, reasoning_effort: provider.reasoning, ...(provider.id === 'deepseek' ? { thinking: { type: 'enabled' } } : {}), ...(options.responseFormat ? { response_format: options.responseFormat } : {}) };
  const started = Date.now();
  const baseDiagnostic = { provider: provider.id, model: provider.model, endpoint: `${url.hostname}${url.pathname}`, kind: provider.kind, reasoning: provider.reasoning, maxTokens, promptBytes: Buffer.byteLength(prompt, 'utf8') };
  providerLog('info', 'request_started', baseDiagnostic);
  let response, attempts;
  try {
    ({ response, attempts } = await requestProvider(provider, body, fetcher, PROVIDER_TIMEOUT_MS[provider.id] ?? 5_400_000));
  } catch (cause) {
    const error = new Error(`Provider ${provider.id} transport failed: ${cleanDiagnostic(cause?.message || cause?.name || 'unknown error')}`);
    error.code = cause?.name === 'TimeoutError' || cause?.code === 'ABORT_ERR' ? 'provider_timeout' : 'provider_transport';
    error.provider = provider.id;
    error.latencyMs = Date.now() - started;
    providerLog('error', error.code, { ...baseDiagnostic, latencyMs: error.latencyMs, errorName: cleanDiagnostic(cause?.name, 80), errorCode: cleanDiagnostic(cause?.code, 80), message: cleanDiagnostic(cause?.message) });
    throw error;
  }
  // Never log response bodies on failure: upstreams may echo sensitive material.
  baseDiagnostic.attempts = attempts;
  if (!response.ok) {
    let providerMessage = '';
    try {
      const payload = await response.clone().json();
      providerMessage = typeof payload?.error?.message === 'string' ? payload.error.message : typeof payload?.message === 'string' ? payload.message : '';
    } catch { /* Some gateways return an empty or non-JSON error body. */ }
    providerMessage = providerMessage.replace(/[\r\n]+/g, ' ').slice(0, 300);
    const error = new Error(`Provider ${provider.id} returned HTTP ${response.status}${providerMessage ? `: ${providerMessage}` : ''}`);
    error.code = 'provider_http';
    error.provider = provider.id;
    error.status = response.status;
    error.providerMessage = providerMessage || null;
    error.latencyMs = Date.now() - started;
    error.requestId = responseHeader(response, 'x-request-id') || responseHeader(response, 'request-id');
    providerLog('warn', 'http_error', { ...baseDiagnostic, status: response.status, latencyMs: error.latencyMs, requestId: error.requestId, providerMessage: error.providerMessage, rateLimitRemainingRequests: responseHeader(response, 'x-ratelimit-remaining-requests'), rateLimitRemainingTokens: responseHeader(response, 'x-ratelimit-remaining-tokens'), retryAfter: responseHeader(response, 'retry-after') });
    throw error;
  }
  let data;
  // Read a stream only if one came back: a provider may ignore the flag.
  const streamed = body.stream && (/event-stream/i.test(responseHeader(response, 'content-type') || '') || typeof response.json !== 'function');
  const deadlineAt = started + (PROVIDER_TIMEOUT_MS[provider.id] ?? 5_400_000);
  try { data = streamed ? await (provider.kind === 'responses' ? readResponsesStream(response, deadlineAt) : provider.kind === 'messages' ? readMessagesStream(response, deadlineAt) : readChatStream(response, deadlineAt)) : await response.json(); }
  catch (cause) {
    const timedOut = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
    // A connection closed mid-reply ("terminated", reset) is a transport
    // failure, not a malformed reply.
    const dropped = !timedOut && (/terminated|ECONNRESET|socket|other side closed|premature/i.test(`${cause?.message} ${cause?.cause?.message || ''} ${cause?.cause?.code || ''}`));
    const error = new Error(timedOut ? `Provider ${provider.id} transport failed: timed out while reading the reply` : dropped ? `Provider ${provider.id} transport failed: the connection was closed before the reply finished` : `Provider ${provider.id} returned invalid JSON`);
    error.code = timedOut ? 'provider_timeout' : dropped ? 'provider_transport' : 'provider_invalid_json';
    error.provider = provider.id;
    error.latencyMs = Date.now() - started;
    providerLog('error', error.code, { ...baseDiagnostic, status: response.status, latencyMs: error.latencyMs, requestId: responseHeader(response, 'x-request-id'), message: cleanDiagnostic(cause?.message) });
    throw error;
  }
  if (provider.id === 'meta' && data.model && data.model !== provider.model) {
    const error = new Error(`Meta returned ${cleanDiagnostic(data.model, 100)} instead of ${provider.model}`);
    error.code = 'provider_model_mismatch';
    providerLog('error', error.code, { ...baseDiagnostic, returnedModel: data.model });
    throw error;
  }
  const text = provider.kind === 'responses'
    ? (data.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('') || data.output_text
    : provider.kind === 'messages'
      ? (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('')
      : chatMessageText(data.choices?.[0]?.message);
  // Anthropic reports a cut-off as max_tokens; the rest of the lab reads "length".
  const finishReason = provider.kind === 'messages' ? (data.stop_reason === 'max_tokens' ? 'length' : data.stop_reason || null) : data.choices?.[0]?.finish_reason || data.status || null;
  const usage = data.usage || {};
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0, outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const result = { text: typeof text === 'string' ? text : '', inputTokens, outputTokens, estimatedCost: (inputTokens * provider.inputRate + outputTokens * provider.outputRate) / 1000000, latencyMs: Date.now() - started, requestId: data.id || responseHeader(response, 'x-request-id'), returnedModel: data.model || provider.model, ...(data.system_fingerprint ? { fingerprint: String(data.system_fingerprint).slice(0, 120) } : {}), finishReason, settings: { model: provider.model, maxTokens, reasoning: provider.reasoning }, usageAvailable: Boolean(data.usage) };
  providerLog(result.text ? 'info' : 'warn', result.text ? 'request_completed' : 'empty_output', { ...baseDiagnostic, status: response.status, latencyMs: result.latencyMs, requestId: result.requestId, returnedModel: result.returnedModel, finishReason: result.finishReason, inputTokens, outputTokens, usageAvailable: result.usageAvailable, textLength: result.text.length, outputTypes: Array.isArray(data.output) ? data.output.map(item => item?.type).filter(Boolean).slice(0, 20) : [] });
  return { ...result, attempts, rejectedAttempts: attempts - 1 };
}

// Chat providers do not all serialize message content identically. Normalize
// plain strings and the content-part arrays used by some Responses-compatible
// gateways before the benchmark parser sees them.
export function chatMessageText(message) {
  if (typeof message === 'string') return message;
  if (!message || typeof message !== 'object') return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      return typeof part.text === 'string' ? part.text : typeof part.content === 'string' ? part.content : '';
    }).join('');
  }
  return typeof message.text === 'string' ? message.text : '';
}

