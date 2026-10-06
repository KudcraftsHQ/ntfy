/** Compact relative time for list rows: "now", "4m", "3h", "Yesterday", "Mon", "12 Sep", "12 Sep 2025". */
export function relativeTime(unixSeconds: number, now = Date.now()): string {
  const t = unixSeconds * 1000;
  const diff = Math.max(0, now - t);
  const min = 60_000;
  if (diff < min) return "now";
  if (diff < 60 * min) return `${Math.floor(diff / min)}m`;
  const d = new Date(t);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (t >= startOfToday) return `${Math.floor(diff / (60 * min))}h`;
  if (t >= startOfToday - 86_400_000) return "Yesterday";
  if (t >= startOfToday - 6 * 86_400_000) return d.toLocaleDateString("en-GB", { weekday: "short" });
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

export const fullTime = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Day bucket label for list section headers. */
export function dayLabel(unixSeconds: number, now = Date.now()): string {
  const d = new Date(unixSeconds * 1000);
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return "Today";
  if (t >= start - 86_400_000) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
}

/** Collapses whitespace; markdown bodies are also stripped of their syntax. */
export const previewText = (s = "", markdown = false) => (markdown ? stripMarkdown(s) : s.replace(/\s+/g, " ").trim());

/** Markdown -> one-line-ish plain text for previews. */
export const stripMarkdown = (s = "") =>
  s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "") // table separator rows
    .replace(/\s*\|\s*/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, "$1$2")
    .replace(/[`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const formatBytes = (n?: number) => {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};

export type PriorityMeta = { label: string; tone: "urgent" | "high" | "low" | "normal" };
export const priorityMeta = (p = 3): PriorityMeta =>
  p >= 5 ? { label: "Urgent", tone: "urgent" } : p === 4 ? { label: "High", tone: "high" } : p <= 2 ? { label: p === 1 ? "Min" : "Low", tone: "low" } : { label: "Normal", tone: "normal" };

/** Deterministic hue for letter avatars. */
export const hueFor = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
