import fs from "node:fs";
import path from "node:path";

import { BrowserWindow, app, shell } from "electron";
import started from "electron-squirrel-startup";

import { initAutoLaunch } from "./native/autoLaunch";
import { aboutPanelOptions } from "./native/buildInfo";
import { config } from "./native/config";
import {
  appPathFromLink,
  linkFromArgs,
  linkProtocolFor,
} from "./native/deepLink";
import { initActivity } from "./native/activity";
import { initDiscordRpc } from "./native/discordRpc";
import { installFrameGuard } from "./native/frameGuard";
import { initGlobalKeys } from "./native/globalKeys";
import { initPushToTalk } from "./native/pushToTalk";
import {
  isSignInStart,
  openSignInWindow,
  signInContents,
} from "./native/signIn";
import {
  closeStartupWindow,
  focusStartupWindow,
  openStartupWindow,
  restartIntoUpdate,
  runStartup,
  startupRunning,
} from "./native/startup";
import { initTray } from "./native/tray";
import { initVirtualMic } from "./native/virtualMic";
import {
  BUILD_URL,
  appPageUrl,
  createMainWindow,
  loadMainWindow,
  mainWindow,
  revealMainWindow,
  startsHidden,
} from "./native/window";

// In Flatpak, we have to update the temp dir to a shared directory across host and sandbox;
// otherwise, the icon will not show up in the tray when using app indicators.
if (process.platform === "linux" && process.env.FLATPAK_ID) {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir) {
    try {
      const sharedTmpDir = path.join(runtimeDir, "app", process.env.FLATPAK_ID);
      fs.mkdirSync(sharedTmpDir, { recursive: true });
      process.env.TMPDIR = sharedTmpDir;
    } catch (error) {
      console.error("Failed to set up host-visible TMPDIR:", error);
    }
  }
}

// Squirrel-specific logic
// create/remove shortcuts on Windows when installing / uninstalling
// we just need to close out of the app immediately
if (started) {
  app.quit();
}

// disable hw-accel if so requested
if (!config.hardwareAcceleration) {
  app.disableHardwareAcceleration();
}

// ensure only one copy of the application can run
const acquiredLock = app.requestSingleInstanceLock();

// zrzur:// links (zrzur-beta:// on beta builds) from the public sites (Discover, Designs) open this app on
// the server or design the person chose
const LINK_SCHEME = linkProtocolFor(BUILD_URL.toString());
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(LINK_SCHEME, process.execPath, [
    path.resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient(LINK_SCHEME);
}

/** A link that arrived before the window existed (macOS open-url) */
let pendingPath = appPathFromLink(
  linkFromArgs(process.argv, LINK_SCHEME) ?? "",
  LINK_SCHEME,
);

function openLink(link: string | undefined) {
  const target = link ? appPathFromLink(link, LINK_SCHEME) : undefined;
  if (!target) return;
  // before the app page is loaded (start-up window still up), the link is
  // kept and the app opens on it
  if (!mainWindow || startupRunning()) {
    pendingPath = target;
    focusStartupWindow();
    return;
  }
  mainWindow.loadURL(appPageUrl(target));
  mainWindow.show();
  mainWindow.restore();
  mainWindow.focus();
}

// macOS hands links over as an event, also before "ready"
app.on("open-url", (event, link) => {
  event.preventDefault();
  openLink(link);
});

if (acquiredLock) {
  // create and configure the app when electron is ready
  app.on("ready", () => {
    // About panel links to the source of this exact build
    app.setAboutPanelOptions(aboutPanelOptions());
    // device permissions for the app origin only (never plugin frames)
    installFrameGuard();

    // Auto-update stays off unless ZRZUR_ENABLE_UPDATES=1 and a Zrzur HTTPS
    // static feed is set (native/updateFeed.ts). Never GitHub or
    // update.electronjs.org defaults.
    if (startsHidden()) {
      // asked to start in the tray: no window of any kind, no update step
      createMainWindow(pendingPath);
      pendingPath = undefined;
    } else {
      // The start-up window is on screen first. The main window exists but
      // stays hidden; with no update step its page loads at once, otherwise
      // only after the check says this version stays.
      const feed = openStartupWindow();
      createMainWindow(undefined, { load: false });
      const openApp = () => {
        loadMainWindow(pendingPath);
        pendingPath = undefined;
        revealMainWindow(closeStartupWindow);
      };
      if (!feed) {
        openApp();
      } else {
        runStartup(feed)
          .then((outcome) => {
            // a source run has no installer to restart into
            if (outcome === "restart" && app.isPackaged) restartIntoUpdate();
            else openApp();
          })
          .catch((error) => {
            console.error("[startup]", error);
            openApp();
          });
      }
    }

    // save first launch state
    if (config.firstLaunch) {
      // Doesn't do anything right now. Used to enable auto start, but that behaviour was removed.
      // Left in case it gets used in the future.
      config.firstLaunch = false;
    }

    initTray();
    initDiscordRpc();
    initVirtualMic();
    initAutoLaunch();
    initPushToTalk();
    initGlobalKeys();
    initActivity();

    // Windows specific fix for notifications
    if (process.platform === "win32") {
      app.setAppUserModelId("cc.zrzur.ZrzurDesktop");
    }
  });

  // focus the window if we try to launch again
  app.on("second-instance", (_event, argv) => {
    // while the start-up window is up, it is the app's window
    if (!focusStartupWindow()) {
      mainWindow.show();
      mainWindow.restore();
      mainWindow.focus();
    }
    // Windows and Linux start a second copy with the link as an argument
    openLink(linkFromArgs(argv, LINK_SCHEME));
  });

  // macOS specific behaviour to keep app active in dock:
  // (irrespective of the minimise-to-tray option)

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !startupRunning()) {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else if (!focusStartupWindow()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // ensure URLs launch in external context
  app.on("web-contents-created", (_, contents) => {
    // a sign-in window has its own rules (native/signIn.ts)
    const isSignIn = () => signInContents.has(contents.id);

    // prevent navigation out of build URL origin; a service's sign-in page
    // (Settings → Connections) opens in its own window instead
    contents.on("will-navigate", (event, navigationUrl) => {
      if (isSignIn()) return;
      if (new URL(navigationUrl).origin !== BUILD_URL.origin) {
        event.preventDefault();
        if (isSignInStart(navigationUrl) && mainWindow) {
          openSignInWindow(navigationUrl, mainWindow, BUILD_URL.origin);
        }
      }
    });

    // a server-side redirect must not move the app window to another site
    contents.on("will-redirect", (details) => {
      if (isSignIn()) return;
      if (
        details.isMainFrame &&
        new URL(details.url).origin !== BUILD_URL.origin
      ) {
        details.preventDefault();
      }
    });

    // handle links externally
    contents.setWindowOpenHandler(({ url }) => {
      if (
        url.startsWith("http:") ||
        url.startsWith("https:") ||
        url.startsWith("mailto:")
      ) {
        setImmediate(() => {
          shell.openExternal(url);
        });
      }

      return { action: "deny" };
    });
  });
} else {
  app.quit();
}
