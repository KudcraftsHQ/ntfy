import type { ServerConfig } from "./types";

declare global {
  interface Window {
    config?: ServerConfig;
  }
}

const raw: ServerConfig =
  (typeof window !== "undefined" && window.config) ||
  ({
    base_url: "",
    app_root: "/",
    enable_login: true,
    enable_web_push: false,
    web_push_public_key: "",
    disallowed_topics: [],
  } as ServerConfig);

/** Server config injected via /config.js. An empty base_url means "this origin". */
export const config: ServerConfig = {
  ...raw,
  base_url: (raw.base_url || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, ""),
};
