import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { shortcutPlatform } from "../src/world/platform.ts";

// The web app picks its keyboard shortcuts (macOS, Windows or Linux set)
// from window.native.platform.
test("the system is passed on as Node names it", () => {
  assert.equal(shortcutPlatform("darwin"), "darwin");
  assert.equal(shortcutPlatform("win32"), "win32");
  assert.equal(shortcutPlatform("linux"), "linux");
  assert.equal(shortcutPlatform("freebsd"), "freebsd");
  assert.equal(shortcutPlatform(), process.platform);
});

test("the preload exposes it on window.native", () => {
  const source = readFileSync("src/world/window.ts", "utf8");
  assert.match(source, /platform: shortcutPlatform\(\)/);
});
