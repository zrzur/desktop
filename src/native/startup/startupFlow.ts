/**
 * What the start-up window goes through, as one function with every outside
 * effect passed in (network, disk, installer, the window, the clock), so the
 * whole sequence is tested without Electron:
 *
 *   checking -> (no update) opening
 *            -> downloading (real bytes) -> installing -> restart
 *            -> no connection -> opening
 *            -> failed -> "Try again" | "Open Zrzur" | opens by itself
 *
 * The app always opens unless an update was installed and it restarts.
 */
import type { UpdatePackage } from "./updateCheck";

export type StartupState =
  | { kind: "checking" }
  | { kind: "downloading"; version: string; received: number; total: number }
  | { kind: "installing"; version: string }
  | { kind: "opening" }
  | { kind: "offline" }
  | { kind: "failed"; details: string };

export type FailedChoice = "open" | "retry" | "timeout";

export interface StartupDeps {
  /** null: updates are off for this build or system */
  feedUrl: string | null;
  /** The feed's RELEASES text; throws when it cannot be fetched */
  fetchReleases(feedUrl: string): Promise<string>;
  /** The newest package newer than this app, or null */
  pick(releasesText: string): UpdatePackage | null;
  /** Whether the system has a network at all (asked only after a failed check) */
  isOnline(): boolean;
  /** Downloads and verifies; resolves with the folder to install from */
  download(
    feedUrl: string,
    update: UpdatePackage,
    onProgress: (received: number, total: number) => void,
  ): Promise<string>;
  /** Installs from that folder; resolves when the new version is in place */
  install(folder: string, update: UpdatePackage): Promise<void>;
  show(state: StartupState): void;
  /** The person's choice in the failed state, or "timeout" */
  waitForChoice(timeoutMs: number): Promise<FailedChoice>;
  sleep(ms: number): Promise<void>;
  describe(error: unknown): string;
  log(message: string): void;
}

/** How long "no connection" stays before the app opens */
export const OFFLINE_NOTICE_MS = 2000;
/** How long "update failed" waits for a choice before the app opens */
export const FAILED_NOTICE_MS = 10_000;

export async function runStartupFlow(
  deps: StartupDeps,
): Promise<"open" | "restart"> {
  const { feedUrl } = deps;
  if (!feedUrl) {
    deps.show({ kind: "opening" });
    return "open";
  }

  deps.show({ kind: "checking" });
  let update: UpdatePackage | null;
  try {
    update = deps.pick(await deps.fetchReleases(feedUrl));
  } catch (error) {
    deps.log(`update check failed: ${deps.describe(error)}`);
    // Only say "no connection" when the system itself reports none; a feed
    // that is slow or down is not the person's problem and not shown
    if (!deps.isOnline()) {
      deps.show({ kind: "offline" });
      await deps.sleep(OFFLINE_NOTICE_MS);
    }
    deps.show({ kind: "opening" });
    return "open";
  }
  if (!update) {
    deps.show({ kind: "opening" });
    return "open";
  }

  for (;;) {
    let stage = "download";
    try {
      const { version, size } = update;
      deps.show({ kind: "downloading", version, received: 0, total: size });
      const folder = await deps.download(feedUrl, update, (received, total) =>
        deps.show({ kind: "downloading", version, received, total }),
      );
      stage = "install";
      deps.show({ kind: "installing", version });
      await deps.install(folder, update);
      return "restart";
    } catch (error) {
      const details = `${stage}: ${deps.describe(error)}\n${update.fileName}`;
      deps.log(`update failed at ${details.replace("\n", " ")}`);
      deps.show({ kind: "failed", details });
      const choice = await deps.waitForChoice(FAILED_NOTICE_MS);
      if (choice === "retry") continue;
      deps.show({ kind: "opening" });
      return "open";
    }
  }
}
