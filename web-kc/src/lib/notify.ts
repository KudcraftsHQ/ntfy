import ding from "../ding.mp3";
import type { NtfyMessage, SoundClass } from "./types";
import { notificationTitle } from "./notify-format";

let audio: HTMLAudioElement | null = null;

export function playSound(sound: SoundClass) {
  if (sound === "silent") return;
  try {
    audio ??= new Audio(ding);
    audio.currentTime = 0;
    audio.volume = sound === "urgent" ? 1 : 0.7;
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
    icon: m.icon || appIcon || "/static/images/ntfy.png",
    badge: "/static/images/ntfy-mask.svg",
    tag: `${m.topic}/${m.sequence_id || m.id}`,
    timestamp: m.time * 1000,
    data: { message: m },
  };
  if (m.attachment?.type?.startsWith("image/")) opts.image = m.attachment.url;
  if (reg) await reg.showNotification(title, opts);
  else new Notification(title, opts);
}
