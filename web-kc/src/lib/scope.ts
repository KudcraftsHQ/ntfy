import type { AppView, TopicView } from "./types";

export type Scope =
  | { kind: "all" }
  | { kind: "app"; app: AppView }
  | { kind: "topic"; app: AppView; topic: TopicView }
  | { kind: "unknown"; topic: string }
  | { kind: "settings" };

/** Routes: "/" (All), "/?app=<id>", "/<topic>", "/settings". Single segments only: that is what the ntfy server serves as the SPA. */
export function resolveScope(path: string, search: string, apps: AppView[]): Scope {
  const seg = decodeURIComponent(path.replace(/^\/+|\/+$/g, ""));
  if (seg === "settings" || seg === "account") return { kind: "settings" };
  if (seg) {
    for (const app of apps) {
      const topic = app.topics.find((t) => t.topic === seg);
      if (topic) return { kind: "topic", app, topic };
    }
    return { kind: "unknown", topic: seg };
  }
  const appId = new URLSearchParams(search).get("app");
  const app = appId ? apps.find((a) => a.id === appId) : undefined;
  return app ? { kind: "app", app } : { kind: "all" };
}

export const scopeTopics = (scope: Scope, apps: AppView[]): string[] =>
  scope.kind === "topic"
    ? [scope.topic.topic]
    : scope.kind === "app"
      ? scope.app.topics.map((t) => t.topic)
      : scope.kind === "all"
        ? apps.flatMap((a) => a.topics.map((t) => t.topic))
        : [];

export const scopeKey = (scope: Scope) =>
  scope.kind === "topic" ? `t:${scope.topic.topic}` : scope.kind === "app" ? `a:${scope.app.id}` : scope.kind === "unknown" ? `u:${scope.topic}` : scope.kind;

export const scopeHref = (s: { app?: string; topic?: string }) => (s.topic ? `/${s.topic}` : s.app ? `/?app=${encodeURIComponent(s.app)}` : "/");
