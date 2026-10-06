# ntfy (kudcrafts fork) — operations

Fork branch `kudcrafts` of KudcraftsHQ/ntfy, cut from upstream tag `v2.28.0`. Image
`ghcr.io/kudcraftshq/ntfy:v2.28.0-kc.N`. Spec: `docs/kudcrafts/catalog-spec.md`.

## Config

| Setting | Env | Default | Notes |
|---|---|---|---|
| `enable-catalog` | `NTFY_ENABLE_CATALOG` | `false` | Off = upstream behaviour. Requires `auth-file` (SQLite) and `base-url`; refused with `database-url`. |
| `catalog-inject-icon` | `NTFY_CATALOG_INJECT_ICON` | `true` | Adds the app icon to messages that have no `icon`. Only active with the catalog on. |
| `cache-duration` | `NTFY_CACHE_DURATION` | `12h` | Set `2160h` (90 days) for history. Only messages published after the change get the long expiry. |

`GET /config.js` carries `enable_catalog`, which switches the web UI's catalog features on.

## Deploy (Coolify service `ntfy`)

1. Release: every PR and push to `kudcrafts` already runs `kc-release.yaml`'s `docker-build` job (build without
   push + smoke run). Push a tag `v2.28.0-kc.N` on `kudcrafts`: the workflow tests and pushes
   `ghcr.io/kudcraftshq/ntfy:v2.28.0-kc.N` (amd64, stock `web`; arm64 or `web_dir=web-kc` via manual dispatch).
   The package must be public, or Coolify needs a ghcr pull credential.
2. Coolify: change the image from `binwiederhier/ntfy:v2.28.0` to `ghcr.io/kudcraftshq/ntfy:v2.28.0-kc.N`,
   catalog flag **off**. Redeploy. Check `https://ntfy.kudcrafts.com/v1/health` and that publishing still works.
3. Add `NTFY_ENABLE_CATALOG=true` **and** `NTFY_CACHE_DURATION=2160h` in the same redeploy (`NTFY_BASE_URL` is already set).
4. Verify:
   ```bash
   curl -s -u hammas:… https://ntfy.kudcrafts.com/v1/catalog | jq .
   curl -s https://ntfy.kudcrafts.com/config.js | grep enable_catalog
   docker exec <ntfy-container> ntfy catalog
   ```
   The catalog starts empty and fills as apps publish. `version` in `ntfy --help` / logs shows `-kc.`.

## Rollback

- **Catalog only:** set `NTFY_ENABLE_CATALOG=false` and redeploy. Code paths are upstream again (`s.catalog == nil`).
- **Whole fork:** set the image back to `binwiederhier/ntfy:v2.28.0`. Safe because:
  - The catalog tables (`catalog_app`, `catalog_topic`) are created with `CREATE TABLE IF NOT EXISTS`
    outside ntfy's migrations; `schemaVersion` stays 9. The official image ignores them. Re-enabling the fork
    later resumes with the data intact. To remove them: `sqlite3 user.db 'DROP TABLE catalog_topic; DROP TABLE catalog_app;'`.
  - `cache.db` is unchanged in shape. Messages published with a 90-day expiry keep it under the official
    image too (expiry is stamped per message at publish), and are pruned as they expire. If you also set
    `cache-duration` back to 12h, new messages get 12h; old ones keep their 90-day stamp.
  - Web clients keep their Dexie data; the extra fields (`catalog`, `appId`, …) are ignored by the stock UI.
    Virtual (catalog) account subscriptions disappear from `/v1/account`, so the stock web app removes them
    locally on its next sync (history for those topics goes with them).

## CLI (inside the container)

```bash
ntfy catalog                                       # table of apps/topics, locked/hidden, last publish
ntfy catalog app set facemap --name FaceMap --icon https://facemap.fyi/logo-200x200.png --sound alert
ntfy catalog app set facemap --unlock              # let publishers change it again
ntfy catalog app rm facemap [--force]              # --force also removes its topics
ntfy catalog topic set facemap-orders --name Orders --sound urgent
ntfy catalog topic set facemap-orders --sound inherit
ntfy catalog topic set facemap-debug --hidden      # never listed (deleting it would re-register on next publish)
ntfy catalog topic rm facemap-orders
ntfy catalog users                                 # each user -> topics they would see (ro/rw)
```

`set` locks the row (publishers can no longer change it via headers) unless `--unlock` is given. Flags may
come before or after the ID. A running server picks up CLI changes within 30 s and pushes a sync event to
every user whose view changed.

Sound classes: `silent`, `default`, `alert`, `urgent`. App ids: `^[a-z0-9][a-z0-9-]{0,31}$`. A topic belongs
to app `X` only if it is `X` or starts with `X-`.

## Admin API (admin users)

```bash
curl -u hammas:… -X PUT https://ntfy.kudcrafts.com/v1/catalog/apps/facemap -d '{"name":"FaceMap","icon":"https://facemap.fyi/logo-200x200.png","sound":"alert"}'
curl -u hammas:… -X PUT https://ntfy.kudcrafts.com/v1/catalog/topics/facemap-orders -d '{"name":"Orders","sound":"urgent","hidden":false}'
curl -u hammas:… -X DELETE 'https://ntfy.kudcrafts.com/v1/catalog/apps/facemap?force=1'
curl -u hammas:… 'https://ntfy.kudcrafts.com/v1/catalog?all=1'      # includes hidden topics + locked/hidden fields
```

