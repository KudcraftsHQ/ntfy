import type { AccountSubscription, AppView, Catalog, SoundClass, TopicView } from "./types";

/** App id a topic belongs to when the catalog does not say: prefix before the first "-" (spec D3). */
export const deriveAppId = (topic: string) => topic.split("-")[0] || topic;

/** "facemap" -> "Facemap", "data-cuan" -> "Data Cuan" */
export const titleCase = (id: string) =>
  id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

const sameBase = (a: string, b: string) => a.replace(/\/$/, "") === b.replace(/\/$/, "");

/**
 * Builds the sidebar model from the catalog (if the server has one) and the account's
 * subscriptions. Rules (spec §14.5, §14.7):
 *  - catalog topics are "managed"; display name = user rename -> catalog name -> topic id
 *  - account subscriptions not in the catalog are grouped by derived app id
 *  - subscriptions for other servers are ignored (this client talks to one server)
 *  - apps sorted by name, topics by topic id
 */
export function buildApps(catalog: Catalog | null, subscriptions: AccountSubscription[], baseUrl: string): AppView[] {
  const apps = new Map<string, AppView>();
  const renames = new Map<string, string>();
  for (const s of subscriptions) {
    if (sameBase(s.base_url, baseUrl) && s.display_name) renames.set(s.topic, s.display_name);
  }

  const seen = new Set<string>();
  for (const app of catalog?.apps ?? []) {
    const view: AppView = { id: app.id, name: app.name || titleCase(app.id), icon: app.icon || "", sound: app.sound || "default", topics: [] };
    for (const t of app.topics) {
      if (seen.has(t.topic)) continue;
      seen.add(t.topic);
      view.topics.push({
        topic: t.topic,
        appId: app.id,
        name: renames.get(t.topic) || t.name || t.topic,
        sound: t.sound || view.sound,
        writable: t.permission === "read-write",
        managed: true,
      });
    }
    if (view.topics.length > 0) apps.set(app.id, view);
  }

  for (const s of subscriptions) {
    if (!sameBase(s.base_url, baseUrl) || seen.has(s.topic)) continue;
    seen.add(s.topic);
    const appId = deriveAppId(s.topic);
    let view = apps.get(appId);
    if (!view) {
      view = { id: appId, name: titleCase(appId), icon: "", sound: "default", topics: [] };
      apps.set(appId, view);
    }
    view.topics.push({
      topic: s.topic,
      appId,
      name: s.display_name || s.topic,
      sound: view.sound,
      writable: true, // unknown without the catalog; the server rejects if not
      managed: false,
    });
  }

  const sorted = [...apps.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const a of sorted) a.topics.sort((x, y) => x.topic.localeCompare(y.topic));
  return sorted;
}

export const allTopics = (apps: AppView[]): TopicView[] => apps.flatMap((a) => a.topics);

/** Short label for a topic inside its app: "facemap-orders" in app "facemap" -> "orders". */
export function shortTopicName(t: TopicView): string {
  if (t.name !== t.topic) return t.name;
  if (t.topic === t.appId) return "general";
  return t.topic.startsWith(`${t.appId}-`) ? t.topic.slice(t.appId.length + 1) : t.topic;
}

/** True when an app shows its topics nested (more than one, or one that isn't just the app id). */
export const isNested = (app: { id: string; topics: { topic: string }[] }) => app.topics.length > 1 || app.topics[0]?.topic !== app.id;

/** The topic's label under its app, or null when the app has a single topic named after itself. */
export const topicLabel = (app: { id: string; topics: { topic: string }[] }, t: TopicView) => (isNested(app) ? shortTopicName(t) : null);

export interface MuteState {
  apps: Record<string, true>;
  topics: Record<string, true>;
}

export const isMuted = (mutes: MuteState, t: Pick<TopicView, "topic" | "appId">) => !!(mutes.apps[t.appId] || mutes.topics[t.topic]);

/** Whether a new message should alert (sound/notification), given mutes and the topic's sound class. */
export function shouldAlert(mutes: MuteState, t: TopicView | undefined, priority = 3): { notify: boolean; sound: SoundClass } {
  if (!t) return { notify: false, sound: "silent" };
  if (isMuted(mutes, t)) return { notify: false, sound: "silent" };
  if (priority <= 1) return { notify: false, sound: "silent" }; // min priority never alerts (ntfy semantics)
  return { notify: true, sound: priority <= 2 ? "silent" : t.sound };
}

/** Stable stream key: sorted topic list. Changing it remounts the stream component. */
export const topicsKey = (topics: string[]) => [...topics].sort().join(",");

/** Apps with unreadable topics removed (and apps left with none dropped): what the stream and backfill use. */
export const readableApps = (apps: AppView[], denied: Set<string>): AppView[] =>
  apps.map((a) => ({ ...a, topics: a.topics.filter((t) => !denied.has(t.topic)) })).filter((a) => a.topics.length > 0);
