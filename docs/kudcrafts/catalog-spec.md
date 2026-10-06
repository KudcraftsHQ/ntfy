# ntfy "catalog" — sign in once, every app/topic appears, with history

Status: build-ready spec. Four builders work in parallel from this document: **S** (server + web), **A** (ntfy-android), **M** (ntfy-bar, macOS), **W** (ntfy-bar-windows, new repo). Section 14 is the contract they share; sections 15–18 are their file-level breakdowns.

Repos: `/Users/hammashamzah/Projects/ntfy` (Go server + `web/`), `/Users/hammashamzah/Projects/ntfy-android`, `/Users/hammashamzah/Projects/ntfy-bar`, `/Users/hammashamzah/Projects/ntfy-bar-windows` (to be created). Production: `https://ntfy.kudcrafts.com`, official image `binwiederhier/ntfy:v2.28.0`, Coolify, `auth-default-access: deny-all`, sqlite `user.db` + `cache.db`, web push on.

---

## 1. Decisions (one line of rationale each)

| # | Decision | Why |
|---|---|---|
| D1 | A **server-side catalog** in two new sqlite tables in `user.db` (`catalog_app`, `catalog_topic`) is the single source of "what exists". | ACL wildcards (`facemap-*`) cannot be enumerated; a publish-registered catalog turns patterns into concrete topics. |
| D2 | **Auto-registration on first authorized publish** (headers `X-App`, `X-App-Name`, `X-App-Icon`, `X-App-Sound`, `X-Display-Name`, `X-Sound`); admin edits via `ntfy catalog …` CLI or `/v1/catalog/*` admin API; admin-edited rows are `locked` and publishers can no longer change them. | Zero admin steps for a new app; admin still wins. |
| D3 | A topic belongs to exactly one app; app id defaults to the topic prefix before the first `-` (`facemap-orders` → `facemap`), and a publisher may only set `X-App` to an app that is a prefix of the topic. | Matches the existing ACL convention `<app>`, `<app>-*`; prevents a publisher of `facemap-*` from editing `kudtrading`'s metadata. |
| D4 | **Enumeration is per request**: `GET /v1/catalog` filters the catalog through `userManager.Authorize(user, topic, PermissionRead)` for every concrete topic. | Reuses the ACL exactly; nothing is ever listed that the user cannot already stream. |
| D5 | **Reuse account-synced subscriptions**: `GET /v1/account` merges the user's readable catalog topics into `subscriptions` as virtual entries. | The web app already auto-subscribes from `account.subscriptions`; stock ntfy web clients get auto-subscribe for free. |
| D6 | **Reuse the per-user sync topic** (`account.sync_topic`) to push `{"event":"sync"}` when a user's catalog view changes; clients also poll `/v1/catalog` every 15 min with `ETag`. | Seconds-level propagation with existing plumbing; polling covers missed events. |
| D7 | Catalog tables are created with `CREATE TABLE IF NOT EXISTS` at startup, **outside** ntfy's schema migrations; `schemaVersion` stays 9. | `db/schema/schema.go` `Migrate()` returns an error if the stored version is greater than the binary's target, so bumping it would break rollback to the official image. Unknown tables are never touched. **Verified.** |
| D8 | Android: **one notification channel per (app, sound class)**, not per topic; channel id embeds the sound class. | Per-topic channels explode the settings list; Android channels are immutable after creation, so a changed default needs a new channel id, not an edit. |
| D9 | Four **sound classes**: `silent`, `default`, `alert`, `urgent`; each client maps them to its platform (bundled OGG on Android, bundled CAF on macOS, `ms-winsoundevent:` on Windows). | A closed set keeps the catalog portable; file names/URLs in the catalog would be an injection surface. |
| D10 | Retention = `cache-duration: 2160h` (90 d). `history_days` in the catalog response is derived from it; clients backfill with `since=all` on first sync. | One knob; the server already enforces expiry per message. |
| D11 | The server injects the app icon into messages that have none (`m.Icon = app.icon`), behind its own setting `catalog-inject-icon` (`NTFY_CATALOG_INJECT_ICON`), **default on**; only active when `enable-catalog` is on. | Stock clients (and notifications on every platform) show the app icon with no client change. |
| D12 | Fork branch `kudcrafts` is cut from tag **`v2.28.0`** (what production runs), not from upstream `main`; versions `v2.28.0-kc.N`. | Rollback is a pure image swap; `main` has moved (46 commits, cluster work) and its cache schema may differ. |
| D13 | Server feature flag `enable-catalog` (`NTFY_ENABLE_CATALOG`), default off; sqlite `auth-file` required. | Off = byte-for-byte upstream behaviour. |
| D14 | Android sign-in mints an **access token** (`POST /v1/account/token`) stored in the existing `user` table; `HttpUtil` sends `Bearer` for `tk_` passwords. | Revocable, scoped, and the smallest diff; the app sandbox is the Android norm (upstream stores passwords the same way). |
| D15 | Android fork ships as the `fdroid` flavor with `applicationId com.kudcrafts.ntfy`, GitHub Releases + Obtainium. | No Firebase on our server; a new id installs beside Play-store ntfy. |
| D16 | ntfy-bar-windows mirrors ntfy-bar's `AppSettings`/`TopicConfig`/`PersistedState` shapes one-to-one in JSON. | Two clients, one mental model; the macOS reconcile logic ports line by line. |

---

## 2. Data model + migration (server, `user.db`)

Created by `user.NewCatalogStore(m *Manager)` at startup (new file `user/catalog.go`, package `user` so it can use the unexported `m.db` without touching `manager.go`):

