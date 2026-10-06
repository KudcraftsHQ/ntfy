import { describe, expect, it } from "vitest";
import { allTopics, buildApps, deriveAppId, readableApps, isMuted, shortTopicName, shouldAlert, titleCase, topicsKey } from "./catalog";
import type { Catalog } from "./types";

const BASE = "https://ntfy.example.com";
const catalog: Catalog = {
  version: 1,
  base_url: BASE,
  history_days: 90,
  sync_topic: "st_1",
  apps: [
    {
      id: "facemap",
      name: "FaceMap",
      icon: "https://facemap.fyi/icon.png",
      sound: "default",
      topics: [
        { topic: "facemap-orders", name: "Orders", sound: "alert", permission: "read-only" },
        { topic: "facemap-alerts", name: "", sound: "default", permission: "read-write" },
      ],
    },
    { id: "empty", name: "Empty", icon: "", sound: "default", topics: [] },
  ],
};

describe("deriveAppId / titleCase", () => {
  it("uses the prefix before the first dash", () => {
    expect(deriveAppId("facemap-orders")).toBe("facemap");
    expect(deriveAppId("kudtrading")).toBe("kudtrading");
    expect(titleCase("data-cuan")).toBe("Data Cuan");
  });
});

describe("buildApps", () => {
  it("groups catalog topics, sorts topics, resolves names and permissions", () => {
    const apps = buildApps(catalog, [], BASE);
    expect(apps.map((a) => a.id)).toEqual(["facemap"]); // apps without topics are dropped
    const [fm] = apps;
    expect(fm.topics.map((t) => t.topic)).toEqual(["facemap-alerts", "facemap-orders"]);
    expect(fm.topics[1]).toMatchObject({ name: "Orders", sound: "alert", writable: false, managed: true });
    expect(fm.topics[0]).toMatchObject({ name: "facemap-alerts", writable: true });
  });

  it("user rename beats catalog name (contract §14.7)", () => {
    const apps = buildApps(catalog, [{ base_url: BASE, topic: "facemap-orders", display_name: "Sales" }], BASE);
    expect(apps[0].topics.find((t) => t.topic === "facemap-orders")?.name).toBe("Sales");
  });

  it("groups non-catalog subscriptions by derived app and ignores other servers", () => {
    const apps = buildApps(
      null,
      [
        { base_url: BASE, topic: "typemap-sales" },
        { base_url: `${BASE}/`, topic: "typemap" },
        { base_url: BASE, topic: "coolify" },
        { base_url: "https://ntfy.sh", topic: "elsewhere" },
      ],
      BASE,
    );
    expect(apps.map((a) => [a.id, a.name, a.topics.map((t) => t.topic)])).toEqual([
      ["coolify", "Coolify", ["coolify"]],
      ["typemap", "Typemap", ["typemap", "typemap-sales"]],
    ]);
    expect(apps[1].topics.every((t) => !t.managed)).toBe(true);
  });

  it("merges a subscription into the catalog app it belongs to without duplicating", () => {
    const apps = buildApps(catalog, [{ base_url: BASE, topic: "facemap-orders" }, { base_url: BASE, topic: "facemap-extra" }], BASE);
    expect(apps[0].topics.map((t) => t.topic)).toEqual(["facemap-alerts", "facemap-extra", "facemap-orders"]);
  });
});

describe("display helpers", () => {
  it("shortTopicName strips the app prefix", () => {
    const t = { topic: "facemap-orders", appId: "facemap", name: "facemap-orders", sound: "default" as const, writable: true, managed: true };
    expect(shortTopicName(t)).toBe("orders");
    expect(shortTopicName({ ...t, topic: "facemap", name: "facemap" })).toBe("general");
    expect(shortTopicName({ ...t, name: "Orders" })).toBe("Orders");
  });
  it("topicsKey is order-independent", () => {
    expect(topicsKey(["b", "a"])).toBe(topicsKey(["a", "b"]));
  });
});

describe("mutes and alerts", () => {
  const t = { topic: "facemap-orders", appId: "facemap", name: "Orders", sound: "alert" as const, writable: true, managed: true };
  it("app mute covers its topics", () => {
    expect(isMuted({ apps: { facemap: true }, topics: {} }, t)).toBe(true);
    expect(isMuted({ apps: {}, topics: { "facemap-orders": true } }, t)).toBe(true);
    expect(isMuted({ apps: {}, topics: {} }, t)).toBe(false);
  });
  it("muted or min-priority never alerts; low priority is silent", () => {
    const none = { apps: {}, topics: {} };
    expect(shouldAlert({ apps: { facemap: true }, topics: {} }, t, 5).notify).toBe(false);
    expect(shouldAlert(none, t, 1).notify).toBe(false);
    expect(shouldAlert(none, t, 2)).toEqual({ notify: true, sound: "silent" });
    expect(shouldAlert(none, t, 4)).toEqual({ notify: true, sound: "alert" });
  });
});

describe("readableApps", () => {
  it("drops unreadable topics so one 403 cannot take the whole stream down", () => {
    const apps = buildApps(null, [{ base_url: BASE, topic: "typemap" }, { base_url: BASE, topic: "typemap-sales" }, { base_url: BASE, topic: "coolify" }], BASE);
    const r = readableApps(apps, new Set(["typemap-sales", "coolify"]));
    expect(allTopics(r).map((t) => t.topic)).toEqual(["typemap"]);
    expect(r.map((a) => a.id)).toEqual(["typemap"]);
  });
});
