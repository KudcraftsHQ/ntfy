package server

// kudcrafts: catalog
//
// The catalog lists the apps and concrete topics a user can read, so that clients can
// auto-subscribe after a single sign-in. Topics register themselves on their first authorized
// publish; admins edit them with `ntfy catalog` or the /v1/catalog admin API. Everything in
// this file is inert unless enable-catalog is set (s.catalog == nil).
// See docs/kudcrafts/catalog-spec.md.

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"heckel.io/ntfy/v2/log"
	"heckel.io/ntfy/v2/model"
	"heckel.io/ntfy/v2/user"
	"heckel.io/ntfy/v2/util"
)

const (
	tagCatalog                 = "catalog"
	apiCatalogPath             = "/v1/catalog"
	catalogReloadInterval      = 30 * time.Second
	catalogTouchInterval       = 10 * time.Minute
	catalogReloadDebounce      = 2 * time.Second // publish-driven reloads are coalesced into one per window
	catalogMetadataInterval    = time.Minute     // a publisher may change an existing row's metadata once per minute
	catalogPermissionRead      = "read-only"
	catalogPermissionReadWrite = "read-write"
	catalogSoundInheritKeyword = "inherit"
)

var (
	apiCatalogAppPathRegex   = regexp.MustCompile(`^/v1/catalog/apps/([^/]+)$`)
	apiCatalogTopicPathRegex = regexp.MustCompile(`^/v1/catalog/topics/([^/]+)$`)

	// Error codes are kudcrafts-specific; the numbers in the spec collided with upstream codes
	// (40030-40034, 40907), so they live in their own range here.
	errHTTPBadRequestCatalogAppID      = &errHTTP{40080, http.StatusBadRequest, "invalid request: invalid catalog app id", "", nil}
	errHTTPBadRequestCatalogName       = &errHTTP{40081, http.StatusBadRequest, "invalid request: invalid catalog name", "", nil}
	errHTTPBadRequestCatalogIcon       = &errHTTP{40082, http.StatusBadRequest, "invalid request: invalid catalog icon URL (https only, <=512)", "", nil}
	errHTTPBadRequestCatalogSound      = &errHTTP{40083, http.StatusBadRequest, "invalid request: invalid sound class", "", nil}
	errHTTPBadRequestCatalogAppPrefix  = &errHTTP{40084, http.StatusBadRequest, "invalid request: app is not a prefix of topic", "", nil}
	errHTTPBadRequestCatalogTopic      = &errHTTP{40085, http.StatusBadRequest, "invalid request: invalid topic", "", nil}
	errHTTPNotFoundCatalogEntry        = &errHTTP{40480, http.StatusNotFound, "not found: catalog entry not found", "", nil}
	errHTTPConflictCatalogAppHasTopics = &errHTTP{40980, http.StatusConflict, "conflict: app still has topics", "", nil}
)

// API types

type apiCatalogResponse struct {
	Version     int64            `json:"version"`
	BaseURL     string           `json:"base_url"`
	HistoryDays int              `json:"history_days"`
	SyncTopic   string           `json:"sync_topic"`
	Apps        []*apiCatalogApp `json:"apps"`
}

type apiCatalogApp struct {
	ID     string             `json:"id"`
	Name   string             `json:"name"`
	Icon   string             `json:"icon"`
	Sound  string             `json:"sound"`
	Locked *bool              `json:"locked,omitempty"` // ?all=1 only
	Topics []*apiCatalogTopic `json:"topics,omitempty"`
}

type apiCatalogTopic struct {
	Topic      string `json:"topic"`
	Name       string `json:"name"`
	Sound      string `json:"sound"`
	Permission string `json:"permission"`
	Locked     *bool  `json:"locked,omitempty"` // ?all=1 only
	Hidden     *bool  `json:"hidden,omitempty"` // ?all=1 only
	App        string `json:"app,omitempty"`    // admin PUT response only
}

