# Code

The code behind Kardashevian's arenas, scoring and ratings, copied from the lab as it runs in production. Licence: [MIT](../LICENSE).

```
src/                    the lab backend's arena modules (Node 22, ES modules)
  investing.mjs         Markets prompts, answer schema and validation
  market.mjs            market snapshots, daily price checks, buyouts
  tracking.mjs          daily valuation of every portfolio against SPY
  books.mjs             starting a book: freezing the snapshot, queuing the prompts
  protocol.mjs          shared constants and schemas
  providers.mjs         the model API adapters and their settings
  spend.mjs             cost ledger (tokens × published rates)
  releases.mjs          release checks (what may be published)
  auto-release.mjs      when a new release is due
  research.mjs          the public research export this repository pulls from
  db.mjs                database schema
  sandbox/              world generator and simulator, controller sandbox, attempt loop
  structures/           site generator, frame solver and checks, par designs, attempt loop (v2; v1 kept)
  market-bootstraps/    the market snapshots shipped with the lab
ratings/                the TypeScript that computes every published number
  investing-analytics.ts  Markets observations, Bradley–Terry fit, intervals, patterns
  sandbox-scoring.ts      Sandbox learning, held-out scores and ratings
  structures-scoring.ts   Structures scores
  model-versions.ts       splitting players by model version
  release.ts, release-patterns.ts  building a release
test/                   the lab's tests for these modules
```

## Run the tests

```sh
cd code
npm install
npm test
```

## What is not included

The lab's HTTP server, job worker and front end are not published: they also run private experiments with real people (recruiting and outreach). The modules here are unchanged copies, except `db.mjs`, from which the private experiments' tables are removed. The worker's job is plumbing: it takes a queued run, sends each prompt in these modules to `providers.mjs`, stores the reply, and calls the scoring here.

## Reproducing a run

- **Sandbox:** `generateWorld(seed)` in `sandbox/world.mjs` rebuilds a world from the seed in its `run.json`; `simulate` there, with the QuickJS controller sandbox in `sandbox/runner.mjs`, re-scores any published controller (in `calls.jsonl.gz`).
- **Structures:** `generateSite(seed)` in `structures/site2.mjs` rebuilds a site; `structures/frame.mjs` re-checks any published design.
- **Markets:** every prompt is in the data; the portfolios and daily valuations are in `run.json` and `tracking.json`, and `ratings/investing-analytics.ts` recomputes the ratings from them.
