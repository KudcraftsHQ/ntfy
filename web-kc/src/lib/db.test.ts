import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { applyEvents, claimForUser, db, prune, retentionDays } from "./db";

const now = Math.floor(Date.now() / 1000);
const msg = (id: string, topic: string, ageDays: number, extra = {}) => ({ id, topic, time: now - ageDays * 86400, event: "message", ...extra });

beforeEach(async () => {
  await db.messages.clear();
  await db.topics.clear();
  await db.meta.clear();
});

describe("retention", () => {
  it("never treats a missing or zero history_days as 'keep nothing'", () => {
    expect(retentionDays(0)).toBe(90);
    expect(retentionDays(undefined)).toBe(90);
    expect(retentionDays(-1)).toBe(90);
    expect(retentionDays(30)).toBe(30);
  });
  it("prune(0) keeps recent history", async () => {
    await applyEvents([msg("a", "t", 0), msg("b", "t", 10), msg("c", "t", 120)]);
    await prune(0);
    expect((await db.messages.toArray()).map((m) => m.id).sort()).toEqual(["a", "b"]);
  });
});

describe("applyEvents", () => {
  it("dedupes, replaces updates by sequence id, deletes and clears", async () => {
    expect(await applyEvents([msg("1", "t", 0, { sequence_id: "s" })])).toHaveLength(1);
    expect(await applyEvents([msg("1", "t", 0, { sequence_id: "s" })])).toHaveLength(0);
    await applyEvents([msg("2", "t", 0, { sequence_id: "s", title: "updated" })]);
    expect((await db.messages.toArray()).map((m) => m.id)).toEqual(["2"]);
    await applyEvents([{ ...msg("3", "t", 0, { sequence_id: "s" }), event: "message_clear" }]);
    expect((await db.messages.get("2"))?.read).toBe(1);
    await applyEvents([{ ...msg("4", "t", 0, { sequence_id: "s" }), event: "message_delete" }]);
    expect(await db.messages.count()).toBe(0);
  });
});

describe("claimForUser", () => {
  it("clears the cache when a different user signs in, keeps it for the same user", async () => {
    await claimForUser("alice");
    await applyEvents([msg("a", "t", 0)]);
    await claimForUser("alice");
    expect(await db.messages.count()).toBe(1);
    await claimForUser("bob");
    expect(await db.messages.count()).toBe(0);
  });
});
