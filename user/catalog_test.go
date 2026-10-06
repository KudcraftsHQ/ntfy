package user

// kudcrafts: catalog

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func newTestCatalogStore(t *testing.T) (*Manager, *CatalogStore, string) {
	filename := filepath.Join(t.TempDir(), "user.db")
	m := newTestManagerFromFile(t, filename, "", PermissionDenyAll, DefaultUserPasswordBcryptCost, DefaultUserStatsQueueWriterInterval)
	t.Cleanup(func() { m.Close() })
	c, err := NewCatalogStore(m)
	require.Nil(t, err)
	return m, c, filename
}

func TestCatalogStore_IdempotentAndSchemaVersionUnchanged(t *testing.T) {
	m, c, filename := newTestCatalogStore(t)
	require.Nil(t, c.UpsertApp(&CatalogApp{ID: "facemap", Name: "FaceMap", Sound: "default"}, false))

	// Second store on the same manager: no error, data intact
	c2, err := NewCatalogStore(m)
	require.Nil(t, err)
	apps, err := c2.Apps()
	require.Nil(t, err)
	require.Len(t, apps, 1)
	require.Nil(t, m.Close())

	// Reopen with the stock manager (rollback path): schema version is still 9, no error
	m2, err := NewSQLiteManager(filename, "", &Config{DefaultAccess: PermissionDenyAll})
	require.Nil(t, err)
	defer m2.Close()
	d, err := sql.Open("sqlite3", filename)
	require.Nil(t, err)
	defer d.Close()
	var version int
	require.Nil(t, d.QueryRow(`SELECT version FROM schemaVersion WHERE id = 1`).Scan(&version))
	require.Equal(t, 9, version)
	require.Equal(t, sqliteCurrentSchemaVersion, version)

	// And a second NewCatalogStore on the reopened db still works
	c3, err := NewCatalogStore(m2)
	require.Nil(t, err)
	apps, err = c3.Apps()
	require.Nil(t, err)
	require.Equal(t, "FaceMap", apps[0].Name)
}

func TestCatalogStore_LockSemantics(t *testing.T) {
	_, c, _ := newTestCatalogStore(t)

	// Publisher creates, then updates (unlocked)
	require.Nil(t, c.UpsertApp(&CatalogApp{ID: "facemap", Name: "Facemap", Sound: "default"}, false))
	require.Nil(t, c.UpsertApp(&CatalogApp{ID: "facemap", Name: "FaceMap", Icon: "https://facemap.fyi/a.png", Sound: "alert"}, false))
	apps, _ := c.Apps()
	require.Equal(t, "FaceMap", apps[0].Name)
	require.Equal(t, "alert", apps[0].Sound)
	require.False(t, apps[0].Locked)

	// Admin locks
	require.Nil(t, c.UpsertApp(&CatalogApp{ID: "facemap", Name: "FaceMap Admin", Sound: "urgent"}, true))
	// Publisher can no longer change it
	require.Nil(t, c.UpsertApp(&CatalogApp{ID: "facemap", Name: "Hacked", Sound: "silent"}, false))
	apps, _ = c.Apps()
	require.Equal(t, "FaceMap Admin", apps[0].Name)
	require.Equal(t, "urgent", apps[0].Sound)
	require.True(t, apps[0].Locked)

	// Unlock -> publisher wins again
	require.Nil(t, c.UnlockApp("facemap"))
	require.Nil(t, c.UpsertApp(&CatalogApp{ID: "facemap", Name: "Again", Sound: "default"}, false))
	apps, _ = c.Apps()
	require.Equal(t, "Again", apps[0].Name)
	require.False(t, apps[0].Locked)

	// Topics: same, and publishers never set hidden
	require.Nil(t, c.UpsertTopic(&CatalogTopic{Topic: "facemap-orders", AppID: "facemap", Name: "Orders", Hidden: true}, false))
	topics, _ := c.Topics()
	require.Len(t, topics, 1)
	require.False(t, topics[0].Hidden)
	require.Equal(t, "", topics[0].Sound)
	require.Nil(t, c.UpsertTopic(&CatalogTopic{Topic: "facemap-orders", AppID: "facemap", Name: "Admin Orders", Sound: "alert", Hidden: true}, true))
	require.Nil(t, c.UpsertTopic(&CatalogTopic{Topic: "facemap-orders", AppID: "facemap", Name: "Nope"}, false))
	topics, _ = c.Topics()
	require.Equal(t, "Admin Orders", topics[0].Name)
	require.True(t, topics[0].Hidden)
	require.True(t, topics[0].Locked)

	require.Nil(t, c.TouchTopic("facemap-orders", 12345))
	topics, _ = c.Topics()
	require.Equal(t, int64(12345), topics[0].LastPublish)

	// Delete app with topics needs force
	require.Equal(t, ErrCatalogAppHasTopics, c.DeleteApp("facemap", false))
	require.Nil(t, c.DeleteApp("facemap", true))
	topics, _ = c.Topics()
	require.Len(t, topics, 0)
	require.Equal(t, ErrCatalogNotFound, c.DeleteApp("facemap", false))
	require.Equal(t, ErrCatalogNotFound, c.DeleteTopic("nope"))
}

