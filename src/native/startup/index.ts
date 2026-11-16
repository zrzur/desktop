/**
 * The start-up window: a small window shown the moment the app starts. It
 * says in words what is happening (checking for an update, downloading it
 * with its real progress, installing, no connection, update failed) and
 * closes when the main window has something to show.
 *
 * Updates run only when a feed is set (native/updateFeed.ts; none is built
 * in) and only on Windows, where the app is installed by Squirrel. The
 * package is downloaded here, so the progress is real and the file is
 * verified, and Squirrel then installs it from the local folder.
 */
import fs from "node:fs";
import path from "node:path";

import { BrowserWindow, app, autoUpdater, ipcMain, net } from "electron";

import { shellLanguage } from "../locale";
import { resolveUpdateFeedUrl } from "../updateFeed";

import {
  STARTUP_GROUND,
  STARTUP_HEIGHT,
  STARTUP_WIDTH,
  startupPage,
} from "./page";
import {
  type FailedChoice,
  type StartupState,
  runStartupFlow,
} from "./startupFlow";
import { startupView } from "./startupStrings";
import { type UpdatePackage, pickUpdate, releasesLine } from "./updateCheck";
import { describeError, downloadPackage } from "./updateDownload";

/** The Squirrel package id (package.json "name" with "-" as "_") */
const PACKAGE_ID = "zrzur_desktop";
const CHECK_TIMEOUT_MS = 4000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const MAX_HEIGHT = 640;

let startupWindow: BrowserWindow | null = null;
let running = false;
let lastState: StartupState = { kind: "opening" };
let choose: ((choice: FailedChoice) => void) | undefined;
let detailsOpen = false;
let onDetails: (() => void) | undefined;

const view = (state: StartupState) =>
  startupView(state, shellLanguage(), app.getVersion());

/** The feed for this run, or null: off unless switched on, Windows only */
function updateFeed(): string | null {
  if (process.platform !== "win32") return null;
  return resolveUpdateFeedUrl(
    process.env.ZRZUR_ENABLE_UPDATES,
    process.env.ZRZUR_UPDATE_FEED_URL,
    // a source run may use a local test feed over HTTP; an installed app never
    { allowLoopbackHttp: !app.isPackaged },
  );
}

/** True from the moment the window opens until the main window takes over */
export function startupRunning() {
  return running;
}

/** Brings the start-up window forward; false when there is none */
export function focusStartupWindow(): boolean {
  if (!startupWindow || startupWindow.isDestroyed()) return false;
  startupWindow.show();
  startupWindow.focus();
  return true;
}

function show(state: StartupState) {
  lastState = state;
  if (!startupWindow || startupWindow.isDestroyed()) return;
  startupWindow.webContents.send("startup:view", view(state));
}

ipcMain.on("startup:choice", (event, choice: unknown) => {
  if (event.sender !== startupWindow?.webContents) return;
  choose?.(choice === "retry" ? "retry" : "open");
});
ipcMain.on("startup:details", (event, open: unknown) => {
  if (event.sender !== startupWindow?.webContents) return;
  detailsOpen = open === true;
  onDetails?.();
});
ipcMain.on("startup:height", (event, height: unknown) => {
  if (event.sender !== startupWindow?.webContents || !startupWindow) return;
  const wanted = Math.round(Number(height));
  if (!Number.isFinite(wanted)) return;
  const next = Math.min(MAX_HEIGHT, Math.max(STARTUP_HEIGHT, wanted));
  if (startupWindow.getContentSize()[1] !== next)
    startupWindow.setContentSize(STARTUP_WIDTH, next);
});

/**
 * The person's choice in the failed state. The app opens by itself after
 * `timeoutMs`; the countdown stops while "Details" is open and starts again
 * when it is closed.
 */
function waitForChoice(timeoutMs: number): Promise<FailedChoice> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (choice: FailedChoice) => {
      clearTimeout(timer);
      choose = undefined;
      onDetails = undefined;
      resolve(choice);
    };
    const arm = () => {
      clearTimeout(timer);
      if (!detailsOpen) timer = setTimeout(() => finish("timeout"), timeoutMs);
    };
    choose = finish;
    onDetails = arm;
    detailsOpen = false;
    arm();
  });
}

