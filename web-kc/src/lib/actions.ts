import type { Action } from "./types";

/** Runs an ntfy action button. Broadcast actions are Android-only and are not shown. */
export async function runAction(a: Action): Promise<string | void> {
  if (a.action === "view" && a.url) {
    window.open(a.url, "_blank", "noopener,noreferrer");
    return;
  }
  if (a.action === "copy") {
    await navigator.clipboard.writeText(a.value ?? a.url ?? "");
    return "Copied";
  }
  if (a.action === "http" && a.url) {
    const res = await fetch(a.url, { method: a.method ?? "POST", headers: a.headers ?? {}, body: a.body });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return "Done";
  }
}

export const visibleActions = (actions: Action[] = []) => actions.filter((a) => a.action === "view" || a.action === "http" || a.action === "copy");
