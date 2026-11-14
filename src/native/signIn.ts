/**
 * Linking an account on another service (Settings → Connections) moves the
 * page to that service's own sign-in. The main window never leaves Zrzur,
 * so the sign-in opens in a separate window instead: no preload, its own
 * in-memory session, sandboxed. When the service sends the person back to
 * Zrzur's return page, that address is loaded in the main window, which
 * finishes the link, and the sign-in window closes.
 *
 * Only these sign-in pages open such a window; any other address the main
 * window tries to reach stays blocked as before.
 */
import { BrowserWindow, shell } from "electron";

import { isSignInPage, signInReturn } from "./signInRules";

export { isSignInStart } from "./signInRules";

/** Ids of the web pages that are sign-in windows, for the app-wide guards */
export const signInContents = new Set<number>();

let current: BrowserWindow | undefined;

/** Open the sign-in in its own window; one at a time */
export function openSignInWindow(
  address: string,
  parent: BrowserWindow,
  appOrigin: string,
) {
  if (current && !current.isDestroyed()) current.close();

  const window = new BrowserWindow({
    parent,
    width: 520,
    height: 760,
    minWidth: 360,
    minHeight: 480,
    autoHideMenuBar: true,
    title: "Zrzur",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // nothing of the person's Zrzur session, and nothing kept afterwards
      partition: "zrzur-sign-in",
    },
  });
  current = window;
  // nothing to grant here: no camera, microphone, notifications, devices
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, answer) =>
    answer(false),
  );
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  const id = window.webContents.id;
  signInContents.add(id);

  // the service sends the person back to Zrzur: finish in the main window
  const back = (event: Electron.Event, target: string) => {
    if (new URL(target).origin !== appOrigin) {
      // the services' own sign-in pages only; anything else (a help link,
      // a sign-up page) opens in the person's browser
      if (!isSignInPage(target)) {
        event.preventDefault();
        if (target.startsWith("https:")) shell.openExternal(target);
      }
      return;
    }
    event.preventDefault();
    const page = signInReturn(target, appOrigin);
    if (page) {
      parent.loadURL(page);
      parent.show();
      parent.focus();
    }
    window.close();
  };
  window.webContents.on("will-navigate", (event, target) =>
    back(event, target),
  );
  window.webContents.on("will-redirect", (details) =>
    back(details as unknown as Electron.Event, details.url),
  );
  // links inside the sign-in page that open new windows stay in the browser
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  window.on("closed", () => {
    signInContents.delete(id);
    if (current === window) current = undefined;
  });

  window.loadURL(address);
}
