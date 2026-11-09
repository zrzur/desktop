import { app, globalShortcut, ipcMain } from "electron";

import { createPushToTalkController } from "./pushToTalkKeys";
import { mainWindow } from "./window";

/**
 * Push to talk from other apps (toggle; see pushToTalkKeys.ts). The app
 * window asks for the combination while it is in a push-to-talk call.
 */
export function initPushToTalk() {
  const controller = createPushToTalkController(globalShortcut, () =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : undefined,
  );

  ipcMain.handle("pushToTalkSet", (event, code: unknown) =>
    controller.set(event.sender, code),
  );
  ipcMain.on("pushToTalkClear", (event) => controller.clear(event.sender));

  // a reload or a crash leaves no call behind: free the combination for
  // other apps (the page asks again when it joins a call)
  const watch = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const contents = mainWindow.webContents;
    contents.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) controller.reset();
    });
    contents.on("render-process-gone", () => controller.reset());
    contents.on("destroyed", () => controller.reset());
  };
  watch();
  app.on("browser-window-created", watch);

  app.on("will-quit", () => controller.reset());
}
