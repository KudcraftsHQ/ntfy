// Moves the Vite build into server/site exactly like upstream's `make web-build`:
// index.html -> app.html, the dev config.js removed (the server generates /config.js).
import { renameSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const build = resolve(root, "build");
const site = resolve(root, "..", "server", "site");
renameSync(resolve(build, "index.html"), resolve(build, "app.html"));
if (existsSync(resolve(build, "config.js"))) rmSync(resolve(build, "config.js"));
rmSync(site, { recursive: true, force: true });
renameSync(build, site);
console.log(`web-kc: build moved to ${site}`);