type apiCatalogAppRequest struct {
	Name  *string `json:"name"`
	Icon  *string `json:"icon"`
	Sound *string `json:"sound"`
}

type apiCatalogTopicRequest struct {
	App    *string `json:"app"`
	Name   *string `json:"name"`
	Sound  *string `json:"sound"`
	Hidden *bool   `json:"hidden"`
}

// catalog holds an in-memory snapshot of the catalog tables, and the per-user views used to
// decide who gets a sync event when something changes.
type catalog struct {
	s         *Server
	store     *user.CatalogStore
	mu        sync.RWMutex
	apps      map[string]*user.CatalogApp
	topics    map[string]*user.CatalogTopic
	version   int64             // unix ms of the last content change
	hash      string            // content hash of the snapshot, to detect changes
	views     map[string]string // username -> hash of the user's view, to detect per-user changes
	reloadMu  sync.Mutex        // serializes reload()
	touchMu   sync.Mutex
	lastTouch map[string]int64 // topic -> unix seconds of the last TouchTopic
	lastMeta  map[string]int64 // "app:<id>" or "topic:<topic>" -> unix seconds of the last publisher metadata change
	pending   atomic.Bool      // a debounced reload is scheduled
}

// catalogViewEntry is one readable topic as seen by a user; it is what clients render
type catalogViewEntry struct {
	app        *user.CatalogApp
	topic      *user.CatalogTopic
	sound      string // resolved
	permission string
}

func newCatalogFromManager(s *Server, m *user.Manager) (*catalog, error) {
	store, err := user.NewCatalogStore(m)
	if err != nil {
		return nil, err
	}
	return newCatalog(s, store)
}

func newCatalog(s *Server, store *user.CatalogStore) (*catalog, error) {
	c := &catalog{
		s:         s,
		store:     store,
		apps:      make(map[string]*user.CatalogApp),
		topics:    make(map[string]*user.CatalogTopic),
		views:     make(map[string]string),
		lastTouch: make(map[string]int64),
		lastMeta:  make(map[string]int64),
	}
	if err := c.reload(); err != nil {
		return nil, err
	}
	return c, nil
}

// loop reloads the catalog every 30s, which also picks up `ntfy catalog` CLI edits and ACL changes
func (c *catalog) loop(stop <-chan bool) {
	ticker := time.NewTicker(catalogReloadInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err := c.reload(); err != nil {
				log.Tag(tagCatalog).Err(err).Warn("Error reloading catalog")
			}
		case <-stop:
			return
		}
	}
}

// reloadAsync schedules a reload in catalogReloadDebounce, coalescing bursts of publish-driven
// changes into a single reload (and a single round of sync events).
func (c *catalog) reloadAsync() {
	if !c.pending.CompareAndSwap(false, true) {
		return // already scheduled; that reload will see this change
	}
	time.AfterFunc(catalogReloadDebounce, func() {
		c.pending.Store(false) // before reloading, so changes made during the reload schedule another
		if err := c.reload(); err != nil {
			log.Tag(tagCatalog).Err(err).Warn("Error reloading catalog")
		}
	})
}

// allowMetadataChange rate-limits publisher-driven changes to an existing row, so a publisher
// alternating header values cannot force a reload and sync fan-out on every publish.
func (c *catalog) allowMetadataChange(key string) bool {
	now := time.Now().Unix()
	c.touchMu.Lock()
	defer c.touchMu.Unlock()
	if now-c.lastMeta[key] < int64(catalogMetadataInterval.Seconds()) {
		return false
	}
	c.lastMeta[key] = now
	return true
}

