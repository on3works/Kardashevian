import { MODEL_IDS } from './protocol.mjs';
import { z } from 'zod';
import { HORIZONS, addMonths } from './protocol.mjs';

export const DEFAULT_QUESTION = `You are taking part in AlphaElo, a paper research experiment about whether language models can predict the future. This is not financial advice and no real money will be invested. Your answer to this focused horizon-and-risk question will be sealed and observed over time. Do not recommend trades, brokerage actions or rebalancing.

Objective
Construct one long-only, buy-and-hold value-investing portfolio for the target horizon and risk objective supplied with this question, using publicly traded US-listed stocks or ETFs and, when justified, spot crypto pairs. The point is to compare the quality, calibration and reasoning of predictions, not to maximize a simulated account balance. A portfolio that is sensible for three months may be very different from one intended for two years; make that difference explicit.

World theses come first
This is value investing from a view of the world, not a pile of isolated stock stories. Before naming holdings, state one or more explicit theses about the world or the whole economy — for example inflation and real rates, growth and recession risk, fiscal and industrial policy, energy and commodity regimes, demographics, geopolitics, market structure, or the monetary system. A portfolio may express more than one thesis. Each thesis must have a short title, a falsifiable claim about the world rather than about one company, and a description of how this portfolio expresses that claim. The reader must be able to see the world view without opening a holding. Do not justify a position only with company-specific narrative. For every holding, name which world thesis it applies and explain how that world view, at this quality and price, makes the holding belong here. If two theses pull in different directions, say so and show how the weights resolve the tension. Cash is also an expression of a world view, such as dry powder in an expensive or fragile regime, not a leftover.

Information boundary
Use only the frozen market snapshot supplied with this prompt and your general knowledge available at the packet cutoff. Do not browse, call tools or use information that becomes available after the packet cutoff. Do not invent a current price, valuation multiple, earnings figure, news event or fact you cannot verify. State your knowledge limitations and uncertainty clearly. Use EODHD-style symbols ending in .US for US-listed securities, such as AAPL.US, BRK-B.US or SPY.US, and .CC for crypto pairs, such as BTC-USD.CC or ETH-USD.CC. Choose only instruments included in the supplied snapshot; if you are uncertain, say so rather than fabricating a symbol.

Frozen market snapshot
The packet contains the latest completed daily adjusted close through its cutoff date, three- and twelve-month price returns, and the trailing 52-week high and low for every candidate instrument. Prices are research inputs, not live execution quotes. Use the packet's price and date when discussing value; do not substitute a newer price from memory.

Risk objectives
1. Low risk: for each horizon, prioritize capital preservation and smaller drawdowns. Prefer diversified, defensive or financially resilient exposures and use cash when it improves resilience. Avoid concentrated speculative bets. Estimate the maximum peak-to-trough decline during that portfolio’s target period and explain why the allocation fits this objective.
2. Medium risk: for each horizon, balance upside with resilience. Use diversified value opportunities and accept meaningful market fluctuations without depending on one speculative outcome. Estimate the target-period maximum drawdown and explain the trade-off between upside and resilience.
3. High risk: for each horizon, prioritize substantial upside from uncertain, contrarian or concentrated value opportunities. Larger losses and drawdowns are acceptable, but describe the downside honestly and identify the assumptions on which the world thesis depends. Estimate the target-period maximum drawdown.

Portfolio construction rules
Create one portfolio for the requested horizon and risk objective. You may hold anywhere from zero to one hundred stocks, ETFs or spot crypto pairs, plus cash, if that is what your reasoning supports; there is no arbitrary five-holding limit. State every allocation as a percentage of portfolio capital, not as a dollar amount. Each holding must have a positive percentage no greater than 100%; cash may be any percentage from 0% to 100%; percentages must total exactly 100% within the portfolio. Do not use leverage, margin, short positions, options, futures, derivatives, synthetic exposures or crypto lending/staking. Do not rebalance after submission. Cash earns 0% in the benchmark. The same starting index of 100 and the same market-data method will be used for every portfolio.

Reasoning required for every holding
For each selected stock, ETF or crypto pair, explain: (a) what the business or exposure is, (b) which stated world thesis it applies and why that economy-wide view — not a standalone stock story — makes it value at this price, (c) the specific evidence or durable mechanism, (d) what future catalyst or change could unlock the value, (e) what would prove the world thesis or this application wrong, and (f) why the position size belongs in this risk objective. For crypto, discuss the protocol or network exposure as an application of the world thesis, plus relevant adoption, supply or market-structure assumptions. Distinguish facts you know from assumptions you are making. After the world theses, give a short portfolio synthesis, the main risks, correlations or concentration, and why the cash allocation is appropriate.

Forecasts
For each portfolio, forecast the expected total return at its own target horizon: 1, 3, 9, 12 or 24 calendar months. These are forecasts of that same portfolio held without rebalancing; do not give one portfolio for multiple horizons unless you can defend the choice. Use decimal fractions where 0.10 means +10% and -0.20 means -20%. Give a short reason for the target-horizon outcome, including what must happen in the world for it to be plausible. Forecasts may be negative. Avoid false precision and include uncertainty in the written reasoning even though the required numeric field is a single estimate.

Evaluation context
The observation baseline is the frozen market packet's cutoff close for market-aware books, so the performance series starts on the same completed market date the models received. Legacy books without a frozen packet use the first common trading close on or after the UTC day following completion of all model responses. Each portfolio starts at index 100. AlphaElo stores each daily adjusted close it receives and compares fixed-weight portfolio performance with SPY.US. An unfinished market day uses the previous completed US stock close. New sealed books are created only when a human starts a run or on a weekly schedule the human has switched on. Daily price checks never send another prompt. A forecast is scored only when its calendar-month due date has arrived, using the first available trading close on or after that date. The score measures prediction error and direction as well as realized portfolio performance; it is not a claim that any strategy is suitable for a real investor.

Answer discipline
Answer only the requested horizon and risk objective. State the world theses first and keep them visible. Make the allocation deliberate, keep every holding explanation an application of those theses, disclose missing knowledge, and never present the result as a guaranteed outcome. AlphaElo will ask the same model 15 separate, identical-format prompts so each horizon/risk decision can be evaluated independently.`;
export const RISK_LEVELS = ['low', 'medium', 'high'];
// investing-v8 adds a 1-month horizon so each book produces fully scored
// results within about five weeks. v5–v7 books keep their 4 × 3 matrix.
export const INVESTING_HORIZONS = [1, 3, 9, 12, 24];
export const LEGACY_MATRIX_HORIZONS = [3, 9, 12, 24];
export const MATRIX_PROTOCOLS = ['investing-v5', 'investing-v6', 'investing-v7', 'investing-v8'];
export const MARKET_AWARE_PROTOCOLS = ['investing-v6', 'investing-v7', 'investing-v8'];
export const INVESTING_PROTOCOL = 'investing-v8';
export const INVESTING_SCHEDULE = 'Manual LLM runs, plus an optional weekly book on Tuesdays after 07:00 UTC when switched on. Price checks start after 06:00 UTC for the previous completed US stock close; an unfinished market day is never treated as a close. Late uploads can repair incomplete checks. The daily job never prompts models.';
export const LEGACY_PACKET_INVESTING_RETIRED = 'Legacy packet investing is retired. Start a manual book from the desk; daily jobs only update prices.';
export function isMatrixProtocol(protocol) { return MATRIX_PROTOCOLS.includes(protocol); }
export function isMarketAwareProtocol(protocol) { return MARKET_AWARE_PROTOCOLS.includes(protocol); }
// Every model gets the largest output its API allows that all of them share
// (128k, the same ceiling as Sandbox and Structures). It was 32k until
// 19 Oct; models cannot see how many tokens they have used, so a tight
// ceiling scored running out rather than forecasting. Meta (retired) keeps
// the 16k it was tested with.
export const INVESTING_MAX_OUTPUT_TOKENS = 128000;
export function investingMaxOutputTokens(provider) {
  const id = typeof provider === 'string' ? provider : provider?.id;
  return id === 'meta' ? 16384 : INVESTING_MAX_OUTPUT_TOKENS;
}
export const RISK_DEFINITIONS = {
  low: 'Prioritize capital preservation and smaller drawdowns. Favor diversified, defensive exposures and cash where justified; avoid concentrated speculative bets.',
  medium: 'Balance upside with resilience. Use diversified value opportunities, accepting meaningful market fluctuations without relying on one speculative outcome.',
  high: 'Prioritize substantial upside from uncertain or contrarian value opportunities. Concentration and large drawdowns are acceptable; explain the downside explicitly.',
};
export const cohortInput = z.object({ question: z.string().trim().min(30).max(16000), models: z.array(z.enum(MODEL_IDS)).min(1).max(5).refine(a => new Set(a).size === a.length) }).strict();
const detail = z.string().trim().min(10).max(4000);
const instrumentSymbol = /^[A-Z0-9][A-Z0-9-]{0,14}\.(?:US|CC)$/;
const thesisId = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/);
export const worldThesisInput = z.object({
  id: thesisId,
  title: z.string().trim().min(4).max(140),
  worldView: detail,
  portfolioExpression: detail,
}).strict();
const worldTheses = z.array(worldThesisInput).min(1).max(6);
const holdingInput = z.object({
  symbol: z.string().regex(instrumentSymbol), name: z.string().min(1).max(120),
  weight: z.number().positive().max(1), thesis: detail, catalyst: detail, invalidation: detail,
  appliesThesisIds: z.array(thesisId).max(6).optional(),
}).strict();
const strategyHoldingInput = holdingInput.extend({ appliesThesisIds: z.array(thesisId).min(1).max(6) });
function refineTheses(p, ctx) {
  if (!p.theses?.length) return;
  const ids = new Set(p.theses.map(t => t.id));
  if (ids.size !== p.theses.length) ctx.addIssue({ code: 'custom', message: 'Thesis ids must be unique' });
  for (const position of p.positions) {
    if ((position.appliesThesisIds || []).some(id => !ids.has(id))) ctx.addIssue({ code: 'custom', message: `Holding ${position.symbol} cites an unknown world thesis` });
  }
}
export const portfolioInput = z.object({
  thesis: detail, risks: detail, knowledgeLimitations: detail,
  theses: worldTheses.optional(),
  cashWeight: z.number().min(0).max(1),
  positions: z.array(holdingInput).max(100),
  forecasts: z.array(z.object({ months: z.number().int(), expectedReturn: z.number().min(-1).max(100), reason: detail }).strict()).length(6),
}).strict().superRefine((p, ctx) => {
  if (Math.abs(p.cashWeight + p.positions.reduce((s, a) => s + a.weight, 0) - 1) > 0.00001) ctx.addIssue({ code: 'custom', message: 'Weights including cash must total 100%' });
  if (new Set(p.positions.map(a => a.symbol)).size !== p.positions.length) ctx.addIssue({ code: 'custom', message: 'Duplicate holdings' });
  if (HORIZONS.some(m => p.forecasts.filter(f => f.months === m).length !== 1)) ctx.addIssue({ code: 'custom', message: 'Provide exactly one forecast for each horizon' });
  refineTheses(p, ctx);
});

