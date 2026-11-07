import { session } from "electron";

import { BUILD_URL } from "./window";

/**
 * Only the Zrzur app origin may use device and browser permissions.
 *
 * Plugin sandboxes are `srcdoc` iframes with an opaque origin ("null"),
 * so they never match; the same goes for embeds and anything else that
 * ends up in a frame. Requests from the app origin keep Electron's
 * previous behaviour (allowed), so voice, video, screen sharing and
 * notifications work as before.
 *
 * The preload bridge (`window.native`, `desktopConfig`) is only injected
 * into the main frame (`nodeIntegrationInSubFrames` stays false), so
 * plugin frames have no IPC at all.
 */
export function installFrameGuard() {
  const isApp = (url: string | undefined) => {
    if (!url) return false;
    try {
      return new URL(url).origin === BUILD_URL.origin;
    } catch {
      return false;
    }
  };

  // video embeds go fullscreen; frames still need `allowfullscreen`, which
  // plugin sandboxes never get
  const anyOrigin = (permission: string) => permission === "fullscreen";

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        anyOrigin(permission) ||
          isApp(details.requestingUrl ?? webContents?.getURL()),
      );
    },
  );

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) =>
      anyOrigin(permission) || isApp(requestingOrigin),
  );
}
