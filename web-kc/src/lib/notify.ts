import type { NtfyMessage, SoundClass } from "./types";
import { notificationTitle } from "./notify-format";
import { clipId } from "./sounds";
import { safeHttpUrl } from "./url";

// Every theme ships in the bundle (70 short clips); only the URLs are loaded up front.
const clipUrls = import.meta.glob<string>("../sounds/kc_*.mp3", { eager: true, query: "?url", import: "default" });
const clipUrl = (id: string) => clipUrls[`../sounds/${id}.mp3`];

let audio: HTMLAudioElement | null = null;

/** Plays `kc_<theme>_<sound>`. Unknown theme -> cabin, unknown class -> default, silent -> nothing. */
export function playSound(sound: SoundClass, theme: unknown) {
  const id = clipId(theme, sound);
  const url = id && clipUrl(id);
  if (!url) return;
  try {
    audio?.pause();
    audio = new Audio(url);
    void audio.play().catch(() => undefined); // autoplay may be blocked until first interaction
  } catch {
    /* no audio support */
  }
}

/** Shows a desktop notification through the service worker (so clicks route like web push ones). */
export async function showNotification(m: NtfyMessage, topicName: string, appIcon: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker?.getRegistration();
  const title = notificationTitle(m, topicName);
  const opts: NotificationOptions & { image?: string; timestamp?: number; renotify?: boolean } = {
    body: (m.message ?? "").slice(0, 400),
    icon: safeHttpUrl(m.icon) || safeHttpUrl(appIcon) || "/static/images/ntfy.png",
    badge: "/static/images/ntfy-mask.svg",
    tag: `${m.topic}/${m.sequence_id || m.id}`,
    timestamp: m.time * 1000,
    data: { message: m },
  };
  const image = safeHttpUrl(m.attachment?.url);
  if (image && m.attachment?.type?.startsWith("image/")) opts.image = image;
  if (reg) await reg.showNotification(title, opts);
  else new Notification(title, opts);
}
