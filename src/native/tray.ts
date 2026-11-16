import { Menu, Tray, app, nativeImage, shell } from "electron";

import trayIconAsset from "../../assets/desktop/icon.png?asset";
import macOsTrayIconAsset from "../../assets/desktop/iconTemplate.png?asset";
import { version } from "../../package.json";

import { buildInfo } from "./buildInfo";
import { whenLanguageChanges } from "./config";
import { shellLanguage } from "./locale";
import { focusStartupWindow } from "./startup";
import {
  type ShellStringKey,
  displayVersion,
  shellString,
} from "./startup/startupStrings";
import { mainWindow, mainWindowRevealed, quitApp } from "./window";

/** Tray words in the shell's language (native/locale.ts) */
const t = (key: ShellStringKey) => shellString(shellLanguage(), key);

/** Show or hide the app window; while the start-up window is up, that one */
function toggleMainWindow() {
  if (!mainWindowRevealed() && focusStartupWindow()) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// internal tray state
let tray: Tray | null = null;

// Create and resize tray icon for macOS
function createTrayIcon() {
  if (process.platform === "darwin") {
    const image = nativeImage.createFromDataURL(macOsTrayIconAsset);
    const resized = image.resize({ width: 20, height: 20 });
    resized.setTemplateImage(true);
    return resized;
  } else {
    return nativeImage.createFromDataURL(trayIconAsset);
  }
}

export function initTray() {
  const trayIcon = createTrayIcon();
  tray = new Tray(trayIcon);
  updateTrayMenu();
  tray.setToolTip(t("trayTitle"));
  tray.setImage(trayIcon);
  whenLanguageChanges(() => {
    tray?.setToolTip(t("trayTitle"));
    updateTrayMenu();
  });
  tray.on("click", toggleMainWindow);
}

export function updateTrayMenu() {
  // the window can show or hide before initTray has run
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t("trayTitle"), type: "normal", enabled: false },
      {
        label: t("trayVersion"),
        type: "submenu",
        submenu: Menu.buildFromTemplate([
          {
            label: displayVersion(version),
            type: "normal",
            enabled: false,
          },
        ]),
      },
      {
        label: t("trayAbout"),
        type: "normal",
        click() {
          app.showAboutPanel();
        },
      },
      {
        label: t("traySource"),
        type: "normal",
        click() {
          // the exact source of this build (tag or commit)
          shell.openExternal(buildInfo.sourceUrl);
        },
      },
      { type: "separator" },
      {
        label: mainWindow.isVisible() ? t("trayHide") : t("trayShow"),
        type: "normal",
        click: toggleMainWindow,
      },
      {
        label: t("trayQuit"),
        type: "normal",
        click: quitApp,
      },
    ]),
  );
}