const strategyPickInput = z.object({
  thesis: detail, risks: detail, knowledgeLimitations: detail,
  theses: worldTheses,
  cashWeight: z.number().min(0).max(1),
  positions: z.array(strategyHoldingInput).max(100),
  forecasts: z.array(z.object({ months: z.number().int(), expectedReturn: z.number().min(-1).max(100), reason: detail }).strict()).length(1),
}).strict().superRefine((p, ctx) => {
  if (Math.abs(p.cashWeight + p.positions.reduce((s, a) => s + a.weight, 0) - 1) > 0.00001) ctx.addIssue({ code: 'custom', message: 'Weights including cash must total 100%' });
  if (new Set(p.positions.map(a => a.symbol)).size !== p.positions.length) ctx.addIssue({ code: 'custom', message: 'Duplicate holdings' });
  if (!INVESTING_HORIZONS.includes(p.forecasts[0]?.months)) ctx.addIssue({ code: 'custom', message: 'Provide one forecast at the selected horizon' });
  refineTheses(p, ctx);
});

const strategyOutput = z.object({
  horizonMonths: z.number().int().refine(m => INVESTING_HORIZONS.includes(m), 'Horizon must be 1, 3, 9, 12 or 24 months'),
  riskLevel: z.enum(RISK_LEVELS), riskRationale: detail,
  expectedMaxDrawdown: z.number().min(0).max(1), pick: strategyPickInput,
}).strict();
export const singleStrategyResponseInput = strategyOutput;
export const strategyResponseInput = z.object({ strategies: z.array(strategyOutput).length(12) }).strict()
  .refine(r => LEGACY_MATRIX_HORIZONS.every(horizon => RISK_LEVELS.every(level => r.strategies.filter(s => s.horizonMonths === horizon && s.riskLevel === level).length === 1)), 'Exactly one portfolio is required for every horizon and risk level')
  .refine(r => new Set(r.strategies.map(s => `${s.horizonMonths}:${s.riskLevel}`)).size === 12, 'Horizon and risk combinations must be unique');

