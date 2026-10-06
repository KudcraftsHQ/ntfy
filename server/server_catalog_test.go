package server

// kudcrafts: catalog

import (
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"heckel.io/ntfy/v2/user"
	"heckel.io/ntfy/v2/util"
)

const testFaceMapIcon = "https://facemap.fyi/icon-192.png"

func newTestCatalogServer(t *testing.T, mutate ...func(c *Config)) *Server {
	conf := newTestConfigWithAuthFile(t, "")
	conf.AuthDefault = user.PermissionDenyAll
	conf.EnableCatalog = true
	conf.CacheDuration = 2160 * time.Hour
	for _, f := range mutate {
		f(conf)
	}
	s := newTestServer(t, conf)
	require.NotNil(t, s.catalog)
	um := s.userManager
	require.Nil(t, um.AddUser("admin", "admin", user.RoleAdmin, false))
	require.Nil(t, um.AddUser("facemap", "facemap", user.RoleUser, false)) // publisher, write-only
	require.Nil(t, um.AllowAccess("facemap", "facemap", user.PermissionWrite))
	require.Nil(t, um.AllowAccess("facemap", "facemap-*", user.PermissionWrite))
	require.Nil(t, um.AddUser("partner", "partner", user.RoleUser, false)) // read-only on one topic
	require.Nil(t, um.AllowAccess("partner", "facemap-orders", user.PermissionRead))
	require.Nil(t, um.AddUser("ops", "ops", user.RoleUser, false)) // read-write on facemap-*
	require.Nil(t, um.AllowAccess("ops", "facemap-*", user.PermissionReadWrite))
	return s
}

func catalogAuth(name string) map[string]string {
	return map[string]string{"Authorization": util.BasicAuth(name, name)}
}

func getCatalog(t *testing.T, s *Server, username string) *apiCatalogResponse {
	rr := request(t, s, "GET", "/v1/catalog", "", catalogAuth(username))
	require.Equal(t, 200, rr.Code, rr.Body.String())
	var c apiCatalogResponse
	require.Nil(t, json.NewDecoder(rr.Body).Decode(&c))
	return &c
}

func publishWith(t *testing.T, s *Server, topic, username string, headers map[string]string) *httptest.ResponseRecorder {
	h := catalogAuth(username)
	for k, v := range headers {
		h[k] = v
	}
	return request(t, s, "PUT", "/"+topic, "hello", h)
}

func TestCatalog_PublishRegistersAndInjectsIcon(t *testing.T) {
	s := newTestCatalogServer(t)
	rr := publishWith(t, s, "facemap-orders", "facemap", map[string]string{
		"X-App":          "facemap",
		"X-App-Name":     "FaceMap",
		"X-App-Icon":     testFaceMapIcon,
		"X-App-Sound":    "alert",
		"X-Display-Name": "Orders",
		"X-Sound":        "urgent",
	})
	require.Equal(t, 200, rr.Code, rr.Body.String())
	m := toMessage(t, rr.Body.String())
	require.Equal(t, testFaceMapIcon, m.Icon) // first publish already carries the icon

	// Derived app, no headers, query param works too
	rr = request(t, s, "PUT", "/facemap-alerts?display-name=Alerts", "x", catalogAuth("facemap"))
	require.Equal(t, 200, rr.Code)
	require.Equal(t, testFaceMapIcon, toMessage(t, rr.Body.String()).Icon)

	// Explicit icon is not overwritten
	rr = publishWith(t, s, "facemap-alerts", "facemap", map[string]string{"X-Icon": "https://example.com/own.png"})
	require.Equal(t, "https://example.com/own.png", toMessage(t, rr.Body.String()).Icon)

	require.Nil(t, s.catalog.reload())
	c := getCatalog(t, s, "admin")
	require.Len(t, c.Apps, 1)
	app := c.Apps[0]
	require.Equal(t, "facemap", app.ID)
	require.Equal(t, "FaceMap", app.Name)
	require.Equal(t, testFaceMapIcon, app.Icon)
	require.Equal(t, "alert", app.Sound)
	require.Len(t, app.Topics, 2)
	require.Equal(t, "facemap-alerts", app.Topics[0].Topic)
	require.Equal(t, "Alerts", app.Topics[0].Name)
	require.Equal(t, "alert", app.Topics[0].Sound) // inherited, resolved
	require.Equal(t, "facemap-orders", app.Topics[1].Topic)
	require.Equal(t, "urgent", app.Topics[1].Sound)
	require.Equal(t, "read-write", app.Topics[1].Permission)
	require.Equal(t, 90, c.HistoryDays)
	require.Equal(t, s.config.BaseURL, c.BaseURL)
	require.NotZero(t, c.Version)
	admin, _ := s.userManager.User("admin")
	require.Equal(t, admin.SyncTopic, c.SyncTopic)
}

