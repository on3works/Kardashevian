import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { tournament, parseMove, leaderboard, predictionInput, addMonths, packetInput } from '../src/protocol.mjs';
import { checkMetaAvailability, diagnoseMeta, generate, providers, estimateReservation } from '../src/providers.mjs';

test('Three models, five paired openings produce 30 games and 20 games per model', () => {
  const games = tournament(['openai','deepseek','meta'],5,false); assert.equal(games.length,30);
  for (const id of ['openai','deepseek','meta']) { assert.equal(games.filter(g=>g.white===id).length,10); assert.equal(games.filter(g=>g.black===id).length,10); }
});
test('Strict UCI rejects explanations and impossible moves', () => {
  const board = new Chess(); assert.equal(parseMove('e2e5', board),null); assert.equal(parseMove('Move: e2e4',board),null); assert.ok(parseMove('e2e4',board));
});
test('Smoke games never change Elo, rated result is zero sum', () => {
  const g = {white:'openai',black:'deepseek',rated:false,status:'complete',result:'1-0'};
  assert.equal(leaderboard([{result:{games:[g]}}]).find(r=>r.id==='openai').games,0); g.rated=true;
  const rows=leaderboard([{result:{games:[g]}}]); const llms=rows.filter(r=>r.id!=='maia3');
  assert.equal(llms.reduce((a,r)=>a+r.elo,0),1500*llms.length); assert.equal(rows.find(r=>r.id==='openai').elo,1512); assert.equal(rows.find(r=>r.id==='maia3').elo,1200);
});
test('Portfolio rejects leverage, invalid totals and duplicates', () => {
  const pick={cashWeight:0.2,expectedReturn:0.1,thesis:'value',risks:'risk',positions:[{assetId:'A',weight:0.8,thesis:'cheap'}]};
  assert.ok(predictionInput.safeParse(pick).success); assert.equal(predictionInput.safeParse({...pick,cashWeight:0.5}).success,false);
  assert.equal(predictionInput.safeParse({...pick,positions:[{assetId:'A',weight:-0.8,thesis:'cheap'}]}).success,false);
});
test('Calendar horizons handle leap years and month ends',()=>{assert.equal(addMonths('2026-08-31T12:00:00.000Z',6),'2027-02-28T12:00:00.000Z');});
test('Provider setup requires a key; configured is not a successful connection test',()=>{assert.equal(providers({}).find(p=>p.id==='meta').configured,false); assert.equal(providers({META_API_KEY:'test'}).find(p=>p.id==='meta').configured,true);});
test('Provider defaults use the contributor model and the highest supported reasoning effort',()=>{
  const catalog = providers({ META_API_KEY: 'test' });
  const meta = catalog.find(p => p.id === 'meta');
  assert.equal(meta.model, 'muse-spark-1.3-contributor');
  assert.equal(meta.url, 'https://api.meta.ai/v1/responses');
  assert.equal(meta.kind, 'responses');
  assert.equal(meta.inputRate, 0.10);
  assert.equal(meta.outputRate, 0.20);
  assert.equal(meta.reasoning, 'xhigh');
});
test('OpenAI request caps output and disables storage',async()=>{
  const p=providers({OPENAI_API_KEY:'test'})[0];
  const result=await generate(p,'hello',2048,async(url,opts)=>{const body=JSON.parse(opts.body); assert.equal(body.store,false); assert.equal(body.max_output_tokens,2048); assert.deepEqual(body.reasoning,{effort:'max'}); return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'e2e4'}]}],usage:{input_tokens:20,output_tokens:30}})};});
  assert.equal(result.text,'e2e4'); assert.ok(estimateReservation(p,'hello',2048)>result.estimatedCost);
});
test('DeepSeek chat requests receive maximum reasoning controls',async()=>{
  const p = providers({ DEEPSEEK_API_KEY: 'test' }).find(item => item.id === 'deepseek');
  await generate(p, 'hello', 2048, async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.reasoning_effort, 'max');
    assert.deepEqual(body.thinking, { type: 'enabled' });
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 20, completion_tokens: 30 } }) };
  });
});
test('Meta Contributor uses Responses with xhigh reasoning',async()=>{
  const p = providers({ META_API_KEY: 'test' }).find(item => item.id === 'meta');
  await generate(p, 'hello', 2048, async (url, opts) => {
    assert.equal(url, 'https://api.meta.ai/v1/responses');
    const body = JSON.parse(opts.body);
    assert.deepEqual(body.reasoning, { effort: 'xhigh' });
    assert.deepEqual(body.input, [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }]);
    assert.equal(body.max_output_tokens, 2048);
    assert.equal(body.store, false);
    assert.equal(body.stream, false);
    return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 20, output_tokens: 30 } }) };
  });
});
test('Meta can use only the named private Railway relays when explicitly configured', async () => {
  for (const hostname of ['meta-relay.railway.internal', 'meta-relay-live.railway.internal']) {
    const relayUrl = `http://${hostname}:8080/v1/responses`;
    const p = providers({ META_API_KEY: 'test', META_RELAY_URL: relayUrl }).find(item => item.id === 'meta');
    assert.equal(p.relay, true);
    await generate(p, 'hello', 64, async url => {
      assert.equal(url, relayUrl);
      return { ok: true, json: async () => ({ output_text: 'ok' }) };
    });
    await assert.rejects(() => generate({ ...p, url: 'http://other.railway.internal:8080/v1/responses' }, 'hello', 64), /HTTPS/);
  }
});
test('Meta retries only explicit model rejections and retains one successful completion', async () => {
  const provider = providers({ META_API_KEY: 'test' }).find(p => p.id === 'meta');
  const bodies = [];
  const result = await generate(provider, 'same benchmark prompt', 32768, async (_url, options) => {
    bodies.push(options.body);
    if (bodies.length < 3) return Response.json({ error: { code: 'model_not_found', message: 'The requested model was not found.' } }, { status: 404 });
    return Response.json({ model: provider.model, id: 'one-completion', status: 'completed', output_text: 'answer', usage: { input_tokens: 20, output_tokens: 30 } });
  });
  assert.equal(new Set(bodies).size, 1);
  assert.equal(result.attempts, 3);
  assert.equal(result.rejectedAttempts, 2);
  assert.equal(result.requestId, 'one-completion');
  assert.equal(result.outputTokens, 30);
  assert.equal(JSON.parse(bodies[0]).store, false);
});
test('Meta never retries uncertain outcomes, other errors, or completed answers', async () => {
  const provider = providers({ META_API_KEY: 'test' }).find(p => p.id === 'meta');
  for (const response of [
    () => Response.json({ error: { code: 'model_not_found' }, usage: { output_tokens: 1 } }, { status: 404 }),
    () => Response.json({ error: { code: 'model_not_found' }, id: 'possible-completion' }, { status: 404 }),
    () => Response.json({ error: { code: 'other_error' } }, { status: 404 }),
    () => Response.json({ error: { code: 'server_error' } }, { status: 500 }),
    () => { throw new Error('Connection lost'); },
  ]) {
    let calls = 0;
    await assert.rejects(() => generate(provider, 'prompt', 100, async () => { calls++; return response(); }));
    assert.equal(calls, 1);
  }
  let calls = 0;
  const result = await generate(provider, 'prompt', 100, async () => { calls++; return Response.json({ model: provider.model, output_text: 'invalid portfolio' }); });
  assert.equal(calls, 1);
  assert.equal(result.text, 'invalid portfolio');
  await assert.rejects(() => generate(provider, 'prompt', 100, async () => Response.json({ model: 'muse-spark-1.2-contributor', output_text: 'answer' })), { code: 'provider_model_mismatch' });
});
test('Meta stops after eight definitive model rejections', async () => {
  const provider = providers({ META_API_KEY: 'test' }).find(p => p.id === 'meta');
  let calls = 0;
  await assert.rejects(() => generate(provider, 'prompt', 100, async () => {
    calls++;
    return Response.json({ error: { code: 'model_not_found' } }, { status: 404 });
  }), { code: 'provider_http', status: 404 });
  assert.equal(calls, 8);
});
test('Meta availability probes a model omitted from the catalog before blocking it', async () => {
  const env = { META_API_KEY: 'test', META_RELAY_URL: 'http://meta-relay-live.railway.internal:8080/v1/responses' };
  let calls = 0;
  const check = await checkMetaAvailability(async (url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, 'Bearer test');
    if (calls === 1) {
      assert.equal(String(url), 'http://meta-relay-live.railway.internal:8080/v1/models');
      return { ok: true, json: async () => ({ data: [{ id: 'muse-spark-1.2-contributor' }] }) };
    }
    assert.equal(String(url), env.META_RELAY_URL);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'muse-spark-1.3-contributor');
    assert.equal(body.max_output_tokens, 32768);
    assert.equal(body.reasoning.effort, 'xhigh');
    return { ok: false, status: 404, json: async () => ({ error: { message: 'Model not found' } }) };
  }, env);
  assert.deepEqual(check, { available: false, model: 'muse-spark-1.3-contributor' });
  assert.equal(calls, 2);
  assert.equal((await checkMetaAvailability(async () => ({ ok: true, json: async () => ({ data: [{ id: 'muse-spark-1.3-contributor' }] }) }), env)).available, true);
  let listed = false;
  const falseNegative = await checkMetaAvailability(async () => {
    if (!listed) { listed = true; return { ok: true, json: async () => ({ data: [{ id: 'muse-spark-1.2-contributor' }] }) }; }
    return { ok: true, status: 200, json: async () => ({ id: 'resp_test', status: 'completed', output_text: 'META_OK' }) };
  }, env);
  assert.equal(falseNegative.available, true);
});
test('DeepSeek can request structured JSON output for recruiting', async () => {
  const p = providers({ DEEPSEEK_API_KEY: 'test' }).find(item => item.id === 'deepseek');
  await generate(p, 'rank candidates', 16384, async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.max_tokens, 16384);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ranking":[]}' } }], usage: { prompt_tokens: 20, completion_tokens: 30 } }) };
  }, { responseFormat: { type: 'json_object' } });
});
test('Chat provider content parts are normalized into ranking text', async () => {
  const p = providers({ META_API_KEY: 'test', META_API_URL: 'https://api.meta.ai/v1/chat/completions' }).find(item => item.id === 'meta');
  const result = await generate(p, 'hello', 2048, async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: [{ type: 'output_text', text: '{"ranking":' }, { type: 'output_text', text: '[]}' }] } }], usage: { prompt_tokens: 20, completion_tokens: 30 } }),
  }));
  assert.equal(result.text, '{"ranking":[]}');
});
test('Provider HTTP failures are marked with a stable error code', async () => {
  const p = providers({ DEEPSEEK_API_KEY: 'test' }).find(item => item.id === 'deepseek');
  const warnings = [], oldWarn = console.warn;
  console.warn = value => warnings.push(value);
  await assert.rejects(() => generate(p, 'hello', 2048, async () => ({ ok: false, status: 400, headers: { get: name => name === 'x-request-id' ? 'request-123' : null }, clone: () => ({ json: async () => ({ error: { message: 'unsupported field' } }) }) })), error => {
    assert.equal(error.code, 'provider_http');
    assert.equal(error.status, 400);
    assert.equal(error.requestId, 'request-123');
    assert.match(error.message, /unsupported field/);
    return true;
  });
  console.warn = oldWarn;
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"event":"http_error"/);
  assert.doesNotMatch(warnings[0], /Bearer|hello/);
});
test('Provider transport failures log a safe diagnostic and retain a stable code', async () => {
  const p = providers({ META_API_KEY: 'test' }).find(item => item.id === 'meta');
  const errors = [], oldError = console.error;
  console.error = value => errors.push(value);
  await assert.rejects(() => generate(p, 'SECRET_PROMPT', 64, async () => { throw new TypeError('network unavailable'); }), error => {
    assert.equal(error.code, 'provider_transport');
    assert.match(error.message, /network unavailable/);
    return true;
  });
  console.error = oldError;
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"event":"provider_transport"/);
  assert.doesNotMatch(errors[0], /SECRET_PROMPT|Bearer/);
});
test('Meta diagnostic adds request fields one at a time and never returns response text', async () => {
  const bodies = [];
  const report = await diagnoseMeta(async (url, options) => {
    if (url.endsWith('/v1/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'muse-spark-1.3-contributor' }] }) };
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: `r${bodies.length}`, status: 'completed', output: [{ content: [{ type: 'output_text', text: 'META_OK' }] }], usage: { input_tokens: 12, output_tokens: 8 } }) };
  }, { META_API_KEY: 'test' });
  assert.equal(report.results.length, 4);
  assert.equal(report.modelAvailable, true);
  assert.equal(bodies[0].max_output_tokens, undefined);
  assert.equal(bodies[1].max_output_tokens, 64);
  assert.deepEqual(bodies[2].reasoning, { effort: 'xhigh' });
  assert.equal(bodies[3].store, false);
  assert.equal(report.results[0].textLength, 7);
  assert.equal(JSON.stringify(report).includes('META_OK'), false);
});
test('Meta diagnostic stops before paid probes when the configured model is absent', async () => {
  let calls = 0;
  const report = await diagnoseMeta(async () => { calls++; return { ok: true, status: 200, json: async () => ({ data: [{ id: 'muse-spark-1.3' }] }) }; }, { META_API_KEY: 'test' });
  assert.equal(calls, 1);
  assert.equal(report.modelAvailable, false);
  assert.deepEqual(report.availableModels, ['muse-spark-1.3']);
  assert.deepEqual(report.results, []);
});
test('Meta diagnostic can force one minimal probe when the catalogue omits the model', async () => {
  const bodies = [];
  const report = await diagnoseMeta(async (url, options) => {
    if (url.endsWith('/v1/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'muse-spark-1.2-contributor' }] }) };
    bodies.push(JSON.parse(options.body));
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ error: { message: 'The requested model was not found.' } }) };
  }, { META_API_KEY: 'test' }, { forceProbe: true });
  assert.equal(report.modelAvailable, false);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].model, 'muse-spark-1.3-contributor');
  assert.equal(bodies[0].reasoning, undefined);
  assert.equal(report.results[0].status, 404);
});

