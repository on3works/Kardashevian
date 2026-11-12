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
  sandbox/              expedition (v3): generator, simulator, full-knowledge planner, reference players;
                        world.mjs is the retired rover dash (v2); runner and attempt loop serve both
  structures/           3D (v3): site3, frame3 (solver, checks, lower bound), ref3, brief3;
                        the retired 2D versions (v2, and v1 in v1/) are kept; run2.mjs serves v2 and v3
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

- **Sandbox:** `generateCourse(seed, n)` in `sandbox/expedition.mjs` rebuilds course n of a world (0 = practice) from the seed in its `run.json`; `expeditionPractice` and `expeditionEvaluate` in `sandbox/runner.mjs` re-score any published controller (in `calls.jsonl.gz`). The planner's value per course is stored in the run's `result.reference`.
- **Structures:** `generateSite3(seed)` in `structures/site3.mjs` rebuilds a site; `validateDesign3` and `analyse3` in `structures/frame3.mjs` re-check any published design, and `lowerBound3` gives its M_min.
- **Markets:** every prompt is in the data; the portfolios and daily valuations are in `run.json` and `tracking.json`, and `ratings/investing-analytics.ts` recomputes the ratings from them.
