import {
  type UtilityProcess,
  app,
  ipcMain,
  powerMonitor,
  systemPreferences,
  utilityProcess,
} from "electron";
import path from "node:path";

import { mainWindow } from "../window";

import { type GameKeyAction, type GameKeyBinds, cleanBinds } from "./binds";
import { type Listener, createGlobalKeysController } from "./controller";

/**
 * Keys that work in games (push to talk, push to mute, mute, deafen). The
 * app window asks for its binds while it is in a call; the listener runs in
 * its own process (hookProcess.ts) for exactly that long.
 */
export function initGlobalKeys() {
  let child: UtilityProcess | undefined;

  const listener: Listener & { release(): void } = {
    start(binds: GameKeyBinds) {
      if (!child) {
        const started = utilityProcess.fork(
          path.join(__dirname, "hookProcess.js"),
          [],
          { serviceName: "Zrzur keys" },
        );
        child = started;
        started.on("message", (message: unknown) => {
          const m = message as {
            type?: string;
            action?: GameKeyAction;
            down?: boolean;
            detail?: string;
          };
          if (child !== started) return;
          if (m.type === "action" && m.action)
            controller.onAction(m.action, m.down === true);
          else if (m.type === "failed") {
            child = undefined;
            started.kill();
            controller.onFailure(m.detail ?? "listener failed");
          }
        });
        started.on("exit", (code) => {
          // ended by itself, not by stop()
          if (child !== started) return;
          child = undefined;
          controller.onFailure(`listener ended (code ${code})`);
        });
      }
      child.postMessage({ type: "set", binds });
    },
    stop() {
      const ending = child;
      child = undefined;
      if (!ending) return;
      ending.postMessage({ type: "stop" });
      // in case it no longer answers
      setTimeout(() => ending.kill(), 1000).unref();
    },
    release() {
      child?.postMessage({ type: "release" });
    },
  };

  const controller = createGlobalKeysController(
    listener,
    () =>
      mainWindow && !mainWindow.isDestroyed()
        ? mainWindow.webContents
        : undefined,
    {
      platform: process.platform,
      wayland:
        process.platform === "linux" &&
        (process.env.XDG_SESSION_TYPE === "wayland" ||
          !!process.env.WAYLAND_DISPLAY),
      focused: () =>
        !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused(),
      trusted: () =>
        process.platform !== "darwin" ||
        systemPreferences.isTrustedAccessibilityClient(false),
    },
    cleanBinds,
  );

  ipcMain.handle("globalKeysStatus", (event) => controller.status(event));
  ipcMain.handle("globalKeysSet", (event, binds: unknown) =>
    controller.set(event, binds),
  );
  ipcMain.on("globalKeysClear", (event) => controller.clear(event));
  // macOS: opens the system's own question; asked only when the person
  // presses "Allow" in voice settings, never by itself
  ipcMain.handle("globalKeysAskPermission", (event) => {
    if (controller.status(event) === undefined) return undefined;
    if (process.platform === "darwin")
      systemPreferences.isTrustedAccessibilityClient(true);
    return controller.status(event);
  });

  // a key released behind the lock screen is never seen: let go of it
  powerMonitor.on("lock-screen", () => listener.release());
  powerMonitor.on("suspend", () => listener.release());

  if (mainWindow && !mainWindow.isDestroyed())
    controller.watch(mainWindow.webContents);
  app.on("browser-window-created", (_event, window) =>
    controller.watch(window.webContents),
  );
  // coming back from System Settings (macOS): the answer may have changed
  app.on("browser-window-focus", () => {
    if (process.platform === "darwin") controller.refresh();
  });

  app.on("will-quit", () => controller.reset());
}