test('Muse Spark and GPT-5.6 Luna are retired from new runs; Meta only returns when re-enabled', async () => {
  const { activeProviders, publicProviders } = await import('../src/providers.mjs');
  const env = { OPENAI_API_KEY: 'x', DEEPSEEK_API_KEY: 'x', META_API_KEY: 'x' };
  assert.deepEqual(activeProviders(env).map(p => p.id), ['openai6', 'deepseek', 'mimo', 'anthropic', 'ember']);
  assert.deepEqual(publicProviders(env).map(p => p.id), ['openai6', 'deepseek', 'mimo', 'anthropic', 'ember']);
  const withMeta = activeProviders({ ...env, ALPHAELO_ENABLE_META: 'true' }).map(p => p.id);
  assert.ok(withMeta.includes('meta'));
  assert.ok(!withMeta.includes('openai'));
});

test('GPT-5.6 Luna and GPT-6 Luna run side by side on one OpenAI key', () => {
  const catalog = providers({ OPENAI_API_KEY: 'test' });
  const old = catalog.find(item => item.id === 'openai'), next = catalog.find(item => item.id === 'openai6');
  assert.equal(old.model, 'gpt-5.6-luna');
  assert.equal(old.name, 'GPT-5.6 Luna');
  assert.equal(next.model, 'gpt-6-luna');
  assert.equal(next.name, 'GPT-6 Luna');
  assert.equal(next.inputRate, 0.10);
  assert.equal(next.outputRate, 0.50);
  assert.ok(old.configured && next.configured);
});

