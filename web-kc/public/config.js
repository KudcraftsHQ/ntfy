// Development example only. The ntfy server generates the real /config.js,
// and scripts/to-site.ts deletes this file from the embedded build.
var config = {
  base_url: window.location.origin,
  app_root: "/",
  enable_login: true,
  require_login: true,
  enable_signup: false,
  enable_web_push: false,
  enable_catalog: true,
  web_push_public_key: "",
  disallowed_topics: ["docs", "static", "file", "app", "metrics", "account", "settings", "signup", "login", "v1"],
  config_hash: "dev",
};
