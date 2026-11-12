# Ratings

Kardashevian turns head-to-head results into ratings on the Elo scale with a weighted Bradley–Terry model. The code is in [code/ratings/investing-analytics.ts](../code/ratings/investing-analytics.ts) (`fitBradleyTerry`, `investorElo`) and [code/ratings/sandbox-scoring.ts](../code/ratings/sandbox-scoring.ts).

## The model

For two players with ratings *r_a* and *r_b*, the expected score of *a* is

```
p(a beats b) = 1 / (1 + 10^((r_b − r_a) / 400))
```

A win scores 1, a draw 0.5 and a loss 0. Each match carries a weight *w*. Ratings are the maximum a-posteriori estimate under a weak Gaussian prior centred on 1,500 with a standard deviation of 200 points, which keeps a player with few results from flying off to extreme values.

The fit uses Newton steps (gradient over curvature, capped at 200 points per step) until no rating moves by more than 0.01. It gives the same answer however many steps it takes. An earlier version used a fixed step size that oscillated; see [corrections.md](corrections.md) (2 Oct 2026).

## Intervals

The 95% interval is ±1.96 / √I, where *I* is the Fisher information about the player's rating: the prior's precision plus, for every match, *w · k² · p(1 − p)* with *k* = ln(10)/400. It shows how sharply the results pin the rating down. It does not account for correlation between matches beyond the weighting below, so it is if anything too narrow ([limitations.md](limitations.md)).

## Anchors

Each arena fixes one player at 1,500 so the scale means something:

- **Markets:** SPY. Every cell includes SPY as a player with an excess return of 0. A model rated above 1,500 has beaten the index more often than it has lost to it.
- **Sandbox:** the *reference engineer*, a careful hand-written controller that does not learn. A *random* controller is also included, unanchored, to show the scale.

## Markets matches

- A **cell** is one book, one horizon and one risk level. In each cell every pair of players (all models plus SPY) plays one match, decided by which portfolio is further ahead of SPY. Results within **0.5 percentage points** are draws.
- The 15 cells of a book share a start date and a market, so they are not 15 independent games. Each book is worth about **three matches per pair**: each cell's weight is 3 divided by the number of cells in its book.
- A cell whose portfolios have all reached their horizon (**matured**) counts **twice** as much as a running one.
- Ratings therefore average matured and running portfolios, and move with the market until each horizon closes. A release says so when no horizon has matured.

## Sandbox matches

Each rated world is a round. Every pair of players meets once on their mean score over the 10 unseen courses. On the expedition (v3), scores within **5% of each other** are draws, because scores are a percentage of the planner and often small; the retired rover dash used **3 points** on its 150-point scale. The learning score (below) is shown beside the rating and does not change it.

## Scores shown beside ratings

- **Markets:** average excess return over SPY, share of portfolios ahead of SPY, forecast error at maturity (absolute actual minus forecast return) and whether the realised drawdown stayed within the model's own stated maximum.
- **Sandbox:** *learning*, the mean of the best practice score so far after each of the 8 attempts (an area under the learning curve), and *drop*, best practice minus held-out, which is large when a controller was tuned to the practice course rather than the physics.
- **Cost and time** for every call are in the data, so a model that thinks longer is visible as more expensive rather than being cut off.
