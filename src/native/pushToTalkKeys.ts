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

/**
 * Keys never taken with Ctrl/Cmd+Shift, because other apps need those
 * combinations for editing and moving around: select all, copy, find, new
 * window, reopen tab, paste as plain text, close window, cut, redo, and the
 * keys that extend a selection (arrows, Space, Home/End, PageUp/PageDown).
 * Those keys are simply missing from NAMED below.
 */
const DENIED_LETTERS = new Set(["A", "C", "F", "N", "T", "V", "W", "X", "Z"]);

const NAMED: Record<string, string> = {
  Insert: "Insert",
  Delete: "Delete",
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
    if (simple[1] && DENIED_LETTERS.has(simple[1])) return undefined;
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
  /** The window's top frame (IPC from embeds inside it is refused) */
  mainFrame?: unknown;
}

/** The parts of an IPC event used here */
export interface SenderEvent {
  sender: unknown;
  senderFrame?: unknown;
}

/** The parts of webContents events used here */
export interface WatchedContents {
  on(event: string, listener: (details?: unknown) => void): unknown;
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
    /** Take the combination for this key; false if refused or taken */
    set(event: SenderEvent | undefined, code: unknown): boolean {
      if (!fromApp(event)) return false;
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
    clear(event: SenderEvent | undefined) {
      if (!fromApp(event)) return;
      release();
    },
    /**
     * Free the combination when this page goes away: a reload or another
     * page, a crash, a closed window (the page asks again in its next call)
     */
    watch(contents: WatchedContents) {
      contents.on("did-start-navigation", (details) => {
        const navigation = details as
          | { isMainFrame?: boolean; isSameDocument?: boolean }
          | undefined;
        if (navigation?.isMainFrame && !navigation.isSameDocument) release();
      });
      contents.on("render-process-gone", () => release());
      contents.on("destroyed", () => release());
    },
    /** The window reloaded, navigated or closed: free the combination */
    reset() {
      release();
    },
  };
}