```sql
CREATE TABLE IF NOT EXISTS catalog_app (
  id        TEXT PRIMARY KEY,                 -- ^[a-z0-9][a-z0-9-]{0,31}$
  name      TEXT NOT NULL,                    -- 1..64 chars, display name
  icon      TEXT NOT NULL DEFAULT '',         -- '' or https URL <= 512 chars
  sound     TEXT NOT NULL DEFAULT 'default',  -- silent|default|alert|urgent
  locked    INT  NOT NULL DEFAULT 0,          -- 1 = admin-set; publishers cannot change
  created   INT  NOT NULL,
  updated   INT  NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_topic (
  topic        TEXT PRIMARY KEY,              -- user.AllowedTopic()
  app_id       TEXT NOT NULL,                 -- FK (logical) catalog_app.id
  name         TEXT NOT NULL DEFAULT '',      -- '' = show topic id
  sound        TEXT NOT NULL DEFAULT '',      -- '' = inherit app.sound
  hidden       INT  NOT NULL DEFAULT 0,       -- admin-only: never listed, no sync events
  locked       INT  NOT NULL DEFAULT 0,
  created      INT  NOT NULL,
  updated      INT  NOT NULL,
  last_publish INT  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_catalog_topic_app ON catalog_topic (app_id);
```

- No `schemaVersion` change. No Postgres support: `ntfy serve` errors at startup if `enable-catalog` is set together with `database-url`, or without `auth-file`.
- Rollback: run the official image; the two tables are inert. Re-enabling the fork later resumes with the data intact.
- `user.CatalogStore` API (all return `error`): `Apps() ([]*CatalogApp, error)`, `Topics() ([]*CatalogTopic, error)`, `UpsertApp(*CatalogApp, lock bool)`, `UpsertTopic(*CatalogTopic, lock bool)`, `TouchTopic(topic string, ts int64)`, `DeleteApp(id)`, `DeleteTopic(topic)`. Upserts from publishers (`lock=false`) must not overwrite rows whose `locked=1` (SQL `WHERE locked = 0` on update) and must not set `locked`.

Types (in `user/catalog.go`):

```go
type CatalogApp   struct { ID, Name, Icon, Sound string; Locked bool; Created, Updated int64 }
type CatalogTopic struct { Topic, AppID, Name, Sound string; Hidden, Locked bool; Created, Updated, LastPublish int64 }
var catalogSounds = []string{"silent", "default", "alert", "urgent"}
```

---

## 3. Server API

All JSON. Errors use ntfy's `errHTTP` envelope `{"code":…, "http":…, "error":…}`. New codes live in `server/server_catalog.go` (not `errors.go`): `40030 invalid catalog app id`, `40031 invalid catalog name`, `40032 invalid catalog icon URL (https only, <=512)`, `40033 invalid sound class`, `40034 app is not a prefix of topic`, `40405 catalog entry not found`.

### 3.1 `GET /v1/catalog` — user's view
Auth: `ensureUser` (401 if anonymous, 404 if `enable-catalog` is off). Rate-limited with `limitRequests`. Supports `If-None-Match` → `304`. Response header `ETag: "<version>"`, `Cache-Control: no-cache`.

```json
{
  "version": 1759740000123,            // unix ms of the last catalog change (snapshot generation)
  "base_url": "https://ntfy.kudcrafts.com",
  "history_days": 90,                   // floor(cache-duration / 24h)
  "sync_topic": "st_abc…",              // the caller's account sync topic (same as /v1/account)
  "apps": [
    {
      "id": "facemap", "name": "FaceMap",
      "icon": "https://facemap.fyi/icon-192.png",   // "" when unset
      "sound": "default",
      "topics": [
        { "topic": "facemap-orders", "name": "Orders", "sound": "alert",  "permission": "read-only" },
        { "topic": "facemap-alerts", "name": "",       "sound": "default", "permission": "read-write" }
      ]
    }
  ]
}
```
Rules: `topics[].sound` is already resolved (topic override or app default, never `""`). Apps with zero readable topics are omitted. Hidden topics are omitted. Sorted by `app.name`, then `topic`. `permission` is `read-only` or `read-write` from `Authorize(..., PermissionWrite)`. Admins see every non-hidden topic. `?all=1` (admin only) also includes hidden topics and the `locked`/`hidden` fields.

### 3.2 Admin edits (`ensureAdmin`)
- `PUT /v1/catalog/apps/{id}` body `{"name":"FaceMap","icon":"https://…","sound":"alert"}` — upsert, sets `locked=1`. Omitted fields keep their current value. 200 → the app object.
- `DELETE /v1/catalog/apps/{id}` — 409 (`40907 app still has topics`) unless `?force=1`, which also deletes its topics.
- `PUT /v1/catalog/topics/{topic}` body `{"app":"facemap","name":"Orders","sound":"alert","hidden":false}` — upsert, sets `locked=1`; `app` must satisfy D3 or `40034`; creates the app row if missing (`name` = Title-cased id).
- `DELETE /v1/catalog/topics/{topic}` — 200; the topic will re-register on the next publish unless its app is locked **and** `hidden` was set (so: to permanently hide, `PUT … "hidden":true`).
Admin edits call `catalog.reload()` immediately (see 3.4).

### 3.3 `GET /v1/account` (existing, 3-line hook)
When the catalog is enabled and `v.User() != nil`, after `response.Subscriptions` is filled: `response.Subscriptions = s.catalog.mergeSubscriptions(u, response.Subscriptions)` appends `{base_url: s.config.BaseURL, topic, display_name: <topic.name or null>}` for every readable, non-hidden catalog topic not already present (match on topic + base_url). Existing (user-stored) entries win. `base-url` must be configured (it is, for web push). Virtual entries are not persisted; `PATCH`/`DELETE /v1/account/subscription` on them return 404 / no-op as today.

### 3.4 Snapshot, reload, sync fan-out (`server/server_catalog.go`)
- `type catalog struct { s *Server; store *user.CatalogStore; mu sync.RWMutex; apps map[string]*user.CatalogApp; topics map[string]*user.CatalogTopic; version int64; lastTouch map[string]int64 }`.
- `reload()` reads both tables, swaps the snapshot, bumps `version` only if content changed, then **diffs per user**: for every `userManager.Users()` (plus nothing for anonymous), compute `view(u)` = readable `{topic, app, name, sound, icon}` set before and after; if different → `s.publishSyncEventForUser(s.visitor(netip.MustParseAddr("127.0.0.1"), u), u)` (existing function in `server_account.go`). Runs every **30 s** in a goroutine started from `Server.Run()` (one `go s.catalog.loop(stopCh)` line) and immediately after any write.
- ACL changes (`ntfy access …`) are picked up by the 30 s loop too because `view(u)` is recomputed each cycle. Cost: users × topics `Authorize` calls from the in-memory access cache; trivial at our scale (<50 × <500).

