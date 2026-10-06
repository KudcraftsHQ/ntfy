import type { Action } from "./types";
import { openSafe, safeHttpUrl, safeUrl } from "./url";

/** Runs an ntfy action button. Broadcast actions are Android-only and are not shown. */
export async function runAction(a: Action): Promise<string | void> {
  if (a.action === "view") {
    if (!openSafe(a.url)) throw new Error("Blocked unsafe link");
    return;
  }
  if (a.action === "copy") {
    await navigator.clipboard.writeText(a.value ?? a.url ?? "");
    return "Copied";
  }
  if (a.action === "http") {
    const url = safeHttpUrl(a.url);
    if (!url) throw new Error("Blocked unsafe URL");
    const res = await fetch(url, { method: a.method ?? "POST", headers: a.headers ?? {}, body: a.body });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return "Done";
  }
}

/** Actions we can run safely; view/http with a non-http(s) URL are hidden rather than shown broken. */
export const visibleActions = (actions: Action[] = []) =>
  actions.filter((a) => (a.action === "view" && safeUrl(a.url)) || (a.action === "http" && safeHttpUrl(a.url)) || a.action === "copy");
