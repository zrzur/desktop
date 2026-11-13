/**
 * Keys that work in games: when the system-wide listener runs, and who may
 * ask for it. It runs only while the app window holds binds (during a call,
 * or while the key test in voice settings is open) and stops as soon as
 * they are given back, the page goes away or the app quits.
 *
 * No Electron import here, so the logic runs under `node --test`.
 */
import type { GameKeyAction, GameKeyBinds } from "./binds";

/** Channels the app window listens on */
export const GLOBAL_KEYS_EVENT = "globalKeysEvent";
export const GLOBAL_KEYS_STATUS = "globalKeysStatus";

export type GlobalKeysState =
  /** can run; starts with the next call */
  | "ready"
  /** listening now */
  | "on"
  /** macOS: the person has not allowed it in System Settings yet */
  | "permission"
  /** the listener could not start on this system */
  | "error";

export interface GlobalKeysStatus {
  state: GlobalKeysState;
  platform: string;
  /** Linux on Wayland: only games that run through XWayland are heard */
  wayland: boolean;
  /** Technical reason, for the "Details" fold */
  detail?: string;
}

/** The listener process (hookProcess.ts), as the controller needs it */
export interface Listener {
  /** Start listening for these binds, or replace the ones in use */
  start(binds: GameKeyBinds): void;
  /** Stop listening and end the process */
  stop(): void;
}

export interface MessageTarget {
  send(channel: string, ...args: unknown[]): void;
  mainFrame?: unknown;
}

export interface SenderEvent {
  sender: unknown;
  senderFrame?: unknown;
}

export interface WatchedContents {
  on(event: string, listener: (details?: unknown) => void): unknown;
}

export interface Platform {
  platform: string;
  wayland: boolean;
  /** macOS: whether the person allowed Zrzur to hear keys in other apps */
  trusted(): boolean;
  /** Whether the Zrzur window is the one in front right now */
  focused(): boolean;
}

export function createGlobalKeysController(
  listener: Listener,
  appContents: () => MessageTarget | undefined,
  platform: Platform,
  clean: (input: unknown) => GameKeyBinds,
) {
  let running = false;
  let failure: string | undefined;
  const held = new Set<GameKeyAction>();

  function status(): GlobalKeysStatus {
    const base = { platform: platform.platform, wayland: platform.wayland };
    if (!platform.trusted()) return { ...base, state: "permission" };
    if (failure) return { ...base, state: "error", detail: failure };
    return { ...base, state: running ? "on" : "ready" };
  }

  function announce() {
    appContents()?.send(GLOBAL_KEYS_STATUS, status());
  }

  /** Nothing stays "held" once the listener is gone */
  function releaseHeld() {
    for (const action of [...held]) {
      held.delete(action);
      appContents()?.send(GLOBAL_KEYS_EVENT, action, false);
    }
  }

  function stop() {
    if (running) listener.stop();
    running = false;
    releaseHeld();
  }

  /** The app window's own page, not an embed or another window */
  function fromApp(event: SenderEvent | undefined): boolean {
    const contents = appContents();
    return (
      !!event &&
      !!contents &&
      event.sender === contents &&
      event.senderFrame === contents.mainFrame
    );
  }

  return {
    status(event: SenderEvent | undefined): GlobalKeysStatus | undefined {
      return fromApp(event) ? status() : undefined;
    },
    /** Listen for these binds (an empty set stops the listener) */
    set(
      event: SenderEvent | undefined,
      input: unknown,
    ): GlobalKeysStatus | undefined {
      if (!fromApp(event)) return undefined;
      const binds = clean(input);
      if (!Object.keys(binds).length || !platform.trusted()) {
        stop();
        return status();
      }
      failure = undefined;
      try {
        listener.start(binds);
        running = true;
      } catch (error) {
        running = false;
        failure = String((error as Error)?.message ?? error);
      }
      return status();
    },
    /** Give the binds back (the call ended, the test closed) */
    clear(event: SenderEvent | undefined) {
      if (!fromApp(event)) return;
      stop();
      announce();
    },
    /** From the listener: a bound key went down or up */
    onAction(action: GameKeyAction, down: boolean) {
      if (!running) return;
      if (down) held.add(action);
      else held.delete(action);
      // the page cannot always tell whether it is in front; the system can
      appContents()?.send(GLOBAL_KEYS_EVENT, action, down, platform.focused());
    },
    /** From the listener: it could not start, or it ended by itself */
    onFailure(detail: string) {
      running = false;
      failure = detail;
      releaseHeld();
      announce();
    },
    /** The permission may have changed (macOS): tell the window */
    refresh() {
      announce();
    },
    /** Stop when this page goes away: reload, crash, closed window */
    watch(contents: WatchedContents) {
      contents.on("did-start-navigation", (details) => {
        const navigation = details as
          | { isMainFrame?: boolean; isSameDocument?: boolean }
          | undefined;
        if (navigation?.isMainFrame && !navigation.isSameDocument) stop();
      });
      contents.on("render-process-gone", () => stop());
      contents.on("destroyed", () => stop());
    },
    /** The app quits */
    reset() {
      stop();
    },
  };
}
