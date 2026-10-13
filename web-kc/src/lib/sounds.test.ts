import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { clipId, resolveSoundTheme, SOUND_THEMES, SOUNDS, toSoundClass, toSoundTheme } from "./sounds";

describe("sound themes", () => {
  it("resolves device override, then server, then cabin", () => {
    expect(resolveSoundTheme("wood", "cockpit")).toBe("wood");
    expect(resolveSoundTheme(null, "cockpit")).toBe("cockpit");
    expect(resolveSoundTheme(null, undefined)).toBe("cabin"); // older server
    expect(resolveSoundTheme("gone", "cockpit")).toBe("cockpit");
    expect(resolveSoundTheme(null, "from-the-future")).toBe("cabin");
    expect(toSoundTheme("")).toBe("cabin");
  });

  it("maps unknown classes to default", () => {
    expect(toSoundClass("cash")).toBe("cash");
    expect(toSoundClass("silent")).toBe("silent");
    expect(toSoundClass("siren")).toBe("default");
    expect(toSoundClass("", "alert")).toBe("alert");
    expect(clipId("cabin", "urgent")).toBe("kc_cabin_urgent");
    expect(clipId("nope", "siren")).toBe("kc_cabin_default");
    expect(clipId("cabin", "silent")).toBeNull();
  });

  it("ships a clip for every theme and sound", () => {
    expect(SOUND_THEMES).toHaveLength(10);
    expect(SOUNDS).toHaveLength(7);
    for (const theme of SOUND_THEMES)
      for (const s of SOUNDS) expect(existsSync(resolve(__dirname, "../sounds", `${clipId(theme, s.name)}.mp3`)), `${theme}/${s.name}`).toBe(true);
  });
});
