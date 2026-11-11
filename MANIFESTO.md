# Benchmarking in the age of superintelligence

*Manifesto · 22 October 2026*

How an inferior intelligence can rigorously assess a superior one, the four kinds of verifier that make it possible, and what Kardashevian is doing about it.

By [John Kinloch](https://x.com/on3John), founder · [Originally published on X](https://x.com/on3John/status/2113290892865847356)

In April 1965, Soviet news agencies announced the discovery of a supercivilisation. The panic all came from the work of one man: Nikolai Kardashev, a Soviet astronomer who had been obsessed with the following question: if you did detect a civilisation far beyond your own, would you be able to say anything rigorous about it?

He became famous for his solution. Instead of focusing on intelligence, intentionality or behaviour, all very complex and difficult to assess, he created a theory of how civilisations use energy. Thermodynamics, he argued, is indifferent to intelligence.

It all turned out to be a quasar. The measurement was fine; there was just no alien behind it.

## Benchmarking in the age of superintelligence

Sixty-one years later we have an oddly similar panic: we seem to be on the cusp of creating an intelligence that will surpass the smartest human who has ever lived. And yet it is of vital importance that we be able to say something meaningful about these systems. In other words, we need to benchmark them.

The reason is simple: resource allocation. Regardless of their far superior intelligence, we will still want the best return for our time and money. Nobody uses Stockfish 13 for deep chess analysis when the 2026 engine is just better.

So why can’t we just use our current benchmarks?

The immediate problem is saturation. A fixed test stops being useful the moment every model scores 100% on it, and that is already happening: benchmarks that were considered hard three years ago are now cleared by cheap models. You can keep writing harder tests, but only up to the hardest test a human can write. Which brings us to the real problem.

Up to now we have mostly measured intelligence with closed tests. By “closed” I mean tests whose answers are known before the test begins: IQ tests, mathematics exams, programming problems. We use them for obvious reasons: they are objective, they are relatively quick to assess, and inertia, because it is how we usually test humans.

As soon as you think about applying these tests to smarter AIs, the issue is obvious. These exams are designed for a superior intelligence to rank an inferior one: a teacher and a pupil. That is exactly why we need to start thinking about, and designing, a new type of assessment. We, the inferior intelligence, the pupil, will have to evaluate a superintelligence, the teacher, while still guaranteeing objectivity.

This problem, how an inferior intelligence can rigorously assess a superior one, I call **the Kardashev problem**. It is what I am personally most passionate about, and the reason I decided to create Kardashevian.

## Future superintelligence benchmarks

We are helped by one saving principle: checking a candidate answer is radically easier than finding one. A Sudoku takes effort to solve; verifying a filled-in grid takes thirty seconds. In most cases an external verifier lets us be as objective as possible about the quality and intelligence of these highly advanced systems.

I see four external verification systems for the future of benchmarking.

### 1. The world is the verifier: open-ended quests

Objectives, not questions and answers. The world grades the objective; the higher or the more optimised, the better.

*Example:* paper-trading value investing in the stock market.

Here the complexity of the real world is so vast and dynamic, constantly changing and reacting, that saturating the challenge is practically impossible. I plan to write another essay on why I believe value investing to be a great test of intelligence. The gist is in the assumption that a system capable of reliably predicting how the world, including humans and markets, will behave is one of the clearest signs of intelligence.

### 2. The rules and the game are the verifier: competition

Chess shows that, despite engines being far better players than humans, we can still know that model X is better than model Z. The Elo system, which we also use at Kardashevian, lets us see not just the winner but keep a statistically significant scoreboard.

*Example:* chess, Go, or any infinitely more complex game created just for this purpose.

### 3. Physics and chemistry are the verifier: complex engineering

We limit the test to physics and chemistry and let nature do the grading.

*Example:* design a material with a given property, then synthesise it in an automated lab and test it.

### 4. Logic is the verifier: formal proof

Mathematics written in a language a computer can check.

*Example:* improving a known bound, or solving an open conjecture, in Lean.

The risk is that the limits of known bounds are human, as are the conjectures we pose. Still very hard to saturate.

## Kardashevian.com

Kardashevian is a first attempt at all four of those ideas, built in my spare time and on a small budget.

Every arena works the same way: inputs are frozen, the models commit, and then something they cannot see or influence does the grading. None of the tests has a specific “answer”.

[Markets](https://kardashevian.com/arenas/markets) is the open-ended quest, a smaller version of the one in the essay. The models receive trading data for a packet of 300 US stocks, ETFs and crypto pairs. Their objective is to build 15 long-only portfolios: five horizons from 1 month to 2 years, at three risk levels, each with a return forecast. We then track every portfolio daily against the S&P 500. The market does the grading. So far no model has lost money on average, and nearly a month in, three of five are beating the S&P 500, although the statistical significance of this is still limited.

[Sandbox](https://kardashevian.com/arenas/sandbox) is the competition. Each model writes the controller for a rover in a simulated world with hidden physics (motor imbalance, command lag, sensor noise, wind, ice), watches its run, and tries again, eight times. Its best controller is then scored on ten courses it has never seen. Nobody knows the perfect controller for that world, but we can tell exactly which model’s is better, and how fast each one learned.

In both arenas the models are rated against each other with the same statistics chess uses: every pair plays a match in every cell, and a Bradley–Terry fit on the Elo scale turns the results into a rating with a 95% interval. The S&P 500 is a player fixed at 1,500. A model that cannot beat an index fund has a rating to show for it.

Two very clear limitations we currently face:

- We are self-funded, so we run the low-cost models from each frontier lab (GPT-6 Luna, Claude Haiku 5.5, DeepSeek Flash, MiMo), not their flagships. The method is the point; the flagships come when the budget does.

- We need time. So far: 358 portfolios and 6 worlds, with new books every Monday and the first portfolios maturing on 25 October. The intervals are still about ±100 points wide.

Everything is public. Each number comes from a [numbered release you can download](https://kardashevian.com/data), and the [method page](https://kardashevian.com/method) describes exactly how it was computed.

We are working hard on increasing the number and difficulty of these tasks.

If you are interested in working together on this project, send me a message on [X](https://x.com/on3John) or an email at john@on3works.com.

John Kinloch is the founder of Kardashevian. This essay was first published on X on 22 October 2026; the numbers in it are as of that date. [Read the original post](https://x.com/on3John/status/2113290892865847356) · [About the team](https://kardashevian.com/team)
