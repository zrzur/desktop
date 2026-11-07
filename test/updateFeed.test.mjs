import test from "node:test";
import assert from "node:assert/strict";

import {
  isAuthorizedUpdateHost,
  resolveUpdateFeedUrl,
} from "../src/native/updateFeed.ts";

test("updates stay off unless explicitly enabled with a Zrzur HTTPS feed", () => {
  assert.equal(resolveUpdateFeedUrl(undefined, "https://updates.zrzur.com/"), null);
  assert.equal(resolveUpdateFeedUrl("1", undefined), null);
  assert.equal(resolveUpdateFeedUrl("1", ""), null);
  assert.equal(
    resolveUpdateFeedUrl("1", "https://updates.zrzur.com/desktop"),
    "https://updates.zrzur.com/desktop/",
  );
  assert.equal(
    resolveUpdateFeedUrl("1", "https://updates.zrzur.com/desktop/"),
    "https://updates.zrzur.com/desktop/",
  );
  assert.equal(
    resolveUpdateFeedUrl("1", "https://zrzur.com/desktop-updates/"),
    "https://zrzur.com/desktop-updates/",
  );
});

test("host suffix spoofs and upstream feeds are refused", () => {
  assert.equal(isAuthorizedUpdateHost("notzrzur.com"), false);
  assert.equal(isAuthorizedUpdateHost("evilzrzur.com"), false);
  assert.equal(isAuthorizedUpdateHost("zrzur.com.evil.test"), false);
  assert.equal(isAuthorizedUpdateHost("zarzour.cc"), false);
  assert.equal(isAuthorizedUpdateHost("updates.zarzour.cc"), false);
  assert.equal(isAuthorizedUpdateHost("stoat.chat"), false);
  assert.equal(isAuthorizedUpdateHost("updates.zrzur.com"), true);
  assert.equal(isAuthorizedUpdateHost("a.b.zrzur.com"), true);

  assert.equal(resolveUpdateFeedUrl("1", "http://updates.zrzur.com/"), null);
  assert.equal(resolveUpdateFeedUrl("1", "https://update.electronjs.org"), null);
  assert.equal(
    resolveUpdateFeedUrl("1", "https://github.com/stoatchat/for-desktop"),
    null,
  );
  assert.equal(resolveUpdateFeedUrl("1", "https://stoat.chat/updates/"), null);
  assert.equal(
    resolveUpdateFeedUrl("1", "https://user:pass@updates.zrzur.com/"),
    null,
  );
  assert.equal(
    resolveUpdateFeedUrl("1", "https://notzrzur.com/updates/"),
    null,
  );
  assert.equal(
    resolveUpdateFeedUrl("1", "https://updates.zrzur.com/path#frag"),
    null,
  );
});