// reload reads both tables, swaps the snapshot, bumps the version if the content changed, and
// publishes a sync event to every user whose view changed (including through ACL changes).
func (c *catalog) reload() error {
	c.reloadMu.Lock()
	defer c.reloadMu.Unlock()
	apps, err := c.store.Apps()
	if err != nil {
		return err
	}
	topics, err := c.store.Topics()
	if err != nil {
		return err
	}
	appsMap := make(map[string]*user.CatalogApp, len(apps))
	contentHash := sha256.New()
	for _, a := range apps {
		appsMap[a.ID] = a
		fmt.Fprintf(contentHash, "a\x00%s\x00%s\x00%s\x00%s\x00%t\n", a.ID, a.Name, a.Icon, a.Sound, a.Locked)
	}
	topicsMap := make(map[string]*user.CatalogTopic, len(topics))
	for _, t := range topics {
		topicsMap[t.Topic] = t
		fmt.Fprintf(contentHash, "t\x00%s\x00%s\x00%s\x00%s\x00%t\x00%t\n", t.Topic, t.AppID, t.Name, t.Sound, t.Hidden, t.Locked)
	}
	newHash := hex.EncodeToString(contentHash.Sum(nil))
	c.mu.Lock()
	c.apps, c.topics = appsMap, topicsMap
	if newHash != c.hash {
		c.hash = newHash
		now := time.Now().UnixMilli()
		if now <= c.version {
			now = c.version + 1
		}
		c.version = now
	}
	c.mu.Unlock()
	return c.notifyChangedViews()
}

// notifyChangedViews recomputes every user's view and sends a sync event to those whose view
// differs from the last reload. Users seen for the first time are only recorded.
func (c *catalog) notifyChangedViews() error {
	users, err := c.s.userManager.Users()
	if err != nil {
		return err
	}
	seen := make(map[string]struct{}, len(users))
	for _, u := range users {
		seen[u.Name] = struct{}{}
		if u.Name == user.Everyone {
			continue
		}
		hash := c.viewHash(c.view(u))
		previous, known := c.views[u.Name]
		c.views[u.Name] = hash
		if known && previous != hash && u.SyncTopic != "" {
			log.Tag(tagCatalog).Field("user_name", u.Name).Debug("Catalog view changed, publishing sync event")
			v := newVisitor(c.s.config, c.s.messageCache, c.s.userManager, netip.MustParseAddr("127.0.0.1"), u)
			if err := c.s.publishSyncEventForUser(v, u); err != nil {
				log.Tag(tagCatalog).Field("user_name", u.Name).Err(err).Warn("Error publishing catalog sync event")
			}
		}
	}
	for name := range c.views {
		if _, ok := seen[name]; !ok {
			delete(c.views, name)
		}
	}
	return nil
}

// view returns the readable, non-hidden topics of the given user (includeHidden only for admins
// asking for ?all=1), sorted by app name, then topic.
func (c *catalog) view(u *user.User) []*catalogViewEntry {
	return c.viewWithHidden(u, false)
}

func (c *catalog) viewWithHidden(u *user.User, includeHidden bool) []*catalogViewEntry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entries := make([]*catalogViewEntry, 0)
	for _, t := range c.topics {
		if t.Hidden && !includeHidden {
			continue
		}
		app, ok := c.apps[t.AppID]
		if !ok {
			app = &user.CatalogApp{ID: t.AppID, Name: user.CatalogTitle(t.AppID), Sound: user.CatalogSoundDefault}
		}
		if err := c.s.userManager.Authorize(u, t.Topic, user.PermissionRead); err != nil {
			continue
		}
		permission := catalogPermissionRead
		if err := c.s.userManager.Authorize(u, t.Topic, user.PermissionWrite); err == nil {
			permission = catalogPermissionReadWrite
		}
		sound := t.Sound
		if sound == user.CatalogSoundInherit {
			sound = app.Sound
		}
		if sound == "" {
			sound = user.CatalogSoundDefault
		}
		entries = append(entries, &catalogViewEntry{app: app, topic: t, sound: sound, permission: permission})
	}
	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.app.Name != b.app.Name {
			return a.app.Name < b.app.Name
		}
		if a.app.ID != b.app.ID {
			return a.app.ID < b.app.ID
		}
		return a.topic.Topic < b.topic.Topic
	})
	return entries
}

