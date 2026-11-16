import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FAILED_NOTICE_MS,
  OFFLINE_NOTICE_MS,
  runStartupFlow,
} from "../src/native/startup/startupFlow.ts";
import { nextRetryDelay } from "../src/native/retryDelay.ts";
import {
  SHELL_LOCALES,
  STRINGS,
  displayVersion,
  percent,
  percentLabel,
  shellLocale,
  shellString,
  startupView,
} from "../src/native/startup/startupStrings.ts";
import {
  compareVersions,
  parseReleases,
  pickUpdate,
  releasesLine,
} from "../src/native/startup/updateCheck.ts";
import {
  DownloadError,
  describeError,
  downloadPackage,
} from "../src/native/startup/updateDownload.ts";
import { resolveUpdateFeedUrl } from "../src/native/updateFeed.ts";

const ID = "zrzur_desktop";
const sha = (buffer) => createHash("sha1").update(buffer).digest("hex");

// ---------------------------------------------------------------- versions

test("versions compare the way releases are numbered", () => {
  assert.ok(compareVersions("26.2.0", "26.1.0") > 0);
  assert.ok(compareVersions("26.1.10", "26.1.9") > 0);
  assert.ok(compareVersions("27.0.0", "26.9.9") > 0);
  assert.equal(compareVersions("26.1.0", "26.1.0"), 0);
  // a release is newer than its own beta
  assert.ok(compareVersions("26.1.0", "26.1.0-beta.2") > 0);
  assert.ok(compareVersions("26.1.0-beta.3", "26.1.0-beta.2") > 0);
  assert.ok(compareVersions("26.1.0-beta.10", "26.1.0-beta.9") > 0);
  assert.ok(compareVersions("26.1.0-beta.1", "26.1.0-alpha.9") > 0);
  // Squirrel writes "beta2" where package.json says "beta.2"
  assert.equal(compareVersions("26.1.0-beta2", "26.1.0-beta.2"), 0);
  assert.ok(compareVersions("26.1.0-beta3", "26.1.0-beta.2") > 0);
  // unreadable is never newer
  assert.ok(compareVersions("latest", "26.1.0") < 0);
  assert.ok(compareVersions("26.1", "26.1.0") < 0);
});

// -------------------------------------------------------------------- feed

const A = "a".repeat(40);
const B = "B".repeat(40);

test("RELEASES: only well-formed full packages of this app are read", () => {
  const text = [
    `\uFEFF${A} ${ID}-26.0.0-full.nupkg 100`,
    `${B} ${ID}-26.2.0-full.nupkg 4400`,
    `${A} ${ID}-26.2.0-delta.nupkg 50`, // deltas are not used
    `${A} other_app-99.0.0-full.nupkg 10`, // another package
    `${A} ../../${ID}-99.0.0-full.nupkg 10`, // path: only the name counts
    `${A} ${ID}-98.0.0-full.nupkg`, // no size
    `nothex ${ID}-97.0.0-full.nupkg 10`,
    `${A} ${ID}-96.0.0-full.nupkg 0`,
    `${A} ${ID}-9x.0.0-full.nupkg 10`,
    "",
  ].join("\r\n");
  const list = parseReleases(text, ID);
  assert.deepEqual(
    list.map((p) => p.version),
    ["26.0.0", "26.2.0", "99.0.0"],
  );
  // the path before the name is dropped: the file is always fetched from the feed folder
  assert.equal(list[2].fileName, `${ID}-99.0.0-full.nupkg`);
  assert.equal(list[1].sha1, "b".repeat(40));
  assert.equal(list[1].size, 4400);
});

test("pickUpdate: the newest package newer than the running version, else none", () => {
  const text = [
    `${A} ${ID}-26.0.0-full.nupkg 100`,
    `${A} ${ID}-26.1.0-beta2-full.nupkg 100`,
    `${A} ${ID}-26.1.0-beta3-full.nupkg 100`,
    `${A} ${ID}-26.2.0-full.nupkg 100`,
    `${A} ${ID}-26.1.5-full.nupkg 100`,
  ].join("\n");
  assert.equal(pickUpdate(text, "26.1.0-beta.2", ID).version, "26.2.0");
  assert.equal(pickUpdate(text, "26.2.0", ID), null);
  assert.equal(pickUpdate(text, "27.0.0", ID), null);
  assert.equal(pickUpdate("", "26.1.0", ID), null);
  assert.equal(pickUpdate("<html>not a feed</html>", "26.1.0", ID), null);
  // the same build under Squirrel's spelling is not an update
  assert.equal(
    pickUpdate(`${A} ${ID}-26.1.0-beta2-full.nupkg 100`, "26.1.0-beta.2", ID),
    null,
  );
  const update = pickUpdate(text, "26.1.0-beta.2", ID);
  assert.equal(releasesLine(update), `${"A".repeat(40)} ${ID}-26.2.0-full.nupkg 100`);
});

