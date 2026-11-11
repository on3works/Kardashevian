# Markets

**Verifier: the world.** Live since September 2026. Protocol `investing-v8` (since 27 Sep 2026).

Markets is the open-ended quest from the [manifesto](../../MANIFESTO.md): predicting how the economy and markets will behave is one of the clearest tests of understanding the world, and the world keeps changing, so it cannot be memorised or saturated.

## The task

A **book** is one sealed experiment. For each book, every model receives 15 independent prompts, one for each combination of:

- **Horizon:** 1, 3, 9, 12 or 24 calendar months
- **Risk level:** low, medium or high

For each prompt the model returns one **long-only, buy-and-hold portfolio** as JSON:

- one or more named **world theses** first: falsifiable claims about the world or the whole economy, and how the portfolio expresses them;
- up to 100 holdings (US stocks, ETFs or spot crypto pairs from the snapshot) plus cash, as percentages of capital summing to exactly 1;
- for every holding: what it is, which thesis it applies, why it is value at this price, the evidence, a catalyst, and what would prove it wrong;
- an **expected total return** at the target horizon, and an **expected maximum drawdown**.

The full prompt is in [code/src/investing.mjs](../../code/src/investing.mjs) (`DEFAULT_QUESTION`, `cohortPrompt`), and every prompt actually sent is in the run data. The prompts still carry the lab's internal name, AlphaElo.

## Inputs

Before any model is called, the lab freezes a **market snapshot**: about 300 instruments (US stocks, ETFs and crypto pairs) with the latest completed daily adjusted close, 3- and 12-month returns and the 52-week range. The same snapshot, byte for byte, goes into all 15 prompts for every model. Models have no web access and are told to use only the snapshot and their own knowledge up to its cutoff.

- A book refuses to start on a snapshot more than 4 days older than the last completed close (added after the 13 Oct incident in [corrections.md](../corrections.md)).
- An instrument bought out for cash is valued at the deal price from its closing date and dropped from new snapshots (Warner Bros. Discovery, 6 Oct 2026).
- The snapshots shipped with the lab are in [code/src/market-bootstraps](../../code/src/market-bootstraps).

## Grading

- Every portfolio starts at an index of 100 on the snapshot's closing date and is valued daily on adjusted closes as a fixed-weight buy-and-hold, with cash earning nothing. It is compared with **SPY** over exactly the same dates.
- A horizon **matures** on its calendar due date and is graded on the first close on or after it. From then on the result is final and never re-scored.
- The **forecast error** at maturity is the absolute gap between forecast and actual return. Whether the realised drawdown stayed within the model's own stated maximum is tracked throughout.
- If a holding's price is missing or stale, the portfolio's score is withheld for that day rather than estimated.

Tracking code: [code/src/tracking.mjs](../../code/src/tracking.mjs) and [code/src/market.mjs](../../code/src/market.mjs). Scoring and ratings: [code/ratings/investing-analytics.ts](../../code/ratings/investing-analytics.ts) and [ratings.md](../ratings.md).

## Format failures

A reply that is not one valid portfolio gets one follow-up with its own reply and the exact reason, on the same snapshot, asking it to fix only the format. An answer accepted that way is labelled *corrected* and the original reply is kept. Extra fields a model adds on its own are dropped rather than failing the cell.

## Known weaknesses

- Prices are adjusted closes, not executable prices, and there are no transaction costs.
- Several books have started on the same day (30 Oct ×3, 3 Nov ×2, 4 Nov ×2, 10 Nov ×5). They see the same market, so they are far from independent, and the intervals are narrower than they should be. See [limitations.md](../limitations.md).
- Until horizons mature, ratings move with the market. Most of the 1,047 tracked portfolios are still running.
- None of this is investment advice.
