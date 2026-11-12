# Data

Everything in [data/](../data) is pulled from the Kardashevian lab's public API by [scripts/sync.mjs](../scripts/sync.mjs), every day by [GitHub Actions](../.github/workflows/sync.yml). You can run it yourself with `node scripts/sync.mjs` (Node 22+, no dependencies). Files are only rewritten when their content changes, so the git history records what moved and when. Licence: [CC BY 4.0](../LICENSE-DATA).

## data/releases/

Every numbered release shown on kardashevian.com, stored exactly as served. Releases never change once published.

- `index.json`: list of releases with number, time and note.
- `release-NNNN.json`: one release.
  - `arenas.markets.leaderboard[]`: `id` (player key, `provider:model[@version-date]`), `elo`, `ci` (95% half-width), `cells`, `maturedCells`, `beatsSpy` (share of cells ahead of SPY), `avgExcess` (mean return minus SPY, as a fraction).
  - `arenas.markets.books[]`: each book's id, snapshot date, models and tracked/matured cells.
  - `arenas.markets.grids`: per model, risk and horizon: count, mean excess return and matured count.
  - `arenas.markets.patterns`: holdings mix by risk and model, group performance, favourite and rarely held symbols.
  - `arenas.markets.early`: early-signal statistics per model (batting average, information ratio, drawdown promises kept).
  - `arenas.sandbox.leaderboard[]`: `id`, `name`, `elo`, `ci`, `worlds`, `learning`.
  - `arenas.sandbox.worlds[]`: each world's seed, whether rated, and each player's learning curve (best-so-far practice score per attempt), held-out score, goals reached.
  - `models[]`: display names and providers.

## data/runs/

One folder per run: `data/runs/<arena>/<YYYY-MM-DD>_<run id>/`, where arena is `markets` (a book), `sandbox` (a world) or `structures` (a site). `data/runs/index.json` lists every run with its status, number of calls and, if it was withdrawn from ratings, the reason.

### run.json

- `arena`, `id`, `status`, `createdAt`, `error`
- `withdrawn`: `null`, or `{ reason, at }` when the run is excluded from ratings
- `retired`: `null`, or `{ version, note }` when the run belongs to an arena version retired as too easy (Sandbox v2, Lightest Structure v1 and v2, retired on 12 Nov 2026); such runs are kept but no longer rated
- `input`: what the run was started with: models, protocol, seed or market snapshot, output budget
- `result`: what the lab computed, for example each model's attempts, scores and held-out results in Sandbox and Structures
- Markets only: `portfolios` (each model's sealed portfolio documents with their hash), `portfolioRecoveries` (portfolios recovered from saved replies after a format fix)

### calls.csv

One row per model call, readable in any spreadsheet:

| Column | Meaning |
|---|---|
| `provider` | Player id (`openai6`, `deepseek`, `mimo`, `anthropic`, `ember`, …) |
| `key` | Call key: run id, then the task (for example the horizon and risk level, or the attempt number) |
| `state` | `complete`, `failed` or `pending` (an outcome the lab could not confirm) |
| `created_at` | When the call started (UTC) |
| `returned_model` | The model name the provider reported |
| `input_tokens`, `output_tokens` | As reported by the provider; output includes reasoning |
| `estimated_cost_usd` | Tokens × the provider's published per-million rates at the time |
| `latency_ms` | Time from request to the end of the reply |
| `finish_reason` | Why the reply ended, for example `stop` or `length` (out of budget) |
| `reply_chars` | Length of the visible reply |
| `error` | The provider's error message for a failed call |

### calls.jsonl.gz

The same calls, one JSON object per line, gzip-compressed (the prompts repeat the same market snapshot many times and compress about 20×). Each object:

```json
{ "provider": "deepseek", "key": "…", "state": "complete", "createdAt": "…",
  "prompt": "the exact text sent to the model",
  "response": { "text": "the full visible reply", "inputTokens": 0, "outputTokens": 0,
                "estimatedCost": 0, "latencyMs": 0, "returnedModel": "…", "finishReason": "…",
                "requestId": "…", "attempts": 1 } }
```

Read it with `zcat calls.jsonl.gz | jq .` or, in Python, `gzip.open(path, 'rt')`. Reasoning tokens are counted but providers do not return the reasoning itself, so only the visible reply is available.

### tracking.json (Markets only)

- `dailySnapshots[]`: for each tracked day, the value of every portfolio and of SPY since the book's start, with the prices used
- `corrections[]`: replacement snapshots when a price was corrected after the fact, with the day of the correction

## What is not here

Recruiting and outreach experiments, which involve real people, are never exported. Human test runs of the Sandbox are not included. API keys, request headers and anything about the lab's infrastructure are never part of a call record.
