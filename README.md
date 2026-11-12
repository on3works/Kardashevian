# Kardashevian

**Open research on how to rank AI models that may soon be smarter than the people grading them.**

Every exam we have was written by a teacher for a pupil. With AI we are about to be the pupil. Kardashevian looks for evaluations that stay rigorous when the model knows more than the examiner: tasks with no answer key, where the answer is decided after the model commits, by something it cannot see or influence, such as the market, physics or the rules of a game.

This repository is the open record of that work: what we do, how we do it, the code that does it, and every model call we have made, with the exact prompt and the full reply.

- Website: [kardashevian.com](https://kardashevian.com)
- Founder: [John Kinloch](https://x.com/on3John)
- Why we do it: [MANIFESTO.md](MANIFESTO.md), *Benchmarking in the age of superintelligence*

## The idea in one paragraph

Checking an answer is far easier than finding one. So instead of writing answer keys, which only work while the examiner knows more than the examinee, we hand the grading to an external verifier. The manifesto names four: **the world** (open-ended goals graded by reality, for example investing), **rules** (competition, as in chess), **physics** (engineering graded by simulation or experiment) and **logic** (machine-checked proof). Each arena follows the same order: frozen inputs, committed answers, then grading. Models are rated against each other with a Bradley–Terry fit on the Elo scale, always with a 95% interval.

## Arenas

| Arena | Verifier | Status | What the models do |
|---|---|---|---|
| [Markets](docs/arenas/markets.md) | The world | Live since Sep 2026 | Build 15 long-only portfolios per book (5 horizons × 3 risk levels) from frozen prices, with return forecasts. The market grades them against SPY. |
| [Sandbox](docs/arenas/sandbox.md) | Rules and physics | Expedition (v3) since 12 Nov 2026 | Write the program for a rover expedition: explore an unknown map, gather science, bring it home on one battery, with physics that changes every course and parts that fail. 8 attempts, then 10 unseen courses. No score ceiling. |
| [Lightest Structure](docs/arenas/structures.md) | Physics | In development, 3D (v3) since 12 Nov 2026 | Design the lightest 3D bridge that carries every load on ten built units, scored against a physical lower bound on mass that no structure can reach. |

## Where things stand (12 Nov 2026)

These are early results from low-cost models. Read [docs/findings.md](docs/findings.md) for what they do and do not show.

**Markets** · 21 books, 1,047 portfolios tracked, 45 matured. SPY is fixed at 1,500.

| Model | Rating | 95% interval |
|---|---:|---:|
| DeepSeek Flash (before 17 Oct) | 1,668 | ±86 |
| Claude Haiku 5.5 | 1,643 | ±58 |
| DeepSeek Flash (V4.1 Flash 1017, from 17 Oct) | 1,625 | ±58 |
| MiMo V2.6 Pro | 1,622 | ±52 |
| GPT-6 Luna | 1,610 | ±48 |
| GPT-5.6 Luna (retired) | 1,571 | ±84 |
| SPY | 1,500 | fixed |

**Sandbox** · rebuilt on 12 Nov 2026. The old rover dash had a ceiling of 150 points and the cheapest models were reaching 125–137 on practice within three or four attempts, so it was retired and its ratings withdrawn. The new expedition has no ceiling; it has no rated worlds yet. The retired worlds stay in the data, labelled retired ([corrections.md](docs/corrections.md)).

The Markets intervals overlap heavily, so no ordering above is settled yet. The live numbers are on [kardashevian.com](https://kardashevian.com) and in [data/releases](data/releases).

## What is in this repository

```
MANIFESTO.md            why Kardashevian exists
docs/
  methodology.md        the rules every arena follows
  arenas/               one page per arena: task, inputs, scoring
  ratings.md            how results become ratings and intervals
  models.md             the models, their settings and versions
  findings.md           what the results show so far, and what they don't
  corrections.md        every correction we have made, dated
  limitations.md        what this work cannot tell you
  data.md               the data files, field by field
code/                   the arena, scoring and rating code, as it runs in production
data/
  releases/             every numbered release published on kardashevian.com
  runs/                 every book, world and site: prompts, replies, scores, tokens, cost
scripts/sync.mjs        pulls the data; runs daily via GitHub Actions
```

## Reproduce and audit

- **Check a number.** Every figure on the site comes from a numbered release in [data/releases](data/releases), built by the code in [code/ratings](code/ratings).
- **Read what a model actually said.** Each run in [data/runs](data/runs) has `calls.jsonl.gz` with the exact prompt and full reply of every call, and `calls.csv` with tokens, cost and latency. See [docs/data.md](docs/data.md).
- **Run the arenas' tests.** `cd code && npm install && npm test` (Node 22+). The sandbox and structures simulators are deterministic from a seed, so a world can be regenerated and any published controller or design re-scored.

## Open problems we would like help with

- Arenas for the two verifiers not yet covered: formal proof (Lean) and real physical or chemical experiments.
- Correcting for correlation between books that start on the same day, which today narrows the Markets intervals more than it should.
- Funding or credits to run the labs' flagship models under the same rules.

Contributions, criticism and replications are welcome. Open an issue, or write to [@on3John](https://x.com/on3John) or john@on3works.com.

## Licence

Code in `code/` and `scripts/` is under the [MIT licence](LICENSE). Writing in `docs/` and `MANIFESTO.md`, and data in `data/`, are under [CC BY 4.0](LICENSE-DATA): reuse them freely, with credit to Kardashevian. Market prices in prompts and snapshots come from third-party data providers and are included only so the experiments can be audited.

Nothing here is investment advice.
