import { config } from "./config";
import { currentToken, useSession } from "./session";
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
  if (res.status === 401 && currentToken()) {
    // Token expired or revoked: drop the session so the login screen shows.
    useSession.getState().signOut();
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

/** GET /v1/catalog. Returns null when the server has the catalog disabled (404). */
export async function fetchCatalog(): Promise<Catalog | null> {
  try {
    return await (await request("/v1/catalog", { headers: { "Cache-Control": "no-cache" } })).json();
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
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
