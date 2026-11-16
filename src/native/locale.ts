/**
 * The language of the shell's own words (start-up window, tray, the page
 * shown while Zrzur cannot be reached): the language chosen in the app, once
 * the app has told the shell (`window.desktopConfig.set({ language })`),
 * else the device's, else English.
 */
import { app } from "electron";

import { config } from "./config";
import { type ShellLocale, shellLocale } from "./startup/startupStrings";

export function shellLanguage(): ShellLocale {
  return shellLocale(config.language || app.getLocale());
}
