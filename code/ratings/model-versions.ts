// Model versions. Providers can change the model behind a name without notice
// (DeepSeek's `deepseek-flash` always points at its newest Flash). A benchmark
// must not pool two different models under one rating, so a player is the
// configured model *and the version that was live when the run started*.
//
// Versions come from two places:
// 1. Detected: the backend records the model name each provider reports on every
//    reply (`returnedModel`, grouped per configured model). When a provider starts
//    reporting a new name, and the old one stops, that date starts a new version.
//    This covers every past run, because every reply has always been recorded.
// 2. Known changes a provider does not report (it keeps returning the same name).
//    Add them below with the date the change went live.
//
// The first version keeps the plain `provider:model` key, so a model that never
// changed keeps exactly the ratings it had; later versions get `provider:model@date`.

export type DetectedVersion = { provider: string; model: string; returnedModel: string; firstSeen: string; lastSeen: string; calls: number };
type Change = { provider: string; model: string; from: string; label: string; source?: string };

// Changes a provider made without reporting a new model name.
export const KNOWN_CHANGES: Change[] = [
  // DeepSeek moved deepseek-flash to the V4.1 Flash checkpoint of 17 Oct 2026 (listed
  // upstream as DeepSeek-V4.1-Flash-1017); the API kept answering as deepseek-flash.
  { provider: "deepseek", model: "deepseek-flash", from: "2026-10-17", label: "V4.1 Flash 1017", source: "third-party model listings (OrcaRouter, WaveSpeed)" },
];

let detected: DetectedVersion[] = [];
export function setModelVersions(list?: DetectedVersion[] | null) { detected = Array.isArray(list) ? list : []; }

const day = (v: string) => v.slice(0, 10);
const DAY = 86_400_000;
type Boundary = { from: string; label: string };

// Where a configured model changed, oldest first.
export function boundaries(provider: string, model: string): Boundary[] {
  const seen = detected.filter(v => v.provider === provider && v.model === model).sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
  const out: Boundary[] = [];
  for (let i = 1; i < seen.length; i++) {
    // Only a clean handover counts: the old name stopped within two days of the new
    // one appearing. Names that alternate (load balancing) would otherwise split ratings.
    if (new Date(seen[i - 1].lastSeen).getTime() <= new Date(seen[i].firstSeen).getTime() + 2 * DAY) out.push({ from: day(seen[i].firstSeen), label: seen[i].returnedModel });
  }
  for (const c of KNOWN_CHANGES) if (c.provider === provider && c.model === model) out.push({ from: c.from, label: c.label });
  return out.sort((a, b) => a.from.localeCompare(b.from)).filter((b, i, all) => i === 0 || b.from !== all[i - 1].from);
}

// The player key for a model as it was on `when` (a run's start).
export function versionKey(provider: string, model: string | undefined, when?: string | null) {
  if (!model) return provider;
  const base = `${provider}:${model}`;
  if (!when) return base;
  const live = boundaries(provider, model).filter(b => b.from <= day(when)).at(-1);
  return live ? `${base}@${live.from}` : base;
}

const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// Display name for a player key: the plain name when the model never changed,
// otherwise the name plus which version it is.
export function versionedName(key: string, name: string) {
  const at = key.indexOf("@");
  const base = at < 0 ? key : key.slice(0, at);
  const [provider, ...rest] = base.split(":");
  const model = rest.join(":");
  const all = model ? boundaries(provider, model) : [];
  if (!all.length) return name;
  if (at < 0) return `${name} (before ${short(all[0].from)})`;
  const from = key.slice(at + 1);
  const b = all.find(x => x.from === from);
  return `${name} (${b?.label ? `${b.label}, ` : ""}from ${short(from)})`;
}
