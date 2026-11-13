import fs from "node:fs";
import path from "node:path";
import { UpdateSourceType, updateElectronApp } from "update-electron-app";

import { BrowserWindow, Notification, app, shell } from "electron";
import started from "electron-squirrel-startup";

import { initAutoLaunch } from "./native/autoLaunch";
import { aboutPanelOptions } from "./native/buildInfo";
import { config } from "./native/config";
import {
  appPathFromLink,
  linkFromArgs,
  linkProtocolFor,
} from "./native/deepLink";
import { initDiscordRpc } from "./native/discordRpc";
import { installFrameGuard } from "./native/frameGuard";
import { initGlobalKeys } from "./native/globalKeys";
import { initPushToTalk } from "./native/pushToTalk";
import { initTray } from "./native/tray";
import { resolveUpdateFeedUrl } from "./native/updateFeed";
import { initVirtualMic } from "./native/virtualMic";
import {
  BUILD_URL,
  appPageUrl,
  createMainWindow,
  mainWindow,
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
  if (!mainWindow) {
    pendingPath = target;
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
  // Auto-update stays off unless ZRZUR_ENABLE_UPDATES=1 and a Zrzur HTTPS
  // static feed is set. Never use GitHub / update.electronjs.org defaults.
  const updateFeed = resolveUpdateFeedUrl(
    process.env.ZRZUR_ENABLE_UPDATES,
    process.env.ZRZUR_UPDATE_FEED_URL,
  );
  if (updateFeed) {
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.StaticStorage,
        baseUrl: updateFeed,
      },
      onNotifyUser: () => {
        new Notification({
          title: "Update Available",
          body: "Restart the app to install the update.",
          silent: true,
        }).show();
      },
    });
  }

  // create and configure the app when electron is ready
  app.on("ready", () => {
    // About panel links to the source of this exact build
    app.setAboutPanelOptions(aboutPanelOptions());
    // device permissions for the app origin only (never plugin frames)
    installFrameGuard();

    // create window and application contexts
    createMainWindow(pendingPath);
    pendingPath = undefined;

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

    // Windows specific fix for notifications
    if (process.platform === "win32") {
      app.setAppUserModelId("cc.zrzur.ZrzurDesktop");
    }
  });

  // focus the window if we try to launch again
  app.on("second-instance", (_event, argv) => {
    mainWindow.show();
    mainWindow.restore();
    mainWindow.focus();
    // Windows and Linux start a second copy with the link as an argument
    openLink(linkFromArgs(argv, LINK_SCHEME));
  });

  // macOS specific behaviour to keep app active in dock:
  // (irrespective of the minimise-to-tray option)

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // ensure URLs launch in external context
  app.on("web-contents-created", (_, contents) => {
    // prevent navigation out of build URL origin
    contents.on("will-navigate", (event, navigationUrl) => {
      if (new URL(navigationUrl).origin !== BUILD_URL.origin) {
        event.preventDefault();
      }
    });

    // a server-side redirect must not move the app window to another site
    contents.on("will-redirect", (details) => {
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