// Kept only so an older sealed cohort can still be displayed and scored after
// the benchmark expands from three risk portfolios to the horizon × risk matrix.
export const legacyStrategyResponseInput = z.object({ strategies: z.array(z.object({
  riskLevel: z.enum(RISK_LEVELS), riskRationale: detail,
  expectedMaxDrawdown: z.number().min(0).max(1), pick: portfolioInput,
}).strict()).length(3) }).strict()
  .refine(r => RISK_LEVELS.every(level => r.strategies.filter(s => s.riskLevel === level).length === 1), 'Exactly one low, medium and high risk strategy is required');

// Providers occasionally wrap valid JSON in a markdown fence or a short
// preamble. Strip only that transport noise; schema validation remains strict.
// Some chat models (MiMo) put their reasoning in the reply itself, inside a
// <think>…</think> block that may contain braces of its own. Drop that block,
// then prefer a fenced JSON block, then the whole reply, then the last
// complete top-level JSON object in the text.
export function stripThinking(text) {
  const closed = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const lastClose = closed.toLowerCase().lastIndexOf('</think>');
  return (lastClose >= 0 ? closed.slice(lastClose + 8) : closed).trim();
}
function jsonObjectsIn(text) {
  const found = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0, inString = false, escaped = false, end = -1;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { end = j; break; }
    }
    if (end < 0) continue;
    try { found.push(JSON.parse(text.slice(i, end + 1))); i = end; } catch { /* not JSON; keep scanning inside */ }
  }
  return found;
}
function extractInvestingJson(text) {
  const body = stripThinking(text);
  const fenced = [...body.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/gi)].map(m => m[1].trim()).reverse();
  for (const candidate of [...fenced, body]) { try { return JSON.parse(candidate); } catch { /* try the next shape */ } }
  const objects = jsonObjectsIn(body);
  const shaped = objects.filter(o => o && typeof o === 'object' && ('pick' in o || 'strategies' in o));
  const value = shaped.at(-1) || objects.at(-1);
  if (!value) throw new Error('Model response did not contain a JSON object');
  return value;
}
// Forgive harmless format slips (decided 28 Sep 2026): extra fields a model
// adds on its own are dropped, and world theses placed beside the pick
// instead of inside it are moved in. Nothing is invented: a missing, empty
// or too-short required field still fails validation, as does broken JSON.
const KEEP = {
  strategy: ['horizonMonths', 'riskLevel', 'riskRationale', 'expectedMaxDrawdown', 'pick'],
  pick: ['thesis', 'risks', 'knowledgeLimitations', 'theses', 'cashWeight', 'positions', 'forecasts'],
  position: ['symbol', 'name', 'weight', 'thesis', 'catalyst', 'invalidation', 'appliesThesisIds'],
  thesis: ['id', 'title', 'worldView', 'portfolioExpression'],
  forecast: ['months', 'expectedReturn', 'reason'],
};
const only = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) ? Object.fromEntries(keys.filter(k => k in object).map(k => [k, object[k]])) : object;
export function normalizeStrategyShape(strategy) {
  if (!strategy || typeof strategy !== 'object' || Array.isArray(strategy) || !strategy.pick || typeof strategy.pick !== 'object') return strategy;
  const pick = { ...strategy.pick };
  if (pick.theses === undefined && Array.isArray(strategy.theses)) pick.theses = strategy.theses;
  const out = only(strategy, KEEP.strategy);
  out.pick = only(pick, KEEP.pick);
  if (Array.isArray(out.pick.positions)) out.pick.positions = out.pick.positions.map(p => only(p, KEEP.position));
  if (Array.isArray(out.pick.theses)) out.pick.theses = out.pick.theses.map(t => only(t, KEEP.thesis));
  if (Array.isArray(out.pick.forecasts)) out.pick.forecasts = out.pick.forecasts.map(f => only(f, KEEP.forecast));
  return out;
}
// Plain-language reason a saved reply could not be used, for the book page.
export function describeInvestingFailure(error) {
  const issues = Array.isArray(error?.issues) ? error.issues : null;
  if (!issues) {
    const m = String(error?.message || error || '');
    if (/JSON|Unexpected token|Unterminated|Expected|did not contain/i.test(m)) return 'The reply is not valid JSON (it is cut off or has a syntax error), so no portfolio could be read from it.';
    if (/target|horizon and risk/i.test(m)) return 'The reply answered a different horizon or risk level than the one asked.';
    if (/outside the frozen market snapshot|snapshot/i.test(m)) return 'The portfolio picked an instrument that is not in the market snapshot.';
    if (/Empty model response/i.test(m)) return 'The reply was empty.';
    return m.slice(0, 240) || 'The reply did not match the portfolio format.';
  }
  const parts = [];
  for (const issue of issues.slice(0, 3)) {
    const field = issue.path?.length ? `\`${issue.path.join('.')}\`` : 'The portfolio';
    if (/Weights including cash/i.test(issue.message)) parts.push('Holding weights plus cash do not add up to 100%.');
    else if (issue.code === 'too_small' && issue.type === 'string') parts.push(`${field} is too short (at least ${issue.minimum} characters are required).`);
    else if (issue.code === 'invalid_type' && issue.received === 'undefined') parts.push(`${field} is missing.`);
    else parts.push(`${field}: ${issue.message}.`);
  }
  if (issues.length > 3) parts.push(`${issues.length - 3} more problem${issues.length - 3 === 1 ? '' : 's'}.`);
  return [...new Set(parts)].join(' ');
}
export function parseInvestingJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty model response');
  let value = extractInvestingJson(text);
  // Meta occasionally emits a numbered spelling of this one field while
  // otherwise returning a complete portfolio. Repair only this unambiguous
  // alias; other extra keys are then dropped below.
  const strategies = Array.isArray(value?.strategies) ? value.strategies : [value];
  for (const strategy of strategies) for (const position of strategy?.pick?.positions || []) {
    if (position.invalidation === undefined && typeof position.invalidation2 === 'string') {
      position.invalidation = position.invalidation2;
      delete position.invalidation2;
    }
  }
  if (Array.isArray(value?.strategies)) value = { ...value, strategies: value.strategies.map(s => normalizeStrategyShape(s)) };
  else value = normalizeStrategyShape(value);
  return value;
}