func TestCatalog_InjectIconDisabled(t *testing.T) {
	s := newTestCatalogServer(t, func(c *Config) { c.CatalogInjectIcon = false })
	rr := publishWith(t, s, "facemap", "facemap", map[string]string{"X-App-Icon": testFaceMapIcon})
	require.Equal(t, 200, rr.Code)
	require.Equal(t, "", toMessage(t, rr.Body.String()).Icon)
	require.Nil(t, s.catalog.reload())
	require.Equal(t, testFaceMapIcon, getCatalog(t, s, "admin").Apps[0].Icon)
}

func TestCatalog_PrefixRuleAndLocked(t *testing.T) {
	s := newTestCatalogServer(t)
	require.Nil(t, s.userManager.AddUser("kudtrading", "kudtrading", user.RoleUser, false))
	require.Nil(t, s.userManager.AllowAccess("kudtrading", "kudtrading", user.PermissionWrite))
	require.Nil(t, s.userManager.AllowAccess("kudtrading", "facemap-x", user.PermissionWrite))

	// X-App that is not a prefix of the topic: ignored entirely, publish still succeeds
	rr := publishWith(t, s, "facemap-x", "kudtrading", map[string]string{"X-App": "kudtrading", "X-App-Name": "Evil"})
	require.Equal(t, 200, rr.Code)
	require.Nil(t, s.catalog.reload())
	require.Len(t, getCatalog(t, s, "admin").Apps, 0)

	// Invalid metadata is ignored per field, the rest is applied
	rr = publishWith(t, s, "facemap-orders", "facemap", map[string]string{"X-App-Name": "<b>x</b>", "X-App-Icon": "http://insecure/a.png", "X-Sound": "loud", "X-Display-Name": "Orders"})
	require.Equal(t, 200, rr.Code)
	require.Nil(t, s.catalog.reload())
	c := getCatalog(t, s, "admin")
	require.Equal(t, "Facemap", c.Apps[0].Name)
	require.Equal(t, "", c.Apps[0].Icon)
	require.Equal(t, "Orders", c.Apps[0].Topics[0].Name)

	// Admin locks; publishers can no longer change it
	rr = request(t, s, "PUT", "/v1/catalog/apps/facemap", `{"name":"FaceMap","sound":"urgent"}`, catalogAuth("admin"))
	require.Equal(t, 200, rr.Code, rr.Body.String())
	rr = request(t, s, "PUT", "/v1/catalog/topics/facemap-orders", `{"name":"Paid orders"}`, catalogAuth("admin"))
	require.Equal(t, 200, rr.Code, rr.Body.String())
	publishWith(t, s, "facemap-orders", "facemap", map[string]string{"X-App-Name": "Changed", "X-Display-Name": "Changed"})
	require.Nil(t, s.catalog.reload())
	c = getCatalog(t, s, "admin")
	require.Equal(t, "FaceMap", c.Apps[0].Name)
	require.Equal(t, "urgent", c.Apps[0].Sound)
	require.Equal(t, "Paid orders", c.Apps[0].Topics[0].Name)
}

