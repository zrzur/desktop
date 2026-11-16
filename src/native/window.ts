import { join } from "node:path";

import {
  BrowserWindow,
  Menu,
  MenuItem,
  app,
  desktopCapturer,
  ipcMain,
  nativeImage,
  session,
} from "electron";

import windowIconAsset from "../../assets/desktop/icon.png?asset";

import { resolveApplicationUrl } from "./applicationUrl";
import { config } from "./config";
import { answerOnce, displayStreams } from "./displayMedia";
import { shellLanguage } from "./locale";
import { THUMBNAIL_SIZE, describeSources } from "./screenSources";
import { shellString } from "./startup/startupStrings";
import { updateTrayMenu } from "./tray";
import { installUnreachablePage } from "./unreachable";

// global reference to main window
export let mainWindow: BrowserWindow;

// currently in-use build — fail closed: never default to Stoat/Revolt production
declare const __ZRZUR_APP_URL__: string;
export const BUILD_URL = new URL(
  resolveApplicationUrl({
    packaged: app.isPackaged,
    commandLine: app.commandLine.getSwitchValue("force-server"),
    environment: process.env.ZRZUR_DESKTOP_URL,
    bundled: typeof __ZRZUR_APP_URL__ === "string" ? __ZRZUR_APP_URL__ : "",
  }),
);

/** The app page at an app path (from a zrzur:// link), else its start page */
export function appPageUrl(path?: string) {
  return path ? new URL(path, BUILD_URL).toString() : BUILD_URL.toString();
}

// internal window state
let shouldQuit = false;
// the window has been put on screen (or was asked to start hidden)
let revealed = false;
// the page has painted, failed to load, or took too long: nothing to wait for
let pageReady = false;
let whenPageReady: (() => void) | undefined;

function markPageReady() {
  if (pageReady) return;
  pageReady = true;
  whenPageReady?.();
  whenPageReady = undefined;
}

/** False while the start-up window is still in front of a hidden main window */
export function mainWindowRevealed() {
  return revealed;
}

// load the window icon
const windowIcon = nativeImage.createFromDataURL(windowIconAsset);

// windowIcon.setTemplateImage(true);

/**
 * Create the main application window
 */
/** Started with --hidden or "start minimised to tray": no window at start */
export function startsHidden() {
  return app.commandLine.hasSwitch("hidden") || config.startMinimisedToTray;
}

/**
 * Create the main application window. It is never shown empty: it stays
 * hidden until `revealMainWindow`, which waits for the page's first paint.
 * With `load: false` the page is loaded later by `loadMainWindow` (the
 * start-up window first finds out whether an update replaces this version).
 */
