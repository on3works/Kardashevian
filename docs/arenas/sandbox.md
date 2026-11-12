# Sandbox

**Verifier: rules and physics.** Expedition (`sandbox-v3`) since 12 Nov 2026. The rover dash (v1, v2) is retired; see [History](#history).

Sandbox is the competition from the [manifesto](../../MANIFESTO.md). Nobody knows the best program for a world, but we can tell exactly whose program does better, and how fast each model learned.

## The task

Each round is a **world** generated from a random seed. A rover lands at a base on an unknown **400 m × 400 m** map and has one **20-minute mission** (simulated time; the simulator runs it in seconds). The map has ridges of rock with a few gaps, craters ringed with rock with one opening, scattered boulders, hills and basins, and patches of soft sand.

- **Science.** 30–45 sites of different value. Small ones tend to be near the base; rich ones are far away, inside craters or in sand. More sites exist than any rover can visit.
- **Sampling and delivery.** To sample, the rover stops within 1.5 m of a site and drills for 6 s while holding still (on a slope it rolls unless the motors hold it). It carries at most 5 samples. Only samples delivered to the base count; samples on board are lost if the battery runs out, the rover hits a rock faster than 1 m/s, or the mission ends.
- **Energy.** Driving, climbing, sand, payload and drilling drain the battery. Solar power recharges it slowly: more when the sun is high, far less while moving, almost nothing in the shadow of a hill or in a dust storm, and the sun sinks during the mission. The base fast-charges.
- **What the rover knows.** GPS and compass with errors, wheel speeds, pitch, nine short range sensors, a science signal with no direction, the nearest site within 8 m, a base beacon within 20 m, and on the first tick an orbital survey that misplaces most real sites by up to 15–20 m, misses about a quarter and includes false positives.
- **Hidden physics, drawn per course.** Motor strength and imbalance, dead zone, command lag, grip, how sand and slopes behave, compass bias and drift, GPS noise and rate, range-sensor bias, noise, reach and dropouts, wind, battery size, energy use and solar yield. Tuning constants to the practice course does not carry over.
- **Faults.** One to three parts fail during each mission with no flag in the observations: a motor weakens, range sensors go blind or stick, the compass jumps, the GPS freezes for minutes, or the battery loses capacity. Many courses also have a dust storm.

A model writes one controller, `function act(obs, mem)`, in JavaScript: up to 120,000 characters, 50 ms per tick, 60 s of computing per mission, in QuickJS with no network or file access. It runs the controller on the **practice course**, sees the score, an event log and a trace sampled every 5 s, then tries again: **8 attempts** in all. Its best practice controller then flies **10 unseen courses**, each with its own map, sites, physics, faults and weather.

Code: [code/src/sandbox/expedition.mjs](../../code/src/sandbox/expedition.mjs) (generator, simulator, full-knowledge planner and reference players), [runner.mjs](../../code/src/sandbox/runner.mjs) (controller sandbox, prompt) and [run.mjs](../../code/src/sandbox/run.mjs) (attempt loop).

## Scoring

- Score on a course = **100 × science value delivered ÷ value delivered by the full-knowledge planner** on the same course. The planner knows the whole map, every site's true value, the true physics and its own exact position; it picks sites by value per second, keeps enough time and energy to get home, and follows shortest paths. It is a strong heuristic, not the optimum, so **there is no upper limit**.
- **Held-out** is the mean over the 10 unseen courses, and it drives the rating.
- **Learning** is the mean of the best practice score so far after each of the 8 attempts. It is shown beside the rating.

Reference players fly the same courses: a careful hand-written **reference engineer** that sees only what the models see and does not adapt (fixed at 1,500), a **random** controller, and do-nothing. In offline checks the planner delivered about half of all the science on a map, and the reference engineer scored 1–3.

## Rating

Each finished world is a round: every pair of players meets on their held-out scores, with scores within 5% of each other counted as draws. See [ratings.md](../ratings.md). A world is left out of ratings when no model returned any code, or when a model was stopped early by a provider failure and not resumed.

## History

- **v1** (Sep 2026): a simpler rover world. GPT-6 Luna came close to solving it.
- **v2, the rover dash** (28 Sep – 12 Nov 2026): a 90-second dash on a 40 m arena through walls with gaps and ordered checkpoints to a flag, scored out of 150. The cheapest models reached 125–137 on practice within three or four attempts, so on 12 Nov it was retired and its ratings withdrawn. Its 9 rated worlds remain in [data/runs/sandbox](../../data/runs), labelled retired, and its code in [world.mjs](../../code/src/sandbox/world.mjs).
- **v3, the expedition** (12 Nov 2026 –): this page.
