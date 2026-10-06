import { useQuery, type QueryClient } from "@tanstack/react-query";
import { canRead, fetchAccount, fetchCatalog, HttpError, poll } from "./api";
import { allTopics, buildApps, isMuted, readableApps, shortTopicName, topicsKey } from "./catalog";
import { config } from "./config";
import { applyEvents, db, prune, retentionDays } from "./db";
import { syncPushTopics } from "./push";
import { useSession } from "./session";
import { useUi } from "../store/ui";
import type { AppView } from "./types";

export const qk = {
  account: ["account"] as const,
  catalog: ["catalog"] as const,
  access: (key: string) => ["access", key] as const,
  backfill: (key: string) => ["backfill", key] as const,
  topicMeta: (key: string) => ["topic-meta", key] as const,
};

const FIFTEEN_MIN = 15 * 60 * 1000;

/** Last probe result, so mute toggles never register unreadable topics for web push. */
let deniedTopics = new Set<string>();

/** Account + catalog -> the sidebar model. Everything else derives from this. */
export function useApps() {
  const token = useSession((s) => s.session?.token);
  const account = useQuery({ queryKey: qk.account, queryFn: fetchAccount, enabled: !!token, refetchInterval: FIFTEEN_MIN });
  const catalog = useQuery({
    queryKey: qk.catalog,
    queryFn: fetchCatalog,
    enabled: !!token && config.enable_catalog !== false,
    refetchInterval: FIFTEEN_MIN,
  });
  const apps: AppView[] = buildApps(catalog.data ?? null, account.data?.subscriptions ?? [], config.base_url);
  return {
    apps,
    account: account.data,
    catalog: catalog.data ?? null,
    syncTopic: catalog.data?.sync_topic || account.data?.sync_topic || null,
    historyDays: retentionDays(catalog.data?.history_days),
    isLoading: account.isLoading || (catalog.isLoading && catalog.fetchStatus !== "idle"),
    error: account.error ?? catalog.error,
    refetch: () => Promise.all([account.refetch(), catalog.refetch()]),
  };
}

/** Runs `fn` over items with at most `n` in flight. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/**
 * Which topics this account can read. ntfy answers 403 to a whole multi-topic stream or poll if any
 * one topic is unreadable, so every topic is probed (GET /<topic>/auth) and unreadable ones are left
 * out of the stream, the backfill and web push, and shown as "no access" instead.
 */
export function useAccess(apps: AppView[]) {
  const topics = allTopics(apps).map((t) => t.topic);
  const key = topicsKey(topics);
  const q = useQuery({
    queryKey: qk.access(key),
    enabled: topics.length > 0,
    staleTime: FIFTEEN_MIN,
    queryFn: async () => {
      const ok = await pool(topics, 6, (t) => canRead(t).catch((e) => (e instanceof HttpError && e.status === 401 ? Promise.reject(e) : true)));
      const denied = topics.filter((_, i) => !ok[i]);
      deniedTopics = new Set(denied);
      return denied;
    },
  });
  const denied = new Set(q.data ?? []);
  const readable = readableApps(apps, denied);
  return { denied, readable, ready: q.isSuccess || topics.length === 0 };
}

/** Re-probe access (after a stream or poll was refused) and refetch the account so a 401 surfaces. */
export const recheckAccess = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: ["access"] });
  void qc.invalidateQueries({ queryKey: qk.account });
};

/**
 * Backfills history for the readable topic set. First time a topic is seen: everything within the
 * retention window (old messages arrive already read, except the last 24h). After that:
 * since=<newest time>. Also re-registers web push topics, since the set just changed.
 */
export function useBackfill(readable: AppView[], historyDays: number, enabled: boolean, qc: QueryClient) {
  const topics = allTopics(readable).map((t) => t.topic);
  const key = topicsKey(topics);
  return useQuery({
    queryKey: qk.backfill(key),
    enabled: enabled && topics.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      try {
        const states = await db.topics.bulkGet(topics);
        const fresh = topics.filter((_, i) => !states[i]?.backfilled);
        const known = topics.filter((_, i) => states[i]?.backfilled);
        const windowStart = String(Math.floor(Date.now() / 1000 - retentionDays(historyDays) * 86400));
        let count = 0;
        if (fresh.length) {
          const msgs = await poll(fresh, windowStart);
          const dayAgo = Date.now() / 1000 - 86400;
          count += (await applyEvents(msgs.filter((m) => m.time < dayAgo), { markRead: true })).length;
          count += (await applyEvents(msgs.filter((m) => m.time >= dayAgo))).length;
          await db.topics.bulkPut(
            fresh.map((t) => ({ topic: t, lastTime: Math.max(0, ...msgs.filter((m) => m.topic === t).map((m) => m.time)), backfilled: 1 as const })),
          );
        }
        if (known.length) {
          const since = Math.min(...known.map((t) => states[topics.indexOf(t)]!.lastTime || 0));
          count += (await applyEvents(await poll(known, since ? String(since) : windowStart))).length;
        }
        await prune(historyDays);
        void reconcilePush(readable);
        return count;
      } catch (e) {
        if (e instanceof HttpError && e.status === 403) recheckAccess(qc);
        throw e;
      }
    },
  });
}

/**
 * Writes topic titles/icons/sounds to IndexedDB for the service worker, which cannot see the
 * catalog. Keyed on the content, so it only runs when something actually changed.
 */
export function useTopicMetaSync(apps: AppView[]) {
  const rows = apps.flatMap((a) =>
    a.topics.map((t) => ({
      topic: t.topic,
      title: a.topics.length > 1 || t.topic !== a.id ? `${a.name} / ${shortTopicName(t)}` : a.name,
      icon: a.icon,
      sound: t.sound,
    })),
  );
  const key = JSON.stringify(rows);
  useQuery({
    queryKey: qk.topicMeta(key),
    enabled: rows.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      await db.transaction("rw", db.topicMeta, async () => {
        await db.topicMeta.clear();
        await db.topicMeta.bulkPut(rows);
      });
      return rows.length;
    },
  });
}

/** Web push gets every readable topic except muted ones. */
export function reconcilePush(apps: AppView[]) {
  const { mutes } = useUi.getState();
  const topics = allTopics(apps)
    .filter((t) => !deniedTopics.has(t.topic) && !isMuted(mutes, t))
    .map((t) => t.topic);
  return syncPushTopics(topics).catch(() => undefined);
}

/** Called on stream (re)connect and on a sync-topic event (contract §14.3). */
export const refreshCatalog = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: qk.account });
  void qc.invalidateQueries({ queryKey: qk.catalog });
};