Error codes (kudcrafts range): 40080 app id, 40081 name, 40082 icon, 40083 sound, 40084 app is not a prefix
of topic, 40085 topic, 40480 not found, 40980 app still has topics.

## Publishers: registering an app

Nothing is required: the first authorized publish registers the topic under the app derived from its prefix
(`facemap-orders` → `facemap`). To give it a name, icon and sound, send these headers once (values persist;
query params `?app-name=…` also work):

```bash
curl -H "Authorization: Bearer $NTFY_TOKEN" \
     -H "X-App-Name: FaceMap" \
     -H "X-App-Icon: https://facemap.fyi/logo-200x200.png" \
     -H "X-App-Sound: default" \
     -H "X-Display-Name: Orders" \
     -H "X-Sound: alert" \
     -d "New paid order" https://ntfy.kudcrafts.com/facemap-orders
```

JSON publishing (`POST /` with a JSON body) has no fields for these; send them as headers on that request.

| Header | Query | Meaning |
|---|---|---|
| `X-App` | `app` | App id; optional, defaults to the topic prefix; must be a prefix of the topic |
| `X-App-Name` | `app-name` | App display name (1–64 chars, no `<>`) |
| `X-App-Icon` | `app-icon` | App icon, https only, ≤512 chars |
| `X-App-Sound` | `app-sound` | App default sound class |
| `X-Display-Name` | `display-name` | Topic display name |
| `X-Sound` | `sound` | Topic sound class (overrides the app's) |

Invalid values are ignored (logged at `warn`, tag `catalog`); the publish itself never fails because of them.
Admin-set (locked) rows are not changed by headers. Sync topics (`st_…`) and `disallowed-topics` never register.

## Users

```bash
ntfy user add partner
ntfy access partner facemap-orders read-only
ntfy catalog users        # check what partner will see
```

Clients sign in once and mint a per-device token (`POST /v1/account/token`); revoke it in the web app under
Account → Access tokens.

## Notes

- `/docs` serves an empty page in this image: the mkdocs site is not built (`server/docs/index.html` is a stub).
  Use https://docs.ntfy.sh.
- Renaming a catalog topic in the stock web app stores a real account subscription for it, so the rename
  persists. That subscription outlives the catalog entry (if the topic is later hidden or removed, the user keeps
  it until they unsubscribe).
- Publisher header changes are applied at most once per minute per app/topic, and reach clients after a 2 s
  debounced reload (or the 30 s loop). Admin edits (CLI/API) are not limited.
- `history_days` in `/v1/catalog` is `cache-duration` in days, rounded up, minimum 1. Set `NTFY_CACHE_DURATION=2160h`
  in the same redeploy that enables the catalog, so clients never prune to 1 day.

## Monitoring history size

```bash
ls -la /var/cache/ntfy/cache.db
sqlite3 /var/cache/ntfy/cache.db 'select count(*) from messages'
```

## Embedded site contract (for an alternative web client, e.g. `web-kc/`)

`Dockerfile.kudcrafts` takes `--build-arg WEB_DIR=<dir>` (default `web`). For any `WEB_DIR`:

1. Build, chosen by lockfile:
   - `bun.lock` present (web-kc): `bun install --frozen-lockfile && bun run build:site`. `build:site` must leave
     the finished site in `../server/site` (relative to `WEB_DIR`; the Dockerfile creates `../server/`).
   - otherwise (stock web): `npm ci && npm run build`, which must produce `build/index.html` plus assets; the
     Dockerfile then does the moves in step 2.
2. Either way the result is the Makefile's `web-build` layout: `build/index.html` → `app.html`, `config.js`
   removed, embedded as `server/site/` (Go `//go:embed site`).
3. The server serves **only** these paths from the site: `/app.html`, `/sw.js`, `/sw.js.map` and anything under
   `/static/`. So every asset (JS, CSS, images, fonts, favicon) must live under `/static/…` (Vite:
   `build.assetsDir: "static/media"`; public files under `public/static/`).
4. Every other GET that is not an API/topic-stream path (`/`, `/<topic>`, `/account`, `/settings`, …) returns
   `app.html`, so client-side routing works.
5. The server generates `GET /config.js` as `var config = {…};` (fields: `base_url`, `app_root`,
   `enable_login`, `require_login`, `enable_signup`, `enable_payments`, `enable_calls`, `enable_emails`,
   `enable_reset_password`, `enable_reservations`, `enable_web_push`, `enable_catalog`, `billing_contact`,
   `web_push_public_key`, `disallowed_topics`, `config_hash`). Load it with a plain `<script src="/config.js">`
   before the app bundle. `base_url` may be empty: fall back to `window.location.origin`.
6. `GET /manifest.webmanifest` is generated by the server (it is not taken from the build).
7. Web push: the service worker must be `/sw.js` (scope `/`).