---

## 4. Publish-time auto-registration

Hook (3 lines) in `handlePublishInternal` (`server/server.go`) right after `parsePublishParams` succeeds and before `s.dispatch`:
```go
if s.catalog != nil { s.catalog.onPublish(r, v, t.ID, m) }
```
`onPublish` never fails a publish; invalid metadata is ignored and logged at `warn` with tag `catalog`.

Headers (via `readParam`, so `?app=` query params also work): `X-App` / `app`, `X-App-Name` / `app-name`, `X-App-Icon` / `app-icon`, `X-App-Sound` / `app-sound`, `X-Display-Name` / `display-name`, `X-Sound` / `sound`.

Algorithm:
1. `app := X-App or derive(topic)` where `derive` = substring before the first `-` (whole topic if none). Reject (ignore) if `app` fails the id regex or is not a prefix of the topic per D3.
2. Validate: names 1–64 chars after `strings.TrimSpace`, control characters stripped, no `<`/`>`; icon must parse with `url.Parse`, scheme `https`, non-empty host, ≤512 chars; sound ∈ `catalogSounds`.
3. In memory: if topic unknown → `UpsertTopic{Topic, AppID: app, Name: X-Display-Name, Sound: X-Sound}` and `UpsertApp` if the app is unknown (`Name: X-App-Name or Title(app)`, `Icon: X-App-Icon`, `Sound: X-App-Sound or "default"`); then `reload()` asynchronously. If known → write only fields that are provided **and** differ **and** row not locked; `TouchTopic` at most once per 10 min per topic (`lastTouch`).
4. Icon injection (D11): if `catalog-inject-icon` is true (default) and `m.Icon == ""` and the resolved app has an icon → `m.Icon = app.Icon`. Done after step 3 so the first publish of a new app already carries it.
5. Does **not** run for the user's sync topics (`st_…` prefix) or for topics in `disallowed-topics`.

Stock `ntfy publish` / curl without the headers still registers the topic under the derived app with no name (clients show the topic id). Existing publishers (kudtrading, facemap-*, …) need no change; adding `X-App-Name`/`X-App-Icon` once is enough since values persist.

---

## 5. CLI — `ntfy catalog` (new `cmd/catalog.go`, `//go:build !noserver`)

Opens `user.db` directly through `createUserManager(c)` + `user.NewCatalogStore`, exactly like `ntfy access`; the running server notices within 30 s (3.4). Must run where the config/auth-file is (inside the container: `docker exec <ntfy> ntfy catalog …`).

```
ntfy catalog                                  # table: app, topic, name, sound, locked, hidden, last publish
ntfy catalog app set ID [--name N] [--icon URL] [--sound CLASS] [--unlock]
ntfy catalog app rm ID [--force]
ntfy catalog topic set TOPIC [--app ID] [--name N] [--sound CLASS|inherit] [--hidden|--visible] [--unlock]
ntfy catalog topic rm TOPIC
ntfy catalog users                            # admin check: each user → the topics they would see (uses Authorize)
```
`set` locks the row unless `--unlock` is given. Validation identical to section 4 (shared helpers in `user/catalog.go`: `ValidateCatalogAppID`, `ValidateCatalogName`, `ValidateCatalogIcon`, `ValidateCatalogSound`).

---

## 6. Web app changes (`web/src`)

Reused as-is: `AccountApi.sync()` → `subscriptionManager.syncFromRemote(account.subscriptions, …)` (auto-subscribe comes from 3.3), the sync-topic listener in `hooks.js` (`handleInternalMessage` → `sync()`), `Session.js` token storage.

