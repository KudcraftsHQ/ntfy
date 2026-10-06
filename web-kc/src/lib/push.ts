import { config } from "./config";
import { deleteWebPush, updateWebPush } from "./api";

export type PushState = "unsupported" | "denied" | "off" | "on";

const supported = () =>
  config.enable_web_push && !!config.web_push_public_key && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const urlBase64ToUint8Array = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return (await currentSubscription()) && Notification.permission === "granted" ? "on" : "off";
}

/** Subscribes this browser to web push for the given topics (needs a user gesture for the permission prompt). */
export async function enablePush(topics: string[]): Promise<PushState> {
  if (!supported()) return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.web_push_public_key) }));
  await updateWebPush(sub, topics);
  return "on";
}

/** Re-registers the topic list (after mute changes or catalog changes). No-op when push is off. */
export async function syncPushTopics(topics: string[]) {
  if (!supported()) return;
  const sub = await currentSubscription();
  if (sub) await updateWebPush(sub, topics);
}

export async function disablePush(): Promise<PushState> {
  const sub = supported() ? await currentSubscription() : null;
  if (sub) {
    await deleteWebPush(sub).catch(() => undefined);
    await sub.unsubscribe();
  }
  return supported() ? "off" : "unsupported";
}

export const requestNotificationPermission = async () =>
  typeof Notification === "undefined" ? "denied" : Notification.requestPermission();
