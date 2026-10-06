import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { Bell, BellOff, CheckCheck, Filter, Inbox as InboxIcon, Menu, PenSquare, Search, X } from "lucide-react";
import { Fragment, useDeferredValue, useRef, useState } from "react";
import { useMountEffect } from "../hooks/useMountEffect";
import { addAccountSubscription } from "../lib/api";
import { isMuted, topicLabel } from "../lib/catalog";
import { db, markRead, markTopicsRead, markUnread } from "../lib/db";
import { dayLabel } from "../lib/format";
import { reconcilePush, qk } from "../lib/sync";
import type { Scope } from "../lib/scope";
import { scopeTopics } from "../lib/scope";
import type { AppView, StoredMessage, TopicView } from "../lib/types";
import { useUi } from "../store/ui";
import { MessageDetail } from "./MessageDetail";
import { MessageRow } from "./MessageRow";
import { AppIcon, Button, cx, IconButton, Kbd, Spinner } from "./ui";

const PAGE = 150;

const matches = (m: StoredMessage, q: string) =>
  (m.title ?? "").toLowerCase().includes(q) ||
  (m.message ?? "").toLowerCase().includes(q) ||
  m.topic.includes(q) ||
  (m.tags ?? []).some((t) => t.includes(q));

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
};

export function Inbox({ scope, apps, syncing, error, onRetry }: { scope: Scope; apps: AppView[]; syncing: boolean; error: Error | null; onRetry: () => void }) {
  const set = useUi((s) => s.set);
  const unreadOnly = useUi((s) => s.unreadOnly);
  const urgentOnly = useUi((s) => s.urgentOnly);
  const mutes = useUi((s) => s.mutes);
  const toggleMute = useUi((s) => s.toggleMute);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = useDeferredValue(search.trim().toLowerCase());

  const topics = scopeTopics(scope, apps);
  const topicKey = topics.join(",");
  const lookup = new Map<string, { app: AppView; t: TopicView }>();
  for (const app of apps) for (const t of app.topics) lookup.set(t.topic, { app, t });

  const rows = useLiveQuery(() => {
    const set = new Set(topics);
    return db.messages
      .orderBy("time")
      .reverse()
      .filter((m) => set.has(m.topic) && (!unreadOnly || m.read === 0) && (!urgentOnly || (m.priority ?? 3) >= 4) && (!q || matches(m, q)))
      .limit(limit)
      .toArray();
  }, [topicKey, unreadOnly, urgentOnly, q, limit]);
  const unreadCount = useLiveQuery(() => {
    const set = new Set(topics);
    return db.messages.where("read").equals(0).filter((m) => set.has(m.topic)).count();
  }, [topicKey]);

  const selected = rows?.find((m) => m.id === selectedId) ?? null;
  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) void markRead([id]);
  };
  const markAll = () => void markTopicsRead(topics);

  const muteTarget = scope.kind === "app" ? ({ kind: "apps", id: scope.app.id } as const) : scope.kind === "topic" ? ({ kind: "topics", id: scope.topic.topic } as const) : null;
  const muted = scope.kind === "app" ? !!mutes.apps[scope.app.id] : scope.kind === "topic" ? isMuted(mutes, scope.topic) : false;
  const toggleScopeMute = () => {
    if (!muteTarget) return;
    toggleMute(muteTarget.kind, muteTarget.id);
    void reconcilePush(apps);
  };

  // Latest values for the keyboard listener (it is registered once).
  const latest = useRef({ rows, selectedId, select, markAll, toggleScopeMute, selected });
  latest.current = { rows, selectedId, select, markAll, toggleScopeMute, selected };

  useMountEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const L = latest.current;
      if (e.key === "Escape") {
        if (document.activeElement === searchRef.current) searchRef.current?.blur();
        else if (L.selectedId) L.select(null);
        return;
      }
      if (isTyping(e) || useUi.getState().composeOpen || useUi.getState().paletteOpen) return;
      const list = L.rows ?? [];
      const idx = list.findIndex((m) => m.id === L.selectedId);
      const move = (d: number) => {
        const next = list[Math.max(0, Math.min(list.length - 1, idx < 0 ? 0 : idx + d))];
        if (next) {
          L.select(next.id);
          document.getElementById(`msg-${next.id}`)?.scrollIntoView({ block: "nearest" });
        }
        e.preventDefault();
      };
      if (e.key === "j" || e.key === "ArrowDown") move(1);
      else if (e.key === "k" || e.key === "ArrowUp") move(-1);
      else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "o" && L.selected?.click) window.open(L.selected.click, "_blank", "noopener,noreferrer");
      else if (e.key === "u" && L.selected) void (L.selected.read ? markUnread(L.selected.id) : markRead([L.selected.id]));
      else if (e.key === "R" && e.shiftKey) L.markAll();
      else if (e.key === "m") L.toggleScopeMute();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const title =
    scope.kind === "all" ? "All messages" : scope.kind === "app" ? scope.app.name : scope.kind === "topic" ? (topicLabel(scope.app, scope.topic) ?? scope.app.name) : scope.kind === "unknown" ? scope.topic : "";
  const headIcon = scope.kind === "app" || scope.kind === "topic" ? scope.app : null;
  const filtered = unreadOnly || urgentOnly || !!q;

  return (
    <div className="flex h-full min-h-0">
      <section className={cx("flex min-w-0 flex-1 flex-col", selected && "hidden lg:flex lg:w-[380px] lg:flex-none xl:w-[440px]")} aria-label="Messages">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-5">
          <IconButton label="Menu" className="-ml-1 md:hidden" onClick={() => set({ sidebarOpen: true })}>
            <Menu className="size-4.5" />
          </IconButton>
          {headIcon ? <AppIcon name={headIcon.name} icon={headIcon.icon} size={22} /> : <InboxIcon className="size-[18px] text-ink-3" />}
          <div className="flex min-w-0 items-baseline gap-2">
            {scope.kind === "topic" && topicLabel(scope.app, scope.topic) && <span className="hidden truncate text-[14px] text-ink-3 sm:inline">{scope.app.name} /</span>}
            <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{title}</h1>
            {!!unreadCount && <span className="shrink-0 text-[12.5px] text-ink-3 tabular-nums">{unreadCount} unread</span>}
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            {syncing && <Spinner className="mr-2 size-3.5 text-ink-3" />}
            {muteTarget && (
              <IconButton label={muted ? "Unmute (M)" : "Mute (M)"} onClick={toggleScopeMute} active={muted}>
                {muted ? <BellOff className="size-4" /> : <Bell className="size-4" />}
              </IconButton>
            )}
            <IconButton label="Mark all read (Shift+R)" onClick={markAll} disabled={!unreadCount} className="disabled:opacity-40">
              <CheckCheck className="size-4" />
            </IconButton>
            <IconButton
              label="New message (C)"
              onClick={() => set({ composeOpen: true })}
              className="md:hidden"
            >
              <PenSquare className="size-4" />
            </IconButton>
          </div>
        </header>

        {scope.kind !== "unknown" && (
          <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2 md:px-5">
            <label className="relative flex h-8 min-w-0 flex-1 items-center">
              <Search className="pointer-events-none absolute left-2.5 size-3.5 text-ink-3" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setLimit(PAGE);
                }}
                placeholder="Search"
                aria-label="Search messages"
                className="h-8 w-full rounded-lg border border-line bg-panel pr-8 pl-8 text-[13px] outline-none transition placeholder:text-ink-3 focus:border-accent focus:ring-3 focus:ring-accent/15"
              />
              {search ? (
                <button aria-label="Clear search" onClick={() => setSearch("")} className="absolute right-2 text-ink-3 hover:text-ink">
                  <X className="size-3.5" />
                </button>
              ) : (
                <span className={cx("pointer-events-none absolute right-2 hidden", selected ? "xl:block" : "sm:block")}>
                  <Kbd>/</Kbd>
                </span>
              )}
            </label>
            <Chip on={unreadOnly} onClick={() => set({ unreadOnly: !unreadOnly })}>
              Unread
            </Chip>
            <Chip on={urgentOnly} onClick={() => set({ urgentOnly: !urgentOnly })}>
              <span className="hidden sm:inline">High priority</span>
              <span className="sm:hidden">High</span>
            </Chip>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-6 md:px-3">
          {scope.kind === "unknown" ? (
            <UnknownTopic topic={scope.topic} />
          ) : error && !rows?.length ? (
            <Empty icon={<InboxIcon />} title="Couldn't reach ntfy" body={error.message}>
              <Button onClick={onRetry}>Try again</Button>
            </Empty>
          ) : rows === undefined || (rows.length === 0 && syncing && !filtered) ? (
            <Skeleton />
          ) : rows.length === 0 ? (
            filtered ? (
              <Empty icon={<Filter />} title="No matches" body="Nothing in this view matches your search and filters.">
                <Button
                  onClick={() => {
                    setSearch("");
                    set({ unreadOnly: false, urgentOnly: false });
                  }}
                >
                  Clear filters
                </Button>
              </Empty>
            ) : topics.length === 0 ? (
              <Empty icon={<InboxIcon />} title="No topics yet" body="Apps appear in the sidebar after they publish their first message, as long as your account can read them." />
            ) : (
              <Empty
                icon={<InboxIcon />}
                title="All quiet"
                body={scope.kind === "topic" ? `New messages to ${scope.topic.topic} will show up here the moment they're sent.` : "New messages will show up here the moment they're sent."}
              />
            )
          ) : (
            <ul>
              {rows.map((m, i) => {
                const day = dayLabel(m.time);
                const showDay = i === 0 || dayLabel(rows[i - 1].time) !== day;
                const l = lookup.get(m.topic);
                return (
                  <Fragment key={m.id}>
                    {showDay && (
                      <li className="sticky top-0 z-10 bg-canvas px-3 pt-3 pb-1.5 text-[11.5px] font-semibold text-ink-3" role="presentation">
                        {day}
                      </li>
                    )}
                    <li>
                      <MessageRow m={m} app={l?.app} topic={l?.t} showSource={scope.kind !== "topic"} selected={m.id === selectedId} onSelect={select} />
                    </li>
                  </Fragment>
                );
              })}
              {rows.length >= limit && (
                <li className="flex justify-center py-4">
                  <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + PAGE)}>
                    Show older messages
                  </Button>
                </li>
              )}
            </ul>
          )}
        </div>
      </section>

      {selected && (
        <aside className="min-w-0 flex-1 border-line lg:border-l">
          <MessageDetail key={selected.id} m={selected} app={lookup.get(selected.topic)?.app} topic={lookup.get(selected.topic)?.t} onClose={() => select(null)} />
        </aside>
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        "h-8 shrink-0 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors",
        on ? "border-accent/40 bg-accent-soft text-accent-ink" : "border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function Empty({ icon, title, body, children }: { icon: React.ReactNode; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="animate-in flex flex-col items-center px-6 py-20 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-line bg-panel text-ink-3 shadow-sm [&>svg]:size-5">{icon}</div>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {body && <p className="mt-1.5 max-w-[340px] text-[13px] leading-relaxed text-ink-3">{body}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

function Skeleton() {
  return (
    <ul className="space-y-1 px-3 pt-3" aria-busy aria-label="Loading messages">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <li key={i} className="flex gap-3 py-3" style={{ opacity: 1 - i * 0.14 }}>
          <div className="size-9 animate-pulse rounded-[9px] bg-active" />
          <div className="flex-1 space-y-2 pt-0.5">
            <div className="h-2.5 w-24 animate-pulse rounded bg-active" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-active" />
            <div className="h-2.5 w-4/5 animate-pulse rounded bg-active" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function UnknownTopic({ topic }: { topic: string }) {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => addAccountSubscription(topic), onSuccess: () => qc.invalidateQueries({ queryKey: qk.account }) });
  return (
    <Empty icon={<InboxIcon />} title={`Not subscribed to ${topic}`} body="Subscribe to see its history and get new messages. Your account needs read access to it.">
      <Button variant="primary" onClick={() => m.mutate()} disabled={m.isPending}>
        {m.isPending ? <Spinner /> : "Subscribe"}
      </Button>
      {m.error && <p className="mt-3 text-[12.5px] text-urgent">{m.error.message}</p>}
    </Empty>
  );
}