func (c *catalog) viewHash(entries []*catalogViewEntry, extra ...string) string {
	h := sha256.New()
	for _, x := range extra {
		fmt.Fprintf(h, "x\x00%s\n", x)
	}
	for _, e := range entries {
		fmt.Fprintf(h, "%s\x00%s\x00%s\x00%s\x00%s\x00%s\x00%s\x00%s\n", e.topic.Topic, e.app.ID, e.app.Name, e.app.Icon, e.app.Sound, e.topic.Name, e.sound, e.permission)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func (c *catalog) currentVersion() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.version
}

// mergeSubscriptions appends the user's readable catalog topics to their stored account
// subscriptions as virtual (not persisted) entries. Stored entries win.
func (c *catalog) mergeSubscriptions(u *user.User, subscriptions []*user.Subscription) []*user.Subscription {
	baseURL := c.s.config.BaseURL
	existing := make(map[string]struct{}, len(subscriptions))
	for _, sub := range subscriptions {
		existing[sub.BaseURL+"\x00"+sub.Topic] = struct{}{}
	}
	merged := append(make([]*user.Subscription, 0, len(subscriptions)), subscriptions...)
	for _, e := range c.view(u) {
		if _, ok := existing[baseURL+"\x00"+e.topic.Topic]; ok {
			continue
		}
		var displayName *string
		if e.topic.Name != "" {
			displayName = util.String(e.topic.Name)
		}
		merged = append(merged, &user.Subscription{BaseURL: baseURL, Topic: e.topic.Topic, DisplayName: displayName})
	}
	return merged
}

// onPublish registers the topic (and its app) on publish, applies publisher-provided metadata
// to unlocked rows, and injects the app icon into the message. It never fails a publish.
func (c *catalog) onPublish(r *http.Request, v *visitor, topic string, m *model.Message) {
	if m.Event != model.MessageEvent || user.IsSyncTopic(topic) || util.Contains(c.s.config.DisallowedTopics, topic) || !user.AllowedTopic(topic) {
		return
	}
	ev := logvr(v, r).Tag(tagCatalog).Field("topic", topic)
	explicitApp := readParam(r, "x-app", "app")
	appID := explicitApp
	if appID == "" {
		appID = user.CatalogAppIDForTopic(topic)
	}
	if user.ValidateCatalogAppID(appID) != nil || !user.CatalogAppMatchesTopic(appID, topic) {
		if explicitApp != "" {
			ev.Field("app", appID).Warn("Ignoring catalog metadata: invalid app or app is not a prefix of the topic")
		} else {
			ev.Debug("Topic not registered in catalog: cannot derive a valid app id")
		}
		return
	}
	appName := c.readName(r, ev, "x-app-name", "app-name")
	appIcon := c.readIcon(r, ev)
	appSound := c.readSound(r, ev, "x-app-sound", "app-sound")
	topicName := c.readName(r, ev, "x-display-name", "display-name")
	topicSound := c.readSound(r, ev, "x-sound", "sound")

	c.mu.RLock()
	existingTopic := c.topics[topic]
	if existingTopic != nil && explicitApp == "" {
		appID = existingTopic.AppID // Never move an existing topic unless X-App is given
	}
	existingApp := c.apps[appID]
	c.mu.RUnlock()

	changed := false
	effectiveApp := existingApp

	// App
	if existingApp == nil {
		newApp := &user.CatalogApp{ID: appID, Name: user.CatalogTitle(appID), Icon: appIcon, Sound: user.CatalogSoundDefault}
		if appName != "" {
			newApp.Name = appName
		}
		if appSound != "" {
			newApp.Sound = appSound
		}
		if err := c.store.UpsertApp(newApp, false); err != nil {
			ev.Err(err).Warn("Error registering catalog app")
			return
		}
		effectiveApp, changed = newApp, true
	} else if !existingApp.Locked {
		updated := *existingApp
		if appName != "" && appName != existingApp.Name {
			updated.Name, changed = appName, true
		}
		if appIcon != "" && appIcon != existingApp.Icon {
			updated.Icon, changed = appIcon, true
		}
		if appSound != "" && appSound != existingApp.Sound {
			updated.Sound, changed = appSound, true
		}
		if changed && !c.allowMetadataChange("app:"+appID) {
			ev.Debug("Ignoring catalog app metadata change: changed less than a minute ago")
			changed = false
		} else if changed {
			if err := c.store.UpsertApp(&updated, false); err != nil {
				ev.Err(err).Warn("Error updating catalog app")
			} else {
				effectiveApp = &updated
			}
		}
	}

	// Topic
	if existingTopic == nil {
		newTopic := &user.CatalogTopic{Topic: topic, AppID: appID, Name: topicName, Sound: topicSound}
		if err := c.store.UpsertTopic(newTopic, false); err != nil {
			ev.Err(err).Warn("Error registering catalog topic")
		} else {
			changed = true
			c.mu.Lock()
			if _, ok := c.topics[topic]; !ok {
				c.topics[topic] = newTopic // Optimistic, until the reload below swaps the snapshot
			}
			if _, ok := c.apps[appID]; !ok {
				c.apps[appID] = effectiveApp
			}
			c.mu.Unlock()
		}
	} else if !existingTopic.Locked {
		updated := *existingTopic
		topicChanged := false
		if appID != existingTopic.AppID {
			updated.AppID, topicChanged = appID, true
		}
		if topicName != "" && topicName != existingTopic.Name {
			updated.Name, topicChanged = topicName, true
		}
		if topicSound != "" && topicSound != existingTopic.Sound {
			updated.Sound, topicChanged = topicSound, true
		}
		if topicChanged && !c.allowMetadataChange("topic:"+topic) {
			ev.Debug("Ignoring catalog topic metadata change: changed less than a minute ago")
		} else if topicChanged {
			if err := c.store.UpsertTopic(&updated, false); err != nil {
				ev.Err(err).Warn("Error updating catalog topic")
			} else {
				changed = true
			}
		}
	}
	if changed {
		ev.Debug("Catalog changed by publish")
		c.reloadAsync()
	}
	c.maybeTouch(topic)

	// Icon injection (D11), after registration, so the first publish of a new app carries it
	if c.s.config.CatalogInjectIcon && m.Icon == "" && effectiveApp != nil && effectiveApp.Icon != "" {
		m.Icon = effectiveApp.Icon
	}
}

func (c *catalog) maybeTouch(topic string) {
	now := time.Now().Unix()
	c.touchMu.Lock()
	if now-c.lastTouch[topic] < int64(catalogTouchInterval.Seconds()) {
		c.touchMu.Unlock()
		return
	}
	c.lastTouch[topic] = now
	c.touchMu.Unlock()
	go func() {
		if err := c.store.TouchTopic(topic, now); err != nil {
			log.Tag(tagCatalog).Field("topic", topic).Err(err).Debug("Error touching catalog topic")
		}
	}()
}

func (c *catalog) readName(r *http.Request, ev *log.Event, names ...string) string {
	value := readParam(r, names...)
	if value == "" {
		return ""
	}
	name, err := user.ValidateCatalogName(value)
	if err != nil {
		ev.Field("param", names[0]).Warn("Ignoring invalid catalog name")
		return ""
	}
	return name
}

func (c *catalog) readIcon(r *http.Request, ev *log.Event) string {
	value := readParam(r, "x-app-icon", "app-icon")
	if value == "" {
		return ""
	}
	if err := user.ValidateCatalogIcon(value); err != nil {
		ev.Warn("Ignoring invalid catalog app icon URL")
		return ""
	}
	return value
}

func (c *catalog) readSound(r *http.Request, ev *log.Event, names ...string) string {
	value := strings.ToLower(readParam(r, names...))
	if value == "" {
		return ""
	}
	if err := user.ValidateCatalogSound(value); err != nil {
		ev.Field("param", names[0]).Warn("Ignoring invalid catalog sound class")
		return ""
	}
	return value
}

// HTTP handlers

func (s *Server) ensureCatalog(next handleFunc) handleFunc {
	return func(w http.ResponseWriter, r *http.Request, v *visitor) error {
		if s.catalog == nil {
			return errHTTPNotFound
		}
		return next(w, r, v)
	}
}

func (s *Server) handleCatalogGet(w http.ResponseWriter, r *http.Request, v *visitor) error {
	u := v.User()
	all := readBoolParam(r, false, "all")
	if all && !u.IsAdmin() {
		return errHTTPUnauthorized
	}
	version := s.catalog.currentVersion()
	entries := s.catalog.viewWithHidden(u, all)
	// The ETag is a hash of exactly what this user sees (not the global version), so that an
	// ACL-only change yields a 200, and a change to topics this user cannot see yields a 304.
	// The non-view fields of the response are part of it too, so a config change is never a 304.
	historyDays := catalogHistoryDays(s.config.CacheDuration)
	etag := fmt.Sprintf(`"%s"`, s.catalog.viewHash(entries, s.config.BaseURL, u.SyncTopic, strconv.Itoa(historyDays))[:20])
	if all {
		etag = fmt.Sprintf(`"%d-%d-all"`, version, historyDays)
	}
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Access-Control-Allow-Origin", s.config.AccessControlAllowOrigin)
	w.Header().Set("Access-Control-Expose-Headers", "ETag")
	if catalogETagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return nil
	}
	response := &apiCatalogResponse{
		Version:     version,
		BaseURL:     s.config.BaseURL,
		HistoryDays: historyDays,
		SyncTopic:   u.SyncTopic,
		Apps:        make([]*apiCatalogApp, 0),
	}
	var current *apiCatalogApp
	for _, e := range entries {
		if current == nil || current.ID != e.app.ID {
			current = &apiCatalogApp{ID: e.app.ID, Name: e.app.Name, Icon: e.app.Icon, Sound: e.app.Sound, Topics: make([]*apiCatalogTopic, 0)}
			if all {
				current.Locked = catalogBool(e.app.Locked)
			}
			response.Apps = append(response.Apps, current)
		}
		t := &apiCatalogTopic{Topic: e.topic.Topic, Name: e.topic.Name, Sound: e.sound, Permission: e.permission}
		if all {
			t.Locked, t.Hidden = catalogBool(e.topic.Locked), catalogBool(e.topic.Hidden)
		}
		current.Topics = append(current.Topics, t)
	}
	return s.writeJSON(w, response)
}

