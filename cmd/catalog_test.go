//go:build !noserver

package cmd

// kudcrafts: catalog

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/urfave/cli/v2"
	"heckel.io/ntfy/v2/server"
	"heckel.io/ntfy/v2/test"
)

func runCatalogCommand(app *cli.App, conf *server.Config, args ...string) error {
	return app.Run(append([]string{
		"ntfy",
		"--log-level=ERROR",
		"catalog",
		"--config=" + conf.File,
		"--auth-file=" + conf.AuthFile,
		"--auth-default-access=" + conf.AuthDefault.String(),
	}, args...))
}

func TestCLI_Catalog_SetListRemove(t *testing.T) {
	s, conf, port := newTestServerWithAuth(t)
	defer test.StopServer(t, s, port)

	app, _, stdout, _ := newTestApp()
	require.Nil(t, runCatalogCommand(app, conf))
	require.Contains(t, stdout.String(), "catalog is empty")

	app, _, stdout, _ = newTestApp()
	require.Nil(t, runCatalogCommand(app, conf, "app", "set", "facemap", "--name", "FaceMap", "--icon", "https://facemap.fyi/icon-192.png", "--sound", "alert"))
	require.Contains(t, stdout.String(), "app facemap set (name: FaceMap, sound: alert")

	app, _, _, _ = newTestApp()
	require.Nil(t, runCatalogCommand(app, conf, "topic", "set", "facemap-orders", "--name", "Orders", "--sound", "urgent"))
	app, _, _, _ = newTestApp()
	require.Nil(t, runCatalogCommand(app, conf, "topic", "set", "facemap-debug", "--hidden", "--unlock"))
	app, _, _, _ = newTestApp()
	require.Nil(t, runCatalogCommand(app, conf, "topic", "set", "kudtrading")) // creates app "kudtrading"

	app, _, stdout, _ = newTestApp()
	require.Nil(t, runCatalogCommand(app, conf))
	out := stdout.String()
	require.Contains(t, out, "facemap")
	require.Contains(t, out, "FaceMap")
	require.Contains(t, out, "facemap-orders")
	require.Contains(t, out, "Orders")
	require.Contains(t, out, "urgent")
	require.Contains(t, out, "Kudtrading")
	require.Regexp(t, `facemap-debug\s+-\s+\(inherit\)\s+no\s+yes`, out) // unlocked, hidden

	// Sound inherit
	app, _, stdout, _ = newTestApp()
	require.Nil(t, runCatalogCommand(app, conf, "topic", "set", "facemap-orders", "--sound", "inherit"))
	require.Contains(t, stdout.String(), "sound: inherit")

	// Validation errors
	app, _, _, _ = newTestApp()
	require.ErrorContains(t, runCatalogCommand(app, conf, "topic", "set", "facemap-orders", "--app", "kudtrading"), "not a prefix")
	app, _, _, _ = newTestApp()
	require.Error(t, runCatalogCommand(app, conf, "app", "set", "facemap", "--icon", "http://insecure/a.png"))
	app, _, _, _ = newTestApp()
	require.Error(t, runCatalogCommand(app, conf, "app", "set", "facemap", "--sound", "loud"))
	app, _, _, _ = newTestApp()
	require.Error(t, runCatalogCommand(app, conf, "app", "set", "Bad_Id"))

	// Remove
	app, _, _, _ = newTestApp()
	require.ErrorContains(t, runCatalogCommand(app, conf, "app", "rm", "facemap"), "--force")
	app, _, _, _ = newTestApp()
	require.Nil(t, runCatalogCommand(app, conf, "topic", "rm", "kudtrading"))
	app, _, _, _ = newTestApp()
	require.Nil(t, runCatalogCommand(app, conf, "app", "rm", "facemap", "--force"))
	app, _, _, _ = newTestApp()
	require.Nil(t, runCatalogCommand(app, conf, "app", "rm", "kudtrading"))
	app, _, stdout, _ = newTestApp()
	require.Nil(t, runCatalogCommand(app, conf))
	require.Contains(t, stdout.String(), "catalog is empty")
}

func TestCLI_Catalog_Users(t *testing.T) {
	s, conf, port := newTestServerWithAuth(t)
	defer test.StopServer(t, s, port)

	app, stdin, _, _ := newTestApp()
	stdin.WriteString("p\np\np\np\n")
	require.Nil(t, runUserCommand(app, conf, "add", "--role=admin", "hammas"))
	require.Nil(t, runUserCommand(app, conf, "add", "partner"))
	require.Nil(t, runAccessCommand(app, conf, "partner", "facemap-orders", "ro"))

	for _, topic := range []string{"facemap-orders", "facemap-alerts"} {
		app, _, _, _ = newTestApp()
		require.Nil(t, runCatalogCommand(app, conf, "topic", "set", topic))
	}
	app, _, _, _ = newTestApp()
	require.Nil(t, runCatalogCommand(app, conf, "topic", "set", "facemap-debug", "--hidden"))

	app, _, stdout, _ := newTestApp()
	require.Nil(t, runCatalogCommand(app, conf, "users"))
	require.Equal(t, `user hammas (role: admin): 2 topic(s)
- facemap-alerts (rw)
- facemap-orders (rw)
user partner (role: user): 1 topic(s)
- facemap-orders (ro)
`, stdout.String())
}

func TestCLI_Serve_CatalogRequiresAuthFile(t *testing.T) {
	configFile := filepath.Join(t.TempDir(), "server.yml")
	require.Nil(t, os.WriteFile(configFile, []byte(""), 0600))
	app, _, _, _ := newTestApp()
	err := app.Run([]string{"ntfy", "serve", "--config=" + configFile, "--listen-http=:0", "--base-url=https://x.example", "--enable-catalog"})
	require.ErrorContains(t, err, "enable-catalog requires auth-file")

	app, _, _, _ = newTestApp()
	err = app.Run([]string{"ntfy", "serve", "--config=" + configFile, "--listen-http=:0", "--auth-file=" + filepath.Join(t.TempDir(), "user.db"), "--enable-catalog"})
	require.ErrorContains(t, err, "enable-catalog requires base-url")
}