// Existing sealed single-portfolio experiments retain their original identity.
export function portfolioStrategies(document) {
  return document.strategies || (document.pick ? [{ riskLevel: 'standard', pick: document.pick }] : []);
}

export const cohortTasks = INVESTING_HORIZONS.flatMap(horizonMonths => RISK_LEVELS.map(riskLevel => ({ horizonMonths, riskLevel })));
export function cohortPrompt(question, asOf, horizonMonths, riskLevel, marketSnapshot = null) {
  const target = horizonMonths && riskLevel ? `Target: ${horizonMonths} calendar months, ${riskLevel} risk.` : 'Target: the caller must supply one horizon/risk task.';
  const marketContext = marketSnapshot ? JSON.stringify(marketSnapshot) : '{"status":"market snapshot will be attached before model generation"}';
  return `AlphaElo forecast benchmark v8 (market-aware, world-thesis). Reference timestamp: ${asOf}.
This is ONE of ${cohortTasks.length} independent prompts sent to the same model. No real money is invested. Build one sealed prediction for the target below; there will be no follow-up question, browsing, trading or rebalancing.
${target}
This is a market-aware, knowledge-only experiment. Use only the frozen market snapshot below; do not browse, call tools or use information that becomes available after its cutoff. Do not invent current prices, valuation multiples, earnings figures, news or facts you cannot verify. Disclose knowledge limitations and uncertainty. Use only the supplied symbols ending in .US for US-listed securities or .CC for crypto pairs, such as AAPL.US, BRK-B.US, SPY.US, BTC-USD.CC or ETH-USD.CC.

Frozen market snapshot (identical for every model and every prompt in this cohort)
${marketContext}

Risk objective definitions (objectives, not guarantees):
${RISK_LEVELS.map(level => `${level}: ${RISK_DEFINITIONS[level]}`).join('\n')}

World theses
This is value investing from a view of the world, not isolated stock picking. First state one or more named theses about the world or the whole economy. Each thesis needs an id, a short title, a falsifiable worldView, and portfolioExpression describing how this book applies it. A portfolio may have more than one thesis; they must be explicit enough that a reader can see the world view before reading any holding. Every holding must cite at least one thesis id in appliesThesisIds and explain the holding as an application of that world view at this price, not as a standalone company story. Cash is also an expression of a world thesis.

Portfolio rules
Choose any number of valid US-listed stocks or ETFs, or spot crypto pairs, from zero up to 100 holdings, plus cash, if that is what the reasoning supports. There is no arbitrary five-holding limit. Allocate by percentage of portfolio capital, never by dollars. In the JSON, weights are decimal percentages of capital: 0.125 means 12.5%. Positive holding weights plus cashWeight must total exactly 1. Do not use leverage, margin, short positions, options, futures, derivatives, synthetic exposures or crypto lending/staking. Hold the portfolio fixed until the target horizon. Cash earns 0%. The portfolio starts at index 100 and is compared with SPY.US using daily adjusted-close history.

Reasoning required
Put world theses first. Then explain the short portfolio synthesis, the main risks, concentration and correlations, and why its cash percentage fits the target risk and horizon. For every holding explain what the business or exposure is, which world thesis it applies, why that economy-wide view makes it value at this price, the evidence or durable mechanism, a possible catalyst, what would prove the thesis wrong, and why its percentage belongs in this portfolio. Distinguish known facts from assumptions. Estimate maximum peak-to-trough drawdown during the target period as a positive fraction.

Forecast
Give one expected total-return forecast at the target horizon only. Use a decimal fraction where 0.10 means +10% and -0.20 means -20%. Give a short reason for what must happen in the world for the forecast to be plausible; do not claim certainty.

Return only JSON, without markdown, shaped exactly as:
{"horizonMonths":${horizonMonths || 3},"riskLevel":"${riskLevel || 'low'}","riskRationale":"why this allocation fits the requested risk and horizon","expectedMaxDrawdown":0.15,"pick":{"theses":[{"id":"restrictive-real-rates","title":"Real rates stay restrictive","worldView":"A falsifiable claim about the world or the whole economy, not about one stock","portfolioExpression":"How this portfolio expresses that world view"}],"thesis":"Short synthesis of the world theses","risks":"portfolio risks","knowledgeLimitations":"what you cannot verify","cashWeight":0.2,"positions":[{"symbol":"AAPL.US","name":"Apple","weight":0.8,"appliesThesisIds":["restrictive-real-rates"],"thesis":"How this holding applies the world thesis at this price","catalyst":"what unlocks value","invalidation":"what proves the world thesis or this application wrong"}],"forecasts":[{"months":${horizonMonths || 3},"expectedReturn":0.1,"reason":"why this target-horizon outcome is plausible in that world"}]}}
The returned horizonMonths, riskLevel and forecast months must match the target exactly.
Before you answer, check the format; a reply that breaks any of these rules is discarded:
- One strictly valid JSON object: double quotes, no comments, no trailing commas, nothing before or after it.
- Use only the keys shown above, in the places shown. Put any extra reasoning inside the existing text fields.
- Holding weights plus cashWeight must add up to exactly 1. Add them up before answering.
- Every text field is at least one full sentence.

Shared research question:
${question}`;
}

