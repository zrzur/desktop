import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// zrzur.com is the product homepage; zrzur.cc only carries invite/share links.
const HOMEPAGE = "https://zrzur.com";

test("AppStream metainfo names zrzur.com as the homepage", () => {
  const xml = readFileSync("cc.zrzur.ZrzurDesktop.metainfo.xml", "utf8");
  assert.match(xml, /<url type="homepage">https:\/\/zrzur\.com<\/url>/);
  assert.doesNotMatch(xml, /zrzur\.cc/);
});

test("package.json names zrzur.com as the homepage", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.homepage, HOMEPAGE);
  assert.equal(pkg.productName, "Zrzur");
  assert.equal(pkg.name, "zrzur-desktop");
});

test("desktop identity carries no retired spelling", () => {
  for (const file of ["strings.ts", "forge.config.ts", "cc.zrzur.ZrzurDesktop.desktop", "package.json"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /zarzou?r|zarzoor/i, file);
  }
});