Changes:
1. `web/src/app/config.js` / `server/types.go` `apiConfigResponse` / `server_web.go configResponse()`: add `enable_catalog` (1 field each).
2. `AccountApi.js`: `async catalog()` → `GET ${config.base_url}/v1/catalog` with the session bearer; returns the JSON or `null` on 404. In `sync()`, after `syncFromRemote`, `if (config.enable_catalog) await subscriptionManager.syncFromCatalog(await this.catalog())`.
3. `SubscriptionManager.js`: `syncFromCatalog(catalog)` → for each app/topic `upsert(catalog.base_url, topic, { catalog: true, appId, appName, appIcon, sound, catalogName: name })`; for local subscriptions with `catalog: true` whose topic is no longer in the catalog, `update(id, { catalog: false, appId: null, … })` (the account sync already removed subscriptions the server dropped). No Dexie version bump (fields are not indexed).
4. `Navigation.jsx` `SubscriptionList`: group by `appId` (header = app name + 20 px icon from `appIcon`, `ListSubheader`), sorted by app name then topic; ungrouped subscriptions last under no header. `SubscriptionItem`: show `appIcon` (`<Avatar src>` with `ChatBubbleOutlineIcon` fallback), name = `displayName || catalogName || topic`.
5. `SubscriptionPopup.jsx`: hide "Unsubscribe" for `catalog: true` subscriptions (it would reappear on next sync); keep Mute and Rename (rename writes the user's own account subscription, which then wins per 3.3).
6. `Notifier.js` / `notificationUtils.js` / `public/sw.js`: use `message.icon` (server-injected app icon) as the notification `icon` when present; fall back to the ntfy icon.
7. Sound classes on web: `sound` only influences the existing `prefs.sound` playback: `silent` → no sound; other classes use the user's chosen sound (web has one global sound; no per-app sounds).
8. `Preferences.jsx`: nothing new; "Delete after" controls local history (see 10).

---

## 7. Android changes (`ntfy-android`, fdroid flavor)

Reused: `Subscription`/`Notification` Room entities and `Repository`, `SubscriberService` + `JsonConnection`/`WsConnection` (all our subscriptions are `instant`; our server has no FCM), `DownloadIconWorker` icon cache, `DeleteWorker`, `NotificationService` channel/group machinery, `ApiService.checkAuth`, Settings → Users.

### 7.1 Sign-in and credentials
- Settings gains a "Kudcrafts account" category (new `res/xml` entries + `ui/CatalogLoginDialog.kt`): server URL (default `https://ntfy.kudcrafts.com`, from `R.string.app_base_url` which the fork sets to our server), username, password → `POST {base}/v1/account/token` with Basic auth, body `{"label":"android-<Build.MODEL>"}` → store `User(baseUrl, username, password = token)` via `repository.addUser`, set `repository.setDefaultBaseUrl(base)`, then run `CatalogSync.now()`. Sign-out deletes the token (`DELETE /v1/account/token` with `X-Token`) and the `User`.
- `util/HttpUtil.requestBuilder`: if `user.password.startsWith("tk_")` → `Authorization: Bearer <token>` (3 lines). Everything else (streams, polls, publish) inherits it.

### 7.2 Data model — Room migration 18 → 19
`Subscription` gains: `managed: Boolean` (default false), `catalogApp: String?`, `catalogAppName: String?`, `catalogIcon: String?` (https URL), `catalogSound: String?` (resolved class), `catalogName: String?`. Update `SubscriptionWithMetadata`, every hand-written SELECT in `SubscriptionDao`, the secondary constructor and `Repository` mappers; export schema `19.json`. Managed subscriptions are created with `instant=true, mutedUntil=0, minPriority=USE_GLOBAL, autoDelete=THREE_MONTHS, insistent=USE_GLOBAL, dedicatedChannels=false`.

### 7.3 `CatalogSync` (new `service/CatalogSync.kt`, singleton)
- Triggers: `now()` from sign-in, `MainActivity.onResume`, every `SubscriberService` connection open, `sync` event (7.4), and a `PeriodicWorkRequest` `CatalogSyncWorker` every 15 min (`ExistingPeriodicWorkPolicy.KEEP`, network required).
- Fetch `GET {base}/v1/catalog` with `If-None-Match` (store ETag in prefs `CatalogEtag`); 304 → done; 401/403 → mark `catalogAuthError` pref (Settings shows "Sign in again"); other errors → log, no changes. **Only a 200 reconciles.**
- Reconcile (pure function `reconcile(current: List<Subscription>, catalog: Catalog): Plan` with `add/update/remove` lists — unit-testable):
  - missing (baseUrl, topic) → add managed subscription with `displayName = null`, catalog fields set; then `Poller`-style backfill `GET /{topic}/json?poll=1&since=all` (reuse `MainActivity.onSubscribe`'s "poll cached messages" path); downloads icon if `catalogIcon != ""`.
  - present → update catalog fields; `displayName` untouched (user rename wins; list shows `displayName ?: catalogName ?: topic`); if `catalogIcon` changed → re-download.
  - present with `managed=true` but absent from catalog → `removeSubscription` (history goes with it; the user lost read access).
  - unmanaged user-added subscriptions are never touched.
- Icon download: https only, ≤300 KB, OkHttp `defaultClient`, saved to the existing `filesDir/SUBSCRIPTION_ICONS/<id>` path and set via `updateSubscriptionIcon` **only if** `subscription.icon` is null or was previously set by the catalog (track with prefs key `CatalogIcon:<id>` = url).
- After reconcile: `SubscriberServiceManager.refresh(context)` and `NotificationService.reconcileCatalogChannels(subscriptions)` (7.5).

### 7.4 Sync topic (seconds-level updates)
`SubscriberService.reallyRefreshConnections()`: when a `User` with a `tk_` token exists for a base URL and prefs `CatalogSyncTopic:<baseUrl>` is set (fetched from `/v1/catalog.sync_topic` on each 200), add `syncTopic -> CatalogSync.SYNC_SUBSCRIPTION_ID (-1L)` to that connection's `topicsToSubscriptionIds`. In `onNotificationReceived`, if `subscriptionId == SYNC_SUBSCRIPTION_ID` → `CatalogSync.now()` and return (never stored, never notified). Include the sync topic in `ConnectionId` so the connection restarts when it appears.

### 7.5 Notification channels (`NotificationService`)
- For `subscription.catalogApp != null`: group id `kc-app-<app>` (`NotificationChannelGroup` name = `catalogAppName`), channels keyed by **(app, sound class)** with ids:
  - `kc-<app>-<class>-low` — priorities 1–2: `IMPORTANCE_LOW`, no sound.
  - `kc-<app>-<class>` — priorities 3–4: see table.
  - `kc-<app>-<class>-max` — priority 5: `IMPORTANCE_HIGH`, lights, long vibration, `setBypassDnd(true)`, sound = urgent file. Insistent behaviour unchanged (existing `insistent` logic, `getInsistentSound` reads this channel).

| class | importance (prio 3–4) | sound (res/raw) | vibration |
|---|---|---|---|
| silent | `IMPORTANCE_LOW` | none | none |
| default | `IMPORTANCE_DEFAULT` | `kc_default.ogg` | none |
| alert | `IMPORTANCE_HIGH` | `kc_alert.ogg` | short |
| urgent | `IMPORTANCE_HIGH` | `kc_urgent.ogg` | long |

- Sound URI: `android.resource://${BuildConfig.APPLICATION_ID}/raw/kc_<class>` with `AudioAttributes(USAGE_NOTIFICATION, CONTENT_TYPE_SONIFICATION)`. Files: three ≤100 KB OGG/Opus clips under `app/src/main/res/raw/` (see Q5).
- Immutability handling: because the class is in the id, a changed catalog default simply yields a new channel; `reconcileCatalogChannels` deletes `kc-<app>-*` channels whose class no longer matches any subscription of that app, and deletes groups of apps that vanished. User edits to a live channel (sound, importance, off) are preserved by Android and respected automatically; if a user turns a channel off, that is their per-app mute at OS level.
- `displayInternal`: `groupId = if (sub.catalogApp != null) "kc-app-${sub.catalogApp}" else existing logic`; `channelId` from the table above using `sub.catalogSound`. Dedicated-channels toggle is hidden for managed subscriptions.
- Large icon: existing `notification.icon.contentUri ?: subscription.icon` already shows the app icon (server injects `icon`; the subscription icon is the downloaded catalog icon).

### 7.6 UI
- `MainAdapter`: sectioned list — header per app (icon + name + unread total + overflow menu: **Mute app** (reuses the mute-until dialog, applies `mutedUntil` to all its subscriptions), **Unmute app**, **Notification settings** (`Settings.ACTION_APP_NOTIFICATION_SETTINGS`)), topics beneath; unmanaged subscriptions under "Other". Row name = `displayName ?: catalogName ?: topic`, subtitle = last message.
- `DetailSettingsActivity` for managed subscriptions: hide "dedicated channels"; show read-only "App: <name>", "Sound: <class> (from server)"; keep mute, min priority, auto delete, display name, custom icon.
- "Add subscription" FAB remains (manual topics still work).

### 7.7 Build, signing, distribution, updates
- `app/build.gradle` fdroid flavor: `applicationId "com.kudcrafts.ntfy"`, `versionName "1.25.2-kc.1"`, `versionCode` = upstream code × 100 + N (`6301`), `resValue "string","app_name","ntfy Kudcrafts"`, `app_base_url = https://ntfy.kudcrafts.com`. Release `signingConfig` reads `KC_KEYSTORE_*` env vars (base64 keystore in GitHub secrets).
- `.github/workflows/kc-release.yaml`: on tag `v*-kc.*` → `./gradlew assembleFdroidRelease` → sign → upload `ntfy-kudcrafts-<tag>.apk` to a GitHub Release. Obtainium entry: repo `KudcraftsHQ/ntfy-android`, regex `.*\.apk`. Versioning against upstream: rebase `kudcrafts` branch onto upstream tags; the version string is `<upstream>-kc.<n>`.

---

## 8. ntfy-bar (macOS) changes

Reused: `AppSettings` / `TopicConfig` (custom `init(from:)` with `decodeIfPresent`), `Keychain` (`password`, `token`), single JSON stream + `scheduleReconnect()` on `enabledTopicNames` change, `Notifier`, `IconCache`, `MenuView` chips.

1. `Models.swift`: `TopicConfig` gains optional `managed: Bool?`, `app: String?`, `appName: String?`, `appIcon: String?`, `sound: String?`, `displayName: String?` (all via `decodeIfPresent`). `AppSettings` gains `catalogEnabled: Bool?` (nil = true when `serverURL` host ≠ `ntfy.sh`), `syncTopic: String?`.
2. New `CatalogSync.swift`: `struct Catalog: Decodable` (section 3.1 shape), `static func fetch(base:auth:etag:session:) async throws -> (Catalog?, etag)`, pure `static func reconcile(current: [TopicConfig], catalog: Catalog) -> [TopicConfig]` (add missing as `managed: true, enabled: true, muted: false`; update catalog fields on existing, keep `muted`/`enabled`; drop `managed == true` topics no longer listed; never touch unmanaged).
3. `AppModel.swift`: `catalogTask`, `restartCatalogSync()` (fetch → `settings.topics = reconcile(...)` → sleep 15 min); started in `start()`, restarted in `updateCredentials` and on `serverURL` change, kicked on wake/path change. 401/403 → `.authError`. `settings.syncTopic` is appended to `streamURL()` topics; `ingest` drops messages whose `topic == syncTopic` and, if the body contains `"event":"sync"`, calls `restartCatalogSync()` immediately. Initial `since` for a freshly added managed topic: poll `GET /{topic}/json?poll=1&since=7d` once and merge into `entries` (cap raised to 2000).
4. `SettingsView.swift`: "Sign in" button (username + password → `POST /v1/account/token` label `ntfy-bar-<hostname>` → store token in Keychain, clear password), "Sync now", last sync time; `TopicRow` shows a "managed" badge and the app name; managed topics cannot be removed, only disabled/muted.
5. `MenuView.swift`: chips grouped by `appName` (section label), icon from `appIcon` via `IconCache`.
6. `Notifier.swift`: sound by class — `silent` → `nil`; `default` → `.default`; `alert` → `UNNotificationSound(named: "kc_alert.caf")`; `urgent` → `UNNotificationSound(named: "kc_urgent.caf")` (+ `interruptionLevel = .timeSensitive`). Files under `Resources/Sounds/`, declared in `Package.swift` `resources: [.copy("Sounds")]`, and copied into `Contents/Resources` by `build.sh`. `soundForAll` keeps its meaning for unmanaged topics.
7. No Swift can be compiled on hammas-dev: builder M writes code + unit tests (`Tests/NtfyBarTests/CatalogSyncTests.swift` for `reconcile` and decoding) and Hammas runs `swift test && ./build.sh` on the Mac. Keep edits to `AppModel.swift` ≤ 60 lines; everything else is new files.

---

## 9. ntfy-bar-windows (new repo `KudcraftsHQ/ntfy-bar-windows`)

Stack: **C# / .NET 8**, WinForms `NotifyIcon` tray app (no WPF; smaller), `Microsoft.Toolkit.Uwp.Notifications` (CommunityToolkit) for toasts, `Meziantou.Framework.Win32.CredentialManager` for the Credential Manager, `System.Text.Json`. Self-contained single-file `win-x64` exe (`PublishSingleFile`, `IncludeNativeLibrariesForSelfExtract`, trimming off). Unpackaged.

### 9.1 What Windows allows (unpackaged toast app) — verified constraints
- **Sounds**: only the built-in `ms-winsoundevent:Notification.*` set (`Default`, `IM`, `Mail`, `Reminder`, `SMS`, `Looping.Alarm1–10`, `Looping.Call1–10`) and `silent`. Custom audio (`ms-appx:///`, `ms-appdata:///`) requires a packaged MSIX app; `file:///` audio is ignored. Users can toggle sound per app in Settings → Notifications but cannot choose a different file. So the mapping is: `silent` → `<audio silent="true"/>`; `default` → `Notification.Default`; `alert` → `Notification.Reminder`; `urgent` → `Notification.Looping.Alarm2` with `loop="false"` and `scenario="reminder"` (toast stays until dismissed). Looping (`loop="true"`) only for priority 5 when the user enables "insistent" in settings (`scenario="alarm"`).
- **Images**: `appLogoOverride` for unpackaged apps must be a **local file path**; `http(s)` image sources only work for packaged apps with the internet capability. So app icons are downloaded (https only, ≤300 KB) to `%LOCALAPPDATA%\ntfy-bar\icons\<sha256(url)>.png` and referenced by path. Hero/inline images same rule.
- **Activation**: `ToastNotificationManagerCompat` registers the AUMID + COM activator for unpackaged apps automatically (HKCU); `OnActivated` gives the argument string. Buttons: `view`/`http` ntfy actions map to `AddButton(label, ToastActivationType.Protocol, url)` for `view` and `ToastActivationType.Background` + our handler issuing the HTTP call for `http`; `broadcast` is unsupported (skipped).
- **Grouping**: `Tag`/`Group` per topic/app so a topic's toasts collapse; Action Center history is Windows' (we keep our own in `state.json`).

### 9.2 Model (mirror of ntfy-bar, same JSON field names)
`%APPDATA%\ntfy-bar\settings.json` = `AppSettings { serverURL, username, topics: [TopicConfig{name, muted, enabled, managed?, app?, appName?, appIcon?, sound?, displayName?}], soundForAll, catalogEnabled?, syncTopic? }` — same names and semantics as section 8 so a settings file is portable between the two apps. `%LOCALAPPDATA%\ntfy-bar\state.json` = `PersistedState { entries, lastMessageId, lastMessageTime, seenIds }`. Credentials in Credential Manager (DPAPI, current user): targets `ntfy-bar/password`, `ntfy-bar/token`. Nothing secret in JSON.

### 9.3 Behaviour
Identical to section 8 items 2–4: `CatalogSync.Reconcile` (pure, in `NtfyBar.Core`), 15-min loop + sync-topic trigger + on resume (`SystemEvents.PowerModeChanged`) + network change (`NetworkChange.NetworkAvailabilityChanged`), one JSON stream `GET /{t1,t2,…}/json?since=…` with `HttpClient` + `ReadLineAsync`, backoff `min(60, 2^(n-1))` ±15 %, 401/403 → auth-error state (tray icon with slash), `since` rule as macOS. Sign-in dialog mints a token (`POST /v1/account/token`, label `ntfy-bar-win-<machine>`). Tray menu: status, grouped topics (app headers, per-topic mute/enable), mark all read, Settings…, Check for updates, Quit. Settings window (WinForms): server, account, topics grid (managed rows read-only except mute/enable), notifications (sound for all, insistent max), launch at login (Run key `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`).

### 9.4 Updates and release
- `.github/workflows/release.yml` on tag `v*`: `windows-latest`, `dotnet test`, `dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true`, attach `ntfy-bar-windows-<tag>.exe` + `SHA256SUMS` to a GitHub Release. Unsigned (SmartScreen warning on first run; document "More info → Run anyway"); code-signing is a later step.
- In-app update check: `GET https://api.github.com/repos/KudcraftsHQ/ntfy-bar-windows/releases/latest` once a day and on demand; compare `tag_name` with the assembly version; if newer, toast "Update available" with a button opening the release page. No silent self-replace in v1.

---

## 10. History / retention

- Server: `NTFY_CACHE_DURATION=2160h` (90 d). `expires` is stamped at publish time (`handlePublishInternal`: `m.Expires = time + MessageExpiryDuration`), so **existing** rows keep their 12 h expiry; history accumulates from deploy. Pruning: existing `pruneMessages()` every manager interval, batched.
- Size: `messages` rows are ~0.5–1 KB (title, body, click, icon URL, tags). At 500 msg/day → ~45 k rows ≈ 25–45 MB at 90 d; at 5 000/day → ~450 MB. Indexes on `topic`, `time`, `expires` keep `since=` queries cheap. Keep `attachment-expiry-duration` at its default (3 h); attachments are not part of history. Monitor with `ls -la /var/lib/ntfy/cache.db` and `sqlite3 cache.db 'select count(*) from messages'`.
- `since=all` on a topic returns everything retained (up to 90 d). Backfill per client: Android `since=all` (local auto-delete 3 months for managed subscriptions; `HARD_DELETE_AFTER_SECONDS` = 4 months already); web `since=all` via the existing poller but the web drops messages older than `prefs.deleteAfter` (default 1 week) — see Q2; ntfy-bar / Windows `since=7d` (menu-bar apps are for "what just happened", full history is in web/Android).
- `web-push` and `upstream-base-url` unaffected.

---

## 11. Security review

| Threat | Control |
|---|---|
| Listing topics the user cannot read | `GET /v1/catalog` and the account merge both pass every topic through `Authorize(user, topic, PermissionRead)`; no pattern expansion, no "everyone" fallback beyond what the ACL already grants. Anonymous → 401. |
| Publishers (write-only) learning the catalog | Their `Authorize(read)` fails → empty `apps`. The publish response never echoes catalog state. |
| Publisher edits another app's metadata | D3 prefix rule + `locked` rows; `X-App` outside the prefix is ignored (logged). |
| Malicious icon URL / names | https-only, ≤512 chars, `url.Parse` host required; names ≤64, control chars stripped, `<>` rejected; clients treat names as text (React escapes; Android `TextView`; macOS/Windows plain strings) and never render HTML. Clients download icons only over https with size caps; Windows/Android store them under app-private dirs. |
| Sync-topic abuse | Sync topics are excluded from registration; the fan-out publishes only `{"event":"sync"}` via the existing internal path. |
| Token exposure | Android: `tk_` token in the Room `user` table (app-private; same posture as upstream passwords); macOS: Keychain; Windows: Credential Manager (DPAPI); web: localStorage (upstream). Tokens are labelled per device and revocable in the web app's Account → Tokens. Recommend per-device tokens, never the admin password, on partner devices. |
| Enumeration DoS | `/v1/catalog` behind `limitRequests`; ETag/304; snapshot served from memory. |
| Rollback safety | No schema version bump (D7); feature flag off = upstream code paths untouched (`s.catalog == nil`). |
| Partner / read-only users | Create with `ntfy user add partner`, `ntfy access partner facemap-orders read-only`; they see only that topic; `ntfy catalog users` prints the resulting view for verification. |

---

## 12. Rollout + rollback per component

**Server** — build: new multi-stage `Dockerfile.kudcrafts` (stage 1 `node:24-alpine`: `cd web && npm ci && npm run build`, then the `web-build` Makefile moves: `mv build/index.html build/app.html`, result to `server/site`; stage 2 `golang:<.go-version>-alpine` with `gcc musl-dev`, `mkdir -p server/docs && touch server/docs/index.html`, `CGO_ENABLED=1 go build -ldflags "-X main.version=${VERSION} -X main.commit=… -X main.date=…" -o ntfy .`; stage 3 = upstream `Dockerfile` (alpine + tzdata)). `.github/workflows/kc-release.yaml` on tag `v*-kc.*` pushes `ghcr.io/kudcraftshq/ntfy:<tag>` (amd64; arm64 via buildx if cheap). Coolify: the existing service's image becomes `ghcr.io/kudcraftshq/ntfy:v2.28.0-kc.1`; env adds `NTFY_ENABLE_CATALOG=true`, `NTFY_CACHE_DURATION=2160h`, `NTFY_BASE_URL=https://ntfy.kudcrafts.com` (already set). Order: deploy with the flag **off** first (proves the image), then on. Rollback: set the image back to `binwiederhier/ntfy:v2.28.0` (or flag off); catalog tables stay inert; messages published with 90 d expiry stay until pruned. Verify after deploy: `curl -u hammas:… https://ntfy.kudcrafts.com/v1/catalog`, `/v1/version` shows `-kc.`.

**Web** — ships inside the server image; `enable_catalog` in `/config.js` gates the UI, so a stock image shows the stock UI.

**Android** — GitHub Release + Obtainium (7.7). Rollback = install the previous APK from Releases (Room migration 18→19 is additive; downgrading to an older build of the same fork is fine, downgrading to upstream `io.heckel.ntfy` is a different app id, no data shared).

**ntfy-bar** — `./build.sh` on the Mac; settings decoding is backward-compatible (optional fields). Rollback = previous build; new optional fields are ignored.

**ntfy-bar-windows** — GitHub Release exe; rollback = previous exe; same settings-file compatibility rule.

---

## 13. Test plan per component

**Server (Go, `go test ./server/ ./user/ ./cmd/`)**
- `user/catalog_test.go`: create store on a temp `user.db` twice (idempotent), `schemaVersion` still 9 after `NewManager` + `NewCatalogStore`; upsert/lock semantics; validators (id regex, https-only icon, lengths, sound set).
- `server/server_catalog_test.go` (use `newTestServer` helpers): publish with headers registers app+topic; derived app without `X-App`; prefix rule ignored case; locked row not overwritten; icon injection on by default and skipped when `catalog-inject-icon=false`; `GET /v1/catalog` as admin / read-only user / write-only publisher (empty) / anonymous (401) / flag off (404); ETag 304; `GET /v1/account` contains virtual subscriptions and user-stored ones win; admin PUT/DELETE; sync event delivered to a subscribed user's sync topic within one reload after `ntfy catalog topic set`; sync topics and disallowed topics never registered.
- Rollback test: open the resulting `user.db` with the stock `user.NewSQLiteManager` from tag v2.28.0 code paths (same package in this branch) → no error.
- Web (`npm test` in `web/`): `SubscriptionManager.test.js` `syncFromCatalog` add/decorate/undecorate; `AccountApi.test.js` `sync()` calls catalog only when `enable_catalog`. Manual: sign in on web → sidebar grouped, mute works, rename persists, unsubscribe hidden.

**Android (`./gradlew testFdroidDebugUnitTest`, then a device)**
- Unit: `CatalogSyncTest` (reconcile plan: add/update/remove/untouched-unmanaged; no changes on non-200), `NotificationChannelIdTest` (id per class/priority), Room migration test 18→19 with exported schemas (`MigrationTestHelper`).
- Instrumented/manual on a phone: sign in → all readable topics appear grouped with icons in <30 s; `ntfy catalog topic set` on the server → new name within seconds (sync topic) or ≤15 min (worker); channel per app visible in Android settings with the right sound; change `--sound urgent` → new channel appears, old removed; mute app; revoke ACL → topic disappears; kill/restart app keeps token; backfill shows ≥1 day of history on a fresh install.

**ntfy-bar (`swift test` + `./build.sh --run` on the Mac)**
- Unit: `CatalogSyncTests` (reconcile, decoding with missing optional fields, old `settings.v1` JSON still decodes).
- Manual: sign in → chips grouped; sync event → chips update without restart; sounds per class; token survives relaunch; auth error state on revoked token.

**ntfy-bar-windows (`dotnet test` on Linux for `NtfyBar.Core.Tests`; full build on the windows runner)**
- Project split: `NtfyBar.Core` (net8.0, no Windows APIs: models, JSON, `CatalogSync.Reconcile`, stream line parser, backoff, since-rule) with xUnit tests runnable on Linux; `NtfyBar.Win` (`net8.0-windows10.0.19041.0`, `UseWindowsForms`, builds on Linux with `EnableWindowsTargeting=true` but only runs on Windows).
- CI: `windows-latest` runs tests + publish + a smoke run `ntfy-bar-windows.exe --selftest` (registers the toast activator, shows one toast, exits 0).
- Manual on the partner's PC: sign in, grouped tray menu, toast with app logo + sound per class, click opens `click` URL, update toast appears when a newer release exists.

---

## 14. Shared interface contract (all builders)

1. `GET /v1/catalog` JSON exactly as 3.1; `version` monotonic ms; `history_days` int ≥ 1; `sync_topic` string; sounds ∈ `silent|default|alert|urgent`, always resolved per topic.
2. `GET /v1/account.subscriptions` includes virtual catalog entries (`display_name` = topic name or `null`).
3. Sync signal: a message on `sync_topic` whose body is `{"event":"sync"}` → client refetches `/v1/catalog` (and account, where applicable). Clients also refetch every 15 min with `If-None-Match`, on launch, on resume/wake, and on every stream (re)connect.
4. Token minting: `POST /v1/account/token` with Basic auth, body `{"label":"<client>-<device>","expires":0}` → `{"token":"tk_…"}`; send as `Authorization: Bearer tk_…`. **`"expires":0` is required**: without it the server applies its 72 h default (`tokenExpiryDuration`) and the device silently goes dark on day 3. `0` = never expires; the token stays revocable per device in Account → Access tokens. (rev 2.1, from the pre-deploy review)
5. Client reconcile rules: only on HTTP 200; add missing as managed; update metadata on existing, keep user mute/enable/rename; remove managed entries no longer listed; never touch unmanaged entries.
6. Publish headers (publishers): `X-App`, `X-App-Name`, `X-App-Icon`, `X-App-Sound`, `X-Display-Name`, `X-Sound`.
7. Display name precedence everywhere: user rename → catalog topic name → topic id. Icon precedence in notifications: message `icon` (server-injected) → app icon → platform default.
8. Sound-class mapping table: Android 7.5, macOS 8.6, Windows 9.1, web 6.7.

---

## 15. Builder S — server + web (branch `kudcrafts` from `v2.28.0`)

New files: `user/catalog.go`, `user/catalog_test.go`, `server/server_catalog.go`, `server/server_catalog_test.go`, `cmd/catalog.go`, `cmd/catalog_test.go`, `Dockerfile.kudcrafts`, `.github/workflows/kc-release.yaml`, `docs/kudcrafts/operations.md` (deploy/rollback/CLI cheat-sheet, incl. publisher header examples).
Edited upstream files (keep each hunk minimal, comment `// kudcrafts: catalog`): `server/config.go` (`EnableCatalog bool`, `CatalogInjectIcon bool` default true), `cmd/serve.go` (flags `enable-catalog` and `catalog-inject-icon` (default true), validation vs `database-url`/`auth-file`), `server/server.go` (struct field `catalog *catalog`; init in `New()` after `userManager`; routes `GET /v1/catalog`, `PUT|DELETE /v1/catalog/apps/…`, `PUT|DELETE /v1/catalog/topics/…` in `handleInternal`; publish hook; `go s.catalog.loop()` in `Run()`), `server/server_account.go` (merge hook), `server/types.go` + `server/server_web.go` (`enable_catalog`).
Web: `web/src/app/{config.js,AccountApi.js,SubscriptionManager.js,Notifier.js,notificationUtils.js}`, `web/src/components/{Navigation.jsx,SubscriptionPopup.jsx}`, `web/public/sw.js`, tests. New `web/src/components/AppGroupHeader.jsx` if it keeps `Navigation.jsx` small.
Version: `main.version` ldflag `2.28.0-kc.1`.

## 16. Builder A — Android (branch `kudcrafts` from the current fork main)

New: `service/CatalogSync.kt`, `service/CatalogSyncWorker.kt`, `msg/CatalogApi.kt` (fetch + DTOs, in `ApiService` style), `ui/CatalogLoginDialog.kt`, `ui/AppHeaderViewHolder.kt`, `res/raw/kc_{default,alert,urgent}.ogg`, `res/xml` prefs entries, `app/schemas/.../19.json`, tests under `app/src/test/java/io/heckel/ntfy/service/`, `.github/workflows/kc-release.yaml`.
Edited: `db/Database.kt` (entity, DAO selects, `MIGRATION_18_19`, version 19), `db/Repository.kt` (mappers, prefs `CatalogEtag`, `CatalogSyncTopic:<base>`, `CatalogIcon:<id>`), `util/HttpUtil.kt` (Bearer), `service/SubscriberService.kt` + `service/Connection.kt` (sync topic in map/ConnectionId), `msg/NotificationService.kt` (groups/channels/reconcile), `ui/MainActivity.kt`, `ui/MainAdapter.kt`, `ui/DetailSettingsActivity.kt`, `ui/SettingsActivity.kt`, `app/build.gradle`, `res/values/values.xml` (`app_base_url`), strings.

## 17. Builder M — ntfy-bar (macOS)

New: `Sources/NtfyBar/CatalogSync.swift`, `Sources/NtfyBar/Resources/Sounds/kc_{alert,urgent}.caf` (`Package.swift` resources), `Tests/NtfyBarTests/CatalogSyncTests.swift` (+ `testTarget` in `Package.swift`), `docs/catalog.md`.
Edited: `Models.swift` (optional fields), `AppModel.swift` (sync loop, sync-topic handling, token sign-in call, since/backfill), `SettingsView.swift`, `MenuView.swift`, `Notifier.swift`, `build.sh` (copy Sounds), `Resources/Info.plist` (version 1.1).

## 18. Builder W — ntfy-bar-windows (new repo)

Layout: `ntfy-bar-windows.sln`; `src/NtfyBar.Core/` (`Models.cs` AppSettings/TopicConfig/PersistedState, `Catalog.cs`, `CatalogSync.cs` Reconcile, `NtfyStream.cs` line parser + backoff + since, `Json.cs`); `src/NtfyBar.Win/` (`Program.cs` single-instance mutex + tray, `TrayApp.cs`, `StreamClient.cs`, `CatalogService.cs`, `Toasts.cs` builder + activation + sound/logo mapping, `IconCache.cs`, `Credentials.cs` (Credential Manager), `Storage.cs` (settings/state paths), `SettingsForm.cs`, `LoginForm.cs`, `Updater.cs`, `Autostart.cs`, `app.manifest` (DPI aware), `Assets/tray-*.ico`); `tests/NtfyBar.Core.Tests/` (xUnit); `.github/workflows/{ci.yml,release.yml}`; `README.md` (install, SmartScreen note, settings-file compatibility with ntfy-bar).

---

## 19. Decisions on the open questions (Hammas, revision 1)

1. Android app identity: **`com.kudcrafts.ntfy`, installed beside Play ntfy.** Decided.
2. Web history: **account preference `delete_after = 0` ("never"), bounded by the server's 90 d cap.** Decided.
3. Icon injection: **a setting, `catalog-inject-icon` / `NTFY_CATALOG_INJECT_ICON`, default on.** Decided (see D11, §4 step 4).
4. Sync fan-out window: **30 s reload** (default kept; no objection).
5. Sound files: **synthesize three short clips in CI with `sox`**, swap for designed sounds later (default kept; no objection).