func TestCatalogStore_TopicPrefixRule(t *testing.T) {
	_, c, _ := newTestCatalogStore(t)
	require.Equal(t, ErrCatalogAppNotPrefix, c.UpsertTopic(&CatalogTopic{Topic: "facemap-orders", AppID: "kudtrading"}, false))
	require.Equal(t, ErrCatalogAppNotPrefix, c.UpsertTopic(&CatalogTopic{Topic: "facemapx", AppID: "facemap"}, true))
	require.Nil(t, c.UpsertTopic(&CatalogTopic{Topic: "facemap", AppID: "facemap"}, false))
	require.Nil(t, c.UpsertTopic(&CatalogTopic{Topic: "facemap-a-b", AppID: "facemap-a"}, false))
	require.Equal(t, ErrCatalogInvalidSound, c.UpsertTopic(&CatalogTopic{Topic: "facemap", AppID: "facemap", Sound: "loud"}, false))
}

func TestCatalog_Validators(t *testing.T) {
	for _, id := range []string{"facemap", "a", "kud-trading", "0abc", strings.Repeat("a", 32)} {
		require.Nil(t, ValidateCatalogAppID(id), id)
	}
	for _, id := range []string{"", "-a", "Facemap", "face_map", strings.Repeat("a", 33), "a b"} {
		require.Equal(t, ErrCatalogInvalidAppID, ValidateCatalogAppID(id), id)
	}

	name, err := ValidateCatalogName("  Face\x00Map\n ")
	require.Nil(t, err)
	require.Equal(t, "FaceMap", name)
	for _, n := range []string{"", "   ", "<b>x</b>", strings.Repeat("x", 65), "a>b"} {
		_, err := ValidateCatalogName(n)
		require.Equal(t, ErrCatalogInvalidName, err, n)
	}
	name, err = ValidateCatalogName("Face\u202eMap\u200b")
	require.Nil(t, err)
	require.Equal(t, "FaceMap", name)
	_, err = ValidateCatalogName(strings.Repeat("é", 64))
	require.Nil(t, err)

	require.Nil(t, ValidateCatalogIcon(""))
	require.Nil(t, ValidateCatalogIcon("https://facemap.fyi/icon-192.png"))
	for _, u := range []string{"http://x.com/a.png", "https:///a.png", "javascript:alert(1)", "https://u:p@x.com/a", "https://x.com/" + strings.Repeat("a", 512), "file:///etc/passwd"} {
		require.Equal(t, ErrCatalogInvalidIcon, ValidateCatalogIcon(u), u)
	}

	for _, s := range []string{"silent", "default", "alert", "urgent"} {
		require.Nil(t, ValidateCatalogSound(s))
	}
	require.Equal(t, ErrCatalogInvalidSound, ValidateCatalogSound(""))
	require.Equal(t, ErrCatalogInvalidSound, ValidateCatalogSound("file.ogg"))

	require.Equal(t, "facemap", CatalogAppIDForTopic("facemap-orders"))
	require.Equal(t, "kudtrading", CatalogAppIDForTopic("kudtrading"))
	require.Equal(t, "Facemap", CatalogTitle("facemap"))
	require.Equal(t, "Kud Trading", CatalogTitle("kud-trading"))
	require.True(t, IsSyncTopic("st_abc"))
}