func (s *Server) handleCatalogAppPut(w http.ResponseWriter, r *http.Request, v *visitor) error {
	id := apiCatalogAppPathRegex.FindStringSubmatch(r.URL.Path)[1]
	if err := user.ValidateCatalogAppID(id); err != nil {
		return errHTTPBadRequestCatalogAppID
	}
	req, err := readJSONWithLimit[apiCatalogAppRequest](r.Body, jsonBodyBytesLimit, true)
	if err != nil {
		return err
	}
	s.catalog.mu.RLock()
	existing := s.catalog.apps[id]
	s.catalog.mu.RUnlock()
	app := &user.CatalogApp{ID: id, Name: user.CatalogTitle(id), Sound: user.CatalogSoundDefault}
	if existing != nil {
		app.Name, app.Icon, app.Sound = existing.Name, existing.Icon, existing.Sound
	}
	if req.Name != nil {
		if app.Name, err = user.ValidateCatalogName(*req.Name); err != nil {
			return errHTTPBadRequestCatalogName
		}
	}
	if req.Icon != nil {
		if err := user.ValidateCatalogIcon(*req.Icon); err != nil {
			return errHTTPBadRequestCatalogIcon
		}
		app.Icon = *req.Icon
	}
	if req.Sound != nil {
		if err := user.ValidateCatalogSound(*req.Sound); err != nil {
			return errHTTPBadRequestCatalogSound
		}
		app.Sound = *req.Sound
	}
	if err := s.catalog.store.UpsertApp(app, true); err != nil {
		return catalogToHTTPError(err)
	}
	logvr(v, r).Tag(tagCatalog).Field("app", id).Info("Catalog app set by admin")
	if err := s.catalog.reload(); err != nil {
		return err
	}
	return s.writeJSON(w, &apiCatalogApp{ID: app.ID, Name: app.Name, Icon: app.Icon, Sound: app.Sound, Locked: catalogBool(true)})
}

