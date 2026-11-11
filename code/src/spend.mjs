import { providers } from './providers.mjs';

export const EXPERIMENT_LABELS = {
  investing: 'Investing predictions',
  recruiting: 'Recruiting ranking',
  chess: 'Chess',
  other: 'Other provider calls',
};

const RISK_WORDS = { low: 'low-risk', medium: 'medium-risk', high: 'high-risk', standard: 'original' };

export function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e6) / 1e6;
}

export function emptyTotals() {
  return { reserved: 0, estimated: 0, billed: 0, calls: 0, complete: 0, pending: 0, inputTokens: 0, outputTokens: 0 };
}

function addTotals(target, item) {
  target.reserved = roundMoney(target.reserved + item.reserved);
  target.estimated = roundMoney(target.estimated + (item.estimated || 0));
  target.billed = roundMoney(target.billed + item.billed);
  target.calls += 1;
  if (item.state === 'complete') target.complete += 1;
  if (item.state === 'pending') target.pending += 1;
  target.inputTokens += item.inputTokens;
  target.outputTokens += item.outputTokens;
  return target;
}

export function usageFromResponse(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { estimatedCost: null, inputTokens: 0, outputTokens: 0, usageAvailable: false, returnedModel: null, latencyMs: null };
  }
  const estimated = Number(response.estimatedCost);
  const latency = Number(response.latencyMs);
  return {
    estimatedCost: Number.isFinite(estimated) ? roundMoney(estimated) : null,
    inputTokens: Number(response.inputTokens) || 0,
    outputTokens: Number(response.outputTokens) || 0,
    usageAvailable: Boolean(response.usageAvailable),
    returnedModel: typeof response.returnedModel === 'string' ? response.returnedModel : null,
    latencyMs: Number.isFinite(latency) ? latency : null,
  };
}

export function billedCost(state, reserved, usage) {
  if (state === 'complete' && usage?.usageAvailable && usage.estimatedCost != null) return roundMoney(usage.estimatedCost);
  return roundMoney(reserved);
}

export function classifyCall(callKey, { kind, games } = {}) {
  const parts = typeof callKey === 'string' ? callKey.split(':') : [];
  const type = parts[1];
  const rest = parts.slice(2);
  if (type === 'chess') {
    const gameIndex = Number(rest[0]);
    const ply = Number(rest[1]);
    const game = Number.isInteger(gameIndex) ? games?.[gameIndex] : null;
    const white = game?.white || 'white';
    const black = game?.black || 'black';
    const rated = game?.rated;
    const kindLabel = rated === false ? 'Smoke' : rated === true ? 'Rated' : 'Chess';
    const gameNo = Number.isInteger(gameIndex) ? gameIndex + 1 : '?';
    const moveNo = Number.isInteger(ply) ? ply + 1 : '?';
    return {
      experiment: 'chess',
      label: `${kindLabel} game ${gameNo} · ${white} vs ${black} · move ${moveNo}`,
      gameIndex: Number.isInteger(gameIndex) ? gameIndex : undefined,
      ply: Number.isInteger(ply) ? ply : undefined,
      rated: typeof rated === 'boolean' ? rated : undefined,
      white: game?.white,
      black: game?.black,
    };
  }
  if (type === 'sandbox') {
    const attempt = Number(rest[1]);
    return { experiment: 'sandbox', label: `Sandbox · ${rest[0] || 'model'} · attempt ${Number.isInteger(attempt) ? attempt : '?'}` };
  }
  if (type === 'structures') {
    const attempt = Number(rest[1]);
    return { experiment: 'structures', label: `Lightest Structure · ${rest[0] || 'model'} · attempt ${Number.isInteger(attempt) ? attempt : '?'}` };
  }
  if (type === 'recruiting') {
    return { experiment: 'recruiting', label: 'Candidate ranking · one prompt covering the role and all six CVs' };
  }
  if (type === 'investing') {
    const horizonMonths = Number(rest[1]);
    return {
      experiment: 'investing',
      label: Number.isInteger(horizonMonths) ? `${horizonMonths}-month research-packet portfolio` : 'Investing prediction',
      horizonMonths: Number.isInteger(horizonMonths) ? horizonMonths : undefined,
    };
  }
  if (type === 'one-shot') {
    if (rest.length >= 3) {
      const horizonMonths = Number(rest[1]);
      const riskLevel = rest[2];
      const riskWord = RISK_WORDS[riskLevel] || riskLevel;
      return {
        experiment: 'investing',
        label: `${Number.isInteger(horizonMonths) ? `${horizonMonths}-month ${riskWord} portfolio` : `Focused ${riskWord || 'portfolio'} prompt`}${rest[3] === 'fix' ? ' · format correction' : rest[3] === 'plain' ? ' · without JSON mode' : rest[3] === 'retry' ? ' · retry after server error' : ''}`,
        horizonMonths: Number.isInteger(horizonMonths) ? horizonMonths : undefined,
        riskLevel,
      };
    }
    if (kind === 'recruiting-once') return { experiment: 'recruiting', label: 'Candidate ranking · one shared prompt' };
    return { experiment: 'investing', label: 'Single shared-question portfolio (legacy one-shot)' };
  }
  if (kind === 'chess') return { experiment: 'chess', label: 'Chess provider request' };
  if (kind === 'recruiting-once') return { experiment: 'recruiting', label: 'Recruiting provider request' };
  if (kind === 'investing-once' || kind === 'investing') return { experiment: 'investing', label: 'Investing provider request' };
  return { experiment: 'other', label: 'Provider request' };
}

