/**
 * Keys that work in games: the listener. It runs as its own small process
 * (Electron utility process), started by native/globalKeys only while the
 * app window holds binds, so the app itself never handles the system's
 * mouse and key traffic and a fault here cannot take the app down.
 *
 * It uses the operating system's documented input APIs through libuiohook
 * (Windows: WH_KEYBOARD_LL / WH_MOUSE_LL; macOS: a listen-only event tap;
 * Linux: XRecord). Keys are only observed, never held back or changed, and
 * nothing is put into any other program. The only thing that leaves this
 * process is "bind X went down / up" for the person's own binds.
 */
import {
  type GameKeyAction,
  type Modifiers,
  cleanBinds,
  createMatcher,
} from "./native/globalKeys/binds";

type Matcher = ReturnType<typeof createMatcher>;

interface HookEvent extends Modifiers {
  keycode?: number;
  button?: unknown;
}

interface Hook {
  on(event: string, listener: (event: HookEvent) => void): unknown;
  start(): void;
  stop(): void;
}

const port = (
  process as unknown as {
    parentPort: {
      on(
        event: "message",
        listener: (message: { data: unknown }) => void,
      ): void;
      postMessage(message: unknown): void;
    };
  }
).parentPort;

let hook: Hook | undefined;
let matcher: Matcher | undefined;

function emit(action: GameKeyAction, down: boolean) {
  port.postMessage({ type: "action", action, down });
}

function start() {
  if (hook) return;
  // loaded here, not at the top: a system without the library reports a
  // plain failure instead of a process that never starts
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const loaded = (require("uiohook-napi") as { uIOhook: Hook }).uIOhook;
  loaded.on("keydown", (event) =>
    matcher?.key(event.keycode as number, true, event),
  );
  loaded.on("keyup", (event) =>
    matcher?.key(event.keycode as number, false, event),
  );
  loaded.on("mousedown", (event) => {
    if (matcher?.usesMouse) matcher.mouse(Number(event.button), true, event);
  });
  loaded.on("mouseup", (event) => {
    if (matcher?.usesMouse) matcher.mouse(Number(event.button), false, event);
  });
  loaded.start();
  hook = loaded;
}

port.on("message", ({ data }) => {
  const message = data as { type?: string; binds?: unknown };
  try {
    if (message.type === "set") {
      matcher?.releaseAll();
      matcher = createMatcher(cleanBinds(message.binds), emit);
      start();
      port.postMessage({ type: "started" });
    } else if (message.type === "release") {
      matcher?.releaseAll();
    } else if (message.type === "stop") {
      matcher?.releaseAll();
      matcher = undefined;
      hook?.stop();
      hook = undefined;
      process.exit(0);
    }
  } catch (error) {
    port.postMessage({
      type: "failed",
      detail: String((error as Error)?.message ?? error),
    });
  }
});
