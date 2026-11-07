import assert from "node:assert/strict";
import test from "node:test";

import {
  appPathFromLink,
  linkFromArgs,
  linkProtocolFor,
} from "../src/native/deepLink.ts";

test("a Discover link opens that server's page, ready to join", () => {
  assert.equal(
    appPathFromLink("zrzur://discover/rabea?join=1"),
    "/discover/rabea?join=1",
  );
});

test("a Designs link opens that design", () => {
  assert.equal(
    appPathFromLink("zrzur://designs/look-night-glow"),
    "/designs/look-night-glow",
  );
});

test("other sections, sites and odd characters are ignored", () => {
  for (const link of [
    "zrzur://settings/account",
    "https://discover.zrzur.com/rabea",
    "zrzur://discover/../../etc",
    "zrzur://discover/a%2Fb",
    "zrzur://user:pass@discover/rabea",
    "zrzur:javascript:alert(1)",
    "not a link",
  ])
    assert.equal(appPathFromLink(link), undefined, link);
});

test("unknown query parameters are dropped", () => {
  assert.equal(
    appPathFromLink("zrzur://discover/rabea?join=1&next=https://x.test"),
    "/discover/rabea?join=1",
  );
});

test("the link is found among command-line arguments", () => {
  assert.equal(
    linkFromArgs(["Zrzur.exe", "--flag", "zrzur://discover/rabea"]),
    "zrzur://discover/rabea",
  );
  assert.equal(linkFromArgs(["Zrzur.exe"]), undefined);
});

test("beta builds use their own scheme and ignore the stable one", () => {
  assert.equal(linkProtocolFor("https://beta.zrzur.com"), "zrzur-beta");
  assert.equal(linkProtocolFor("https://app.zrzur.com"), "zrzur");
  assert.equal(linkProtocolFor("nonsense"), "zrzur");
  assert.equal(
    appPathFromLink("zrzur-beta://discover/rabea", "zrzur-beta"),
    "/discover/rabea",
  );
  assert.equal(appPathFromLink("zrzur://discover/rabea", "zrzur-beta"), undefined);
  assert.equal(appPathFromLink("zrzur-beta://discover/rabea"), undefined);
  assert.equal(
    linkFromArgs(["x", "zrzur-beta://designs/a"], "zrzur-beta"),
    "zrzur-beta://designs/a",
  );
});