export function cohortPrompts(question, asOf, marketSnapshot = null) {
  return cohortTasks.map(task => ({ ...task, prompt: cohortPrompt(question, asOf, task.horizonMonths, task.riskLevel, marketSnapshot) }));
}

export const dateKey = value => new Date(value).toISOString().slice(0, 10);
export function snapshotDay(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
// Older daily snapshots were written before horizonMonths was included in the
// score identity. Recover that identity at read time from the sealed strategy
// order, without mutating immutable evidence rows. Matrix strategies are
// emitted in horizon × risk order, so the risk-specific order is unambiguous.
export function hydrateSnapshotIdentity(document, sealedPortfolios = []) {
  if (!document?.portfolios?.length) return document;
  const byProvider = new Map(sealedPortfolios.map(row => [row.provider, row.document ? portfolioStrategies(row.document).filter(strategy => strategy.horizonMonths) : []]));
  const seen = new Map();
  const portfolios = document.portfolios.map(score => {
    if (score.horizonMonths != null || !score.provider || score.riskLevel === 'standard') return score;
    const strategies = (byProvider.get(score.provider) || []).filter(strategy => strategy.riskLevel === score.riskLevel);
    const index = seen.get(`${score.provider}:${score.riskLevel}`) || 0;
    const strategy = strategies[index];
    seen.set(`${score.provider}:${score.riskLevel}`, index + 1);
    return strategy ? { ...score, horizonMonths: strategy.horizonMonths, identityRecovered: true } : score;
  });
  return { ...document, portfolios };
}
export function assembleCohorts(runs, portfolios, snapshots, corrections = []) {
  return runs.map(run => {
    const runPortfolios = portfolios.filter(p => p.run_id === run.id);
    const byDay = new Map(snapshots.filter(s => s.run_id === run.id).map(s => [snapshotDay(s.day), s.document]));
    for (const correction of corrections.filter(s => s.run_id === run.id)) byDay.set(snapshotDay(correction.day), correction.document);
    const history = [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, document]) => ({ day, document: hydrateSnapshotIdentity(document, runPortfolios) }));
    return { ...run, portfolios: runPortfolios, snapshots: history, snapshot: history.at(-1)?.document || null };
  });
}
export function mergeRecoveredPortfolios(portfolios, recoveries = []) {
  const recovered = new Map(recoveries.map(row => [`${row.run_id}:${row.provider}`, row]));
  return portfolios.map(row => recovered.has(`${row.run_id}:${row.provider}`)
    ? { ...row, ...recovered.get(`${row.run_id}:${row.provider}`) }
    : row);
}
export function nextDate(value) { return dateKey(new Date(new Date(value).getTime() + 86400000)); }
export function validatePrices(data) {
  if (!Array.isArray(data)) throw new Error('Price provider did not return daily history');
  const rows = data.map(row => z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), adjusted_close: z.number().positive().finite() }).parse(row));
  if (new Set(rows.map(r => r.date)).size !== rows.length) throw new Error('Duplicate price dates');
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

