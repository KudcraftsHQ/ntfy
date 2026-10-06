import { useQueryClient } from "@tanstack/react-query";
import { useMountEffect } from "../hooks/useMountEffect";
import { streamUrl } from "../lib/api";
import { shouldAlert } from "../lib/catalog";
import { applyEvents, db } from "../lib/db";
import { playSound, showNotification } from "../lib/notify";
import { pushState } from "../lib/push";
import { currentToken } from "../lib/session";
import { isSyncEvent, parseLine, retryDelay } from "../lib/stream";
import { refreshCatalog } from "../lib/sync";
import { useUi } from "../store/ui";
import type { AppView, TopicView } from "../lib/types";

export type StreamStatus = "connecting" | "live" | "offline";

/**
 * One WebSocket for every visible topic plus the account sync topic.
 * Mounted with key={topicsKey}, so a changed topic set tears it down and reconnects.
 */
export function StreamConnector({ apps, syncTopic, onStatus }: { apps: AppView[]; syncTopic: string | null; onStatus: (s: StreamStatus) => void }) {
  const qc = useQueryClient();
  useMountEffect(() => {
    const byTopic = new Map<string, { t: TopicView; app: AppView }>();
    for (const app of apps) for (const t of app.topics) byTopic.set(t.topic, { t, app });
    const topics = [...byTopic.keys()];
    if (syncTopic) topics.push(syncTopic);
    if (topics.length === 0) return;

    let ws: WebSocket | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let pushOn = false;
    void pushState().then((s) => (pushOn = s === "on"));

    const sinceTime = async () => {
      const states = await db.topics.bulkGet([...byTopic.keys()]);
      const times = states.map((s) => s?.lastTime ?? 0).filter(Boolean);
      return times.length ? String(Math.min(...times)) : null;
    };

    const onMessage = async (raw: string) => {
      const m = parseLine(raw);
      if (!m) return;
      if (m.topic === syncTopic) {
        if (isSyncEvent(m)) refreshCatalog(qc);
        return;
      }
      const entry = byTopic.get(m.topic);
      const fresh = await applyEvents([m]);
      if (!fresh.length || !entry) return;
      const ui = useUi.getState();
      const { notify, sound } = shouldAlert(ui.mutes, entry.t, m.priority);
      if (!notify) return;
      if (ui.sound) playSound(sound);
      const visible = document.visibilityState === "visible" && document.hasFocus();
      // When web push is on, the service worker already shows the notification.
      if (!visible && !pushOn && ui.notify) void showNotification(m, entry.t.name, entry.app.icon);
    };

    const connect = async () => {
      if (closed) return;
      onStatus("connecting");
      ws = new WebSocket(streamUrl(topics, await sinceTime(), currentToken()));
      ws.onopen = () => {
        attempt = 0;
        onStatus("live");
        refreshCatalog(qc); // contract §14.3: refetch on every (re)connect
      };
      ws.onmessage = (e) => void onMessage(String(e.data));
      ws.onclose = () => {
        if (closed) return;
        onStatus("offline");
        timer = setTimeout(connect, retryDelay(attempt++) * 1000);
      };
    };
    void connect();

    // Reconnect promptly when the device wakes or comes back online.
    const wake = () => {
      if (ws && ws.readyState <= WebSocket.OPEN) return;
      clearTimeout(timer);
      attempt = 0;
      void connect();
    };
    window.addEventListener("online", wake);
    const onVisible = () => document.visibilityState === "visible" && wake();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisible);
    };
  });
  return null;
}
