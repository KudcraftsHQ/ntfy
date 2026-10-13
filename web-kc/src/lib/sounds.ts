import type { SoundClass, SoundTheme } from "./types";

/** The closed sets of the sound-theme contract (docs/kudcrafts/catalog-spec.md §20). */
export const SOUND_THEMES = ["wood", "glass", "soft", "chip", "pluck", "keys", "space", "cabin", "cockpit", "terminal"] as const;
export const DEFAULT_SOUND_THEME: SoundTheme = "cabin";

/** Every class with a clip, in the order they are previewed. `silent` has none. */
export const SOUNDS: { name: Exclude<SoundClass, "silent">; meaning: string }[] = [
  { name: "default", meaning: "Ordinary message" },
  { name: "alert", meaning: "Look at this soon" },
  { name: "urgent", meaning: "Prod broken, money at risk" },
  { name: "cash", meaning: "Order paid" },
  { name: "done", meaning: "Job or agent finished" },
  { name: "fail", meaning: "Build, deploy or job failed" },
  { name: "ask", meaning: "An agent needs an answer" },
];

const isTheme = (v: unknown): v is SoundTheme => (SOUND_THEMES as readonly unknown[]).includes(v);

/** An unknown or missing theme (older server, newer server) is `cabin`. */
export const toSoundTheme = (v: unknown): SoundTheme => (isTheme(v) ? v : DEFAULT_SOUND_THEME);

/** An unknown class (a newer server) is `default`; an empty one falls back to `fallback`. */
export const toSoundClass = (v: unknown, fallback: SoundClass = "default"): SoundClass =>
  !v ? fallback : v === "silent" || SOUNDS.some((s) => s.name === v) ? (v as SoundClass) : "default";

/** This device's override if set, else the server's theme, else `cabin`. */
export const resolveSoundTheme = (override: unknown, server: unknown): SoundTheme => (isTheme(override) ? override : toSoundTheme(server));

/** The clip id shared by every client: `kc_<theme>_<sound>`. Null for `silent`. */
export function clipId(theme: unknown, sound: unknown): string | null {
  const s = toSoundClass(sound);
  return s === "silent" ? null : `kc_${toSoundTheme(theme)}_${s}`;
}