test("a local test feed over plain HTTP is accepted only when asked for", () => {
  const local = "http://127.0.0.1:31250/feed";
  assert.equal(resolveUpdateFeedUrl("1", local), null);
  assert.equal(
    resolveUpdateFeedUrl("1", local, { allowLoopbackHttp: true }),
    "http://127.0.0.1:31250/feed/",
  );
  // never for another host, never without the switch
  assert.equal(
    resolveUpdateFeedUrl("1", "http://updates.zrzur.com/", { allowLoopbackHttp: true }),
    null,
  );
  assert.equal(
    resolveUpdateFeedUrl("1", "http://192.168.1.5/feed/", { allowLoopbackHttp: true }),
    null,
  );
  assert.equal(resolveUpdateFeedUrl(undefined, local, { allowLoopbackHttp: true }), null);
});

// ---------------------------------------------------------------- download

/** A feed server whose behaviour each test sets */
async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zrzur-startup-test-"));
  try {
    await run(`http://127.0.0.1:${server.address().port}/`, dir);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BODY = Buffer.alloc(300_000, 7);

test("download: the bytes are written, counted and verified", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-length": BODY.length });
      res.write(BODY.subarray(0, 100_000));
      setTimeout(() => res.end(BODY.subarray(100_000)), 30);
    },
    async (base, dir) => {
      const file = path.join(dir, "p.nupkg");
      const seen = [];
      await downloadPackage({
        url: `${base}p.nupkg`,
        file,
        size: BODY.length,
        sha1: sha(BODY),
        fetch,
        onProgress: (received, total) => seen.push([received, total]),
      });
      assert.deepEqual(fs.readFileSync(file), BODY);
      assert.equal(fs.existsSync(`${file}.part`), false);
      assert.deepEqual(seen[0], [0, BODY.length]);
      assert.deepEqual(seen.at(-1), [BODY.length, BODY.length]);
      // progress never goes back and never passes the total
      for (let i = 1; i < seen.length; i++) {
        assert.ok(seen[i][0] >= seen[i - 1][0]);
        assert.ok(seen[i][0] <= BODY.length);
      }
      assert.ok(seen.length >= 3, "more than a start and an end were reported");
    },
  );
});

test("download: a verified file from an earlier try is not fetched again", async () => {
  let hits = 0;
  await withServer(
    (_req, res) => {
      hits++;
      res.end(BODY);
    },
    async (base, dir) => {
      const file = path.join(dir, "p.nupkg");
      fs.writeFileSync(file, BODY);
      const seen = [];
      await downloadPackage({
        url: `${base}p.nupkg`, file, size: BODY.length, sha1: sha(BODY), fetch,
        onProgress: (r, t) => seen.push([r, t]),
      });
      assert.equal(hits, 0);
      assert.deepEqual(seen, [[BODY.length, BODY.length]]);
      // a file with the right size and wrong content is fetched again
      fs.writeFileSync(file, Buffer.alloc(BODY.length, 9));
      await downloadPackage({ url: `${base}p.nupkg`, file, size: BODY.length, sha1: sha(BODY), fetch });
      assert.equal(hits, 1);
      assert.deepEqual(fs.readFileSync(file), BODY);
    },
  );
});

async function failure(handler, overrides = {}) {
  let caught;
  await withServer(handler, async (base, dir) => {
    const file = path.join(dir, "p.nupkg");
    try {
      await downloadPackage({
        url: `${base}p.nupkg`, file, size: BODY.length, sha1: sha(BODY), fetch,
        ...overrides,
      });
    } catch (error) {
      caught = error;
    }
    // nothing is left behind for the installer to pick up
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(`${file}.part`), false);
  });
  assert.ok(caught instanceof DownloadError, `a DownloadError, got ${caught}`);
  return caught;
}