// All ratios use one coherent history response per instrument. Never mix a newly
// dividend-adjusted latest price with an old, differently adjusted baseline.
export function scorePortfolio(pick, histories, startDate, throughDate, baselineDate = null) {
  const symbols = [...new Set(['SPY.US', ...pick.positions.map(p => p.symbol)])];
  if (symbols.some(s => !histories[s]?.length)) return { status: 'missing_prices', message: 'Waiting for complete price history; no partial portfolio score.' };
  const maps = Object.fromEntries(symbols.map(s => [s, new Map(histories[s].filter(r => r.date >= startDate && r.date <= throughDate).map(r => [r.date, r.adjusted_close]))]));
  const dates = [...maps['SPY.US'].keys()].sort().filter(d => symbols.every(s => maps[s].has(d)));
  const baseline = baselineDate || dates[0];
  if (!baseline || symbols.some(s => !maps[s].has(baseline))) return { status: 'awaiting_baseline', message: 'Waiting for the common first trading close.' };
  const latestMarketDate = [...maps['SPY.US'].keys()].sort().at(-1);
  if (symbols.some(s => !maps[s].has(latestMarketDate))) return { status: 'missing_prices', baseline, message: 'A holding is missing the latest market close; score withheld.' };
  const series = dates.filter(d => d >= baseline).map(date => {
    const value = pick.cashWeight + pick.positions.reduce((sum, p) => sum + p.weight * maps[p.symbol].get(date) / maps[p.symbol].get(baseline), 0);
    return { date, index: value * 100, return: value - 1, benchmarkReturn: maps['SPY.US'].get(date) / maps['SPY.US'].get(baseline) - 1 };
  });
  let peak = 100, maxDrawdown = 0;
  for (const point of series) { peak = Math.max(peak, point.index); maxDrawdown = Math.min(maxDrawdown, point.index / peak - 1); }
  const latest = series.at(-1);
  if (!latest) return { status: 'awaiting_baseline', message: 'No scored observations yet.' };
  const forecasts = pick.forecasts.map(f => {
    const due = addMonths(`${baseline}T00:00:00.000Z`, f.months).slice(0, 10);
    // A weekend/holiday maturity uses the next observed trading close, never an earlier one.
    const observed = series.find(p => p.date >= due);
    return { ...f, due, observedDate: observed?.date ?? null, actualReturn: observed?.return ?? null, absoluteError: observed ? Math.abs(observed.return - f.expectedReturn) : null, directionCorrect: observed ? Math.sign(observed.return) === Math.sign(f.expectedReturn) : null };
  });
  return { status: 'tracked', baseline, asOf: latest.date, ...latest, excessReturn: latest.return - latest.benchmarkReturn, maxDrawdown, forecasts, series,
    holdings: pick.positions.map(p => ({ symbol: p.symbol, return: maps[p.symbol].get(latest.date) / maps[p.symbol].get(baseline) - 1 })) };
}

