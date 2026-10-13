import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { Bell, BellOff, Menu, Monitor, Moon, Play, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { logout, setServerSoundTheme } from "../lib/api";
import { clearLocalSession } from "../lib/auth";
import { isMuted } from "../lib/catalog";
import { config } from "../lib/config";
import { db } from "../lib/db";
import { playSound } from "../lib/notify";
import { disablePush, enablePush, pushState, requestNotificationPermission } from "../lib/push";
import { useSession } from "../lib/session";
import { resolveSoundTheme, SOUND_THEMES, SOUNDS, toSoundTheme } from "../lib/sounds";
import { qk, reconcilePush } from "../lib/sync";
import type { AppView, SoundTheme } from "../lib/types";
import { useUi, type Theme } from "../store/ui";
import { ShortcutList } from "./HelpDialog";
import { AppIcon, Button, cx, IconButton, Spinner, Switch } from "./ui";
import { allTopics } from "../lib/catalog";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-b border-line py-8 last:border-0">
      <h2 className="text-[16px] font-medium">{title}</h2>
      {description && <p className="mt-1 text-[13.5px] text-ink-3">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="text-[14.5px] text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[13px] text-ink-3">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const pushCopy = { unsupported: "Not available in this browser", denied: "Blocked in browser settings", off: "Off", on: "On — alerts arrive even with ntfy closed" };

const themeLabel = (t: string) => t[0].toUpperCase() + t.slice(1);
const selectClass = "h-9 rounded-lg border border-line-strong bg-raised px-2.5 text-[13.5px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45";

export function SettingsPage({ apps, serverTheme: rawServerTheme, isAdmin }: { apps: AppView[]; serverTheme?: SoundTheme; isAdmin?: boolean }) {
  const ui = useUi();
  const session = useSession((s) => s.session);
  const qc = useQueryClient();
  const push = useQuery({ queryKey: ["push-state"], queryFn: pushState });
  const unmutedTopics = () => allTopics(apps).filter((t) => !isMuted(useUi.getState().mutes, t)).map((t) => t.topic);
  const pushToggle = useMutation({
    mutationFn: (on: boolean) => (on ? enablePush(unmutedTopics()) : disablePush()),
    onSuccess: (s) => qc.setQueryData(["push-state"], s),
  });
  const serverTheme = toSoundTheme(rawServerTheme); // an older server sends none: cabin
  const theme = resolveSoundTheme(ui.soundTheme, serverTheme);
  const setServerTheme = useMutation({
    mutationFn: setServerSoundTheme,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.catalog }),
  });
  const count = useLiveQuery(() => db.messages.count(), []);
  const out = useMutation({
    mutationFn: async () => {
      await disablePush().catch(() => undefined);
      await logout();
    },
    onSettled: async () => {
      await clearLocalSession();
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
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-3 md:hidden">
        <IconButton label="Menu" className="-ml-1" onClick={() => ui.set({ sidebarOpen: true })}>
          <Menu className="size-[18px]" />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-5 pb-16 md:px-8">
          <h1 className="pt-10 pb-2 text-[30px] font-normal tracking-[-0.02em]">Settings</h1>
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
            <Row label="Sound theme" hint="For this device. Other devices keep their own choice.">
              <select
                aria-label="Sound theme"
                className={selectClass}
                value={ui.soundTheme ?? ""}
                onChange={(e) => ui.set({ soundTheme: (e.target.value || null) as SoundTheme | null })}
              >
                <option value="">Follow server ({themeLabel(serverTheme)})</option>
                {SOUND_THEMES.map((t) => (
                  <option key={t} value={t}>
                    {themeLabel(t)}
                  </option>
                ))}
              </select>
            </Row>
            <div className="flex flex-wrap gap-1.5 pt-1 pb-2.5" role="group" aria-label={`Preview the ${themeLabel(theme)} theme`}>
              {SOUNDS.map((s) => (
                <button
                  key={s.name}
                  title={s.meaning}
                  onClick={() => playSound(s.name, theme)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-pill px-3 text-[12.5px] font-medium text-ink-2 transition hover:bg-active hover:text-ink"
                >
                  <Play className="size-3" />
                  {s.name}
                </button>
              ))}
            </div>
            {isAdmin && (
              <Row label="Server sound theme" hint="For everyone whose device follows the server">
                <select
                  aria-label="Server sound theme"
                  className={selectClass}
                  value={serverTheme}
                  disabled={setServerTheme.isPending}
                  onChange={(e) => setServerTheme.mutate(e.target.value as SoundTheme)}
                >
                  {SOUND_THEMES.map((t) => (
                    <option key={t} value={t}>
                      {themeLabel(t)}
                    </option>
                  ))}
                </select>
              </Row>
            )}
            {pushToggle.error && <p className="mt-2 text-[12.5px] text-urgent">{pushToggle.error.message}</p>}
            {setServerTheme.error && <p className="mt-2 text-[12.5px] text-urgent">{setServerTheme.error.message}</p>}

            <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-panel shadow-soft">
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
