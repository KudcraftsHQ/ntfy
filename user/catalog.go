package user

// kudcrafts: catalog
//
// The catalog is the server-side list of "apps" and their concrete topics. It lives in two
// extra tables in user.db that are created with CREATE TABLE IF NOT EXISTS, outside of ntfy's
// schema migrations, so the schema version is untouched and the official image can still open
// the database (the tables are simply ignored there). See docs/kudcrafts/catalog-spec.md.

import (
	"database/sql"
	"errors"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"heckel.io/ntfy/v2/db"
)

const (
	catalogCreateTablesQuery = `
		CREATE TABLE IF NOT EXISTS catalog_app (
			id        TEXT PRIMARY KEY,
			name      TEXT NOT NULL,
			icon      TEXT NOT NULL DEFAULT '',
			sound     TEXT NOT NULL DEFAULT 'default',
			locked    INT  NOT NULL DEFAULT 0,
			created   INT  NOT NULL,
			updated   INT  NOT NULL
		);
		CREATE TABLE IF NOT EXISTS catalog_topic (
			topic        TEXT PRIMARY KEY,
			app_id       TEXT NOT NULL,
			name         TEXT NOT NULL DEFAULT '',
			sound        TEXT NOT NULL DEFAULT '',
			hidden       INT  NOT NULL DEFAULT 0,
			locked       INT  NOT NULL DEFAULT 0,
			created      INT  NOT NULL,
			updated      INT  NOT NULL,
			last_publish INT  NOT NULL DEFAULT 0
		);
		CREATE INDEX IF NOT EXISTS idx_catalog_topic_app ON catalog_topic (app_id);
	`
	catalogSelectAppsQuery   = `SELECT id, name, icon, sound, locked, created, updated FROM catalog_app ORDER BY id`
	catalogSelectTopicsQuery = `SELECT topic, app_id, name, sound, hidden, locked, created, updated, last_publish FROM catalog_topic ORDER BY topic`

	// Admin writes: overwrite everything and lock the row
	catalogUpsertAppLockedQuery = `
		INSERT INTO catalog_app (id, name, icon, sound, locked, created, updated) VALUES (?, ?, ?, ?, 1, ?, ?)
		ON CONFLICT (id) DO UPDATE SET name = excluded.name, icon = excluded.icon, sound = excluded.sound, locked = 1, updated = excluded.updated
	`
	catalogUpsertTopicLockedQuery = `
		INSERT INTO catalog_topic (topic, app_id, name, sound, hidden, locked, created, updated) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
		ON CONFLICT (topic) DO UPDATE SET app_id = excluded.app_id, name = excluded.name, sound = excluded.sound, hidden = excluded.hidden, locked = 1, updated = excluded.updated
	`

	// Publisher writes: never touch locked rows, never set locked or hidden
	catalogUpsertAppUnlockedQuery = `
		INSERT INTO catalog_app (id, name, icon, sound, locked, created, updated) VALUES (?, ?, ?, ?, 0, ?, ?)
		ON CONFLICT (id) DO UPDATE SET name = excluded.name, icon = excluded.icon, sound = excluded.sound, updated = excluded.updated
		WHERE catalog_app.locked = 0
	`
	catalogUpsertTopicUnlockedQuery = `
		INSERT INTO catalog_topic (topic, app_id, name, sound, hidden, locked, created, updated) VALUES (?, ?, ?, ?, 0, 0, ?, ?)
		ON CONFLICT (topic) DO UPDATE SET app_id = excluded.app_id, name = excluded.name, sound = excluded.sound, updated = excluded.updated
		WHERE catalog_topic.locked = 0
	`
	catalogUnlockAppQuery        = `UPDATE catalog_app SET locked = 0, updated = ? WHERE id = ?`
	catalogUnlockTopicQuery      = `UPDATE catalog_topic SET locked = 0, updated = ? WHERE topic = ?`
	catalogTouchTopicQuery       = `UPDATE catalog_topic SET last_publish = ? WHERE topic = ?`
	catalogCountAppTopicsQuery   = `SELECT COUNT(*) FROM catalog_topic WHERE app_id = ?`
	catalogDeleteAppQuery        = `DELETE FROM catalog_app WHERE id = ?`
	catalogDeleteAppTopicsQuery  = `DELETE FROM catalog_topic WHERE app_id = ?`
	catalogDeleteTopicQuery      = `DELETE FROM catalog_topic WHERE topic = ?`
	catalogMaxNameLength         = 64
	catalogMaxIconLength         = 512
	catalogSyncTopicPrefixForApp = syncTopicPrefix
)

// Sound class values with a special meaning
const (
	CatalogSoundDefault = "default" // The default sound class of a new app
	CatalogSoundInherit = ""        // Topic sound: inherit from the app
)

var (
	catalogSounds       = []string{"silent", "default", "alert", "urgent"}
	catalogAppIDRegex   = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)
	catalogNameBadChars = "<>"

	errCatalogNilArgument = errors.New("nil argument")
)