func (s *Server) handleCatalogAppDelete(w http.ResponseWriter, r *http.Request, v *visitor) error {
	id := apiCatalogAppPathRegex.FindStringSubmatch(r.URL.Path)[1]
	if err := s.catalog.store.DeleteApp(id, readBoolParam(r, false, "force")); err != nil {
		return catalogToHTTPError(err)
	}
	logvr(v, r).Tag(tagCatalog).Field("app", id).Info("Catalog app deleted by admin")
	if err := s.catalog.reload(); err != nil {
		return err
	}
	return s.writeJSON(w, newSuccessResponse())
}

func (s *Server) handleCatalogTopicPut(w http.ResponseWriter, r *http.Request, v *visitor) error {
	topic := apiCatalogTopicPathRegex.FindStringSubmatch(r.URL.Path)[1]
	if !user.AllowedTopic(topic) {
		return errHTTPBadRequestCatalogTopic
	}
	req, err := readJSONWithLimit[apiCatalogTopicRequest](r.Body, jsonBodyBytesLimit, true)
	if err != nil {
		return err
	}
	s.catalog.mu.RLock()
	existing := s.catalog.topics[topic]
	s.catalog.mu.RUnlock()
	t := &user.CatalogTopic{Topic: topic, AppID: user.CatalogAppIDForTopic(topic)}
	if existing != nil {
		t.AppID, t.Name, t.Sound, t.Hidden = existing.AppID, existing.Name, existing.Sound, existing.Hidden
	}
	if req.App != nil {
		t.AppID = *req.App
	}
	if err := user.ValidateCatalogAppID(t.AppID); err != nil {
		return errHTTPBadRequestCatalogAppID
	} else if !user.CatalogAppMatchesTopic(t.AppID, topic) {
		return errHTTPBadRequestCatalogAppPrefix
	}
	if req.Name != nil {
		if *req.Name == "" {
			t.Name = ""
		} else if t.Name, err = user.ValidateCatalogName(*req.Name); err != nil {
			return errHTTPBadRequestCatalogName
		}
	}
	if req.Sound != nil {
		if *req.Sound == "" || *req.Sound == catalogSoundInheritKeyword {
			t.Sound = user.CatalogSoundInherit
		} else if err := user.ValidateCatalogSound(*req.Sound); err != nil {
			return errHTTPBadRequestCatalogSound
		} else {
			t.Sound = *req.Sound
		}
	}
	if req.Hidden != nil {
		t.Hidden = *req.Hidden
	}
	s.catalog.mu.RLock()
	_, appExists := s.catalog.apps[t.AppID]
	s.catalog.mu.RUnlock()
	if !appExists {
		// Created unlocked, so the publisher can still set its name/icon via headers
		if err := s.catalog.store.UpsertApp(&user.CatalogApp{ID: t.AppID, Name: user.CatalogTitle(t.AppID), Sound: user.CatalogSoundDefault}, false); err != nil {
			return catalogToHTTPError(err)
		}
	}
	if err := s.catalog.store.UpsertTopic(t, true); err != nil {
		return catalogToHTTPError(err)
	}
	logvr(v, r).Tag(tagCatalog).Field("topic", topic).Info("Catalog topic set by admin")
	if err := s.catalog.reload(); err != nil {
		return err
	}
	return s.writeJSON(w, &apiCatalogTopic{Topic: t.Topic, App: t.AppID, Name: t.Name, Sound: t.Sound, Locked: catalogBool(true), Hidden: catalogBool(t.Hidden)})
}

