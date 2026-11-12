# Corrections and changes

Every change that affects results, newest first. When we get something wrong we say what, why and what changed. The same log is on the [Method page](https://kardashevian.com/method).

| Date | Area | Change |
|---|---|---|
| 12 Nov 2026 | Sandbox | The rover dash (v2) is retired and its ratings withdrawn: it had a ceiling of 150 points and the cheapest models reached 125–137 on practice within three or four attempts. Replaced by the expedition (v3), which has no ceiling ([sandbox.md](arenas/sandbox.md)). Retired worlds stay in the data, labelled retired. |
| 12 Nov 2026 | Lightest Structure | The 2D versions (v1, v2) are retired: the cheapest models beat the v2 par by 35–81% within eight attempts. Replaced by a 3D version (v3) scored against a lower bound on mass that no structure can reach ([structures.md](arenas/structures.md)). |
| 11 Nov 2026 | All | This repository published: methodology, arena and rating code, and every model call with its prompt and reply. Until now the models' written reasoning was private. |
| 10 Nov 2026 | Models | Muse Ember (Meta) added to new books and worlds. Its calls fail from the lab's EU servers ("model not found"), so its cells in the 10 Nov books count as no answer; the other models' portfolios are unaffected. See [models.md](models.md). |
| 30 Oct 2026 | Ratings | Ratings split by model version, including past runs. DeepSeek changed `deepseek-flash` to the V4.1 Flash checkpoint on 17 Oct without changing its name, so DeepSeek Flash is now two players, before and after 17 Oct. |
| 19 Oct 2026 | Markets | The book sealed on 13 Oct was removed: the price provider failed and the lab gave it a market snapshot from 18 Sep, so it was scored from 18 Sep. Ratings are recalculated without it, and books now refuse to start on a snapshot more than 4 days older than the last close. |
| 19 Oct 2026 | All arenas | Output budget raised to 128,000 tokens per reply for every model (from 32,768 in Markets and 100,000 in Sandbox), the most every model's API allows. Models cannot track their own token count, so the limit should measure thinking, not running out. Earlier books and worlds keep the budget they ran on. |
| 19 Oct 2026 | Models | Claude Haiku 5.5 now thinks at high effort rather than maximum. At maximum it used its whole output budget thinking and returned nothing, so all its portfolios in the 19 Oct book failed and count for nothing; the other models' portfolios are unaffected. |
| 19 Oct 2026 | Models | Claude Haiku 5.5 joins new books and worlds. GPT-5.6 Luna is no longer run, now that GPT-6 Luna has replaced it; its existing portfolios still count until they mature. |
| 16 Oct 2026 | Site | Releases are published automatically after each daily price check, so the site follows the lab within a day. |
| 9 Oct 2026 | Markets | Warner Bros. Discovery (WBD) was bought out for cash at $31.0167 a share on 6 Oct. Daily tracking values it at that price from 7 Oct, and new books offer 299 instruments without it. No portfolio held WBD. |
| 6 Oct 2026 | Sandbox | Each model's feedback now reports how many output tokens each past attempt used, after MiMo V2.6 Pro spent a whole 100,000-token budget reasoning and returned no code. New worlds only. |
| 2 Oct 2026 | Ratings | Elo fit fixed in both arenas. It used a fixed step size that oscillated; it now converges. DeepSeek Flash moved from first to last in Markets. See [findings.md](findings.md#correcting-our-ratings-2-oct-2026). |
| 30 Sep 2026 | Markets | An internal spending cap paused the 29 Sep book after 3 of 4 models had answered. The missing DeepSeek Flash prompts ran on 30 Sep with the same frozen prices. |
| 28 Sep 2026 | Sandbox | Output budget raised from 32,000 to 64,000 and then 100,000 tokens per reply; worlds run on the lower limits are withdrawn from ratings. |
| 28 Sep 2026 | Sandbox | World generator v2: walls with gaps, ordered checkpoints, five range sensors and harder hidden physics, after v1 came close to being solved. |
| 28 Sep 2026 | Sandbox | Worlds started before long model calls stopped being cut off are withdrawn from ratings. |
| 28 Sep 2026 | Markets | A portfolio that fails the format gets one correction request with its own reply and the reason; answers accepted that way are labelled *corrected*. |
| 27 Sep 2026 | Markets | 1-month horizon added: 15 portfolios per model per book. |
