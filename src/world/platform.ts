/**
 * The system the app runs on, as Node names it ("darwin", "win32",
 * "linux"). The web app picks its keyboard shortcuts (the macOS, Windows or
 * Linux set) from it.
 */
export function shortcutPlatform(
  platform: string = process.platform,
): string {
  return platform;
}