export function createMainWindow(
  startPath?: string,
  options: { load?: boolean } = {},
) {
  const startHidden = startsHidden();
  revealed = startHidden;
  pageReady = false;
  const isMacOS = process.platform === "darwin";

  // create the window
  mainWindow = new BrowserWindow({
    minWidth: 300,
    minHeight: 300,
    width: 1280,
    height: 720,
    // the app's own ground (--surface-frame), so no other colour flashes
    backgroundColor: "#0D0E16",
    frame: isMacOS ? true : !config.customFrame,
    titleBarStyle: isMacOS ? "hidden" : "default",
    trafficLightPosition: isMacOS ? { x: 8, y: 8 } : undefined,
    icon: windowIcon,
    show: false,
    webPreferences: {
      // relative to `.vite/build`
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // explicit, so a future default change can't weaken them
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
    },
  });

  // hide the options
  mainWindow.setMenu(null);

  // restore last position if it was moved previously
  if (config.windowState.x > 0 || config.windowState.y > 0) {
    mainWindow.setPosition(
      config.windowState.x ?? 0,
      config.windowState.y ?? 0,
    );
  }

  // restore last size if it was resized previously
  if (config.windowState.width > 0 && config.windowState.height > 0) {
    mainWindow.setSize(
      config.windowState.width ?? 1280,
      config.windowState.height ?? 720,
    );
  }

  // first paint is ready
  mainWindow.once("ready-to-show", markPageReady);
  // The address does not load (no network, site down, gateway error): the
  // window shows Zrzur's own page, keeps trying and opens the app by itself.
  // Never a browser error, never an empty window.
  installUnreachablePage(mainWindow, BUILD_URL, {
    controls: !isMacOS && config.customFrame,
    ready: markPageReady,
  });

  // load the entrypoint
  if (options.load !== false) loadMainWindow(startPath);

  // minimise window to tray
  mainWindow.on("close", (event) => {
    if (!shouldQuit && config.minimiseToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // update tray menu when window is shown/hidden
  mainWindow.on("show", updateTrayMenu);
  mainWindow.on("hide", updateTrayMenu);

  // keep track of window state
  function generateState() {
    config.windowState = {
      x: mainWindow.getPosition()[0],
      y: mainWindow.getPosition()[1],
      width: mainWindow.getSize()[0],
      height: mainWindow.getSize()[1],
      isMaximised: mainWindow.isMaximized(),
    };
  }

  mainWindow.on("maximize", generateState);
  mainWindow.on("unmaximize", generateState);
  mainWindow.on("moved", generateState);
  mainWindow.on("resized", generateState);

  // rebind zoom controls to be more sensible
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.control && (input.key === "=" || input.key === "+")) {
      // zoom in (+)
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(
        mainWindow.webContents.getZoomLevel() + 1,
      );
    } else if (input.control && input.key === "-") {
      // zoom out (-)
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(
        mainWindow.webContents.getZoomLevel() - 1,
      );
    } else if (input.control && input.key === "0") {
      // reset zoom to default.
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(0);
    } else if (
      input.key === "F5" ||
      ((input.control || input.meta) && input.key.toLowerCase() === "r")
    ) {
      event.preventDefault();
      mainWindow.webContents.reload();
    }
  });

  // send the config (the preload also reads it once, synchronously, before
  // the page's first script: see world/config.ts)
  mainWindow.webContents.on("did-finish-load", () => config.sync());

  // Only show native spelling suggestions for an actual misspelling in an
  // editable field. Other clicks belong to the web client's own context menus.
  mainWindow.webContents.on("context-menu", (_, params) => {
    if (!params.isEditable || !config.spellchecker || !params.misspelledWord) {
      return;
    }
    const menu = new Menu();

    // add all suggestions
    for (const suggestion of params.dictionarySuggestions) {
      menu.append(
        new MenuItem({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion),
        }),
      );
    }

    // allow users to add the misspelled word to the dictionary
    if (params.misspelledWord) {
      menu.append(
        new MenuItem({
          label: shellString(shellLanguage(), "addToDictionary"),
          click: () =>
            mainWindow.webContents.session.addWordToSpellCheckerDictionary(
              params.misspelledWord,
            ),
        }),
      );
    }

    // show menu if we've generated enough entries
    if (menu.items.length > 0) {
      menu.popup();
    }
  });

  // Create display media request handler
  let pendingPick: ((idx: number, audio: boolean) => void) | undefined;
  ipcMain.on("screenPickerCallback", (event, idx: unknown, audio: unknown) => {
    // only the app window may answer the picker
    if (event.sender !== mainWindow.webContents) return;
    const pick = pendingPick;
    pendingPick = undefined;
    pick?.(typeof idx === "number" ? idx : -1, audio === true);
  });

  session.defaultSession.setDisplayMediaRequestHandler(
    (request, electronCallback) => {
      // answered once; a refusal is null (an empty object throws in the
      // main process: see displayMedia.ts)
      const callback = answerOnce(electronCallback, (error) =>
        console.error("[screen share] answer failed", error),
      );
      // Screen capture is only for the app itself, never for another origin
      // that ends up in a frame (embeds, links that slipped through)
      let origin: string | undefined;
      try {
        origin = request.frame ? new URL(request.frame.url).origin : undefined;
      } catch {
        origin = undefined;
      }
      if (origin !== BUILD_URL.origin) {
        callback(null);
        return;
      }

      // a new request replaces one whose picker was never answered
      pendingPick?.(-1, false);
      pendingPick = undefined;

      desktopCapturer
        .getSources({
          types: ["screen", "window"],
          fetchWindowIcons: true,
          // a small picture of each screen and window for the picker
          thumbnailSize: THUMBNAIL_SIZE,
        })
        .then((sources) => {
          // Shortcut for linux wayland.
          if (sources.length == 1) {
            callback(displayStreams(sources, 0, true, request.audioRequested));
            return;
          }
          pendingPick = (idx, audio) =>
            callback(
              displayStreams(sources, idx, audio, request.audioRequested),
            );
          // previews and icons; a window whose icon or picture the
          // system could not read is still listed, with a plain symbol
          mainWindow.webContents.send("screenPicker", describeSources(sources));
        })
        .catch(() => {
          pendingPick = undefined;
          callback(null);
        });
    },
    { useSystemPicker: true },
  );

  // push world events to the window
  ipcMain.on("minimise", () => mainWindow.minimize());
  ipcMain.on("maximise", () =>
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(),
  );
  ipcMain.on("close", () => mainWindow.close());
  // a call rings: the taskbar button flashes until the window is used (or
  // the ringing stops); a focused window does not flash
  ipcMain.on("callAttention", (event, on: unknown) => {
    if (event.sender !== mainWindow.webContents) return;
    mainWindow.flashFrame(on === true && !mainWindow.isFocused());
  });
  // settings that need a restart offer one (Desktop settings page)
  ipcMain.on("relaunch", (event) => {
    if (event.sender !== mainWindow.webContents) return;
    app.relaunch();
    quitApp();
  });

  // mainWindow.webContents.openDevTools();

  // let i = 0;
  // setInterval(() => setBadgeCount((++i % 30) + 1), 1000);
}

/** Loads the app page into the main window (once) */
export function loadMainWindow(startPath?: string) {
  // never wait longer than this for a first paint
  setTimeout(markPageReady, 10_000);
  mainWindow.loadURL(appPageUrl(startPath)).catch(() => markPageReady());
}

/**
 * Puts the main window on screen as soon as its page has painted, then calls
 * `shown`. A start that asked for a hidden window stays hidden.
 */
export function revealMainWindow(shown?: () => void) {
  const reveal = () => {
    if (mainWindow.isDestroyed()) return;
    if (!revealed) {
      revealed = true;
      // maximise the window if it was maximised before (this also shows it)
      if (config.windowState.isMaximised) mainWindow.maximize();
      mainWindow.show();
      mainWindow.focus();
    }
    shown?.();
  };
  if (pageReady) reveal();
  else whenPageReady = reveal;
}

/**
 * Quit the entire app
 */
export function quitApp() {
  shouldQuit = true;
  mainWindow.close();
}

// Ensure global app quit works properly
app.on("before-quit", () => {
  shouldQuit = true;
});
