# Sandbox

**Verifier: rules and physics.** Live since September 2026. World generator v2 since 28 Sep 2026.

Sandbox is the competition from the [manifesto](../../MANIFESTO.md). Nobody knows the perfect controller for a world, but we can tell exactly whose controller is better, and how fast each model learned.

## The task

Each round is a **world** generated from a random seed: a 40-metre arena with walls of rocks broken by one or two narrow gaps, dead-end pockets, scattered rocks, 1 to 4 checkpoints to visit in order, and a goal flag, within 90 seconds. Every layout is checked to be solvable.

The **physics is hidden**: a motor dead zone and imbalance, a 100 to 350 ms command delay, compass bias and drift, a slow and noisy GPS, five short-sighted range sensors that sometimes miss, wind with gusts, and ice patches.

A model writes a controller, `function act(obs, mem)`, in JavaScript and runs it on the **practice course**. It sees its score, the outcome and a trace of the run, then tries again: **8 attempts** in all. From 6 Oct 2026 the feedback also reports how many output tokens each past attempt used.

Its best practice controller is then scored on **10 unseen courses** generated the same way, with the same physics but their own layout styles (walls, gap widths, pockets, rocks, checkpoints, direction).

Model code runs in QuickJS (WebAssembly) with no Node, network or file access, a 32 MB memory limit and a per-tick time limit.

Code: [code/src/sandbox/world.mjs](../../code/src/sandbox/world.mjs) (the world generator and simulator), [runner.mjs](../../code/src/sandbox/runner.mjs) (the brief, reply parsing and the QuickJS controller sandbox) and [run.mjs](../../code/src/sandbox/run.mjs) (the attempt loop).

## Scoring

- Finishing (all checkpoints in order, then the goal) scores **100 + up to 50 for speed**: 50 × (1 − time / 90 s).
- Otherwise up to **90 for progress**: checkpoints reached plus the share of the current leg.
- A crash costs **15**.
- **Held-out** is the mean over the 10 unseen courses, and it drives the rating.
- **Learning** is the mean of the best practice score so far after each of the 8 attempts, so a model that finds a good controller early scores higher. It is shown beside the rating.
- **Drop** is best practice minus held-out. A large drop means the controller fitted the practice course rather than the physics.

Three reference players run on the same courses: a careful hand-written **reference engineer** (fixed at 1,500), a **random** controller, and do-nothing. In testing, the reference engineer averaged about 11 held-out, and a controller given the full map and hidden physics but naive steering averaged about 49, so there is a lot of headroom.

## Rating

Each finished world is a round: every pair of players meets on their held-out scores, with results within 3 points as draws. See [ratings.md](../ratings.md).

A world is left out of ratings when no model returned any code, or when a model was stopped early by a provider failure and not resumed. Such worlds stay in the data with the reason.

## History

- **v1** (Sep 2026) was a simpler rover world. GPT-6 Luna came close to solving it, so it was replaced.
- **v2** (28 Sep 2026) added walls with gaps, ordered checkpoints, five range sensors and harder hidden physics.
- The output budget went from 32,000 to 64,000 to 100,000 tokens (28 Sep) and then to 128,000 (19 Oct). Worlds that ran on the 32k and 64k limits are withdrawn from ratings.