func TestCatalog_GetPermissions(t *testing.T) {
	s := newTestCatalogServer(t)
	publishWith(t, s, "facemap-orders", "facemap", nil)
	publishWith(t, s, "facemap-alerts", "facemap", nil)
	require.Nil(t, s.catalog.reload())

	// Admin sees everything
	require.Len(t, getCatalog(t, s, "admin").Apps[0].Topics, 2)

	// Read-only partner sees only their topic
	c := getCatalog(t, s, "partner")
	require.Len(t, c.Apps, 1)
	require.Len(t, c.Apps[0].Topics, 1)
	require.Equal(t, "facemap-orders", c.Apps[0].Topics[0].Topic)
	require.Equal(t, "read-only", c.Apps[0].Topics[0].Permission)

	// Read-write ops user
	c = getCatalog(t, s, "ops")
	require.Len(t, c.Apps[0].Topics, 2)
	require.Equal(t, "read-write", c.Apps[0].Topics[0].Permission)

	// Write-only publisher sees nothing
	c = getCatalog(t, s, "facemap")
	require.Len(t, c.Apps, 0)

	// Anonymous: 401
	rr := request(t, s, "GET", "/v1/catalog", "", nil)
	require.Equal(t, 401, rr.Code)

	// ?all=1 is admin only
	rr = request(t, s, "GET", "/v1/catalog?all=1", "", catalogAuth("partner"))
	require.Equal(t, 401, rr.Code)
}

func TestCatalog_Hidden(t *testing.T) {
	s := newTestCatalogServer(t)
	publishWith(t, s, "facemap-orders", "facemap", nil)
	publishWith(t, s, "facemap-secret", "facemap", nil)
	rr := request(t, s, "PUT", "/v1/catalog/topics/facemap-secret", `{"hidden":true}`, catalogAuth("admin"))
	require.Equal(t, 200, rr.Code)
	c := getCatalog(t, s, "admin")
	require.Len(t, c.Apps[0].Topics, 1)
	require.Equal(t, "facemap-orders", c.Apps[0].Topics[0].Topic)

	rr = request(t, s, "GET", "/v1/catalog?all=1", "", catalogAuth("admin"))
	require.Equal(t, 200, rr.Code)
	require.Contains(t, rr.Body.String(), `"hidden":true`)
	require.Contains(t, rr.Body.String(), `"locked":true`)

	// Publishing to a hidden topic does not unhide it
	publishWith(t, s, "facemap-secret", "facemap", map[string]string{"X-Display-Name": "Leak"})
	require.Nil(t, s.catalog.reload())
	require.Len(t, getCatalog(t, s, "admin").Apps[0].Topics, 1)
}

func TestCatalog_Disabled(t *testing.T) {
	conf := newTestConfigWithAuthFile(t, "")
	s := newTestServer(t, conf)
	require.Nil(t, s.catalog)
	require.Nil(t, s.userManager.AddUser("admin", "admin", user.RoleAdmin, false))
	rr := request(t, s, "GET", "/v1/catalog", "", catalogAuth("admin"))
	require.Equal(t, 404, rr.Code)
	rr = request(t, s, "PUT", "/v1/catalog/apps/x", `{}`, catalogAuth("admin"))
	require.Equal(t, 404, rr.Code)

	// Publishing with catalog headers is a no-op, no icon injected
	rr = request(t, s, "PUT", "/facemap", "x", map[string]string{"Authorization": util.BasicAuth("admin", "admin"), "X-App-Icon": testFaceMapIcon})
	require.Equal(t, 200, rr.Code)
	require.Equal(t, "", toMessage(t, rr.Body.String()).Icon)

	rr = request(t, s, "GET", "/config.js", "", nil)
	require.Contains(t, rr.Body.String(), `"enable_catalog": false`)
}

func TestCatalog_ConfigJS(t *testing.T) {
	s := newTestCatalogServer(t)
	rr := request(t, s, "GET", "/config.js", "", nil)
	require.Contains(t, rr.Body.String(), `"enable_catalog": true`)
}

