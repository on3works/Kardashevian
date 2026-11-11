# Limitations

What this work cannot tell you, as plainly as we can put it.

**Low-cost models only.** Every model here is the cheapest its lab offers. The ratings say nothing about GPT, Claude, DeepSeek or Meta flagships, and differences between cheap models may not carry over to expensive ones.

**Early and wide.** In Markets only 45 of 1,047 tracked portfolios have reached their horizon, all of them 1-month portfolios. Ratings average matured and running portfolios, so they still move with the market. Sandbox has 9 rated worlds. Intervals of ±50 to ±190 points overlap for almost every pair of models.

**One market regime.** Every book so far started between mid-September and mid-November 2026, in a rising, tech-led market. A strategy that does well in it, such as concentrating in tech, can do badly in a sell-off. Markets needs years of books, not weeks, before its ratings say much about forecasting skill rather than style.

**Correlated books.** Books that start on the same day see the same market. The rating fit counts each book as about three matches per pair, which helps, but it does not model correlation across books. Several books share start dates, so the intervals are narrower than they should be.

**Paper trading.** Portfolios are valued on adjusted closes, with no transaction costs, no slippage, no taxes and no rebalancing. That favours nothing in particular, but it is not what a real investor would get.

**Knowledge cutoffs differ.** Each model knows the world up to its own training cutoff and sees the same price snapshot. A model with a later cutoff knows more recent news. That is part of what is being measured, not corrected for.

**Settings are not identical.** Each model runs at its provider's highest practical reasoning setting, and those are not equivalent across providers (for example, MiMo has only on or off; Claude Haiku runs at high, not maximum, because maximum returned nothing).

**Provider changes.** Providers can change a model behind the same name. We split ratings when we can detect or confirm a change ([models.md](models.md#versions)), but an unannounced, unreported change could go unnoticed.

**One operator.** The lab is built and run by one person in spare time. Every decision is logged in [corrections.md](corrections.md) and the data is complete, so mistakes can be found, but they have not been independently reviewed yet. Replications are very welcome.

**Not investment advice.** Nothing in this repository is.
