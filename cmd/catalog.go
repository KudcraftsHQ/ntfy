//go:build !noserver

package cmd

// kudcrafts: catalog

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"sort"
	"text/tabwriter"
	"time"

	"github.com/urfave/cli/v2"
	"heckel.io/ntfy/v2/user"
)

func init() {
	commands = append(commands, cmdCatalog)
}

var cmdCatalog = &cli.Command{
	Name:      "catalog",
	Usage:     "Show/edit the app and topic catalog (kudcrafts)",
	UsageText: "ntfy catalog [app|topic|users] ...",
	Flags:     flagsUser,
	Before:    initConfigFileInputSourceFunc("config", flagsUser, initLogFunc),
	Action:    execCatalogList,
	Category:  categoryServer,
	Description: `Show and edit the catalog of apps and topics (kudcrafts fork, requires enable-catalog).

This is a server-only command. It directly manages the catalog tables in the user.db defined
by 'auth-file' (SQLite only). A running server picks up changes within 30 seconds.

Topics register themselves on their first authorized publish; use this command to name them,
assign sounds, hide them, or fix their app. Rows set here are locked: publishers can no longer
change them via headers, unless --unlock is given.

Examples:
  ntfy catalog                                             # Show all apps and topics
  ntfy catalog app set facemap --name FaceMap --icon https://facemap.fyi/icon-192.png --sound alert
  ntfy catalog app rm facemap --force                      # Remove app and all its topics
  ntfy catalog topic set facemap-orders --name Orders --sound urgent
  ntfy catalog topic set facemap-orders --sound inherit    # Use the app's sound again
  ntfy catalog topic set facemap-debug --hidden            # Never list this topic
  ntfy catalog topic rm facemap-orders
  ntfy catalog users                                       # What each user would see
`,
	Subcommands: []*cli.Command{
		{
			Name:  "app",
			Usage: "Set or remove apps",
			Subcommands: []*cli.Command{
				{
					Name:      "set",
					Usage:     "Create or update an app (locks it)",
					UsageText: "ntfy catalog app set ID [--name N] [--icon URL] [--sound CLASS] [--unlock]",
					Action:    execCatalogAppSet,
					Flags: []cli.Flag{
						&cli.StringFlag{Name: "name", Usage: "display name (1-64 chars)"},
						&cli.StringFlag{Name: "icon", Usage: "icon URL (https only, or \"\" to clear)"},
						&cli.StringFlag{Name: "sound", Usage: "sound class: silent, default, alert, urgent"},
						&cli.BoolFlag{Name: "unlock", Usage: "leave the app unlocked, so publishers may change it"},
					},
				},
				{
					Name:      "rm",
					Aliases:   []string{"remove", "del"},
					Usage:     "Remove an app",
					UsageText: "ntfy catalog app rm ID [--force]",
					Action:    execCatalogAppRemove,
					Flags: []cli.Flag{
						&cli.BoolFlag{Name: "force", Usage: "also remove the app's topics"},
					},
				},
			},
		},
		{
			Name:  "topic",
			Usage: "Set or remove topics",
			Subcommands: []*cli.Command{
				{
					Name:      "set",
					Usage:     "Create or update a topic (locks it)",
					UsageText: "ntfy catalog topic set TOPIC [--app ID] [--name N] [--sound CLASS|inherit] [--hidden|--visible] [--unlock]",
					Action:    execCatalogTopicSet,
					Flags: []cli.Flag{
						&cli.StringFlag{Name: "app", Usage: "app ID; must be a prefix of the topic (app or app-...)"},
						&cli.StringFlag{Name: "name", Usage: "display name (1-64 chars, or \"\" to show the topic id)"},
						&cli.StringFlag{Name: "sound", Usage: "sound class: silent, default, alert, urgent, or inherit"},
						&cli.BoolFlag{Name: "hidden", Usage: "never list this topic"},
						&cli.BoolFlag{Name: "visible", Usage: "list this topic again"},
						&cli.BoolFlag{Name: "unlock", Usage: "leave the topic unlocked, so publishers may change it"},
					},
				},
				{
					Name:      "rm",
					Aliases:   []string{"remove", "del"},
					Usage:     "Remove a topic (it re-registers on its next publish; use --hidden to hide it for good)",
					UsageText: "ntfy catalog topic rm TOPIC",
					Action:    execCatalogTopicRemove,
				},
			},
		},
		{
			Name:   "users",
			Usage:  "Show the topics each user would see",
			Action: execCatalogUsers,
		},
	},
}

