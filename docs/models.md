# Models

Kardashevian is self-funded, so it tests the **most affordable models each frontier lab offers through its public API**, not the labs' flagships. That lets every model answer every book and every world, so every comparison is complete. These ratings say nothing yet about the flagship models; the plan is to bring them into the same arenas, under the same rules, when the budget allows.

## Current models

| Model | Provider | API model id | Reasoning setting | Since |
|---|---|---|---|---|
| GPT-6 Luna | OpenAI | `gpt-6-luna` | maximum reasoning effort | Sep 2026 |
| DeepSeek Flash | DeepSeek | `deepseek-flash` | maximum reasoning effort | Sep 2026 |
| MiMo V2.6 Pro | Xiaomi | `mimo-v2.6-pro` | thinking on (its only setting) | Sep 2026 |
| Claude Haiku 5.5 | Anthropic | `claude-haiku-5-5` | adaptive thinking at high effort | 19 Oct 2026 |
| Muse Ember | Meta | `muse-ember-1.0` | maximum reasoning effort | 10 Nov 2026, not yet answering (below) |

Claude Haiku 5.5 runs at high effort rather than maximum because at maximum it spent its whole output budget thinking and returned no answer (19 Oct 2026 book).

Muse Ember was added on 10 Nov 2026. Meta's API answers our calls with "model not found" from the lab's European servers, although the same account can use the model in Meta's own playground. Meta has not launched its Muse models in the EU. Until Ember's calls are routed through the lab's US relay, its cells fail and count as no answer.

## Retired models

| Model | Provider | Why | Results |
|---|---|---|---|
| GPT-5.6 Luna | OpenAI | Replaced by GPT-6 Luna (19 Oct 2026) | Its portfolios still count until they mature |
| Muse Spark 1.3 Contributor | Meta | Retired | Runs remain in the data |

## Settings shared by every model

- Same prompt, same inputs, same output budget: **128,000 output tokens per reply** in every arena, reasoning included (since 19 Oct 2026; earlier runs keep the budget they ran on).
- Replies are streamed, so long thinking does not look like an idle connection.
- No web access or tools beyond what the arena provides.
- JSON mode is requested from providers that support it (DeepSeek and MiMo) in Markets.

The provider adapters, with every setting, are in [code/src/providers.mjs](../code/src/providers.mjs).

## Versions

Providers sometimes change the model behind a name without notice. A benchmark must not pool two different models under one rating, so a **player is a model at a version**: the configured model plus the version that was live when the run started.

- **Detected changes.** Every reply records the model name the provider reports. When a provider starts reporting a new name and the old one stops within two days, that date starts a new version.
- **Known changes.** Some changes are not reported. DeepSeek moved `deepseek-flash` to the V4.1 Flash checkpoint of **17 Oct 2026** while still answering as `deepseek-flash`. DeepSeek Flash is therefore two players: *before 17 Oct* and *V4.1 Flash 1017, from 17 Oct*.

Applied retroactively to every past run. Code: [code/ratings/model-versions.ts](../code/ratings/model-versions.ts).
