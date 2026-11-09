import { app, globalShortcut, ipcMain } from "electron";

import { createPushToTalkController } from "./pushToTalkKeys";
import { mainWindow } from "./window";

/**
 * Talk from other apps (toggle; see pushToTalkKeys.ts). The app window asks
 * for the combination while it is in a push-to-talk call and the person
 * turned "Talk from other apps" on.
 */
export function initPushToTalk() {
  const controller = createPushToTalkController(globalShortcut, () =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : undefined,
  );

  ipcMain.handle("pushToTalkSet", (event, code: unknown) =>
    controller.set(event, code),
  );
  ipcMain.on("pushToTalkClear", (event) => controller.clear(event));

  // the window that exists now, and every window created later (the main
  // window is created again on macOS after it was closed)
  if (mainWindow && !mainWindow.isDestroyed())
    controller.watch(mainWindow.webContents);
  app.on("browser-window-created", (_event, window) =>
    controller.watch(window.webContents),
  );

  app.on("will-quit", () => controller.reset());
}
