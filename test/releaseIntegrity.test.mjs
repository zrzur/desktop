import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { productionPackageDirs } from "../scripts/dependency-graph.mjs";
import { generateThirdPartyNotices } from "../scripts/generate-third-party-notices.mjs";
import { buildDefine, readReleaseInfo, sourceUrl } from "../scripts/release-info.mjs";
import { aboutPanelOptions } from "../src/native/buildInfo.ts";

function pkg(root, name, json, license) {
  const dir = join(root, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", ...json }));
  if (license) writeFileSync(join(dir, "LICENSE"), license);
}

test("source url and about panel point at the build's commit", () => {
  const info = readReleaseInfo({
    dir: mkdtempSync(join(tmpdir(), "zrzur-rel-")),
    env: { ZRZUR_GIT_COMMIT: "0123456789abcdef", ZRZUR_GIT_TAG: "" },
  });
  assert.equal(info.commit, "0123456789abcdef");
  assert.equal(sourceUrl(info, "desktop"), "https://github.com/zrzur/desktop/tree/0123456789abcdef");
  const built = JSON.parse(buildDefine(info, "desktop"));
  const panel = aboutPanelOptions(built);
  assert.equal(panel.website, built.sourceUrl);
  assert.equal(panel.version, "0123456");
  assert.match(panel.copyright, /AGPL-3\.0/);
});

test("notices cover production dependencies, not dev dependencies", () => {
  const root = mkdtempSync(join(tmpdir(), "zrzur-desk-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "app", dependencies: { a: "1" }, devDependencies: { dev: "1" } }),
  );
  pkg(root, "a", { license: "MIT", dependencies: { b: "1" } }, "MIT licence of a");
  pkg(root, "b", { license: "ISC" }, "ISC licence of b");
  pkg(root, "dev", { license: "MIT" }, "dev only");
  assert.equal(productionPackageDirs(root).length, 2);
  const out = join(root, "build", "THIRD-PARTY-NOTICES.txt");
  const { count } = generateThirdPartyNotices(root, out);
  assert.equal(count, 2);
  const text = readFileSync(out, "utf8");
  assert.match(text, /MIT licence of a/);
  assert.match(text, /ISC licence of b/);
  assert.doesNotMatch(text, /dev only/);
});

test("the real desktop dependency graph lists production packages", (t) => {
  if (!existsSync("node_modules")) return t.skip("dependencies not installed");
  const dirs = productionPackageDirs(process.cwd());
  assert.ok(dirs.length > 5, `only ${dirs.length} production packages found`);
  assert.ok(dirs.some((d) => d.split("\\").join("/").endsWith("/auto-launch")));
});

test("the copied shared scripts match their recorded hashes", () => {
  const recorded = readFileSync("scripts/shared-scripts.sha256", "utf8")
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/));
  assert.equal(recorded.length, 2);
  for (const [hash, file] of recorded) {
    const text = readFileSync(`scripts/${file}`, "utf8").split("\r\n").join("\n");
    assert.equal(createHash("sha256").update(text).digest("hex"), hash, `${file} changed: update every copy and shared-scripts.sha256`);
  }
});