test("download: a file that differs from the list is refused", async () => {
  const other = Buffer.alloc(BODY.length, 8);
  const error = await failure((_req, res) => res.end(other));
  assert.match(error.message, /SHA-1/);
  assert.equal(error.received, BODY.length);
});

test("download: a connection that drops says where it stopped", async () => {
  const error = await failure((_req, res) => {
    res.writeHead(200, { "content-length": BODY.length });
    res.write(BODY.subarray(0, 120_000), () => res.destroy());
  });
  assert.ok(error.received > 0 && error.received < BODY.length);
  assert.equal(error.total, BODY.length);
});

test("download: a short, a long and a missing file are refused", async () => {
  const short = await failure((_req, res) => res.end(BODY.subarray(0, 1000)));
  assert.match(short.message, /ended early/);
  const long = await failure((_req, res) => res.end(Buffer.concat([BODY, BODY])));
  assert.match(long.message, /larger/);
  const missing = await failure((_req, res) => {
    res.writeHead(404);
    res.end("no");
  });
  assert.match(missing.message, /404/);
  // a redirect could lead to another host: not followed
  const moved = await failure((_req, res) => {
    res.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" });
    res.end();
  });
  assert.ok(moved.message.length > 0);
});

test("download: silence on the line ends the wait", async () => {
  const error = await failure(
    (_req, res) => {
      res.writeHead(200, { "content-length": BODY.length });
      res.write(BODY.subarray(0, 50_000)); // and then nothing
    },
    { stallMs: 150 },
  );
  assert.match(error.message, /no data for/);
});

test("describeError keeps the system's code", () => {
  const error = new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "ECONNREFUSED" }) });
  assert.equal(describeError(error), "fetch failed: ECONNREFUSED");
  assert.equal(describeError("plain"), "plain");
});

// -------------------------------------------------------------------- flow

const UPDATE = { version: "26.2.0", fileName: `${ID}-26.2.0-full.nupkg`, sha1: A, size: 1000 };

function flowDeps(overrides = {}) {
  const shown = [];
  const calls = [];
  const deps = {
    feedUrl: "https://updates.zrzur.com/win/",
    fetchReleases: async () => "feed",
    pick: () => UPDATE,
    isOnline: () => true,
    download: async (_feed, _update, onProgress) => {
      onProgress(400, 1000);
      onProgress(1000, 1000);
      return "C:/tmp/update";
    },
    install: async () => undefined,
    show: (state) => shown.push(state),
    waitForChoice: async (ms) => {
      calls.push(["wait", ms]);
      return "timeout";
    },
    sleep: async (ms) => {
      calls.push(["sleep", ms]);
    },
    describe: (error) => error.message,
    log: () => undefined,
    ...overrides,
  };
  return { deps, shown, calls, kinds: () => shown.map((s) => s.kind) };
}

test("flow: no feed means the app just opens, nothing is fetched", async () => {
  let fetched = false;
  const f = flowDeps({ feedUrl: null, fetchReleases: async () => { fetched = true; return ""; } });
  assert.equal(await runStartupFlow(f.deps), "open");
  assert.deepEqual(f.kinds(), ["opening"]);
  assert.equal(fetched, false);
});

test("flow: up to date opens the app", async () => {
  const f = flowDeps({ pick: () => null });
  assert.equal(await runStartupFlow(f.deps), "open");
  assert.deepEqual(f.kinds(), ["checking", "opening"]);
});

test("flow: an update is downloaded with its real byte counts, installed, then the app restarts", async () => {
  const f = flowDeps();
  assert.equal(await runStartupFlow(f.deps), "restart");
  assert.deepEqual(f.kinds(), ["checking", "downloading", "downloading", "downloading", "installing"]);
  assert.deepEqual(f.shown.filter((s) => s.kind === "downloading").map((s) => s.received), [0, 400, 1000]);
  assert.equal(f.shown[1].total, 1000);
  assert.equal(f.shown.at(-1).version, "26.2.0");
});

test("flow: no network is said in words, briefly, and the app opens", async () => {
  const f = flowDeps({ fetchReleases: async () => { throw new Error("net down"); }, isOnline: () => false });
  assert.equal(await runStartupFlow(f.deps), "open");
  assert.deepEqual(f.kinds(), ["checking", "offline", "opening"]);
  assert.deepEqual(f.calls, [["sleep", OFFLINE_NOTICE_MS]]);
});

