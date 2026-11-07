import { Menu, Tray, app, nativeImage, shell } from "electron";

import trayIconAsset from "../../assets/desktop/icon.png?asset";
import macOsTrayIconAsset from "../../assets/desktop/iconTemplate.png?asset";
import { version } from "../../package.json";

import { buildInfo } from "./buildInfo";
import { mainWindow, quitApp } from "./window";

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
  tray.setToolTip("Zrzur for Desktop");
  tray.setImage(trayIcon);
  tray.on("click", () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

export function updateTrayMenu() {
  // the window can show or hide before initTray has run
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Zrzur for Desktop", type: "normal", enabled: false },
      {
        label: "Version",
        type: "submenu",
        submenu: Menu.buildFromTemplate([
          {
            label: version,
            type: "normal",
            enabled: false,
          },
        ]),
      },
      {
        label: "About Zrzur",
        type: "normal",
        click() {
          app.showAboutPanel();
        },
      },
      {
        label: "Source code",
        type: "normal",
        click() {
          // the exact source of this build (tag or commit)
          shell.openExternal(buildInfo.sourceUrl);
        },
      },
      { type: "separator" },
      {
        label: mainWindow.isVisible() ? "Hide App" : "Show App",
        type: "normal",
        click() {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
          }
        },
      },
      {
        label: "Quit App",
        type: "normal",
        click: quitApp,
      },
    ]),
  );
}
