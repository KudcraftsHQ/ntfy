import { create } from "zustand";

export interface Session {
  username: string;
  token: string;
}

const KEY = "kc.session";

const load = (): Session | null => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return s?.token ? s : null;
  } catch {
    return null;
  }
};

interface SessionState {
  session: Session | null;
  signIn: (s: Session) => void;
  signOut: () => void;
}

export const useSession = create<SessionState>((set) => ({
  session: typeof localStorage !== "undefined" ? load() : null,
  signIn: (session) => {
    localStorage.setItem(KEY, JSON.stringify(session));
    set({ session });
  },
  signOut: () => {
    localStorage.removeItem(KEY);
    set({ session: null });
  },
}));

export const currentToken = () => useSession.getState().session?.token ?? null;