test("flow: a feed that does not answer is not called 'no connection'", async () => {
  const f = flowDeps({ fetchReleases: async () => { throw new Error("503"); } });
  assert.equal(await runStartupFlow(f.deps), "open");
  assert.deepEqual(f.kinds(), ["checking", "opening"]);
  assert.deepEqual(f.calls, []);
});

test("flow: a failed download shows details, waits, then opens the app", async () => {
  const f = flowDeps({ download: async () => { throw new Error("download stopped at 0.4 of 1.0 MB"); } });
  assert.equal(await runStartupFlow(f.deps), "open");
  assert.deepEqual(f.kinds(), ["checking", "downloading", "failed", "opening"]);
  const failed = f.shown[2];
  assert.equal(failed.details, `download: download stopped at 0.4 of 1.0 MB\n${UPDATE.fileName}`);
  assert.deepEqual(f.calls, [["wait", FAILED_NOTICE_MS]]);
});

test("flow: 'Try again' downloads again; 'Open Zrzur' opens at once", async () => {
  let tries = 0;
  const choices = ["retry", "retry"];
  const f = flowDeps({
    download: async () => {
      if (++tries < 3) throw new Error("reset");
      return "dir";
    },
    waitForChoice: async () => choices.shift(),
  });
  assert.equal(await runStartupFlow(f.deps), "restart");
  assert.equal(tries, 3);
  assert.deepEqual(f.kinds(), [
    "checking", "downloading", "failed", "downloading", "failed", "downloading", "installing",
  ]);

  const g = flowDeps({ download: async () => { throw new Error("reset"); }, waitForChoice: async () => "open" });
  assert.equal(await runStartupFlow(g.deps), "open");
  assert.equal(g.kinds().at(-1), "opening");
});

test("flow: an installer error names the install step and the app still opens", async () => {
  const f = flowDeps({ install: async () => { throw new Error("Update.exe exited with 1"); } });
  assert.equal(await runStartupFlow(f.deps), "open");
  assert.deepEqual(f.kinds().slice(-3), ["installing", "failed", "opening"]);
  assert.match(f.shown.at(-2).details, /^install: Update\.exe exited with 1\n/);
});

// ------------------------------------------------------------------- words

test("language: the device's, English when it is not one of the seven", () => {
  // the seven the app itself is complete in
  assert.deepEqual([...SHELL_LOCALES], ["en", "ar", "de", "fr", "es", "ru", "zh-Hans"]);
  assert.equal(shellLocale("fr-CA"), "fr");
  assert.equal(shellLocale("es-419"), "es");
  assert.equal(shellLocale("ru"), "ru");
  assert.equal(shellLocale("ja-JP"), "en");
  assert.equal(shellLocale("tr-TR"), "en");
  // a Chinese device reports a region or the bare language, never the script
  for (const tag of ["zh", "zh-CN", "zh_CN", "zh-SG", "zh-Hans", "zh-Hans-CN", "ZH-cn"])
    assert.equal(shellLocale(tag), "zh-Hans", tag);
  // Traditional Chinese is not translated: English, not Simplified
  for (const tag of ["zh-TW", "zh-HK", "zh-Hant", "zh-Hant-TW", "zh-MO"])
    assert.equal(shellLocale(tag), "en", tag);
  // the language chosen in the app is stored under the catalog's own name
  for (const locale of SHELL_LOCALES) assert.equal(shellLocale(locale), locale);
  assert.equal(shellLocale("ar-SY"), "ar");
  assert.equal(shellLocale("ar"), "ar");
  assert.equal(shellLocale("de-AT"), "de");
  assert.equal(shellLocale("de_DE"), "de");
  assert.equal(shellLocale("en-GB"), "en");
  assert.equal(shellLocale(""), "en");
  assert.equal(shellLocale(undefined), "en");
});

test("versions are written the product's way", () => {
  assert.equal(displayVersion("26.1.0-beta.2"), "26.1.0 Beta 2");
  assert.equal(displayVersion("26.1.0-beta3"), "26.1.0 Beta 3");
  assert.equal(displayVersion("26.2.0"), "26.2.0");
  assert.equal(displayVersion("dev"), "dev");
});