async function fetchReleases(feedUrl: string): Promise<string> {
  const response = await net.fetch(`${feedUrl}RELEASES`, {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`the update list answered ${response.status}`);
  // The list names a file, a size and a hash; the file is always fetched
  // from the feed folder itself and must match, wherever the list came from
  return response.text();
}

function updateFolder(version: string) {
  return path.join(
    app.getPath("temp"),
    "zrzur-update",
    version.replace(/[^0-9A-Za-z.-]/g, "_"),
  );
}

async function download(
  feedUrl: string,
  update: UpdatePackage,
  onProgress: (received: number, total: number) => void,
): Promise<string> {
  const folder = updateFolder(update.version);
  // at most one repaint every 50 ms, and always the last byte count
  let last = 0;
  await downloadPackage({
    url: `${feedUrl}${update.fileName}`,
    file: path.join(folder, update.fileName),
    size: update.size,
    sha1: update.sha1,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      net.fetch(String(input), init)) as typeof fetch,
    onProgress: (received, total) => {
      const now = Date.now();
      if (received < total && now - last < 50) return;
      last = now;
      onProgress(received, total);
    },
  });
  // Squirrel installs from a folder that holds the package and its list
  fs.writeFileSync(path.join(folder, "RELEASES"), releasesLine(update));
  return folder;
}

/** Installs the verified package with the installed app's own Squirrel */
function installWithSquirrel(folder: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error("the installer did not finish in five minutes")),
      INSTALL_TIMEOUT_MS,
    );
    const ok = () => finish();
    const failed = (error: Error) => finish(error);
    const nothing = () =>
      finish(new Error("the installer found nothing to install"));
    function finish(error?: Error) {
      clearTimeout(timer);
      autoUpdater.removeListener("update-downloaded", ok);
      autoUpdater.removeListener("error", failed);
      autoUpdater.removeListener("update-not-available", nothing);
      if (error) reject(error);
      else resolve();
    }
    autoUpdater.once("update-downloaded", ok);
    autoUpdater.once("error", failed);
    autoUpdater.once("update-not-available", nothing);
    try {
      autoUpdater.setFeedURL({ url: folder });
      autoUpdater.checkForUpdates();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * A source run has no installer. For the window's own tests it can stand in:
 * ZRZUR_STARTUP_TEST_INSTALL=ok (finishes after a moment) or =fail. Read
 * only when the app is not packaged.
 */
function installForSourceRun(): Promise<void> {
  const mode = process.env.ZRZUR_STARTUP_TEST_INSTALL;
  const wait = Number(process.env.ZRZUR_STARTUP_TEST_INSTALL_MS) || 1500;
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      if (mode === "ok") resolve();
      else if (mode === "fail")
        reject(new Error("Update.exe exited with code 1 (test)"));
      else
        reject(
          new Error("this copy was not installed, so it cannot update itself"),
        );
    }, wait),
  );
}

function removeOldDownloads() {
  fs.rm(
    path.join(app.getPath("temp"), "zrzur-update"),
    { recursive: true, force: true },
    () => undefined,
  );
}

/** Opens the window at once; its first state is already in the page */
export function openStartupWindow() {
  running = true;
  const feed = updateFeed();
  lastState = feed ? { kind: "checking" } : { kind: "opening" };
  startupWindow = new BrowserWindow({
    width: STARTUP_WIDTH,
    height: STARTUP_HEIGHT,
    useContentSize: true,
    center: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    // the page's ground: the window is this colour before its first paint
    backgroundColor: STARTUP_GROUND,
    title: "Zrzur",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "startupPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  startupWindow.setMenu(null);
  const page = startupWindow;
  // the page never navigates: it has no links and loads nothing
  page.webContents.on("will-navigate", (event) => event.preventDefault());
  page.webContents.on("did-finish-load", () => show(lastState));
  page.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(startupPage(view(lastState)))}`,
  );
  // closing this window before the app is open means "do not start"
  page.on("closed", () => {
    if (startupWindow === page) startupWindow = null;
    if (running) app.quit();
  });
  return feed;
}

/**
 * Runs the check and, if there is one, the update. "open": show the app.
 * "restart": the new version is installed; quit and start it.
 */
export function runStartup(
  feedUrl: string | null,
): Promise<"open" | "restart"> {
  return runStartupFlow({
    feedUrl,
    fetchReleases,
    pick: (text) => {
      const update = pickUpdate(text, app.getVersion(), PACKAGE_ID);
      if (!update) removeOldDownloads();
      return update;
    },
    // (a source run can pretend the system is offline, for the window's tests)
    isOnline: () =>
      net.isOnline() &&
      !(!app.isPackaged && process.env.ZRZUR_STARTUP_TEST_OFFLINE === "1"),
    download,
    install: (folder) =>
      app.isPackaged ? installWithSquirrel(folder) : installForSourceRun(),
    show,
    waitForChoice,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    describe: describeError,
    log: (message) => console.info(`[startup] ${message}`),
  });
}

/** The main window is on screen: the start-up window has done its job */
export function closeStartupWindow() {
  running = false;
  const page = startupWindow;
  startupWindow = null;
  if (page && !page.isDestroyed()) page.destroy();
}

/** Quits into the installed new version (an installed app only) */
export function restartIntoUpdate() {
  running = false;
  autoUpdater.quitAndInstall();
}