// Errors returned by the catalog validators and the catalog store
var (
	ErrCatalogInvalidAppID = errors.New("invalid catalog app id")
	ErrCatalogInvalidName  = errors.New("invalid catalog name")
	ErrCatalogInvalidIcon  = errors.New("invalid catalog icon URL (https only, <=512 chars)")
	ErrCatalogInvalidSound = errors.New("invalid sound class (silent, default, alert, urgent)")
	ErrCatalogAppNotPrefix = errors.New("app is not a prefix of topic")
	ErrCatalogNotFound     = errors.New("catalog entry not found")
	ErrCatalogAppHasTopics = errors.New("app still has topics")
	ErrCatalogNotSupported = errors.New("the catalog requires a SQLite user database (auth-file)")
	ErrCatalogInvalidTopic = errors.New("invalid topic")
)

// CatalogApp is an app in the catalog, e.g. "facemap", which groups one or more topics
type CatalogApp struct {
	ID      string
	Name    string
	Icon    string
	Sound   string
	Locked  bool
	Created int64
	Updated int64
}

// CatalogTopic is a concrete topic in the catalog; it belongs to exactly one app
type CatalogTopic struct {
	Topic       string
	AppID       string
	Name        string
	Sound       string // "" = inherit app sound
	Hidden      bool
	Locked      bool
	Created     int64
	Updated     int64
	LastPublish int64
}

// CatalogStore reads and writes the catalog tables in user.db
type CatalogStore struct {
	db *db.DB
}

// NewCatalogStore creates the catalog tables (if needed) in the manager's database. It only
// supports SQLite; the tables are created outside the schema migrations (no version bump).
func NewCatalogStore(m *Manager) (*CatalogStore, error) {
	if m == nil {
		return nil, errCatalogNilArgument
	} else if m.config != nil && m.config.DatabaseURL != "" {
		return nil, ErrCatalogNotSupported
	}
	if _, err := m.db.Exec(catalogCreateTablesQuery); err != nil {
		return nil, err
	}
	return &CatalogStore{db: m.db}, nil
}

// Apps returns all apps, sorted by ID
func (c *CatalogStore) Apps() ([]*CatalogApp, error) {
	rows, err := c.db.Query(catalogSelectAppsQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	apps := make([]*CatalogApp, 0)
	for rows.Next() {
		var a CatalogApp
		var locked int
		if err := rows.Scan(&a.ID, &a.Name, &a.Icon, &a.Sound, &locked, &a.Created, &a.Updated); err != nil {
			return nil, err
		}
		a.Locked = locked == 1
		apps = append(apps, &a)
	}
	return apps, rows.Err()
}

// Topics returns all topics, sorted by topic
func (c *CatalogStore) Topics() ([]*CatalogTopic, error) {
	rows, err := c.db.Query(catalogSelectTopicsQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	topics := make([]*CatalogTopic, 0)
	for rows.Next() {
		var t CatalogTopic
		var hidden, locked int
		if err := rows.Scan(&t.Topic, &t.AppID, &t.Name, &t.Sound, &hidden, &locked, &t.Created, &t.Updated, &t.LastPublish); err != nil {
			return nil, err
		}
		t.Hidden, t.Locked = hidden == 1, locked == 1
		topics = append(topics, &t)
	}
	return topics, rows.Err()
}

// UpsertApp inserts or updates an app. With lock=true (admin) the row is overwritten and locked.
// With lock=false (publisher) a locked row is left untouched and locked is never set.
func (c *CatalogStore) UpsertApp(a *CatalogApp, lock bool) error {
	if a == nil {
		return errCatalogNilArgument
	} else if err := ValidateCatalogAppID(a.ID); err != nil {
		return err
	} else if err := ValidateCatalogIcon(a.Icon); err != nil {
		return err
	} else if err := ValidateCatalogSound(a.Sound); err != nil {
		return err
	}
	name, err := ValidateCatalogName(a.Name)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	query := catalogUpsertAppUnlockedQuery
	if lock {
		query = catalogUpsertAppLockedQuery
	}
	_, err = c.db.Exec(query, a.ID, name, a.Icon, a.Sound, now, now)
	return err
}

// UpsertTopic inserts or updates a topic. Same locking rules as UpsertApp; publishers can never
// set or clear Hidden. The app must satisfy the prefix rule (CatalogAppMatchesTopic).
func (c *CatalogStore) UpsertTopic(t *CatalogTopic, lock bool) error {
	if t == nil {
		return errCatalogNilArgument
	} else if !AllowedTopic(t.Topic) {
		return ErrCatalogInvalidTopic
	} else if err := ValidateCatalogAppID(t.AppID); err != nil {
		return err
	} else if !CatalogAppMatchesTopic(t.AppID, t.Topic) {
		return ErrCatalogAppNotPrefix
	} else if t.Sound != CatalogSoundInherit {
		if err := ValidateCatalogSound(t.Sound); err != nil {
			return err
		}
	}
	name := ""
	if t.Name != "" {
		var err error
		if name, err = ValidateCatalogName(t.Name); err != nil {
			return err
		}
	}
	now := time.Now().Unix()
	var err error
	if lock {
		_, err = c.db.Exec(catalogUpsertTopicLockedQuery, t.Topic, t.AppID, name, t.Sound, boolToInt(t.Hidden), now, now)
	} else {
		_, err = c.db.Exec(catalogUpsertTopicUnlockedQuery, t.Topic, t.AppID, name, t.Sound, now, now)
	}
	return err
}

// UnlockApp clears the locked flag, so publishers may change the app again
func (c *CatalogStore) UnlockApp(id string) error {
	return c.execExpectRow(catalogUnlockAppQuery, time.Now().Unix(), id)
}

// UnlockTopic clears the locked flag, so publishers may change the topic again
func (c *CatalogStore) UnlockTopic(topic string) error {
	return c.execExpectRow(catalogUnlockTopicQuery, time.Now().Unix(), topic)
}

// TouchTopic records the time of the last publish
func (c *CatalogStore) TouchTopic(topic string, ts int64) error {
	_, err := c.db.Exec(catalogTouchTopicQuery, ts, topic)
	return err
}

// DeleteApp deletes an app. If it still has topics, ErrCatalogAppHasTopics is returned
// unless force is true, in which case its topics are deleted as well.
func (c *CatalogStore) DeleteApp(id string, force bool) error {
	return db.ExecTx(c.db, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRow(catalogCountAppTopicsQuery, id).Scan(&count); err != nil {
			return err
		}
		if count > 0 && !force {
			return ErrCatalogAppHasTopics
		}
		if _, err := tx.Exec(catalogDeleteAppTopicsQuery, id); err != nil {
			return err
		}
		res, err := tx.Exec(catalogDeleteAppQuery, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 && count == 0 {
			return ErrCatalogNotFound
		}
		return nil
	})
}

// DeleteTopic deletes a topic. It will be registered again on its next publish.
func (c *CatalogStore) DeleteTopic(topic string) error {
	return c.execExpectRow(catalogDeleteTopicQuery, topic)
}

func (c *CatalogStore) execExpectRow(query string, args ...any) error {
	res, err := c.db.Exec(query, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrCatalogNotFound
	}
	return nil
}

// ValidateCatalogAppID checks an app ID against ^[a-z0-9][a-z0-9-]{0,31}$
func ValidateCatalogAppID(id string) error {
	if !catalogAppIDRegex.MatchString(id) {
		return ErrCatalogInvalidAppID
	}
	return nil
}

// ValidateCatalogName cleans a display name (trims, strips control characters) and checks it:
// 1-64 characters, no '<' or '>'. It returns the cleaned name.
func ValidateCatalogName(name string) (string, error) {
	if !utf8.ValidString(name) {
		return "", ErrCatalogInvalidName
	}
	cleaned := strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) { // control and format chars (RTL override, zero-width)
			return -1
		}
		return r
	}, name))
	n := utf8.RuneCountInString(cleaned)
	if n < 1 || n > catalogMaxNameLength || strings.ContainsAny(cleaned, catalogNameBadChars) {
		return "", ErrCatalogInvalidName
	}
	return cleaned, nil
}