test("percentage is the bytes received, and 100 only when all are there", () => {
  assert.equal(percent(0, 1000), 0);
  assert.equal(percent(1, 1000), 0);
  assert.equal(percent(420, 1000), 42);
  assert.equal(percent(999, 1000), 99);
  assert.equal(percent(9_999_999, 10_000_000), 99);
  assert.equal(percent(1000, 1000), 100);
  assert.equal(percent(5, 0), 0);
});

const STATES = [
  { kind: "checking" },
  { kind: "downloading", version: "26.2.0", received: 18_400_000, total: 43_900_000 },
  { kind: "installing", version: "26.2.0" },
  { kind: "opening" },
  { kind: "offline" },
  { kind: "failed", details: "download: reset\nfile.nupkg" },
];

test("every state has its words in all seven languages", () => {
  const titles = Object.fromEntries(SHELL_LOCALES.map((l) => [l, new Set()]));
  for (const locale of SHELL_LOCALES) {
    for (const state of STATES) {
      const view = startupView(state, locale, "26.1.0-beta.2");
      assert.ok(view.title.length > 3, `${locale} ${state.kind} has a title`);
      assert.equal(view.dir, locale === "ar" ? "rtl" : "ltr");
      assert.equal(view.version, "26.1.0 Beta 2");
      assert.doesNotMatch(view.title + view.sub, /\{[a-z]\}/, "no unfilled placeholder");
      titles[locale].add(view.title);
      // the logo moves only while something is really running
      assert.equal(view.moving, !["offline", "failed"].includes(state.kind));
    }
    assert.equal(titles[locale].size, STATES.length, `${locale}: one title per state`);
  }
  // every language is translated, not English left in place
  for (const state of STATES) {
    const all = SHELL_LOCALES.map((l) => startupView(state, l, "26.1.0").title);
    assert.equal(new Set(all).size, SHELL_LOCALES.length, `${state.kind}: seven different titles`);
    assert.match(startupView(state, "ar", "26.1.0").title, /[\u0600-\u06FF]/);
    assert.match(startupView(state, "ru", "26.1.0").title, /[\u0400-\u04FF]/);
  }
  assert.equal(startupView(STATES[0], "ar", "26.1.0").name, "زرزور");
});

test("the download line carries megabytes and the true percentage", () => {
  const en = startupView(STATES[1], "en", "26.1.0").progress;
  assert.deepEqual(en, { percent: 41, label: "41%", bytes: "18.4 of 43.9 MB" });
  const bytes = (l) => startupView(STATES[1], l, "26.1.0").progress.bytes;
  assert.equal(bytes("fr"), "18,4 sur 43,9 Mo");
  assert.equal(bytes("es"), "18,4 de 43,9 MB");
  assert.equal(bytes("zh-Hans"), "18.4 / 43.9 MB");
  assert.equal(bytes("ru"), "18,4 из 43,9 МБ");
  // the percentage the way each language writes it; Western digits everywhere
  assert.equal(percentLabel(45, "en"), "45%");
  assert.equal(percentLabel(45, "ar"), "45%");
  assert.equal(percentLabel(45, "zh-Hans"), "45%");
  for (const l of ["de", "fr", "es", "ru"]) assert.match(percentLabel(45, l), /^45\s?%$/);
  assert.equal(startupView(STATES[1], "de", "26.1.0").progress.bytes, "18,4 von 43,9 MB");
  assert.equal(startupView(STATES[1], "ar", "26.1.0").progress.bytes, "18.4 من 43.9 ميغابايت");
  assert.equal(startupView(STATES[1], "en", "26.1.0").sub, "Version 26.2.0");
  // no bar where nothing is measured
  for (const state of [STATES[0], STATES[2], STATES[3], STATES[4], STATES[5]])
    assert.equal(startupView(state, "en", "26.1.0").progress, undefined);
});

test("the failed state offers both ways on and keeps the technical text apart", () => {
  const view = startupView(STATES[5], "de", "26.1.0");
  assert.deepEqual(view.failed, {
    open: "Zrzur öffnen",
    retry: "Erneut versuchen",
    details: "Details",
    text: "download: reset\nfile.nupkg",
  });
  assert.equal(view.tone, "error");
  assert.doesNotMatch(view.title + view.sub, /reset|nupkg/);
  assert.equal(startupView(STATES[4], "en", "26.1.0").tone, "warn");
});

