// A small stand-in for the ntfy server, for local development and screenshots.
//   bun dev/mock-server.ts            -> serves ./build on :4180 against mock data (login demo / demo)
// Implements just what web-kc uses: login, account, catalog, poll, ws stream, publish, token, webpush.
import { file } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { catalog, messages } from "./fixtures";

const PORT = Number(process.env.PORT ?? 4180);
const ROOT = join(import.meta.dir, "..", "build");
const TOKEN = "tk_mockmockmockmockmockmockmockm";
const user = { name: "demo", pass: "demo" };
// A subscription the account keeps but can no longer read: ntfy answers 403 to any
// multi-topic stream/poll that includes it, so the client must leave it out.
const DENIED = new Set(["legacy-reports"]);
let userSubs = ["legacy-reports"];
const sockets = new Set<{ ws: import("bun").ServerWebSocket<{ topics: string[] }> }>();

const configJs = `var config = ${JSON.stringify({
  base_url: "",
  app_root: "/",
  enable_login: true,
  require_login: true,
  enable_signup: false,
  enable_web_push: false,
  enable_catalog: true,
  web_push_public_key: "",
  disallowed_topics: ["docs", "static", "file", "app", "account", "settings", "signup", "login", "v1"],
  config_hash: "mock",
})};`;

const authed = (req: Request, url: URL) => {
  const h = req.headers.get("authorization") ?? (url.searchParams.get("auth") ? atob(url.searchParams.get("auth")!.replace(/-/g, "+").replace(/_/g, "/")) : "");
  return h === `Bearer ${TOKEN}`;
};
const json = (b: unknown, status = 200) => Response.json(b, { status });
const deny = () => json({ code: 40101, http: 401, error: "unauthorized" }, 401);

Bun.serve<{ topics: string[] }>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (process.env.LOG) console.log(req.method, p);
    // Dev-only shortcut for screenshot agents that cannot type into password fields.
    if (p === "/__mock_login") {
      const next = JSON.stringify(url.searchParams.get("next") ?? "/");
      const html = `<script>localStorage.setItem("kc.session", JSON.stringify({username:"demo",token:"${TOKEN}"}));location.replace(${next});</script>`;
      return new Response(html, { headers: { "content-type": "text/html" } });
    }
    if (p === "/config.js") return new Response(configJs, { headers: { "content-type": "text/javascript" } });
    if (p === "/manifest.webmanifest") return json({ name: "ntfy", short_name: "ntfy", start_url: "/", display: "standalone", icons: [{ src: "/static/images/pwa-192x192.png", sizes: "192x192", type: "image/png" }] });
    if (p === "/v1/account/login" && req.method === "POST") {
      const [u, pw] = atob((req.headers.get("authorization") ?? "").replace(/^Basic /, "")).split(":");
      return u === user.name && pw === user.pass ? json({ token: TOKEN, username: u }) : deny();
    }
    if (p.startsWith("/v1/")) {
      if (!authed(req, url)) return deny();
      if (p === "/v1/account")
        return json({ username: user.name, role: "user", sync_topic: catalog.sync_topic, subscriptions: userSubs.map((topic) => ({ base_url: url.origin, topic, display_name: null })) });
      if (p === "/v1/catalog") {
        const etag = `"mock-${catalog.version}"`;
        if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
        return Response.json({ ...catalog, base_url: url.origin }, { headers: { ETag: etag, "Access-Control-Expose-Headers": "ETag" } });
      }
      if (p === "/v1/account/subscription" && req.method === "DELETE") {
        userSubs = userSubs.filter((t) => t !== req.headers.get("x-topic"));
        return json({ success: true });
      }
      return json({ success: true });
    }
    if (p === "/" && req.method === "POST") {
      if (!authed(req, url)) return deny();
      const b = await req.json();
      const m = { id: `pub${Date.now()}`, time: Math.floor(Date.now() / 1000), event: "message", ...b, content_type: b.markdown ? "text/markdown" : undefined };
      delete m.markdown;
      messages.unshift(m);
      for (const s of sockets) if (s.ws.data.topics.includes(m.topic)) s.ws.send(JSON.stringify(m));
      return json(m);
    }
    const auth = p.match(/^\/([-_A-Za-z0-9]+)\/auth$/);
    if (auth) {
      if (!authed(req, url)) return deny();
      return DENIED.has(auth[1]) ? json({ code: 40301, http: 403, error: "forbidden" }, 403) : json({ success: true });
    }
    const stream = p.match(/^\/([-_A-Za-z0-9,]+)\/(json|ws)$/);
    if (stream) {
      if (!authed(req, url)) return deny();
      const topics = stream[1].split(",");
      if (topics.some((t) => DENIED.has(t))) return json({ code: 40301, http: 403, error: "forbidden" }, 403);
      if (stream[2] === "ws") return server.upgrade(req, { data: { topics } }) ? undefined : new Response("upgrade failed", { status: 400 });
      const since = url.searchParams.get("since");
      const sinceT = since && since !== "all" ? Number(since) : 0;
      const body = messages
        .filter((m) => topics.includes(m.topic as string) && (m.time as number) >= sinceT)
        .sort((a, b) => (a.time as number) - (b.time as number))
        .map((m) => JSON.stringify(m))
        .join("\n");
      return new Response(body + "\n", { headers: { "content-type": "application/x-ndjson" } });
    }
    // Static files, then SPA fallback for single-segment routes (like the Go server).
    const f = join(ROOT, p);
    if (p !== "/" && existsSync(f) && !p.endsWith("/")) return new Response(file(f));
    return new Response(file(join(ROOT, "index.html")), { headers: { "content-type": "text/html" } });
  },
  websocket: {
    open(ws) {
      const entry = { ws };
      sockets.add(entry);
      (ws as unknown as { entry: typeof entry }).entry = entry;
      ws.send(JSON.stringify({ id: "open", time: Math.floor(Date.now() / 1000), event: "open", topic: ws.data.topics.join(",") }));
    },
    message() {},
    close(ws) {
      sockets.delete((ws as unknown as { entry: { ws: typeof ws } }).entry);
    },
  },
});
console.log(`mock ntfy on http://localhost:${PORT} (login demo / demo)`);
