import { useQuery, type QueryClient } from "@tanstack/react-query";
import { fetchAccount, fetchCatalog, poll } from "./api";
import { allTopics, buildApps, isMuted, topicsKey } from "./catalog";
import { config } from "./config";
import { applyEvents, db, prune } from "./db";
import { syncPushTopics } from "./push";
import { useSession } from "./session";
import { useUi } from "../store/ui";
import type { AppView } from "./types";

export const qk = {
  account: ["account"] as const,
  catalog: ["catalog"] as const,
  backfill: (key: string) => ["backfill", key] as const,
};

const FIFTEEN_MIN = 15 * 60 * 1000;

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
    historyDays: catalog.data?.history_days ?? 90,
    isLoading: account.isLoading || (catalog.isLoading && catalog.fetchStatus !== "idle"),
    error: account.error ?? catalog.error,
    refetch: () => Promise.all([account.refetch(), catalog.refetch()]),
  };
}

/**
 * Backfills history for the current topic set. First time a topic is seen: since=all (old
 * messages arrive already read, except the last 24h). After that: since=<newest time>.
 * Also re-registers web push topics, since the set just changed.
 */
export function useBackfill(apps: AppView[], historyDays: number) {
  const topics = allTopics(apps).map((t) => t.topic);
  const key = topicsKey(topics);
  return useQuery({
    queryKey: qk.backfill(key),
    enabled: topics.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const states = await db.topics.bulkGet(topics);
      const fresh = topics.filter((_, i) => !states[i]?.backfilled);
      const known = topics.filter((_, i) => states[i]?.backfilled);
      let count = 0;
      if (fresh.length) {
        const msgs = await poll(fresh, "all");
        const dayAgo = Date.now() / 1000 - 86400;
        const old = msgs.filter((m) => m.time < dayAgo);
        const recent = msgs.filter((m) => m.time >= dayAgo);
        count += (await applyEvents(old, { markRead: true })).length;
        count += (await applyEvents(recent)).length;
        await db.topics.bulkPut(fresh.map((t) => ({ topic: t, lastTime: Math.max(0, ...msgs.filter((m) => m.topic === t).map((m) => m.time)), backfilled: 1 as const })));
      }
      if (known.length) {
        const since = Math.min(...known.map((t) => states[topics.indexOf(t)]!.lastTime || 0));
        count += (await applyEvents(await poll(known, since ? String(since) : "all"))).length;
      }
      await prune(historyDays);
      void reconcilePush(apps);
      return count;
    },
  });
}

/** Web push gets every visible topic except muted ones. */
export function reconcilePush(apps: AppView[]) {
  const { mutes } = useUi.getState();
  const topics = allTopics(apps)
    .filter((t) => !isMuted(mutes, t))
    .map((t) => t.topic);
  return syncPushTopics(topics).catch(() => undefined);
}

/** Called on stream (re)connect and on a sync-topic event (contract §14.3). */
export const refreshCatalog = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: qk.account });
  void qc.invalidateQueries({ queryKey: qk.catalog });
};