test('MiMo uses its chat endpoint with thinking on and no reasoning_effort', async () => {
  const p = providers({ MIMO_API_KEY: 'test' }).find(item => item.id === 'mimo');
  assert.equal(p.configured, true);
  assert.equal(p.model, 'mimo-v2.6-pro');
  const result = await generate(p, 'hello', 4096, async (url, opts) => {
    assert.equal(url, 'https://api.xiaomimimo.com/v1/chat/completions');
    assert.equal(opts.headers.Authorization, 'Bearer test');
    const body = JSON.parse(opts.body);
    assert.deepEqual(body.thinking, { type: 'enabled' });
    assert.equal(body.max_completion_tokens, 4096);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.max_tokens, undefined);
    return { ok: true, json: async () => ({ model: 'mimo-v2.6-pro', choices: [{ message: { content: '{"ok":true}', reasoning_content: 'thinking…' } }], usage: { prompt_tokens: 1000, completion_tokens: 2000 } }) };
  });
  assert.equal(result.text, '{"ok":true}');
  assert.ok(Math.abs(result.estimatedCost - (1000 * 0.435 + 2000 * 0.87) / 1e6) < 1e-12);
});

test('MiMo joins new runs as a fourth model', async () => {
  const { cohortInput } = await import('../src/investing.mjs');
  const parsed = cohortInput.parse({ question: 'x'.repeat(40), models: ['openai', 'deepseek', 'mimo'] });
  assert.deepEqual(parsed.models, ['openai', 'deepseek', 'mimo']);
});

