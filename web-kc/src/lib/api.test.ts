import { describe, expect, it } from "vitest";
import { normalizeCatalog } from "./api";
import type { Catalog } from "./types";

describe("normalizeCatalog (server shape from KudcraftsHQ/ntfy#2)", () => {
  it("fills omitted topics, empty sounds and unknown permissions", () => {
    const raw = {
      version: 1,
      base_url: "https://ntfy.example.com",
      history_days: 0,
      sync_topic: "st_x",
      apps: [
        { id: "a", name: "", icon: "", sound: "alert" }, // topics omitted (omitempty)
        { id: "b", name: "B", icon: "https://b/icon.png", sound: "", topics: [{ topic: "b-x", name: "", sound: "", permission: "weird" }] },
      ],
    } as unknown as Catalog;
    const c = normalizeCatalog(raw);
    expect(c.apps[0]).toMatchObject({ name: "a", topics: [] });
    expect(c.apps[1].sound).toBe("default");
    expect(c.apps[1].topics[0]).toMatchObject({ sound: "default", permission: "read-only" });
    expect(c.history_days).toBe(0);
  });
});
