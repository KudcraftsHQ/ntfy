import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { Bell, BellOff, CheckCheck, Filter, Inbox as InboxIcon, Lock, Menu, PenSquare, Search, X } from "lucide-react";
import { useLocation } from "wouter";
import { Fragment, useDeferredValue, useRef, useState } from "react";
import { useMountEffect } from "../hooks/useMountEffect";
import { addAccountSubscription, removeAccountSubscription } from "../lib/api";
import { isMuted, topicLabel } from "../lib/catalog";
import { db, markRead, markTopicsRead, markUnread } from "../lib/db";
import { dayLabel } from "../lib/format";
import { openSafe } from "../lib/url";
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

export function Inbox({
  scope,
  apps,
  denied,
  syncing,
  error,
  onRetry,
}: {
  scope: Scope;
  apps: AppView[];
  denied: Set<string>;
  syncing: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
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
      } else if (e.key === "o" && L.selected?.click) openSafe(L.selected.click);
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
  const noAccess = scope.kind === "topic" && denied.has(scope.topic.topic);
  const unsubTopic = scope.kind === "topic" && !scope.topic.managed ? scope.topic.topic : null;

  return (
    <div className="flex h-full min-h-0">
      <section className={cx("flex min-w-0 flex-1 flex-col", selected && "hidden lg:flex lg:w-[380px] lg:flex-none xl:w-[440px]")} aria-label="Messages">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-3 md:px-6">
          <IconButton label="Menu" className="-ml-1 md:hidden" onClick={() => set({ sidebarOpen: true })}>
            <Menu className="size-[18px]" />
          </IconButton>
          {scope.kind !== "unknown" && !noAccess ? (
            <label className="relative flex h-9 min-w-0 flex-1 items-center">
              <Search className="pointer-events-none absolute left-1 size-4 stroke-[1.6] text-ink-3" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setLimit(PAGE);
                }}
                placeholder={scope.kind === "all" ? "Search all messages" : `Search ${title}`}
                aria-label="Search messages"
                className="h-9 w-full bg-transparent pr-8 pl-8 text-[14.5px] outline-none placeholder:text-ink-3"
              />
              {search ? (
                <button aria-label="Clear search" onClick={() => setSearch("")} className="absolute right-1 rounded-full p-1 text-ink-3 hover:bg-hover hover:text-ink">
                  <X className="size-3.5" />
                </button>
              ) : (
                <span className={cx("pointer-events-none absolute right-1 hidden", selected ? "xl:block" : "sm:block")}>
                  <Kbd>/</Kbd>
                </span>
              )}
            </label>
          ) : (
            <div className="flex-1" />
          )}
          <div className="ml-auto flex items-center gap-0.5">
            {syncing && <Spinner className="mr-2 size-3.5 text-ink-3" />}
            {unsubTopic && !noAccess && <UnsubscribeButton topic={unsubTopic} />}
            {muteTarget && (
              <IconButton label={muted ? "Unmute (M)" : "Mute (M)"} onClick={toggleScopeMute} active={muted}>
                {muted ? <BellOff className="size-[17px]" /> : <Bell className="size-[17px]" />}
              </IconButton>
            )}
            <IconButton label="Mark all read (Shift+R)" onClick={markAll} disabled={!unreadCount} className="disabled:opacity-40">
              <CheckCheck className="size-[17px]" />
            </IconButton>
            <IconButton label="New message (C)" onClick={() => set({ composeOpen: true })} className="md:hidden">
              <PenSquare className="size-[17px]" />
            </IconButton>
          </div>
        </header>

        <div className={cx("shrink-0 px-5 md:px-7", selected ? "pt-5 pb-3" : "pt-7 pb-4")}>
          <div className="flex min-w-0 items-center gap-3">
            {headIcon && <AppIcon name={headIcon.name} icon={headIcon.icon} size={selected ? 26 : 32} />}
            <h1 className={cx("min-w-0 truncate font-normal tracking-[-0.02em] text-ink", selected ? "text-[24px]" : "text-[30px]")}>
              {scope.kind === "topic" && topicLabel(scope.app, scope.topic) && <span className="text-ink-3">{scope.app.name} / </span>}
              {title}
            </h1>
          </div>
          {scope.kind !== "unknown" && !noAccess && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Chip on={unreadOnly} onClick={() => set({ unreadOnly: !unreadOnly })}>
                Unread{unreadCount ? <span className="tabular-nums text-ink-3">{unreadCount}</span> : null}
              </Chip>
              <Chip on={urgentOnly} onClick={() => set({ urgentOnly: !urgentOnly })}>
                High priority
              </Chip>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line pb-6">
          {scope.kind === "unknown" ? (
            <UnknownTopic topic={scope.topic} />
          ) : noAccess && scope.kind === "topic" ? (
            <Empty
              icon={<Lock />}
              title={`No access to ${scope.topic.topic}`}
              body={
                scope.topic.managed
                  ? "Your account can no longer read this topic. Ask an admin to restore access."
                  : "Your account can no longer read this topic, so it is left out of the live stream. Unsubscribe to remove it."
              }
            >
              {unsubTopic && <UnsubscribeButton topic={unsubTopic} big />}
            </Empty>
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
                      <li className="sticky top-0 z-10 border-b border-line bg-canvas/95 px-5 py-2 text-[12.5px] font-medium text-ink-3 backdrop-blur-sm md:px-7" role="presentation">
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
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[13.5px] transition-colors duration-150",
        on ? "border-accent/35 bg-accent-soft text-accent-ink" : "border-line-strong bg-canvas text-ink-2 hover:bg-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function Empty({ icon, title, body, children }: { icon: React.ReactNode; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="animate-in flex flex-col items-center px-6 py-20 text-center">
      <div className="mb-5 flex size-12 items-center justify-center rounded-full border border-line bg-panel text-ink-3 shadow-soft [&>svg]:size-5 [&>svg]:stroke-[1.5]">{icon}</div>
      <h2 className="font-display text-[26px] leading-tight text-ink">{title}</h2>
      {body && <p className="mt-2 max-w-[360px] text-[14px] leading-relaxed text-ink-3">{body}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

function Skeleton() {
  return (
    <ul aria-busy aria-label="Loading messages">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <li key={i} className="flex gap-3.5 border-b border-line px-5 py-4 md:px-7" style={{ opacity: 1 - i * 0.14 }}>
          <div className="size-[34px] animate-pulse rounded-full bg-active" />
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

/** Removes an unmanaged (user-added) subscription. Catalog topics cannot be unsubscribed. Two clicks. */
function UnsubscribeButton({ topic, big }: { topic: string; big?: boolean }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [armed, setArmed] = useState(false);
  const m = useMutation({
    mutationFn: async () => {
      await removeAccountSubscription(topic);
      await db.messages.where("topic").equals(topic).delete();
      await db.topics.delete(topic);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.account });
      navigate("/");
    },
  });
  if (big) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Button onClick={() => m.mutate()} disabled={m.isPending} className="text-urgent">
          {m.isPending ? <Spinner /> : "Unsubscribe"}
        </Button>
        {m.error && <p className="text-[12.5px] text-urgent">{m.error.message}</p>}
      </div>
    );
  }
  return (
    <Button
      size="sm"
      variant={armed ? "danger" : "ghost"}
      onClick={() => (armed ? m.mutate() : setArmed(true))}
      onBlur={() => setArmed(false)}
      disabled={m.isPending}
      title={m.error ? m.error.message : "Remove this topic from your account"}
      className="mr-1"
    >
      {m.isPending ? <Spinner className="size-3" /> : armed ? "Confirm unsubscribe" : "Unsubscribe"}
    </Button>
  );
}