test('Muse Ember runs on the Meta Model API with the Meta key, streamed, at xhigh reasoning', async () => {
  const { providers, generate } = await import('../src/providers.mjs');
  const ember = providers({ META_API_KEY: 'k' }).find(p => p.id === 'ember');
  assert.equal(ember.model, 'muse-ember-1.0');
  assert.equal(ember.configured, true);
  assert.equal(ember.url, 'https://api.meta.ai/v1/responses');
  assert.equal(ember.reasoning, 'xhigh');
  assert.equal(ember.inputRate, 0.10); assert.equal(ember.outputRate, 0.50);
  let sent = null;
  const fetcher = async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ model: 'muse-ember-1.0', output: [{ content: [{ type: 'output_text', text: 'OK' }] }], usage: { input_tokens: 3, output_tokens: 1 } }) }; };
  const r = await generate(ember, 'hi', 64, fetcher);
  assert.equal(r.text, 'OK');
  assert.equal(String(sent.url), 'https://api.meta.ai/v1/responses');
  assert.equal(sent.body.model, 'muse-ember-1.0');
  assert.equal(sent.body.stream, true);
  assert.deepEqual(sent.body.reasoning, { effort: 'xhigh' });
  assert.equal(sent.body.input[0].content[0].text, 'hi');
  const offHost = providers({ META_API_KEY: 'k', EMBER_API_URL: 'https://example.com/v1/responses' }).find(p => p.id === 'ember');
  await assert.rejects(generate(offHost, 'hi', 16, fetcher), /approved Meta API host/);
});