func (s *Server) handleCatalogTopicDelete(w http.ResponseWriter, r *http.Request, v *visitor) error {
	topic := apiCatalogTopicPathRegex.FindStringSubmatch(r.URL.Path)[1]
	if err := s.catalog.store.DeleteTopic(topic); err != nil {
		return catalogToHTTPError(err)
	}
	logvr(v, r).Tag(tagCatalog).Field("topic", topic).Info("Catalog topic deleted by admin")
	if err := s.catalog.reload(); err != nil {
		return err
	}
	return s.writeJSON(w, newSuccessResponse())
}

func catalogToHTTPError(err error) error {
	switch {
	case errors.Is(err, user.ErrCatalogInvalidAppID):
		return errHTTPBadRequestCatalogAppID
	case errors.Is(err, user.ErrCatalogInvalidName):
		return errHTTPBadRequestCatalogName
	case errors.Is(err, user.ErrCatalogInvalidIcon):
		return errHTTPBadRequestCatalogIcon
	case errors.Is(err, user.ErrCatalogInvalidSound):
		return errHTTPBadRequestCatalogSound
	case errors.Is(err, user.ErrCatalogAppNotPrefix):
		return errHTTPBadRequestCatalogAppPrefix
	case errors.Is(err, user.ErrCatalogInvalidTopic):
		return errHTTPBadRequestCatalogTopic
	case errors.Is(err, user.ErrCatalogNotFound):
		return errHTTPNotFoundCatalogEntry
	case errors.Is(err, user.ErrCatalogAppHasTopics):
		return errHTTPConflictCatalogAppHasTopics
	}
	return err
}

