import { db } from "./db";
import { disablePush } from "./push";
import { useSession } from "./session";

let clearing: Promise<void> | null = null;
let onCleared: (() => void) | null = null;

/** Registered by the app so a forced sign-out can also drop the query cache. */
export const setOnCleared = (fn: () => void) => (onCleared = fn);

/**
 * Full local sign-out: web push subscription, cached messages, query cache, session.
 * Used for explicit sign-out and whenever the server rejects the token (401), so a shared
 * browser never shows the previous user's messages or keeps receiving their pushes.
 */
export function clearLocalSession(): Promise<void> {
  clearing ??= (async () => {
    await disablePush().catch(() => undefined);
    await db.messages.clear().catch(() => undefined);
    await db.topics.clear().catch(() => undefined);
    await db.topicMeta.clear().catch(() => undefined);
    await db.meta.clear().catch(() => undefined);
    onCleared?.();
    useSession.getState().signOut();
  })().finally(() => (clearing = null));
  return clearing;
}