func TestCatalog_ETag(t *testing.T) {
	s := newTestCatalogServer(t)
	publishWith(t, s, "facemap-orders", "facemap", nil)
	require.Nil(t, s.catalog.reload())
	rr := request(t, s, "GET", "/v1/catalog", "", catalogAuth("partner"))
	require.Equal(t, 200, rr.Code)
	etag := rr.Header().Get("ETag")
	require.NotEmpty(t, etag)
	require.Equal(t, "no-cache", rr.Header().Get("Cache-Control"))

	h := catalogAuth("partner")
	h["If-None-Match"] = etag
	rr = request(t, s, "GET", "/v1/catalog", "", h)
	require.Equal(t, 304, rr.Code)

	// ACL change (no catalog content change) still changes the ETag
	require.Nil(t, s.userManager.AllowAccess("partner", "facemap-orders", user.PermissionReadWrite))
	rr = request(t, s, "GET", "/v1/catalog", "", h)
	require.Equal(t, 200, rr.Code)

	// Gaining read on another topic (ACL only) returns 200 with the new topic
	publishWith(t, s, "facemap-alerts", "facemap", nil)
	require.Nil(t, s.catalog.reload())
	etag = rr.Header().Get("ETag")
	h["If-None-Match"] = etag
	rr = request(t, s, "GET", "/v1/catalog", "", h)
	require.Equal(t, 304, rr.Code) // new topic exists, but partner can't read it yet
	require.Nil(t, s.userManager.AllowAccess("partner", "facemap-alerts", user.PermissionRead))
	rr = request(t, s, "GET", "/v1/catalog", "", h)
	require.Equal(t, 200, rr.Code)
	require.Contains(t, rr.Body.String(), `"topic":"facemap-alerts"`)

	// Content change changes it too
	etag = rr.Header().Get("ETag")
	h["If-None-Match"] = etag
	rr = request(t, s, "PUT", "/v1/catalog/topics/facemap-orders", `{"name":"Orders"}`, catalogAuth("admin"))
	require.Equal(t, 200, rr.Code)
	rr = request(t, s, "GET", "/v1/catalog", "", h)
	require.Equal(t, 200, rr.Code)
}

func TestCatalog_AccountMerge(t *testing.T) {
	s := newTestCatalogServer(t)
	publishWith(t, s, "facemap-orders", "facemap", map[string]string{"X-Display-Name": "Orders"})
	publishWith(t, s, "facemap-alerts", "facemap", nil)
	require.Nil(t, s.catalog.reload())

	// User-stored subscription wins
	rr := request(t, s, "POST", "/v1/account/subscription", `{"base_url":"`+s.config.BaseURL+`","topic":"facemap-alerts","display_name":"My alerts"}`, catalogAuth("ops"))
	require.Equal(t, 200, rr.Code, rr.Body.String())

	rr = request(t, s, "GET", "/v1/account", "", catalogAuth("ops"))
	require.Equal(t, 200, rr.Code)
	var account apiAccountResponse
	require.Nil(t, json.NewDecoder(rr.Body).Decode(&account))
	require.Len(t, account.Subscriptions, 2)
	byTopic := map[string]*user.Subscription{}
	for _, sub := range account.Subscriptions {
		byTopic[sub.Topic] = sub
		require.Equal(t, s.config.BaseURL, sub.BaseURL)
	}
	require.Equal(t, "My alerts", *byTopic["facemap-alerts"].DisplayName)
	require.Equal(t, "Orders", *byTopic["facemap-orders"].DisplayName)

	// Partner: one virtual subscription, display_name null for unnamed topics
	rr = request(t, s, "PUT", "/v1/catalog/topics/facemap-orders", `{"name":""}`, catalogAuth("admin"))
	require.Equal(t, 200, rr.Code)
	rr = request(t, s, "GET", "/v1/account", "", catalogAuth("partner"))
	require.Contains(t, rr.Body.String(), `"subscriptions":[{"base_url":"http://127.0.0.1:12345","topic":"facemap-orders","display_name":null}]`)

	// Virtual subscriptions are not persisted
	u, _ := s.userManager.User("partner")
	require.Nil(t, u.Prefs.Subscriptions)
}