// handleCatalogRoute dispatches /v1/catalog* requests; returns handled=false if the path is not a catalog path
func (s *Server) handleCatalogRoute(w http.ResponseWriter, r *http.Request, v *visitor) (bool, error) {
	if !strings.HasPrefix(r.URL.Path, apiCatalogPath) {
		return false, nil
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == apiCatalogPath:
		return true, s.ensureCatalog(s.limitRequests(s.ensureUser(s.handleCatalogGet)))(w, r, v)
	case r.Method == http.MethodPut && apiCatalogAppPathRegex.MatchString(r.URL.Path):
		return true, s.ensureCatalog(s.ensureAdmin(s.handleCatalogAppPut))(w, r, v)
	case r.Method == http.MethodDelete && apiCatalogAppPathRegex.MatchString(r.URL.Path):
		return true, s.ensureCatalog(s.ensureAdmin(s.handleCatalogAppDelete))(w, r, v)
	case r.Method == http.MethodPut && apiCatalogTopicPathRegex.MatchString(r.URL.Path):
		return true, s.ensureCatalog(s.ensureAdmin(s.handleCatalogTopicPut))(w, r, v)
	case r.Method == http.MethodDelete && apiCatalogTopicPathRegex.MatchString(r.URL.Path):
		return true, s.ensureCatalog(s.ensureAdmin(s.handleCatalogTopicDelete))(w, r, v)
	}
	return false, nil
}

func catalogBool(b bool) *bool {
	return &b
}

// catalogHistoryDays is cache-duration in whole days, rounded up, and at least 1: clients prune
// their local history to it, so 0 (e.g. the 12h default) must never be sent.
func catalogHistoryDays(d time.Duration) int {
	days := int((d + 24*time.Hour - 1) / (24 * time.Hour))
	if days < 1 {
		return 1
	}
	return days
}

// catalogETagMatches implements If-None-Match: a comma-separated list, weak comparison (W/), or "*"
func catalogETagMatches(header, etag string) bool {
	if header == "" {
		return false
	}
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimPrefix(strings.TrimSpace(candidate), "W/")
		if candidate == "*" || candidate == etag {
			return true
		}
	}
	return false
}