function itemFromRow(row) {
  const usage = usageFromResponse(row.usage || row.response);
  const reserved = roundMoney(row.reserved);
  const classified = classifyCall(row.call_key || row.callKey, { kind: row.kind, games: row.games });
  const source = row.state === 'complete' && usage.usageAvailable && usage.estimatedCost != null ? 'usage' : 'reservation';
  return {
    id: row.id,
    runId: row.run_id || row.runId || null,
    provider: row.provider,
    state: row.state,
    reserved,
    estimated: usage.estimatedCost,
    billed: billedCost(row.state, reserved, usage),
    source,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    usageAvailable: usage.usageAvailable,
    returnedModel: usage.returnedModel,
    latencyMs: usage.latencyMs,
    createdAt: row.created_at || row.createdAt || null,
    experiment: classified.experiment,
    label: classified.label,
    horizonMonths: classified.horizonMonths,
    riskLevel: classified.riskLevel,
    gameIndex: classified.gameIndex,
    ply: classified.ply,
    rated: classified.rated,
    white: classified.white,
    black: classified.black,
  };
}

function rateCard(provider) {
  return {
    id: provider.id,
    name: provider.name,
    model: provider.model,
    inputRate: provider.inputRate,
    outputRate: provider.outputRate,
    unit: 'USD per 1M tokens',
    note: `Usage estimate = (input tokens × $${Number(provider.inputRate).toFixed(2)} + output tokens × $${Number(provider.outputRate).toFixed(2)}) / 1,000,000. Not an invoice.`,
  };
}

export function summarizeSpend(rows = [], catalog = providers()) {
  const items = rows.map(itemFromRow);
  const totals = emptyTotals();
  const byExperiment = { investing: emptyTotals(), recruiting: emptyTotals(), chess: emptyTotals(), sandbox: emptyTotals(), structures: emptyTotals(), other: emptyTotals() };
  const byProvider = {};
  for (const provider of catalog) byProvider[provider.id] = { id: provider.id, name: provider.name, model: provider.model, ...emptyTotals() };
  for (const item of items) {
    addTotals(totals, item);
    addTotals(byExperiment[item.experiment] || (byExperiment[item.experiment] = emptyTotals()), item);
    if (!byProvider[item.provider]) byProvider[item.provider] = { id: item.provider, name: item.provider, model: item.returnedModel, ...emptyTotals() };
    addTotals(byProvider[item.provider], item);
  }
  return {
    disclaimer: 'These figures are conservative lab estimates from recorded token usage and pre-call reservations. They are not provider invoices.',
    rates: catalog.map(rateCard),
    localEngines: [{ id: 'maia3', name: 'Maia-3', billed: 0, note: 'Local UCI engine. Chess moves it plays do not create a provider API bill.' }],
    outsideLedger: [
      { id: 'eodhd', name: 'EODHD market data', note: 'The frozen investing packet and daily adjusted-close jobs use a separate market-data subscription. Those HTTP calls are not LLM tokens and are not summed here.' },
      { id: 'hosting', name: 'Railway and site hosting', note: 'Always-on backend compute, Postgres, and the ChatGPT Site are billed by those hosts, not by this call ledger.' },
    ],
    notes: [
      'There is no in-app spending cap; each provider API key carries its own spending limit. A conservative reservation is still recorded before each call so a missing usage block cannot understate spend.',
      'When a completed call reports token usage, the usage estimate is what this page treats as the cost of that call.',
      'Failed or uncertain calls keep their reservation. There is no silent retry, so a malformed answer still appears as a paid attempt.',
      'Maia-3 is local. EODHD and hosting are outside this ledger.',
    ],
    totals,
    byExperiment,
    byProvider,
    items,
  };
}