// catalogFlags lets flags follow the positional argument ("set ID --name N", as documented):
// urfave/cli stops parsing flags at the first argument, so trailing flags are parsed here.
type catalogFlags struct {
	c        *cli.Context
	arg      string
	strings  map[string]string
	bools    map[string]bool
	extraArg int
}

func parseCatalogFlags(c *cli.Context, stringNames, boolNames []string) (*catalogFlags, error) {
	f := &catalogFlags{c: c, strings: map[string]string{}, bools: map[string]bool{}}
	args := c.Args().Slice()
	if len(args) == 0 {
		return f, nil
	}
	f.arg = args[0]
	fs := flag.NewFlagSet("catalog", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	strs := map[string]*string{}
	bls := map[string]*bool{}
	for _, n := range stringNames {
		strs[n] = fs.String(n, "", "")
	}
	for _, n := range boolNames {
		bls[n] = fs.Bool(n, false, "")
	}
	if err := fs.Parse(args[1:]); err != nil {
		return nil, err
	}
	f.extraArg = fs.NArg()
	fs.Visit(func(fl *flag.Flag) {
		if p, ok := strs[fl.Name]; ok {
			f.strings[fl.Name] = *p
		} else if p, ok := bls[fl.Name]; ok {
			f.bools[fl.Name] = *p
		}
	})
	return f, nil
}

func (f *catalogFlags) IsSet(name string) bool {
	_, s := f.strings[name]
	_, b := f.bools[name]
	return s || b || f.c.IsSet(name)
}

func (f *catalogFlags) String(name string) string {
	if v, ok := f.strings[name]; ok {
		return v
	}
	return f.c.String(name)
}

func (f *catalogFlags) Bool(name string) bool {
	if v, ok := f.bools[name]; ok {
		return v
	}
	return f.c.Bool(name)
}

func openCatalog(c *cli.Context) (*user.Manager, *user.CatalogStore, error) {
	if c.String("database-url") != "" {
		return nil, nil, errors.New("the catalog is not supported with database-url, only with auth-file (SQLite)")
	}
	manager, err := createUserManager(c)
	if err != nil {
		return nil, nil, err
	}
	store, err := user.NewCatalogStore(manager)
	if err != nil {
		manager.Close()
		return nil, nil, err
	}
	return manager, store, nil
}

func execCatalogList(c *cli.Context) error {
	if c.NArg() > 0 {
		return fmt.Errorf("unknown command %q, please check 'ntfy catalog --help'", c.Args().First())
	}
	manager, store, err := openCatalog(c)
	if err != nil {
		return err
	}
	defer manager.Close()
	apps, err := store.Apps()
	if err != nil {
		return err
	}
	topics, err := store.Topics()
	if err != nil {
		return err
	}
	return printCatalog(c, apps, topics)
}

func printCatalog(c *cli.Context, apps []*user.CatalogApp, topics []*user.CatalogTopic) error {
	if len(apps) == 0 && len(topics) == 0 {
		fmt.Fprintln(c.App.Writer, "catalog is empty; topics register on their first publish")
		return nil
	}
	appsByID := make(map[string]*user.CatalogApp)
	for _, a := range apps {
		appsByID[a.ID] = a
	}
	w := tabwriter.NewWriter(c.App.Writer, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "APP\tTOPIC\tNAME\tSOUND\tLOCKED\tHIDDEN\tLAST PUBLISH")
	for _, a := range apps {
		fmt.Fprintf(w, "%s\t\t%s\t%s\t%s\t\t%s\n", a.ID, a.Name, a.Sound, yesNo(a.Locked), iconNote(a.Icon))
		for _, t := range topics {
			if t.AppID != a.ID {
				continue
			}
			printCatalogTopic(w, t, a)
		}
	}
	for _, t := range topics {
		if _, ok := appsByID[t.AppID]; !ok {
			printCatalogTopic(w, t, nil)
		}
	}
	return w.Flush()
}

func printCatalogTopic(w *tabwriter.Writer, t *user.CatalogTopic, a *user.CatalogApp) {
	sound := t.Sound
	if sound == "" {
		sound = "(inherit)"
	}
	name := t.Name
	if name == "" {
		name = "-"
	}
	lastPublish := "never"
	if t.LastPublish > 0 {
		lastPublish = time.Unix(t.LastPublish, 0).UTC().Format("2006-01-02 15:04 UTC")
	}
	appCol := ""
	if a == nil {
		appCol = t.AppID + " (missing)"
	}
	fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", appCol, t.Topic, name, sound, yesNo(t.Locked), yesNo(t.Hidden), lastPublish)
}

func yesNo(b bool) string {
	if b {
		return "yes"
	}
	return "no"
}

func iconNote(icon string) string {
	if icon == "" {
		return "(no icon)"
	}
	return icon
}

func execCatalogAppSet(cc *cli.Context) error {
	c, err := parseCatalogFlags(cc, []string{"name", "icon", "sound"}, []string{"unlock"})
	if err != nil {
		return err
	}
	id := c.arg
	if id == "" || c.extraArg > 0 {
		return errors.New("usage: ntfy catalog app set ID [--name N] [--icon URL] [--sound CLASS] [--unlock]")
	} else if err := user.ValidateCatalogAppID(id); err != nil {
		return fmt.Errorf("%s: %w (must match ^[a-z0-9][a-z0-9-]{0,31}$)", id, err)
	}
	manager, store, err := openCatalog(cc)
	if err != nil {
		return err
	}
	defer manager.Close()
	apps, err := store.Apps()
	if err != nil {
		return err
	}
	app := &user.CatalogApp{ID: id, Name: user.CatalogTitle(id), Sound: user.CatalogSoundDefault}
	for _, a := range apps {
		if a.ID == id {
			app.Name, app.Icon, app.Sound = a.Name, a.Icon, a.Sound
		}
	}
	if c.IsSet("name") {
		if app.Name, err = user.ValidateCatalogName(c.String("name")); err != nil {
			return err
		}
	}
	if c.IsSet("icon") {
		if err := user.ValidateCatalogIcon(c.String("icon")); err != nil {
			return err
		}
		app.Icon = c.String("icon")
	}
	if c.IsSet("sound") {
		if err := user.ValidateCatalogSound(c.String("sound")); err != nil {
			return err
		}
		app.Sound = c.String("sound")
	}
	if err := store.UpsertApp(app, true); err != nil {
		return err
	}
	if c.Bool("unlock") {
		if err := store.UnlockApp(id); err != nil {
			return err
		}
	}
	fmt.Fprintf(cc.App.Writer, "app %s set (name: %s, sound: %s, icon: %s, locked: %s)\n", id, app.Name, app.Sound, iconNote(app.Icon), yesNo(!c.Bool("unlock")))
	return nil
}

func execCatalogAppRemove(cc *cli.Context) error {
	c, err := parseCatalogFlags(cc, nil, []string{"force"})
	if err != nil {
		return err
	}
	id := c.arg
	if id == "" || c.extraArg > 0 {
		return errors.New("usage: ntfy catalog app rm ID [--force]")
	}
	manager, store, err := openCatalog(cc)
	if err != nil {
		return err
	}
	defer manager.Close()
	if err := store.DeleteApp(id, c.Bool("force")); errors.Is(err, user.ErrCatalogAppHasTopics) {
		return fmt.Errorf("app %s still has topics; use --force to remove them too", id)
	} else if err != nil {
		return err
	}
	fmt.Fprintf(cc.App.Writer, "app %s removed\n", id)
	return nil
}

func execCatalogTopicSet(cc *cli.Context) error {
	c, err := parseCatalogFlags(cc, []string{"app", "name", "sound"}, []string{"hidden", "visible", "unlock"})
	if err != nil {
		return err
	}
	topic := c.arg
	if topic == "" || c.extraArg > 0 {
		return errors.New("usage: ntfy catalog topic set TOPIC [--app ID] [--name N] [--sound CLASS|inherit] [--hidden|--visible] [--unlock]")
	} else if !user.AllowedTopic(topic) {
		return fmt.Errorf("invalid topic %s", topic)
	} else if c.Bool("hidden") && c.Bool("visible") {
		return errors.New("cannot use --hidden and --visible together")
	}
	manager, store, err := openCatalog(cc)
	if err != nil {
		return err
	}
	defer manager.Close()
	topics, err := store.Topics()
	if err != nil {
		return err
	}
	t := &user.CatalogTopic{Topic: topic, AppID: user.CatalogAppIDForTopic(topic)}
	for _, existing := range topics {
		if existing.Topic == topic {
			t.AppID, t.Name, t.Sound, t.Hidden = existing.AppID, existing.Name, existing.Sound, existing.Hidden
		}
	}
	if c.IsSet("app") {
		t.AppID = c.String("app")
	}
	if err := user.ValidateCatalogAppID(t.AppID); err != nil {
		return fmt.Errorf("app %q: %w; use --app", t.AppID, err)
	} else if !user.CatalogAppMatchesTopic(t.AppID, topic) {
		return fmt.Errorf("app %s is not a prefix of topic %s (topic must be %s or %s-...)", t.AppID, topic, t.AppID, t.AppID)
	}
	if c.IsSet("name") {
		if c.String("name") == "" {
			t.Name = ""
		} else if t.Name, err = user.ValidateCatalogName(c.String("name")); err != nil {
			return err
		}
	}
	if c.IsSet("sound") {
		sound := c.String("sound")
		if sound == "inherit" || sound == "" {
			t.Sound = user.CatalogSoundInherit
		} else if err := user.ValidateCatalogSound(sound); err != nil {
			return err
		} else {
			t.Sound = sound
		}
	}
	if c.Bool("hidden") {
		t.Hidden = true
	} else if c.Bool("visible") {
		t.Hidden = false
	}
	apps, err := store.Apps()
	if err != nil {
		return err
	}
	appExists := false
	for _, a := range apps {
		appExists = appExists || a.ID == t.AppID
	}
	if !appExists {
		if err := store.UpsertApp(&user.CatalogApp{ID: t.AppID, Name: user.CatalogTitle(t.AppID), Sound: user.CatalogSoundDefault}, false); err != nil {
			return err
		}
	}
	if err := store.UpsertTopic(t, true); err != nil {
		return err
	}
	if c.Bool("unlock") {
		if err := store.UnlockTopic(topic); err != nil {
			return err
		}
	}
	sound := t.Sound
	if sound == "" {
		sound = "inherit"
	}
	fmt.Fprintf(cc.App.Writer, "topic %s set (app: %s, name: %q, sound: %s, hidden: %s, locked: %s)\n", topic, t.AppID, t.Name, sound, yesNo(t.Hidden), yesNo(!c.Bool("unlock")))
	return nil
}

func execCatalogTopicRemove(c *cli.Context) error {
	topic := c.Args().Get(0)
	if topic == "" || c.NArg() > 1 {
		return errors.New("usage: ntfy catalog topic rm TOPIC")
	}
	manager, store, err := openCatalog(c)
	if err != nil {
		return err
	}
	defer manager.Close()
	if err := store.DeleteTopic(topic); errors.Is(err, user.ErrCatalogNotFound) {
		return fmt.Errorf("topic %s is not in the catalog", topic)
	} else if err != nil {
		return err
	}
	fmt.Fprintf(c.App.Writer, "topic %s removed (it registers again on its next publish; use 'topic set --hidden' to hide it)\n", topic)
	return nil
}

func execCatalogUsers(c *cli.Context) error {
	manager, store, err := openCatalog(c)
	if err != nil {
		return err
	}
	defer manager.Close()
	users, err := manager.Users()
	if err != nil {
		return err
	}
	topics, err := store.Topics()
	if err != nil {
		return err
	}
	sort.Slice(users, func(i, j int) bool { return users[i].Name < users[j].Name })
	for _, u := range users {
		if u.Name == user.Everyone {
			continue
		}
		visible := make([]string, 0)
		for _, t := range topics {
			if t.Hidden || manager.Authorize(u, t.Topic, user.PermissionRead) != nil {
				continue
			}
			perm := "ro"
			if manager.Authorize(u, t.Topic, user.PermissionWrite) == nil {
				perm = "rw"
			}
			visible = append(visible, fmt.Sprintf("%s (%s)", t.Topic, perm))
		}
		fmt.Fprintf(c.App.Writer, "user %s (role: %s): %d topic(s)\n", u.Name, u.Role, len(visible))
		for _, v := range visible {
			fmt.Fprintf(c.App.Writer, "- %s\n", v)
		}
	}
	return nil
}
