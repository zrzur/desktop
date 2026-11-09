/**
 * Push to talk from other apps. Electron's global shortcuts report a press
 * but never a release, so a true "hold to talk" outside the window is not
 * possible without a native keyboard hook library. What the app offers
 * instead is a toggle: Ctrl+Shift (Cmd+Shift on a Mac) with the person's
 * push-to-talk key turns talking on, the next press turns it off.
 *
 * The modifiers keep a plain key (` or V) free for typing in other apps;
 * the combination is held only while the app asks for it (during a push-to-
 * talk call). No Electron import here, so the logic runs under `node --test`.
 */

/** Channel the app window listens on for a press */
export const PUSH_TO_TALK_TOGGLE = "pushToTalkToggle";

const PUNCTUATION: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

const NAMED: Record<string, string> = {
  Space: "Space",
  Insert: "Insert",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  CapsLock: "Capslock",
  ScrollLock: "Scrolllock",
  PrintScreen: "PrintScreen",
  NumpadAdd: "numadd",
  NumpadSubtract: "numsub",
  NumpadMultiply: "nummult",
  NumpadDivide: "numdiv",
  NumpadDecimal: "numdec",
};

/**
 * Electron accelerator for a push-to-talk key (`KeyboardEvent.code`), or
 * undefined for keys that cannot be used (unknown, modifiers, Esc, Tab, …)
 */
export function pushToTalkAccelerator(code: unknown): string | undefined {
  if (typeof code !== "string") return undefined;
  let key: string | undefined;
  const simple = /^(?:Key([A-Z])|Digit([0-9])|Numpad([0-9])|F([1-9]|1[0-9]|2[0-4]))$/.exec(
    code,
  );
  if (simple) {
    if (simple[1] || simple[2]) key = simple[1] || simple[2];
    else if (simple[3]) key = `num${simple[3]}`;
    else key = `F${simple[4]}`;
  } else if (Object.prototype.hasOwnProperty.call(PUNCTUATION, code)) {
    key = PUNCTUATION[code];
  } else if (Object.prototype.hasOwnProperty.call(NAMED, code)) {
    key = NAMED[code];
  }
  return key ? `CommandOrControl+Shift+${key}` : undefined;
}

/** The parts of Electron's `globalShortcut` used here */
export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

/** Something that can receive a message (the app window's webContents) */
export interface MessageTarget {
  send(channel: string): void;
}

/**
 * Holds at most one global combination for the app window. Requests from
 * anything but the app window are ignored.
 */
export function createPushToTalkController(
  shortcuts: ShortcutRegistry,
  appContents: () => MessageTarget | undefined,
) {
  let current: string | undefined;

  function release() {
    if (current) shortcuts.unregister(current);
    current = undefined;
  }

  return {
    /** Take the combination for this key; false if refused or taken */
    set(sender: unknown, code: unknown): boolean {
      if (!sender || sender !== appContents()) return false;
      release();
      const accelerator = pushToTalkAccelerator(code);
      if (!accelerator) return false;
      const ok = shortcuts.register(accelerator, () =>
        appContents()?.send(PUSH_TO_TALK_TOGGLE),
      );
      if (ok) current = accelerator;
      return ok;
    },
    /** Give the combination back (the call ended, push to talk is off) */
    clear(sender: unknown) {
      if (!sender || sender !== appContents()) return;
      release();
    },
    /** The window reloaded, navigated or closed: free the combination */
    reset() {
      release();
    },
  };
}
