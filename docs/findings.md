# Findings so far

Results as of **release 31** (prices through 10 Nov 2026). Everything here is early: read [limitations.md](limitations.md) first. The numbers come from [data/releases/release-0031.json](../data/releases/release-0031.json); newer releases supersede them.

## Markets

**21 books, 1,047 portfolios, 45 matured.** Every model is rated above SPY, but the intervals overlap for every pair of models, so no ordering among them is settled.

### The risk split reversed

On 7 October (below), high-risk portfolios were the only ones beating SPY. A month later it is the opposite:

| Risk | Portfolios | Ahead of SPY | Average vs SPY |
|---|---:|---:|---:|
| Low | 351 | 99% | +3.0 pp |
| Medium | 351 | 95% | +2.4 pp |
| High | 345 | 24% | −2.0 pp |

The holdings explain it. Low-risk portfolios hold about 28% cash, 29% bonds, 22% defensive stocks and no tech. High-risk portfolios hold 52% tech and chips and 9% crypto. Over the portfolios still running, while held, defensive stocks are 5.8 points ahead of SPY, tech 2.4 behind and crypto 8.4 behind.

This is the clearest lesson so far about the arena itself: **over weeks, Markets measures market regime and style more than forecasting skill**. The same models ranked differently a month ago. Only matured portfolios across many start dates can separate the two, which is why matured cells count double in the ratings and why we keep publishing books for years, not weeks.

### Model personalities

Each model invests in a recognisable way:

| Model | Portfolios | Avg holdings | Different instruments | Most often held |
|---|---:|---:|---:|---|
| GPT-6 Luna | 269 | 5.4 | 73 | short Treasuries (SHY), value stocks (VTV), Adobe |
| DeepSeek Flash V4.1 (from 17 Oct) | 192 | 15.8 | 148 | Berkshire Hathaway, health care (XLV), energy (XLE) |
| MiMo V2.6 Pro | 222 | 13.5 | 170 | Berkshire Hathaway, gold (GLD), Exxon, bitcoin |
| Claude Haiku 5.5 (from 19 Oct) | 199 | 12.3 | 137 | gold (GLD), short Treasuries (SHY), Berkshire Hathaway |

GPT-6 Luna is by far the most concentrated, and keeps the most in cash and bonds (39% of capital across all its portfolios). DeepSeek and MiMo spread wide and lean on energy and defensive stocks.

All models largely avoid the largest US tech companies. Across 1,047 portfolios, Apple appears in 8 and Tesla in none.

### Forecasts and promises

Each portfolio states an expected maximum drawdown. Across models, almost every portfolio has stayed within its own stated maximum so far (for example 266 of 269 checks for GPT-6 Luna). It is too early to grade return forecasts: only 1-month portfolios have matured.

## Sandbox

**Rebuilt on 12 Nov 2026; no rated expedition worlds yet.** The rover dash these findings were based on was retired as too easy: the cheapest models reached 125–137 of its 150-point ceiling on practice within three or four attempts. Two observations from its 9 rated worlds are kept for the record:

- **Learning differed more than final skill.** DeepSeek Flash V4.1 (from 17 Oct) found good controllers earliest; Claude Haiku 5.5 and GPT-5.6 Luna found theirs late.
- **DeepSeek's silent upgrade mattered.** DeepSeek Flash before 17 Oct rated 1,423, below the reference engineer; after DeepSeek's unannounced switch to V4.1 Flash it rated 1,777. Pooling the two would have hidden a 350-point change, which is why ratings are split by model version.

## Notes published along the way

### What the models do with money (7 Oct 2026)

Across 273 portfolios after one to three weeks of a rising, tech-led market, only high-risk portfolios were beating SPY: 67% of them ahead, while no low-risk portfolio was. GPT-6 Luna put 66% of its high-risk capital in tech, and its high-risk portfolios were ahead 95% of the time. Gold was the closest thing to a consensus, in 74% of portfolios. We wrote then that "in a sell-off the order could flip"; by 10 Nov it had.

### When a model thinks past its budget (6 Oct 2026)

On its third attempt in the 6 October Sandbox world, MiMo V2.6 Pro used its full 100,000-token budget over 24 minutes and returned no code, scoring −15. A model cannot count its own tokens as it thinks, so a number in the prompt is weak guidance. We kept the result, added each attempt's token use to every model's feedback, and on 19 Oct raised every budget to 128,000 so that limits measure thinking rather than running out.

### Correcting our ratings (2 Oct 2026)

Our Elo fit ran a fixed 600 steps with too large a step size, so the ratings oscillated and the table showed wherever step 600 landed: DeepSeek Flash read 1,652 after step 600 and 1,086 after step 601. Its actual record that day was 0.32 against GPT-5.6 Luna and 0.34 against GPT-6 Luna. The fit now converges, and DeepSeek Flash moved from first to last. See [ratings.md](ratings.md).
