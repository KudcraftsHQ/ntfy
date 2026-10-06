import Dexie, { type Table } from "dexie";
import type { NtfyMessage, StoredMessage } from "./types";
import { EVENT_MESSAGE, EVENT_MESSAGE_CLEAR, EVENT_MESSAGE_DELETE, sequenceId } from "./stream";

export interface TopicState {
  topic: string;
  lastTime: number; // unix seconds of newest message seen; used as ?since= on reconnect
  backfilled: 0 | 1;
}

class KcDb extends Dexie {
  messages!: Table<StoredMessage, string>;
  topics!: Table<TopicState, string>;
  constructor() {
    super("ntfy-kc");
    this.version(1).stores({
      messages: "id, topic, time, read, [topic+time], sequence_id",
      topics: "topic",
    });
  }
}

export const db = new KcDb();

/**
 * Applies a batch of stream/poll events to the local store. Returns the messages that are new
 * (not seen before), which the caller may notify about.
 */
export async function applyEvents(events: NtfyMessage[], opts: { markRead?: boolean } = {}): Promise<NtfyMessage[]> {
  const fresh: NtfyMessage[] = [];
  await db.transaction("rw", db.messages, db.topics, async () => {
    for (const m of events) {
      const seq = sequenceId(m);
      if (m.event === EVENT_MESSAGE) {
        if (await db.messages.get(m.id)) continue;
        // An update to an earlier message (same sequence id) replaces it.
        const prior = await db.messages.where({ topic: m.topic }).filter((x) => sequenceId(x) === seq).toArray();
        if (prior.length) await db.messages.bulkDelete(prior.map((p) => p.id));
        await db.messages.put({ ...m, read: opts.markRead ? 1 : 0 });
        fresh.push(m);
      } else if (m.event === EVENT_MESSAGE_DELETE) {
        const doomed = await db.messages.where({ topic: m.topic }).filter((x) => sequenceId(x) === seq).primaryKeys();
        await db.messages.bulkDelete(doomed);
      } else if (m.event === EVENT_MESSAGE_CLEAR) {
        await db.messages.where({ topic: m.topic }).filter((x) => sequenceId(x) === seq).modify({ read: 1 });
      }
      const st = await db.topics.get(m.topic);
      if (!st || st.lastTime < m.time) await db.topics.put({ topic: m.topic, lastTime: m.time, backfilled: st?.backfilled ?? 0 });
    }
  });
  return fresh;
}

export const markRead = (ids: string[]) => db.messages.where("id").anyOf(ids).modify({ read: 1 });
export const markUnread = (id: string) => db.messages.update(id, { read: 0 });
export const markTopicsRead = (topics: string[]) => db.messages.where("topic").anyOf(topics).and((m) => m.read === 0).modify({ read: 1 });
export const deleteMessage = (id: string) => db.messages.delete(id);

/** Drops messages older than the server's retention window. */
export const prune = (days: number) => db.messages.where("time").below(Date.now() / 1000 - days * 86400).delete();
