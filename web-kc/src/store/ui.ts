import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MuteState } from "../lib/catalog";

export type Theme = "system" | "light" | "dark";

interface Prefs {
  theme: Theme;
  sound: boolean;
  notify: boolean; // in-tab desktop notifications (web push is tracked separately by the browser)
  mutes: MuteState;
}

interface UiState extends Prefs {
  sidebarOpen: boolean; // mobile drawer
  composeOpen: boolean;
  paletteOpen: boolean;
  helpOpen: boolean;
  unreadOnly: boolean;
  urgentOnly: boolean;
  set: (p: Partial<UiState>) => void;
  toggleMute: (kind: "apps" | "topics", id: string) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: "system",
      sound: true,
      notify: true,
      mutes: { apps: {}, topics: {} },
      sidebarOpen: false,
      composeOpen: false,
      paletteOpen: false,
      helpOpen: false,
      unreadOnly: false,
      urgentOnly: false,
      set: (p) => set(p),
      toggleMute: (kind, id) =>
        set((s) => {
          const next = { ...s.mutes[kind] };
          if (next[id]) delete next[id];
          else next[id] = true;
          return { mutes: { ...s.mutes, [kind]: next } };
        }),
    }),
    {
      name: "kc.prefs",
      partialize: (s): Prefs => ({ theme: s.theme, sound: s.sound, notify: s.notify, mutes: s.mutes }),
    },
  ),
);

/** Applies the theme to <html>. Called on change and from the matchMedia listener. */
export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
