export type SoundClass = "silent" | "default" | "alert" | "urgent";

export interface ServerConfig {
  base_url: string;
  app_root: string;
  enable_login: boolean;
  require_login?: boolean;
  enable_web_push: boolean;
  enable_catalog?: boolean;
  web_push_public_key: string;
  disallowed_topics: string[];
  config_hash?: string;
}

export interface Attachment {
  name: string;
  type?: string;
  size?: number;
  expires?: number;
  url: string;
}

export interface Action {
  id?: string;
  action: "view" | "http" | "broadcast" | "copy" | string;
  label: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  value?: string;
  clear?: boolean;
}

/** A message as delivered by ntfy's JSON stream / poll / web push. */
export interface NtfyMessage {
  id: string;
  sequence_id?: string;
  time: number;
  expires?: number;
  event: string;
  topic: string;
  title?: string;
  message?: string;
  priority?: number;
  tags?: string[];
  click?: string;
  icon?: string;
  actions?: Action[];
  attachment?: Attachment;
  content_type?: string;
}

/** A message as stored locally. `read` is 0/1 because IndexedDB cannot index booleans. */
export interface StoredMessage extends NtfyMessage {
  read: 0 | 1;
}

export interface CatalogTopic {
  topic: string;
  name: string;
  sound: SoundClass;
  permission: "read-only" | "read-write";
}

export interface CatalogApp {
  id: string;
  name: string;
  icon: string;
  sound: SoundClass;
  topics: CatalogTopic[];
}

export interface Catalog {
  version: number;
  base_url: string;
  history_days: number;
  sync_topic: string;
  apps: CatalogApp[];
}

export interface AccountSubscription {
  base_url: string;
  topic: string;
  display_name?: string | null;
}

export interface Account {
  username: string;
  role?: string;
  sync_topic?: string;
  subscriptions?: AccountSubscription[];
}

/** What the sidebar renders: apps with their topics, resolved from catalog + account. */
export interface TopicView {
  topic: string;
  appId: string;
  name: string; // resolved display name
  sound: SoundClass;
  writable: boolean;
  managed: boolean; // came from the catalog (cannot be removed by the user)
}

export interface AppView {
  id: string;
  name: string;
  icon: string;
  sound: SoundClass;
  topics: TopicView[];
}