test("no language lacks a text, an empty one, or a placeholder", () => {
  const keys = Object.keys(STRINGS.en).sort();
  assert.ok(keys.length >= 30);
  assert.deepEqual(Object.keys(STRINGS).sort(), [...SHELL_LOCALES].sort());
  for (const locale of SHELL_LOCALES) {
    assert.deepEqual(Object.keys(STRINGS[locale]).sort(), keys, `${locale}: same texts as English`);
    for (const key of keys) {
      const text = STRINGS[locale][key];
      assert.ok(typeof text === "string" && text.trim().length > 0, `${locale}.${key} is empty`);
      assert.equal(text, text.trim(), `${locale}.${key} has stray spaces`);
      assert.deepEqual(
        (text.match(/\{[a-z]\}/g) ?? []).sort(),
        (STRINGS.en[key].match(/\{[a-z]\}/g) ?? []).sort(),
        `${locale}.${key}: same placeholders as English`,
      );
      // nothing left in English by mistake (names and "Version"/"Details" cognates aside)
      if (locale !== "en" && !["name", "trayTitle"].includes(key) && !(locale === "de" && ["version", "details", "trayVersion"].includes(key)) && !(locale === "fr" && ["version", "trayVersion"].includes(key)))
        assert.notEqual(text, STRINGS.en[key], `${locale}.${key} is still English`);
    }
    // the product is never called by a retired or upstream name
    assert.doesNotMatch(Object.values(STRINGS[locale]).join(" "), /Zarzour|Stoat|Revolt|Discord/i);
  }
  // each script is really there
  assert.match(STRINGS.ar.checking, /[\u0600-\u06FF]/);
  assert.match(STRINGS.ru.checking, /[\u0400-\u04FF]/);
  assert.match(STRINGS["zh-Hans"].checking, /[\u4E00-\u9FFF]/);
  // words the web client also has are the web client's own
  assert.deepEqual(SHELL_LOCALES.map((l) => STRINGS[l].retry), ["Try again", "إعادة المحاولة", "Erneut versuchen", "Réessayer", "Reintentar", "Повторить", "重试"]);
  assert.deepEqual(SHELL_LOCALES.map((l) => STRINGS[l].details), ["Details", "التفاصيل", "Details", "Détails", "Detalles", "Подробности", "详情"]);
  assert.deepEqual(SHELL_LOCALES.map((l) => STRINGS[l].close), ["Close", "إغلاق", "Schließen", "Fermer", "Cerrar", "Закрыть", "关闭"]);
  assert.deepEqual(SHELL_LOCALES.map((l) => STRINGS[l].minimise), ["Minimise", "تصغير", "Minimieren", "Réduire", "Minimizar", "Свернуть", "最小化"]);
  assert.deepEqual(SHELL_LOCALES.map((l) => STRINGS[l].traySource), ["Source code", "الشيفرة المصدرية", "Quellcode", "Code source", "Código fuente", "Исходный код", "源代码"]);
});

test("tray and unreachable-page words exist in all seven languages", () => {
  for (const key of [
    "trayAbout", "traySource", "trayShow", "trayHide", "trayQuit", "addToDictionary",
    "unreachable", "unreachableSub", "noNetwork", "noNetworkSub", "retryNow", "minimise", "close",
  ]) {
    const values = SHELL_LOCALES.map((locale) => shellString(locale, key));
    assert.equal(new Set(values).size, SHELL_LOCALES.length, `${key} differs per language`);
    for (const value of values) assert.ok(value.length > 1);
  }
  // a site that is down is never described as an error code or an address
  for (const locale of SHELL_LOCALES)
    assert.doesNotMatch(shellString(locale, "unreachable") + shellString(locale, "unreachableSub"), /\d|https?:|ERR/);
});

test("retries while unreachable start quick and settle at 30 s", () => {
  const delays = Array.from({ length: 12 }, (_, i) => nextRetryDelay(i));
  assert.equal(delays[0], 2000);
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] >= delays[i - 1]);
  assert.equal(delays.at(-1), 30_000);
  assert.equal(nextRetryDelay(1e9), 30_000);
  assert.equal(nextRetryDelay(-3), 2000);
  // an hour of outage costs about 120 small requests, not thousands
  let t = 0, n = 0;
  while (t < 3_600_000) t += nextRetryDelay(n++);
  assert.ok(n < 130, String(n));
});
