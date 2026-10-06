import { BellOff, ChevronRight, Inbox, Lock, PenSquare, Search, Settings } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { config } from "../lib/config";
import { isMuted, isNested, shortTopicName } from "../lib/catalog";
import type { Scope } from "../lib/scope";
import { scopeHref } from "../lib/scope";
import { useSession } from "../lib/session";
import type { AppView } from "../lib/types";
import { useUi } from "../store/ui";
import type { StreamStatus } from "./StreamConnector";
import { AppIcon, cx, IconButton, Kbd } from "./ui";

/** Unread count: a plain number (calm), with an accent dot when it should draw the eye. */
function Count({ n, muted }: { n: number; muted?: boolean }) {
  if (!n) return null;
  return (
    <span className={cx("ml-auto flex items-center gap-1.5 text-[12.5px] tabular-nums", muted ? "text-ink-3" : "font-medium text-ink-2")}>
      {!muted && <span className="size-1.5 rounded-full bg-unread" aria-hidden />}
      {n > 999 ? "999+" : n}
    </span>
  );
}

const statusCopy: Record<StreamStatus, string> = { live: "Live", connecting: "Connecting", offline: "Reconnecting" };

export function Sidebar({
  apps,
  denied,
  unread,
  scope,
  status,
  loading,
}: {
  apps: AppView[];
  denied: Set<string>;
  unread: Record<string, number>;
  scope: Scope;
  status: StreamStatus;
  loading: boolean;
}) {
  const mutes = useUi((s) => s.mutes);
  const set = useUi((s) => s.set);
  const username = useSession((s) => s.session?.username ?? "");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const total = Object.values(unread).reduce((a, b) => a + b, 0);
  const close = () => set({ sidebarOpen: false });
  const host = config.base_url.replace(/^https?:\/\//, "");

  const rowBase = "group flex h-9 items-center gap-3 rounded-[10px] px-2.5 text-[14.5px] transition-colors duration-150";
  const rowState = (active: boolean) => (active ? "bg-active text-ink" : "text-ink-2 hover:bg-hover hover:text-ink");

  return (
    <nav className="flex h-full w-full flex-col bg-sidebar" aria-label="Apps and topics">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-4">
        <img src="/static/images/pwa-192x192.png" alt="" className="size-7 rounded-lg" />
        <div className="min-w-0 leading-tight">
          <div className="text-[15px] font-semibold tracking-[-0.01em]">ntfy</div>
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3" title={`${statusCopy[status]} · ${host}`}>
            <span
              className={cx(
                "size-1.5 rounded-full",
                status === "live" ? "bg-accent" : status === "connecting" ? "bg-high animate-pulse" : "bg-ink-3 animate-pulse",
              )}
            />
            <span className="truncate">{status === "live" ? host : statusCopy[status]}</span>
          </div>
        </div>
        <IconButton label="New message (C)" className="ml-auto" onClick={() => set({ composeOpen: true, sidebarOpen: false })}>
          <PenSquare className="size-[17px]" />
        </IconButton>
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={() => set({ paletteOpen: true, sidebarOpen: false })}
          className="flex h-9 w-full items-center gap-2 rounded-[10px] border border-line bg-canvas px-2.5 text-[13.5px] text-ink-3 shadow-[0_1px_1px_rgb(20_20_40/0.03)] transition hover:border-line-strong"
        >
          <Search className="size-3.5" />
          Jump to…
          <span className="ml-auto flex gap-0.5">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <Link href="/" onClick={close} className={cx(rowBase, rowState(scope.kind === "all"))}>
          <Inbox className="size-[17px] shrink-0 stroke-[1.6]" />
          All messages
          <Count n={total} />
        </Link>

        <div className="mt-6 mb-1.5 px-2.5 text-[12.5px] font-medium text-ink-3">Apps</div>
        {loading && apps.length === 0 && (
          <div className="space-y-1.5 px-2 pt-1" aria-busy>
            {[70, 55, 80, 60].map((w) => (
              <div key={w} className="flex h-8 items-center gap-2.5">
                <div className="size-5 animate-pulse rounded-md bg-active" />
                <div className="h-2.5 animate-pulse rounded bg-active" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        )}
        {!loading && apps.length === 0 && <p className="px-2 py-2 text-[12.5px] leading-relaxed text-ink-3">No topics yet. Apps appear here after their first message.</p>}

        <ul className="space-y-px">
          {apps.map((app) => {
            const appUnread = app.topics.reduce((n, t) => n + (unread[t.topic] ?? 0), 0);
            const appMuted = !!mutes.apps[app.id];
            const nested = isNested(app);
            const open = nested && !collapsed[app.id];
            const appActive = (scope.kind === "app" || (scope.kind === "topic" && !nested)) && scope.app.id === app.id;
            return (
              <li key={app.id}>
                <div className="relative">
                  <Link href={scopeHref({ app: app.id })} onClick={close} className={cx(rowBase, rowState(appActive), "pr-2")}>
                    <AppIcon name={app.name} icon={app.icon} size={22} />
                    <span className="truncate">{app.name}</span>
                    {!nested && denied.has(app.topics[0]?.topic) && <Lock className="size-3 shrink-0 text-ink-3" aria-label="No access" />}
                    {appMuted && <BellOff className="size-3 shrink-0 text-ink-3" aria-label="Muted" />}
                    <Count n={appUnread} muted={appMuted} />
                    {nested && <span className="w-4 shrink-0" />}
                  </Link>
                  {nested && (
                    <button
                      aria-label={open ? `Collapse ${app.name}` : `Expand ${app.name}`}
                      onClick={() => setCollapsed((c) => ({ ...c, [app.id]: open }))}
                      className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-active hover:text-ink"
                    >
                      <ChevronRight className={cx("size-3.5 transition-transform", open && "rotate-90")} />
                    </button>
                  )}
                </div>
                {open && (
                  <ul className="relative mt-px mb-1.5 ml-[21px] space-y-px border-l border-line pl-2.5">
                    {app.topics.map((t) => {
                      const active = scope.kind === "topic" && scope.topic.topic === t.topic;
                      const muted = isMuted(mutes, t);
                      const noAccess = denied.has(t.topic);
                      return (
                        <li key={t.topic}>
                          <Link href={scopeHref({ topic: t.topic })} onClick={close} className={cx(rowBase, "h-8 text-[14px]", rowState(active))}>
                            {noAccess && <Lock className="size-3.5 shrink-0 text-ink-3" aria-label="No access" />}
                            <span className={cx("truncate", (muted || noAccess) && "text-ink-3")} title={noAccess ? "No access" : undefined}>
                              {shortTopicName(t)}
                            </span>
                            {muted && !appMuted && <BellOff className="size-3 shrink-0 text-ink-3" aria-label="Muted" />}
                            <Count n={unread[t.topic] ?? 0} muted={muted} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-line p-3">
        <Link href="/settings" onClick={close} className={cx(rowBase, rowState(scope.kind === "settings"), "h-10")}>
          <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-ink">{username.slice(0, 1).toUpperCase()}</span>
          <span className="truncate">{username}</span>
          <Settings className="ml-auto size-4 stroke-[1.6] text-ink-3" />
        </Link>
      </div>
    </nav>
  );
}
