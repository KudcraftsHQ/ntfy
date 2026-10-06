import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMountEffect } from "../hooks/useMountEffect";
import { extendToken } from "../lib/api";
import { allTopics, topicsKey } from "../lib/catalog";
import { db } from "../lib/db";
import { liveQuery } from "dexie";
import { resolveScope, scopeKey } from "../lib/scope";
import { useAccess, useApps, useBackfill, useTopicMetaSync } from "../lib/sync";
import { useUi } from "../store/ui";
import { CommandPalette } from "./CommandPalette";
import { Compose } from "./Compose";
import { HelpDialog } from "./HelpDialog";
import { Inbox } from "./Inbox";
import { SettingsPage } from "./SettingsPage";
import { Sidebar } from "./Sidebar";
import { StreamConnector, type StreamStatus } from "./StreamConnector";
import { cx } from "./ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export function Shell() {
  const { apps: catalogApps, syncTopic, historyDays, isLoading, error, refetch } = useApps();
  // Without catalog icons (catalog off, or publisher never sent X-App-Icon), borrow the icon of the
  // app's most recent message that carried one.
  const msgIcons =
    useLiveQuery(async () => {
      const map: Record<string, string> = {};
      await db.messages
        .orderBy("time")
        .reverse()
        .limit(2000)
        .each((m) => {
          if (m.icon && !map[m.topic]) map[m.topic] = m.icon;
        });
      return map;
    }, []) ?? {};
  const apps = catalogApps.map((a) => (a.icon ? a : { ...a, icon: a.topics.map((t) => msgIcons[t.topic]).find(Boolean) ?? "" }));
  const qc = useQueryClient();
  const access = useAccess(apps);
  const backfill = useBackfill(access.readable, historyDays, access.ready, qc);
  useTopicMetaSync(apps);
  // Login tokens expire after 72 h of no use; keep extending even while the tab is hidden.
  useQuery({
    queryKey: ["token-extend"],
    queryFn: extendToken,
    refetchInterval: 60 * 60 * 1000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const readableRef = useRef(access.readable);
  readableRef.current = access.readable;
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [path] = useLocation();
  const search = useSearch();
  const scope = resolveScope(path, search, apps);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const set = useUi((s) => s.set);

  const unread =
    useLiveQuery(async () => {
      const counts: Record<string, number> = {};
      await db.messages
        .where("read")
        .equals(0)
        .each((m) => (counts[m.topic] = (counts[m.topic] ?? 0) + 1));
      return counts;
    }, []) ?? {};

  const streamKey = `${topicsKey(allTopics(access.readable).map((t) => t.topic))}|${syncTopic ?? ""}`;

  return (
    <div className="flex h-full overflow-hidden">
      <GlobalKeys />
      <BadgeSync />
      {!isLoading && access.ready && <StreamConnector key={streamKey} appsRef={readableRef} syncTopic={syncTopic} onStatus={setStatus} />}

      {/* Sidebar: static from md up, a drawer below. */}
      <div
        className={cx("fixed inset-0 z-40 bg-black/30 transition-opacity md:hidden", sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={() => set({ sidebarOpen: false })}
      />
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 w-[272px] border-r border-line transition-transform md:static md:z-auto md:w-[248px] md:shrink-0 md:translate-x-0 lg:w-[264px]",
          sidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
        )}
      >
        <Sidebar apps={apps} denied={access.denied} unread={unread} scope={scope} status={status} loading={isLoading} />
      </aside>

      <main className="min-w-0 flex-1">
        {scope.kind === "settings" ? (
          <SettingsPage apps={apps} />
        ) : (
          <Inbox key={scopeKey(scope)} scope={scope} apps={apps} denied={access.denied} syncing={isLoading || backfill.isFetching} error={(error ?? backfill.error) as Error | null} onRetry={() => void refetch()} />
        )}
      </main>

      <Compose apps={apps} defaultTopic={scope.kind === "topic" ? scope.topic.topic : scope.kind === "app" ? scope.app.topics[0]?.topic : undefined} />
      <CommandPalette apps={apps} unread={unread} />
      <HelpDialog />
    </div>
  );
}

/** App-wide shortcuts: ⌘K palette, C compose, ? help, G then A/S. */
function GlobalKeys() {
  const [, navigate] = useLocation();
  const nav = useRef(navigate);
  nav.current = navigate;
  useMountEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (e.key === "Escape" && (ui.helpOpen || ui.paletteOpen || ui.composeOpen)) {
        ui.set({ helpOpen: false, paletteOpen: false, composeOpen: false });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.set({ paletteOpen: !ui.paletteOpen });
        return;
      }
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (ui.composeOpen || ui.paletteOpen) return;
      if (Date.now() - g < 800) {
        g = 0;
        if (e.key === "a") nav.current("/");
        else if (e.key === "s") nav.current("/settings");
        return;
      }
      if (e.key === "g") g = Date.now();
      else if (e.key === "c") {
        e.preventDefault();
        ui.set({ composeOpen: true });
      } else if (e.key === "?") ui.set({ helpOpen: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return null;
}

/** Mirrors the unread count into the tab title and the installed-PWA badge. */
function BadgeSync() {
  useMountEffect(() => {
    const sub = liveQuery(() => db.messages.where("read").equals(0).count()).subscribe((n) => {
      document.title = n ? `(${n}) ntfy` : "ntfy";
      if ("setAppBadge" in navigator) void (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => undefined);
    });
    return () => sub.unsubscribe();
  });
  return null;
}
