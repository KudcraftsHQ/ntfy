import { CornerDownLeft, Hash, Inbox, PenSquare, Search, Settings } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { scopeHref } from "../lib/scope";
import type { AppView } from "../lib/types";
import { useUi } from "../store/ui";
import { AppIcon, cx, Dialog } from "./ui";

interface Item {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  count?: number;
  run: () => void;
}

export function CommandPalette({ apps, unread }: { apps: AppView[]; unread: Record<string, number> }) {
  const open = useUi((s) => s.paletteOpen);
  const set = useUi((s) => s.set);
  if (!open) return null;
  return <Palette apps={apps} unread={unread} onClose={() => set({ paletteOpen: false })} />;
}

function Palette({ apps, unread, onClose }: { apps: AppView[]; unread: Record<string, number>; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [, navigate] = useLocation();
  const set = useUi((s) => s.set);
  const go = (href: string) => () => {
    navigate(href);
    onClose();
  };

  const items: Item[] = [
    { id: "all", label: "All messages", icon: <Inbox className="size-4" />, run: go("/") },
    ...apps.flatMap((a) => [
      { id: `a:${a.id}`, label: a.name, hint: "App", icon: <AppIcon name={a.name} icon={a.icon} size={18} />, count: a.topics.reduce((n, t) => n + (unread[t.topic] ?? 0), 0), run: go(scopeHref({ app: a.id })) },
      ...a.topics.map((t) => ({ id: `t:${t.topic}`, label: t.topic, hint: t.name !== t.topic ? t.name : a.name, icon: <Hash className="size-4" />, count: unread[t.topic], run: go(scopeHref({ topic: t.topic })) })),
    ]),
    {
      id: "compose",
      label: "New message",
      hint: "C",
      icon: <PenSquare className="size-4" />,
      run: () => {
        onClose();
        set({ composeOpen: true });
      },
    },
    { id: "settings", label: "Settings", hint: "G S", icon: <Settings className="size-4" />, run: go("/settings") },
  ];
  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter((i) => `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(needle)) : items;
  const idx = Math.min(active, Math.max(0, shown.length - 1));

  return (
    <Dialog open onClose={onClose} label="Jump to" className="max-w-[540px]">
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search className="size-4 text-ink-3" />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive(Math.min(idx + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive(Math.max(idx - 1, 0));
            } else if (e.key === "Enter") shown[idx]?.run();
          }}
          placeholder="Jump to an app, topic or action…"
          className="h-12 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-ink-3"
        />
      </div>
      <ul className="max-h-[360px] overflow-y-auto p-1.5" role="listbox">
        {shown.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-ink-3">No results</li>}
        {shown.map((it, i) => (
          <li key={it.id} role="option" aria-selected={i === idx}>
            <button
              onMouseMove={() => setActive(i)}
              onClick={it.run}
              className={cx("flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[13.5px]", i === idx ? "bg-active text-ink" : "text-ink-2")}
            >
              <span className="flex w-5 justify-center text-ink-3">{it.icon}</span>
              <span className="truncate">{it.label}</span>
              {it.hint && <span className="truncate text-[12px] text-ink-3">{it.hint}</span>}
              <span className="ml-auto flex items-center gap-2">
                {!!it.count && <span className="text-[12px] text-ink-3 tabular-nums">{it.count}</span>}
                {i === idx && <CornerDownLeft className="size-3.5 text-ink-3" />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
