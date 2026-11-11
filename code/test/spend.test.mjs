import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCall, billedCost, usageFromResponse, summarizeSpend, roundMoney } from '../src/spend.mjs';
import { providers } from '../src/providers.mjs';

const catalog = providers({ OPENAI_API_KEY: 'x', DEEPSEEK_API_KEY: 'x', META_API_KEY: 'x' });
const runId = '11111111-1111-1111-1111-111111111111';

test('call keys name the experiment and the exact paid task', () => {
  const focused = classifyCall(`${runId}:one-shot:openai:12:medium`);
  assert.equal(focused.experiment, 'investing');
  assert.equal(focused.horizonMonths, 12);
  assert.equal(focused.riskLevel, 'medium');
  assert.match(focused.label, /12-month medium-risk portfolio/);

  const ranking = classifyCall(`${runId}:recruiting:deepseek`);
  assert.equal(ranking.experiment, 'recruiting');
  assert.match(ranking.label, /six CVs/);

  const games = [{ white: 'openai', black: 'maia3', rated: true }];
  const move = classifyCall(`${runId}:chess:0:3`, { kind: 'chess', games });
  assert.equal(move.experiment, 'chess');
  assert.equal(move.gameIndex, 0);
  assert.equal(move.ply, 3);
  assert.equal(move.label, 'Rated game 1 · openai vs maia3 · move 4');

  const legacy = classifyCall(`${runId}:one-shot:meta`, { kind: 'investing-once' });
  assert.equal(legacy.experiment, 'investing');
  assert.match(legacy.label, /legacy/);
});

test('usage estimate is the billed cost when tokens exist; otherwise the reservation is kept', () => {
  const usage = usageFromResponse({ estimatedCost: 0.0123456, inputTokens: 100, outputTokens: 50, usageAvailable: true, text: 'secret ranking' });
  assert.equal(usage.estimatedCost, 0.012346);
  assert.equal(billedCost('complete', 0.05, usage), 0.012346);
  assert.equal(billedCost('pending', 0.05, usage), 0.05);
  assert.equal(billedCost('complete', 0.04, { usageAvailable: false, estimatedCost: null }), 0.04);
  assert.equal(usageFromResponse({ text: 'no meters' }).usageAvailable, false);
});

test('project ledger itemizes every model and never copies prompt or answer text', () => {
  const rows = [
    { id: 'a', run_id: runId, provider: 'openai', call_key: `${runId}:one-shot:openai:3:low`, state: 'complete', reserved: 0.04, created_at: '2026-09-18T10:00:00.000Z', kind: 'investing-once', usage: { estimatedCost: 0.011, inputTokens: 2000, outputTokens: 800, usageAvailable: true, returnedModel: 'gpt-5.6-luna', text: 'PORTFOLIO_SECRET' }, prompt: 'CV_TEXT_SECRET' },
    { id: 'b', run_id: runId, provider: 'deepseek', call_key: `${runId}:one-shot:deepseek:3:low`, state: 'complete', reserved: 0.05, created_at: '2026-09-18T10:01:00.000Z', kind: 'investing-once', response: { estimatedCost: 0.009, inputTokens: 1800, outputTokens: 400, usageAvailable: true, returnedModel: 'deepseek-flash' } },
    { id: 'c', run_id: '22222222-2222-2222-2222-222222222222', provider: 'meta', call_key: '22222222-2222-2222-2222-222222222222:recruiting:meta', state: 'complete', reserved: 0.08, created_at: '2026-09-18T10:02:00.000Z', kind: 'recruiting-once', usage: { estimatedCost: 0.03, inputTokens: 9000, outputTokens: 1200, usageAvailable: true, returnedModel: 'muse-spark-1.3' } },
    { id: 'd', run_id: '33333333-3333-3333-3333-333333333333', provider: 'openai', call_key: '33333333-3333-3333-3333-333333333333:chess:0:0', state: 'pending', reserved: 0.02, created_at: '2026-09-18T10:03:00.000Z', kind: 'chess', games: [{ white: 'openai', black: 'maia3', rated: false }] },
  ];
  const spend = summarizeSpend(rows, catalog);
  assert.equal(spend.totals.calls, 4);
  assert.equal(spend.totals.pending, 1);
  assert.equal(spend.totals.billed, roundMoney(0.011 + 0.009 + 0.03 + 0.02));
  assert.equal(spend.byExperiment.investing.calls, 2);
  assert.equal(spend.byExperiment.recruiting.billed, 0.03);
  assert.equal(spend.byExperiment.chess.billed, 0.02);
  assert.equal(spend.byProvider.openai.calls, 2);
  assert.equal(spend.byProvider.deepseek.billed, 0.009);
  assert.equal(spend.byProvider.meta.billed, 0.03);
  assert.equal(spend.items[0].label, '3-month low-risk portfolio');
  assert.equal(spend.items[0].source, 'usage');
  assert.equal(spend.items[3].source, 'reservation');
  assert.equal(spend.items[3].label, 'Smoke game 1 · openai vs maia3 · move 1');
  const blob = JSON.stringify(spend);
  assert.equal(blob.includes('PORTFOLIO_SECRET'), false);
  assert.equal(blob.includes('CV_TEXT_SECRET'), false);
  assert.equal(blob.includes('secret ranking'), false);
  assert.ok(spend.items.every(item => !('prompt' in item) && !('text' in item) && !('response' in item)));
  assert.equal(spend.localEngines[0].billed, 0);
  assert.ok(spend.rates.find(r => r.id === 'openai').note.includes('1,000,000'));
});

test('empty ledger still explains published rates and non-LLM costs', () => {
  const spend = summarizeSpend([], catalog);
  assert.equal(spend.totals.billed, 0);
  assert.equal(spend.items.length, 0);
  assert.equal(spend.rates.length, 7);
  assert.ok(spend.outsideLedger.some(row => row.id === 'eodhd'));
});
