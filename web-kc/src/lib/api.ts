import { config } from "./config";
import { clearLocalSession } from "./auth";
import { currentToken } from "./session";
import { parseNdjson } from "./stream";
import type { Account, Catalog, NtfyMessage } from "./types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const base = () => config.base_url;

const authHeaders = (token = currentToken()): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

const encodeBasic = (user: string, pass: string) => {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `Basic ${btoa(bin)}`;
};

/** Reads ntfy's error envelope {code, http, error} into a readable message. */
const errorFrom = async (res: Response) => {
  try {
    const j = await res.json();
    if (j?.error) return new HttpError(res.status, j.error);
  } catch {
    /* not JSON */
  }
  return new HttpError(res.status, `HTTP ${res.status}`);
};

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${base()}${path}`, { ...init, headers: { ...authHeaders(), ...(init.headers as Record<string, string>) } });
  if (res.status === 304) return res;
  if (res.status === 401 && currentToken()) {
    // Token expired or revoked: full local cleanup, then the login screen shows.
    void clearLocalSession();
  }
  if (!res.ok) throw await errorFrom(res);
  return res;
}

export async function login(username: string, password: string) {
  const res = await fetch(`${base()}/v1/account/login`, {
    method: "POST",
    headers: { Authorization: encodeBasic(username, password) },
  });
  if (!res.ok) {
    if (res.status === 401) throw new HttpError(401, "Wrong username or password");
    throw await errorFrom(res);
  }
  const json = await res.json();
  if (!json.token) throw new Error("Server did not return a token");
  return { token: json.token as string, username: (json.username as string) || username };
}

export async function logout() {
  await request("/v1/account/token", { method: "DELETE" }).catch(() => undefined);
}

export async function extendToken() {
  await request("/v1/account/token", { method: "PATCH" });
  return Date.now();
}

export async function fetchAccount(): Promise<Account> {
  return (await request("/v1/account")).json();
}

let catalogCache: { etag: string; body: Catalog; token: string | null } | null = null;

/** Fills defaults the server omits (`topics` is omitempty) so the rest of the app can trust the shape. */
export function normalizeCatalog(raw: Catalog): Catalog {
  return {
    ...raw,
    history_days: typeof raw.history_days === "number" ? raw.history_days : 0,
    sync_topic: raw.sync_topic || "",
    apps: (raw.apps ?? []).map((a) => ({
      ...a,
      name: a.name || a.id,
      icon: a.icon || "",
      sound: a.sound || "default",
      topics: (a.topics ?? []).map((t) => ({ ...t, name: t.name || "", sound: t.sound || a.sound || "default", permission: t.permission === "read-write" ? "read-write" : "read-only" })),
    })),
  };
}

/**
 * GET /v1/catalog with If-None-Match (the server's ETag is a per-user view hash). Returns null when
 * the server has the catalog disabled (404). A 304 returns the cached body.
 */
export async function fetchCatalog(): Promise<Catalog | null> {
  const token = currentToken();
  const cached = catalogCache?.token === token ? catalogCache : null;
  try {
    const res = await request("/v1/catalog", { headers: cached ? { "If-None-Match": cached.etag } : {} });
    if (res.status === 304 && cached) return cached.body;
    const body = normalizeCatalog(await res.json());
    const etag = res.headers.get("ETag");
    catalogCache = etag ? { etag, body, token } : null;
    return body;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      catalogCache = null;
      return null;
    }
    throw e;
  }
}

/** GET /<topic>/auth: can this account read the topic? 401 (bad token) throws and signs out. */
export async function canRead(topic: string): Promise<boolean> {
  const res = await fetch(`${base()}/${topic}/auth`, { headers: authHeaders() });
  if (res.status === 401 && currentToken()) {
    void clearLocalSession();
    throw new HttpError(401, "Signed out");
  }
  if (res.ok) return true;
  if (res.status === 403 || res.status === 404) return false;
  throw new HttpError(res.status, `HTTP ${res.status}`);
}

export async function addAccountSubscription(topic: string) {
  await request("/v1/account/subscription", {
    method: "POST",
    body: JSON.stringify({ base_url: base(), topic }),
  });
}

export async function removeAccountSubscription(topic: string) {
  await request("/v1/account/subscription", {
    method: "DELETE",
    headers: { "X-BaseURL": base(), "X-Topic": topic },
  });
}

/** Polls cached messages for several topics at once: GET /t1,t2/json?poll=1&since=… */
export async function poll(topics: string[], since: string): Promise<NtfyMessage[]> {
  if (topics.length === 0) return [];
  const res = await request(`/${topics.join(",")}/json?poll=1&since=${encodeURIComponent(since)}`);
  return parseNdjson(await res.text());
}

export interface PublishInput {
  topic: string;
  message: string;
  title?: string;
  priority?: number;
  tags?: string[];
  click?: string;
  markdown?: boolean;
}

export async function publish(input: PublishInput) {
  const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)));
  return (await request("/", { method: "POST", body: JSON.stringify(body) })).json();
}

export async function updateWebPush(sub: PushSubscription, topics: string[]) {
  const s = sub.toJSON();
  await request("/v1/webpush", {
    method: "POST",
    body: JSON.stringify({ endpoint: s.endpoint, auth: s.keys?.auth, p256dh: s.keys?.p256dh, topics }),
  });
}

export async function deleteWebPush(sub: PushSubscription) {
  await request("/v1/webpush", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) });
}

/** WebSocket URL for a multi-topic stream; auth goes in ?auth= because browsers cannot set WS headers. */
export function streamUrl(topics: string[], since: string | null, token: string | null) {
  const url = new URL(`${base()}/${topics.join(",")}/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (since) url.searchParams.set("since", since);
  if (token) {
    const b64 = btoa(`Bearer ${token}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    url.searchParams.set("auth", b64);
  }
  return url.toString();
}
