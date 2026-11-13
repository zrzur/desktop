/**
 * Keys that work in games: which key presses belong to the person's own
 * binds. The listener (hookProcess.ts) sees every key and mouse button of
 * the system; this file decides which ones matter, and nothing else ever
 * leaves that process. No key is stored, counted or sent anywhere.
 *
 * A bind is a physical key (`KeyboardEvent.code`) or a mouse button
 * ("Mouse3" middle, "Mouse4" and "Mouse5" the side buttons), optionally
 * with modifiers. A modifier alone can be a bind too ("ControlRight").
 *
 * No Electron import here, so the logic runs under `node --test`.
 */

export type GameKeyAction = "talk" | "mute" | "toggleMute" | "toggleDeafen";

export const GAME_KEY_ACTIONS: readonly GameKeyAction[] = [
  "talk",
  "mute",
  "toggleMute",
  "toggleDeafen",
];

/** Held actions follow the key down and up; the others fire once per press */
const HELD = new Set<GameKeyAction>(["talk", "mute"]);

export interface GameKeyBind {
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export type GameKeyBinds = Partial<Record<GameKeyAction, GameKeyBind>>;

/** Modifier state that comes with every event of the listener */
export interface Modifiers {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** libuiohook virtual codes (scan code set 1) by `KeyboardEvent.code` */
const KEYCODES: Record<string, number> = {
  Space: 0x0039,
  CapsLock: 0x003a,
  PageUp: 0x0e49,
  PageDown: 0x0e51,
  End: 0x0e4f,
  Home: 0x0e47,
  ArrowLeft: 0xe04b,
  ArrowUp: 0xe048,
  ArrowRight: 0xe04d,
  ArrowDown: 0xe050,
  Insert: 0x0e52,
  Delete: 0x0e53,
  Digit0: 0x000b,
  Digit1: 0x0002,
  Digit2: 0x0003,
  Digit3: 0x0004,
  Digit4: 0x0005,
  Digit5: 0x0006,
  Digit6: 0x0007,
  Digit7: 0x0008,
  Digit8: 0x0009,
  Digit9: 0x000a,
  KeyA: 0x001e,
  KeyB: 0x0030,
  KeyC: 0x002e,
  KeyD: 0x0020,
  KeyE: 0x0012,
  KeyF: 0x0021,
  KeyG: 0x0022,
  KeyH: 0x0023,
  KeyI: 0x0017,
  KeyJ: 0x0024,
  KeyK: 0x0025,
  KeyL: 0x0026,
  KeyM: 0x0032,
  KeyN: 0x0031,
  KeyO: 0x0018,
  KeyP: 0x0019,
  KeyQ: 0x0010,
  KeyR: 0x0013,
  KeyS: 0x001f,
  KeyT: 0x0014,
  KeyU: 0x0016,
  KeyV: 0x002f,
  KeyW: 0x0011,
  KeyX: 0x002d,
  KeyY: 0x0015,
  KeyZ: 0x002c,
  Numpad0: 0x0052,
  Numpad1: 0x004f,
  Numpad2: 0x0050,
  Numpad3: 0x0051,
  Numpad4: 0x004b,
  Numpad5: 0x004c,
  Numpad6: 0x004d,
  Numpad7: 0x0047,
  Numpad8: 0x0048,
  Numpad9: 0x0049,
  NumpadMultiply: 0x0037,
  NumpadAdd: 0x004e,
  NumpadSubtract: 0x004a,
  NumpadDecimal: 0x0053,
  NumpadDivide: 0x0e35,
  F1: 0x003b,
  F2: 0x003c,
  F3: 0x003d,
  F4: 0x003e,
  F5: 0x003f,
  F6: 0x0040,
  F7: 0x0041,
  F8: 0x0042,
  F9: 0x0043,
  F10: 0x0044,
  F11: 0x0057,
  F12: 0x0058,
  F13: 0x005b,
  F14: 0x005c,
  F15: 0x005d,
  F16: 0x0063,
  F17: 0x0064,
  F18: 0x0065,
  F19: 0x0066,
  F20: 0x0067,
  F21: 0x0068,
  F22: 0x0069,
  F23: 0x006a,
  F24: 0x006b,
  Semicolon: 0x0027,
  Equal: 0x000d,
  Comma: 0x0033,
  Minus: 0x000c,
  Period: 0x0034,
  Slash: 0x0035,
  Backquote: 0x0029,
  BracketLeft: 0x001a,
  Backslash: 0x002b,
  BracketRight: 0x001b,
  Quote: 0x0028,
  ScrollLock: 0x0046,
  ControlLeft: 0x001d,
  ControlRight: 0x0e1d,
  AltLeft: 0x0038,
  AltRight: 0x0e38,
  ShiftLeft: 0x002a,
  ShiftRight: 0x0036,
  MetaLeft: 0x0e5b,
  MetaRight: 0x0e5c,
};

/** The modifier a modifier key is itself (it never has to be "also held") */
const OWN_MODIFIER: Record<string, keyof Modifiers> = {
  ControlLeft: "ctrlKey",
  ControlRight: "ctrlKey",
  AltLeft: "altKey",
  AltRight: "altKey",
  ShiftLeft: "shiftKey",
  ShiftRight: "shiftKey",
  MetaLeft: "metaKey",
  MetaRight: "metaKey",
};

/** Middle and the two side buttons; left and right belong to the game */
const MOUSE_BUTTONS: Record<string, number> = {
  Mouse3: 3,
  Mouse4: 4,
  Mouse5: 5,
};

export type HookInput =
  | { kind: "key"; keycode: number }
  | { kind: "mouse"; button: number };

/** What the listener reports for this bind's main key, if it can be a bind */
export function hookInput(code: unknown): HookInput | undefined {
  if (typeof code !== "string") return undefined;
  if (Object.prototype.hasOwnProperty.call(KEYCODES, code))
    return { kind: "key", keycode: KEYCODES[code] };
  if (Object.prototype.hasOwnProperty.call(MOUSE_BUTTONS, code))
    return { kind: "mouse", button: MOUSE_BUTTONS[code] };
  return undefined;
}

/**
 * The binds the app window sent, checked: unknown actions and keys are
 * dropped, and nothing but the five known fields is kept.
 */
export function cleanBinds(input: unknown): GameKeyBinds {
  const out: GameKeyBinds = {};
  if (!input || typeof input !== "object") return out;
  for (const action of GAME_KEY_ACTIONS) {
    const bind = (input as Record<string, unknown>)[action];
    if (!bind || typeof bind !== "object") continue;
    const b = bind as Record<string, unknown>;
    if (!hookInput(b.code)) continue;
    const clean: GameKeyBind = { code: b.code as string };
    if (b.ctrl === true) clean.ctrl = true;
    if (b.shift === true) clean.shift = true;
    if (b.alt === true) clean.alt = true;
    if (b.meta === true) clean.meta = true;
    // a modifier key never needs itself held as well
    const own = OWN_MODIFIER[clean.code];
    if (own === "ctrlKey") delete clean.ctrl;
    if (own === "shiftKey") delete clean.shift;
    if (own === "altKey") delete clean.alt;
    if (own === "metaKey") delete clean.meta;
    out[action] = clean;
  }
  return out;
}

function modifiersFit(
  action: GameKeyAction,
  bind: GameKeyBind,
  mods: Modifiers,
): boolean {
  const own = OWN_MODIFIER[bind.code];
  const want: [keyof Modifiers, boolean][] = [
    ["ctrlKey", !!bind.ctrl],
    ["shiftKey", !!bind.shift],
    ["altKey", !!bind.alt],
    ["metaKey", !!bind.meta],
  ];
  for (const [name, needed] of want) {
    if (name === own) continue;
    if (needed && !mods[name]) return false;
    // A held key works with anything else held too (Shift to run while
    // talking). A press that switches something must be exactly the bind,
    // so Ctrl+F9 never fires a bind on F9.
    if (!needed && mods[name] && !HELD.has(action)) return false;
  }
  return true;
}

/**
 * Turns the listener's raw events into "this action went down / up".
 * Repeats of a held key are ignored; a toggle fires once per press.
 */
export function createMatcher(
  binds: GameKeyBinds,
  emit: (action: GameKeyAction, down: boolean) => void,
) {
  const entries = GAME_KEY_ACTIONS.flatMap((action) => {
    const bind = binds[action];
    const input = bind && hookInput(bind.code);
    return bind && input ? [{ action, bind, input }] : [];
  });
  const down = new Set<GameKeyAction>();

  function handle(input: HookInput, pressed: boolean, mods: Modifiers) {
    for (const entry of entries) {
      if (entry.input.kind !== input.kind) continue;
      if (
        input.kind === "key"
          ? (entry.input as { keycode: number }).keycode !== input.keycode
          : (entry.input as { button: number }).button !== input.button
      )
        continue;
      if (pressed) {
        if (down.has(entry.action)) continue;
        if (!modifiersFit(entry.action, entry.bind, mods)) continue;
        down.add(entry.action);
        emit(entry.action, true);
      } else if (down.delete(entry.action)) {
        emit(entry.action, false);
      }
    }
  }

  return {
    /** Whether any bind uses the mouse (else mouse events are not looked at) */
    usesMouse: entries.some((entry) => entry.input.kind === "mouse"),
    key(keycode: number, pressed: boolean, mods: Modifiers) {
      handle({ kind: "key", keycode }, pressed, mods);
    },
    mouse(button: number, pressed: boolean, mods: Modifiers) {
      handle({ kind: "mouse", button }, pressed, mods);
    },
    /** Everything held goes up (the listener stops, the screen locks) */
    releaseAll() {
      for (const action of [...down]) {
        down.delete(action);
        emit(action, false);
      }
    },
  };
}
