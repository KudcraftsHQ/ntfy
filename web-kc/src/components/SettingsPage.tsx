import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { Bell, BellOff, Menu, Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { logout } from "../lib/api";
import { isMuted } from "../lib/catalog";
import { config } from "../lib/config";
import { db } from "../lib/db";
import { disablePush, enablePush, pushState, requestNotificationPermission } from "../lib/push";
import { useSession } from "../lib/session";
import { reconcilePush } from "../lib/sync";
import type { AppView } from "../lib/types";
import { useUi, type Theme } from "../store/ui";
import { ShortcutList } from "./HelpDialog";
import { AppIcon, Button, cx, IconButton, Spinner, Switch } from "./ui";
import { allTopics } from "../lib/catalog";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-b border-line py-8 last:border-0">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      {description && <p className="mt-1 text-[13px] text-ink-3">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="text-[13.5px] text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[12.5px] text-ink-3">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const pushCopy = { unsupported: "Not available in this browser", denied: "Blocked in browser settings", off: "Off", on: "On — alerts arrive even with ntfy closed" };

export function SettingsPage({ apps }: { apps: AppView[] }) {
  const ui = useUi();
  const session = useSession((s) => s.session);
  const signOut = useSession((s) => s.signOut);
  const qc = useQueryClient();
  const push = useQuery({ queryKey: ["push-state"], queryFn: pushState });
  const unmutedTopics = () => allTopics(apps).filter((t) => !isMuted(useUi.getState().mutes, t)).map((t) => t.topic);
  const pushToggle = useMutation({
    mutationFn: (on: boolean) => (on ? enablePush(unmutedTopics()) : disablePush()),
    onSuccess: (s) => qc.setQueryData(["push-state"], s),
  });
  const count = useLiveQuery(() => db.messages.count(), []);
  const out = useMutation({
    mutationFn: async () => {
      await disablePush().catch(() => undefined);
      await logout();
      await db.delete();
    },
    onSettled: () => {
      signOut();
      qc.clear();
      location.assign("/");
    },
  });

  const themes: { v: Theme; label: string; icon: ReactNode }[] = [
    { v: "system", label: "System", icon: <Monitor className="size-3.5" /> },
    { v: "light", label: "Light", icon: <Sun className="size-3.5" /> },
    { v: "dark", label: "Dark", icon: <Moon className="size-3.5" /> },
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-5">
        <IconButton label="Menu" className="-ml-1 md:hidden" onClick={() => ui.set({ sidebarOpen: true })}>
          <Menu className="size-4.5" />
        </IconButton>
        <h1 className="text-[15px] font-semibold">Settings</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-5 pb-16 md:px-8">
          <Section title="Account">
            <Row label={session?.username ?? ""} hint={config.base_url.replace(/^https?:\/\//, "")}>
              <Button onClick={() => out.mutate()} disabled={out.isPending}>
                {out.isPending ? <Spinner /> : "Sign out"}
              </Button>
            </Row>
          </Section>

          <Section title="Notifications" description="Muted apps and topics stay in the inbox but never alert.">
            <Row label="Push notifications" hint={push.data ? pushCopy[push.data] : "Checking…"}>
              <Switch
                label="Push notifications"
                checked={push.data === "on"}
                onChange={(v) => push.data !== "unsupported" && pushToggle.mutate(v)}
              />
            </Row>
            <Row label="Alerts while this tab is open" hint="Desktop notifications from the live stream when push is off">
              <Switch
                label="Desktop notifications"
                checked={ui.notify}
                onChange={(v) => {
                  ui.set({ notify: v });
                  if (v) void requestNotificationPermission();
                }}
              />
            </Row>
            <Row label="Sound" hint="Played for new messages, except silent and low-priority ones">
              <Switch label="Sound" checked={ui.sound} onChange={(v) => ui.set({ sound: v })} />
            </Row>
            {pushToggle.error && <p className="mt-2 text-[12.5px] text-urgent">{pushToggle.error.message}</p>}

            <div className="mt-5 overflow-hidden rounded-xl border border-line">
              {apps.length === 0 && <p className="px-4 py-3 text-[13px] text-ink-3">No apps yet.</p>}
              {apps.map((a) => (
                <div key={a.id} className="border-b border-line last:border-0">
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <AppIcon name={a.name} icon={a.icon} size={22} />
                    <span className="text-[13.5px] font-medium">{a.name}</span>
                    <MuteToggle muted={!!ui.mutes.apps[a.id]} onClick={() => (ui.toggleMute("apps", a.id), void reconcilePush(apps))} />
                  </div>
                  {(a.topics.length > 1 || a.topics[0]?.topic !== a.id) && !ui.mutes.apps[a.id] && (
                    <div className="pb-1.5">
                      {a.topics.map((t) => (
                        <div key={t.topic} className="flex items-center gap-3 py-1 pr-4 pl-[50px] text-[13px] text-ink-2">
                          <span className="truncate">{t.topic}</span>
                          <span className="text-[11.5px] text-ink-3">{t.sound !== "default" ? t.sound : ""}</span>
                          <MuteToggle small muted={!!ui.mutes.topics[t.topic]} onClick={() => (ui.toggleMute("topics", t.topic), void reconcilePush(apps))} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Appearance">
            <div className="inline-grid grid-cols-3 gap-1 rounded-lg bg-hover p-1">
              {themes.map((t) => (
                <button
                  key={t.v}
                  onClick={() => ui.set({ theme: t.v })}
                  className={cx("flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium transition", ui.theme === t.v ? "bg-panel text-ink shadow-sm" : "text-ink-3 hover:text-ink")}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="History" description="Messages are kept on the server for 90 days and cached on this device.">
            <Row label="Cached on this device" hint={count === undefined ? "…" : `${count.toLocaleString()} messages`}>
              <Button
                onClick={async () => {
                  await db.messages.clear();
                  await db.topics.clear();
                  await qc.invalidateQueries({ queryKey: ["backfill"] });
                }}
              >
                Re-download
              </Button>
            </Row>
          </Section>

          <Section title="Keyboard shortcuts">
            <ShortcutList />
          </Section>
        </div>
      </div>
    </div>
  );
}

function MuteToggle({ muted, onClick, small }: { muted: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={muted}
      className={cx(
        "ml-auto inline-flex items-center gap-1.5 rounded-md px-2 font-medium transition",
        small ? "h-6 text-[11.5px]" : "h-7 text-[12px]",
        muted ? "bg-hover text-ink-3" : "text-ink-2 hover:bg-hover",
      )}
    >
      {muted ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}
      {muted ? "Muted" : "On"}
    </button>
  );
}
