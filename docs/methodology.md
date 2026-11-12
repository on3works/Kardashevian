# Methodology

Method version 1.0. This page states the rules every Kardashevian arena follows. The arena pages describe each task in detail, and [ratings.md](ratings.md) describes the statistics.

## The problem

A benchmark is a test whose answers are known before it starts. That only works while the examiner knows more than the examinee. Once models pass the hardest test a person can write, a fixed test stops measuring anything: it saturates, and it can leak into training data. We call the question of how a weaker intelligence can rigorously rank a stronger one **the Kardashev problem** ([MANIFESTO.md](../MANIFESTO.md)).

## The way out: external verifiers

Checking an answer is radically easier than finding one. So we do not write answer keys. We hand the grading to something the model cannot see or influence:

| Verifier | What grades the answer | Arena |
|---|---|---|
| The world | What actually happens later (prices, events) | Markets |
| Rules | The rules of a game or a simulator, applied the same way to every player | Sandbox |
| Physics | A physical model or, eventually, a real experiment | Lightest Structure (in development) |
| Logic | A proof checker such as Lean | Not started |

## Three rules

1. **Unsaturable.** Every arena has a moving or hidden answer. When a model nears the ceiling, the arena gets harder rather than being retired. When GPT-6 Luna came close to solving the first Sandbox world generator, we built a much harder one (v2, 28 Sep 2026); when the cheapest models neared v2's ceiling, we replaced it with the expedition, which has none (v3, 12 Nov 2026). Retired versions stay in the data, labelled, and are no longer rated.
2. **Committed before graded.** Models answer from frozen inputs, and the answer is decided later, by the market or by physics they never see. Inputs are frozen and hashed before any model is called, and every answer is sealed with a hash when it arrives. No one, including us, can tune a result after the fact.
3. **Uncertainty shown.** Every rating carries its 95% interval, early results are labelled provisional, and corrections are published next to results ([corrections.md](corrections.md)).

## Fairness between models

- Every model in a run receives **the same prompt, the same inputs and the same output budget**: 128,000 output tokens per reply in every arena, reasoning included, which is the most every model's API allows. Models cannot count their own tokens, so the budget is set high enough that it should rarely decide an answer. Cost and time are reported beside the rating instead of being used as a limit.
- Each model runs through its provider's public API at its provider's highest practical reasoning setting ([models.md](models.md)).
- No model has web access or tools beyond what the arena gives it. Markets models see only the frozen price snapshot; Sandbox and Structures models see only the brief and their own results.
- A model is a player **at a version**. When a provider changes the model behind a name, the date it changed starts a new player, so two different models are never pooled under one rating ([models.md](models.md#versions)).

## Failures

- A reply that fails the arena's format gets **one** follow-up containing its own reply and the exact reason, on the same frozen inputs; an answer accepted that way is labelled *corrected* and the original reply is kept.
- Rate limits, server errors and transport failures that return nothing (a dropped connection, a restart, a timeout) are retried, since the model produced and learned nothing. A request the provider rejects outright is recorded as failed and is final: it counts as no answer.
- A run is **withdrawn** from ratings only for a documented reason that applies to every model in it (for example a stale price snapshot, or a budget limit that cut off every model). Withdrawn runs stay in the data with their reason.

## Publication

- The site shows **numbered releases**. A release is built automatically after each daily price check whenever results change, with the same code that computes the lab's numbers, and is stored unchanged. Every release is in [data/releases](../data/releases).
- Everything underneath the releases is in [data/runs](../data/runs): the inputs of every run, every model call with its exact prompt and full reply, scores, tokens, cost and latency. It is updated daily by [scripts/sync.mjs](../scripts/sync.mjs).
- The code that runs the arenas and computes the ratings is in [code](../code).

## What is not published

Kardashevian's lab also runs private experiments that involve real people, such as ranking real job candidates and a cold-email outreach test. They are not arenas, are not rated here, and none of their data is published.
