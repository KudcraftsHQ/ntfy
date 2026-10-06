/**
 * Publisher-controlled URLs (click, actions, attachments, icons) must never reach window.open,
 * an href or fetch with a scheme like javascript: or data:. Returns the normalized URL or null.
 */
const NAVIGABLE = new Set(["http:", "https:", "mailto:", "tel:"]);
const FETCHABLE = new Set(["http:", "https:"]);

function check(url: string | undefined | null, allowed: Set<string>): string | null {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    return allowed.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** For links the user opens: http(s), mailto, tel. */
export const safeUrl = (url?: string | null) => check(url, NAVIGABLE);
/** For things we fetch or load (http action, images, attachments): http(s) only. */
export const safeHttpUrl = (url?: string | null) => check(url, FETCHABLE);

export function openSafe(url?: string | null) {
  const safe = safeUrl(url);
  if (safe) window.open(safe, "_blank", "noopener,noreferrer");
  return !!safe;
}