func TestCatalog_AdminAPI(t *testing.T) {
	s := newTestCatalogServer(t)
	admin := catalogAuth("admin")

	rr := request(t, s, "PUT", "/v1/catalog/apps/Bad_ID", `{}`, admin)
	require.Equal(t, 40080, toHTTPError(t, rr.Body.String()).Code)
	rr = request(t, s, "PUT", "/v1/catalog/apps/facemap", `{"icon":"http://x/a.png"}`, admin)
	require.Equal(t, 40082, toHTTPError(t, rr.Body.String()).Code)
	rr = request(t, s, "PUT", "/v1/catalog/apps/facemap", `{"sound":"boom"}`, admin)
	require.Equal(t, 40083, toHTTPError(t, rr.Body.String()).Code)
	rr = request(t, s, "PUT", "/v1/catalog/topics/facemap-orders", `{"app":"kudtrading"}`, admin)
	require.Equal(t, 40084, toHTTPError(t, rr.Body.String()).Code)

	// Non-admins are refused
	rr = request(t, s, "PUT", "/v1/catalog/apps/facemap", `{}`, catalogAuth("ops"))
	require.Equal(t, 401, rr.Code)

	// Topic PUT creates the app if missing
	rr = request(t, s, "PUT", "/v1/catalog/topics/facemap-orders", `{"name":"Orders","sound":"alert"}`, admin)
	require.Equal(t, 200, rr.Code, rr.Body.String())
	require.Contains(t, rr.Body.String(), `"app":"facemap"`)
	c := getCatalog(t, s, "admin")
	require.Equal(t, "Facemap", c.Apps[0].Name)
	require.Equal(t, "alert", c.Apps[0].Topics[0].Sound)

	// sound "inherit" clears the override
	rr = request(t, s, "PUT", "/v1/catalog/topics/facemap-orders", `{"sound":"inherit"}`, admin)
	require.Equal(t, 200, rr.Code)
	require.Equal(t, "default", getCatalog(t, s, "admin").Apps[0].Topics[0].Sound)

	// Delete app with topics: 409 unless force
	rr = request(t, s, "DELETE", "/v1/catalog/apps/facemap", "", admin)
	require.Equal(t, 409, rr.Code)
	require.Equal(t, 40980, toHTTPError(t, rr.Body.String()).Code)
	rr = request(t, s, "DELETE", "/v1/catalog/topics/facemap-orders", "", admin)
	require.Equal(t, 200, rr.Code)
	rr = request(t, s, "DELETE", "/v1/catalog/topics/facemap-orders", "", admin)
	require.Equal(t, 404, rr.Code)
	rr = request(t, s, "DELETE", "/v1/catalog/apps/facemap", "", admin)
	require.Equal(t, 200, rr.Code)
	require.Len(t, getCatalog(t, s, "admin").Apps, 0)

	publishWith(t, s, "facemap-orders", "facemap", nil)
	rr = request(t, s, "DELETE", "/v1/catalog/apps/facemap?force=1", "", admin)
	require.Equal(t, 200, rr.Code)
	require.Len(t, getCatalog(t, s, "admin").Apps, 0)
}

func TestCatalog_SyncEventOnChange(t *testing.T) {
	s := newTestCatalogServer(t)
	publishWith(t, s, "facemap-orders", "facemap", nil)
	require.Nil(t, s.catalog.reload()) // records the initial views

	partner, err := s.userManager.User("partner")
	require.Nil(t, err)
	require.NotEmpty(t, partner.SyncTopic)

	rr := httptest.NewRecorder()
	cancel := subscribe(t, s, "/"+partner.SyncTopic+"/json?auth="+authParam("partner"), rr)

	// Simulate `ntfy catalog topic set facemap-orders --name Orders` (direct store write), then the 30s reload
	require.Nil(t, s.catalog.store.UpsertTopic(&user.CatalogTopic{Topic: "facemap-orders", AppID: "facemap", Name: "Orders"}, true))
	require.Nil(t, s.catalog.reload())
	cancel()
	require.Contains(t, rr.Body.String(), `{\"event\":\"sync\"}`)

	// A change invisible to the partner sends nothing to them
	rr2 := httptest.NewRecorder()
	cancel = subscribe(t, s, "/"+partner.SyncTopic+"/json?auth="+authParam("partner"), rr2)
	publishWith(t, s, "facemap-alerts", "facemap", nil)
	require.Nil(t, s.catalog.reload())
	cancel()
	require.NotContains(t, rr2.Body.String(), `sync`)
}

func TestCatalog_SyncAndDisallowedTopicsNotRegistered(t *testing.T) {
	s := newTestCatalogServer(t, func(c *Config) { c.DisallowedTopics = []string{"docs"} })
	admin, _ := s.userManager.User("admin")
	publishWith(t, s, admin.SyncTopic, "admin", nil)
	publishWith(t, s, "docs", "admin", nil)
	require.Nil(t, s.catalog.reload())
	topics, err := s.catalog.store.Topics()
	require.Nil(t, err)
	require.Len(t, topics, 0)
}

func authParam(name string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(util.BasicAuth(name, name)))
}