// ValidateCatalogIcon checks an icon URL: empty (no icon), or https with a host, <=512 chars
func ValidateCatalogIcon(icon string) error {
	if icon == "" {
		return nil
	} else if len(icon) > catalogMaxIconLength {
		return ErrCatalogInvalidIcon
	}
	u, err := url.Parse(icon)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return ErrCatalogInvalidIcon
	}
	return nil
}

// ValidateCatalogSound checks that the sound is one of the four sound classes
func ValidateCatalogSound(sound string) error {
	if !slices.Contains(catalogSounds, sound) {
		return ErrCatalogInvalidSound
	}
	return nil
}

// CatalogSounds returns the valid sound classes
func CatalogSounds() []string {
	return slices.Clone(catalogSounds)
}

// CatalogAppIDForTopic derives the default app ID of a topic: the part before the first '-',
// or the whole topic if there is none. The result may not be a valid app ID.
func CatalogAppIDForTopic(topic string) string {
	if i := strings.Index(topic, "-"); i > 0 {
		return topic[:i]
	}
	return topic
}

// CatalogAppMatchesTopic implements the prefix rule: a topic may belong to app X only if
// it is "X" or starts with "X-" (the ACL convention <app>, <app>-*).
func CatalogAppMatchesTopic(app, topic string) bool {
	return app != "" && (topic == app || strings.HasPrefix(topic, app+"-"))
}

// CatalogTitle turns an app ID into a default display name: "facemap" -> "Facemap",
// "kud-trading" -> "Kud Trading".
func CatalogTitle(id string) string {
	parts := strings.Split(id, "-")
	for i, p := range parts {
		if p != "" {
			r, size := utf8.DecodeRuneInString(p)
			parts[i] = string(unicode.ToUpper(r)) + p[size:]
		}
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}

// IsSyncTopic returns true if the topic looks like an account sync topic (st_...)
func IsSyncTopic(topic string) bool {
	return strings.HasPrefix(topic, catalogSyncTopicPrefixForApp)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
