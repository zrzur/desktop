/**
 * Version, commit and tag of this desktop build, injected by Vite
 * (`define` in vite.main.config.ts, from scripts/release-info.mjs).
 * The About panel links to the exact source of the running build.
 */
export interface BuildInfo {
  version: string;
  commit: string;
  tag: string;
  repo: string;
  sourceUrl: string;
}

declare const __ZRZUR_BUILD__: BuildInfo | undefined;

export const FALLBACK_BUILD: BuildInfo = {
  version: "dev",
  commit: "",
  tag: "",
  repo: "desktop",
  sourceUrl: "https://github.com/zrzur/desktop",
};

export const buildInfo: BuildInfo =
  typeof __ZRZUR_BUILD__ !== "undefined" && __ZRZUR_BUILD__
    ? __ZRZUR_BUILD__
    : FALLBACK_BUILD;

/** Options for Electron's `app.setAboutPanelOptions` */
export function aboutPanelOptions(info: BuildInfo = buildInfo) {
  return {
    applicationName: "Zrzur",
    applicationVersion: info.version,
    version: info.commit ? info.commit.slice(0, 7) : "",
    copyright: "AGPL-3.0. Source code: " + info.sourceUrl,
    website: info.sourceUrl,
  };
}
