/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";
import { clientsClaim } from "workbox-core";
import { applyEvents, db } from "./lib/db";
import { EVENT_MESSAGE, EVENT_MESSAGE_CLEAR, EVENT_MESSAGE_DELETE } from "./lib/stream";
import { notificationTitle } from "./lib/notify-format";
import { safeHttpUrl, safeUrl } from "./lib/url";
import type { Action, NtfyMessage } from "./lib/types";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };
declare const config: { app_root: string };

const ICON = "/static/images/ntfy.png";
const BADGE = "/static/images/ntfy-mask.svg";

const tagFor = (m: NtfyMessage) => `${m.topic}/${m.sequence_id || m.id}`;

async function updateBadge() {
  const n = await db.messages.where("read").equals(0).count();
  // setAppBadge exists on WorkerNavigator in Chromium.
  const nav = self.navigator as unknown as { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  await (n ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => undefined);
}

async function closeTagged(m: NtfyMessage) {
  for (const n of await self.registration.getNotifications({ tag: tagFor(m) })) n.close();
}

async function onPush(data: { event?: string; message?: NtfyMessage }) {
  const m = data.message;
  if (data.event === "message" && m) {
    if (m.event === EVENT_MESSAGE) {
      // Titles, icons and sound classes come from the catalog via IndexedDB (written by the app).
      const meta = await db.topicMeta.get(m.topic).catch(() => undefined);
      const quiet = (m.priority ?? 3) <= 2 || meta?.sound === "silent";
      // Always show: Safari revokes push subscriptions that do not show a notification promptly.
      const opts: NotificationOptions & { image?: string; timestamp?: number; renotify?: boolean; actions?: { action: string; title: string }[] } = {
        body: (m.message ?? "").slice(0, 400),
        icon: safeHttpUrl(m.icon) || safeHttpUrl(meta?.icon) || ICON,
        silent: quiet,
        badge: BADGE,
        tag: tagFor(m),
        renotify: true,
        timestamp: m.time * 1000,
        data: { message: m },
        actions: (m.actions ?? [])
          .filter((a) => (a.action === "view" && safeUrl(a.url)) || (a.action === "http" && safeHttpUrl(a.url)))
          .slice(0, 2).map((a) => ({ action: a.id || a.label, title: a.label })),
      };
      const image = safeHttpUrl(m.attachment?.url);
      if (image && m.attachment?.type?.startsWith("image/")) opts.image = image;
      await self.registration.showNotification(notificationTitle(m, meta?.title || m.topic), opts);
      await applyEvents([m]);
      await updateBadge();
      return;
    }
    if (m.event === EVENT_MESSAGE_DELETE || m.event === EVENT_MESSAGE_CLEAR) {
      await applyEvents([m]);
      await closeTagged(m);
      await updateBadge();
      return;
    }
  }
  if (data.event === "subscription_expiring") {
    await self.registration.showNotification("Push notifications are expiring", {
      body: "Open ntfy to keep receiving them.",
      icon: ICON,
      badge: BADGE,
    });
    return;
  }
  await self.registration.showNotification("New notification", { body: "Open ntfy to see it.", icon: ICON, badge: BADGE });
}

async function focusOrOpen(path: string) {
  const url = new URL(path, self.location.origin).toString();
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const exact = windows.find((c) => c.url === url);
  if (exact) return exact.focus();
  const any = windows[0];
  if (any) {
    await any.focus();
    return any.navigate(url);
  }
  return self.clients.openWindow(url);
}

async function onClick(e: NotificationEvent) {
  e.notification.close();
  const m: NtfyMessage | undefined = e.notification.data?.message;
  if (!m) return focusOrOpen("/");
  if (e.action) {
    const a: Action | undefined = (m.actions ?? []).find((x) => (x.id || x.label) === e.action);
    if (a?.action === "view") {
      const url = safeUrl(a.url);
      return url ? self.clients.openWindow(url) : undefined;
    }
    const httpUrl = a?.action === "http" ? safeHttpUrl(a.url) : null;
    if (a && httpUrl) {
      try {
        const res = await fetch(httpUrl, { method: a.method ?? "POST", headers: a.headers ?? {}, body: a.body });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        await self.registration.showNotification(`Action failed: ${a.label}`, { body: String(err), icon: ICON, badge: BADGE });
      }
      return;
    }
  }
  await db.messages.update(m.id, { read: 1 }).catch(() => undefined);
  await updateBadge();
  const click = safeUrl(m.click);
  if (click) return self.clients.openWindow(click);
  return focusOrOpen(`/${encodeURIComponent(m.topic)}`);
}

self.addEventListener("install", () => void self.skipWaiting());
self.addEventListener("push", (e) => {
  const data = e.data?.json() ?? {};
  e.waitUntil(onPush(data));
});
self.addEventListener("notificationclick", (e) => e.waitUntil(onClick(e)));

precacheAndRoute(self.__WB_MANIFEST);
clientsClaim();
cleanupOutdatedCaches();

if (!import.meta.env.DEV) {
  // config.js is generated by the Go server; it gives us app_root for the SPA fallback.
  self.importScripts("/config.js");
  registerRoute(new NavigationRoute(createHandlerBoundToURL("/app.html"), { allowlist: [new RegExp(`^${config.app_root}$`)] }));
  registerRoute(({ url }) => url.pathname === "/config.js", new NetworkFirst());
}
