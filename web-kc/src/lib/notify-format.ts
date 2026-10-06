import { emojiFor } from "./emoji";
import type { NtfyMessage } from "./types";

/** "⚠️ Disk almost full" — tag emojis prefixed to the title, like ntfy's own clients. */
export function notificationTitle(m: NtfyMessage, fallback: string) {
  const emojis = (m.tags ?? []).map(emojiFor).filter(Boolean).join(" ");
  const title = m.title || fallback;
  return emojis ? `${emojis} ${title}` : title;
}
