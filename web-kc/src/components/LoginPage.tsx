import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { login } from "../lib/api";
import { claimForUser } from "../lib/db";
import { config } from "../lib/config";
import { useSession } from "../lib/session";
import { Button, Spinner } from "./ui";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const signIn = useSession((s) => s.signIn);
  const m = useMutation({
    mutationFn: async () => {
      const session = await login(username.trim(), password);
      await claimForUser(session.username); // a different user never sees the previous one's cache
      return session;
    },
    onSuccess: signIn,
  });
  const host = config.base_url.replace(/^https?:\/\//, "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (username && password) m.mutate();
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-sidebar px-5 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-9 flex flex-col items-center text-center">
          <img src="/static/images/pwa-192x192.png" alt="" className="mb-6 size-11 rounded-xl" />
          <h1 className="font-display text-[40px] leading-none tracking-[-0.01em] text-ink">Welcome back</h1>
          <p className="mt-3 text-[14.5px] text-ink-3">Sign in to every app's alerts, in one inbox.</p>
        </div>
        <form onSubmit={submit} className="rounded-2xl border border-line bg-panel p-7 shadow-soft">
          <label className="block text-[13.5px] text-ink-2" htmlFor="u">
            Username
          </label>
          <input
            id="u"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-2 h-11 w-full rounded-[10px] border border-line-strong bg-canvas px-3.5 text-[15px] outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/12"
          />
          <label className="mt-5 block text-[13.5px] text-ink-2" htmlFor="p">
            Password
          </label>
          <input
            id="p"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 h-11 w-full rounded-[10px] border border-line-strong bg-canvas px-3.5 text-[15px] outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/12"
          />
          {m.error && (
            <p role="alert" className="mt-3 rounded-lg bg-urgent-soft px-3 py-2 text-[13px] text-urgent">
              {m.error.message}
            </p>
          )}
          <Button variant="primary" type="submit" disabled={!username || !password || m.isPending} className="mt-6 h-11 w-full text-[15px]">
            {m.isPending ? <Spinner /> : "Sign in"}
          </Button>
        </form>
        <p className="mt-6 text-center text-[12px] text-ink-3">{host}</p>
      </div>
    </div>
  );
}
