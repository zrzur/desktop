import assert from "node:assert/strict";
import test from "node:test";

import { resolveApplicationUrl } from "../src/native/applicationUrl.ts";

test("development alone defaults to loopback", () => {
  assert.equal(
    resolveApplicationUrl({ packaged: false }),
    "http://127.0.0.1:5173/",
  );
  assert.throws(
    () => resolveApplicationUrl({ packaged: true }),
    /no application URL/,
  );
});
test("the configured public URL is bundled into packaged applications", () => {
  assert.equal(
    resolveApplicationUrl({
      packaged: true,
      bundled: "https://app.example.test",
    }),
    "https://app.example.test/",
  );
});
test("an explicit loopback development override remains available", () => {
  assert.equal(
    resolveApplicationUrl({
      packaged: true,
      commandLine: "http://127.0.0.1:14707",
    }),
    "http://127.0.0.1:14707/",
  );
  assert.throws(
    () =>
      resolveApplicationUrl({
        packaged: true,
        bundled: "http://127.0.0.1:14707",
      }),
    /requires HTTPS/,
  );
});
test("production rejects insecure protocols, credentials and upstream origins", () => {
  for (const bundled of [
    "http://app.example.test",
    "file:///local",
    "https://user:pass@app.example.test",
    "https://app.stoat.chat",
    "https://revolt.chat",
    "https://app.stoat.chat./",
  ]) {
    assert.throws(() => resolveApplicationUrl({ packaged: true, bundled }));
  }
});
test("explicit overrides take precedence over bundled configuration", () => {
  assert.equal(
    resolveApplicationUrl({
      packaged: true,
      commandLine: "https://override.example.test",
      environment: "https://env.example.test",
      bundled: "https://app.example.test",
    }),
    "https://override.example.test/",
  );
  assert.equal(
    resolveApplicationUrl({
      packaged: true,
      environment: "https://env.example.test",
      bundled: "https://app.example.test",
    }),
    "https://env.example.test/",
  );
});
