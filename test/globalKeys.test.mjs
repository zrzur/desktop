import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanBinds,
  createMatcher,
  hookInput,
} from "../src/native/globalKeys/binds.ts";
import {
  GLOBAL_KEYS_EVENT,
  GLOBAL_KEYS_STATUS,
  createGlobalKeysController,
} from "../src/native/globalKeys/controller.ts";

const NONE = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
const V = 0x002f;
const F9 = 0x0043;
const CTRL_RIGHT = 0x0e1d;

function matcher(binds) {
  const seen = [];
  const m = createMatcher(cleanBinds(binds), (action, down) =>
    seen.push(`${action}:${down ? "down" : "up"}`),
  );
  return { m, seen };
}

test("keys, modifiers and mouse side buttons can be binds; left and right click cannot", () => {
  assert.deepEqual(hookInput("KeyV"), { kind: "key", keycode: V });
  assert.deepEqual(hookInput("Backquote"), { kind: "key", keycode: 0x29 });
  assert.deepEqual(hookInput("ControlRight"), {
    kind: "key",
    keycode: CTRL_RIGHT,
  });
  assert.deepEqual(hookInput("Mouse4"), { kind: "mouse", button: 4 });
  assert.deepEqual(hookInput("Mouse5"), { kind: "mouse", button: 5 });
  for (const code of ["Mouse1", "Mouse2", "Nope", "", 5, undefined, null, {}])
    assert.equal(hookInput(code), undefined, String(code));
});

test("binds from the app window are checked field by field", () => {
  assert.deepEqual(
    cleanBinds({
      talk: { code: "KeyV", ctrl: true, shift: "yes", extra: 1 },
      mute: { code: "Mouse1" },
      toggleMute: { code: "ShiftLeft", shift: true, alt: true },
      record: { code: "KeyA" },
      toggleDeafen: "KeyD",
    }),
    {
      talk: { code: "KeyV", ctrl: true },
      // Shift never needs Shift held as well
      toggleMute: { code: "ShiftLeft", alt: true },
    },
  );
  for (const input of [undefined, null, "x", 5, []])
    assert.deepEqual(cleanBinds(input), {});
});

test("push to talk follows the key down and up, once, whatever else is held", () => {
  const { m, seen } = matcher({ talk: { code: "KeyV" } });
  m.key(V, true, NONE);
  m.key(V, true, NONE); // the keyboard repeats a held key
  m.key(V, true, NONE);
  m.key(V, false, NONE);
  // Shift held to run in the game: talking still works
  m.key(V, true, { ...NONE, shiftKey: true });
  m.key(V, false, NONE);
  assert.deepEqual(seen, ["talk:down", "talk:up", "talk:down", "talk:up"]);
});

test("other keys are never reported", () => {
  const { m, seen } = matcher({ talk: { code: "KeyV" } });
  for (let keycode = 1; keycode < 0x70; keycode++) {
    if (keycode === V) continue;
    m.key(keycode, true, NONE);
    m.key(keycode, false, NONE);
  }
  m.mouse(1, true, NONE);
  m.mouse(4, true, NONE);
  assert.deepEqual(seen, []);
  assert.equal(m.usesMouse, false);
});

test("a combination needs its modifiers at the press", () => {
  const { m, seen } = matcher({ talk: { code: "KeyV", ctrl: true } });
  m.key(V, true, NONE);
  m.key(V, false, NONE);
  assert.deepEqual(seen, []);
  m.key(V, true, { ...NONE, ctrlKey: true });
  // Ctrl let go first: talking lasts until the key itself goes up
  m.key(V, false, NONE);
  assert.deepEqual(seen, ["talk:down", "talk:up"]);
});

test("a switch fires only on exactly its combination", () => {
  const { m, seen } = matcher({ toggleMute: { code: "F9" } });
  m.key(F9, true, { ...NONE, ctrlKey: true });
  m.key(F9, false, NONE);
  assert.deepEqual(seen, []);
  m.key(F9, true, NONE);
  m.key(F9, true, NONE);
  m.key(F9, false, NONE);
  assert.deepEqual(seen, ["toggleMute:down", "toggleMute:up"]);
});

test("a modifier alone and a mouse side button can be held to talk", () => {
  const a = matcher({ talk: { code: "ControlRight" } });
  a.m.key(CTRL_RIGHT, true, { ...NONE, ctrlKey: true });
  a.m.key(CTRL_RIGHT, false, NONE);
  assert.deepEqual(a.seen, ["talk:down", "talk:up"]);

  const b = matcher({ talk: { code: "Mouse4" }, mute: { code: "Mouse5" } });
  assert.equal(b.m.usesMouse, true);
  b.m.mouse(1, true, NONE);
  b.m.mouse(4, true, NONE);
  b.m.mouse(5, true, NONE);
  b.m.mouse(4, false, NONE);
  b.m.mouse(5, false, NONE);
  assert.deepEqual(b.seen, ["talk:down", "mute:down", "talk:up", "mute:up"]);
});

test("releaseAll lets go of everything held", () => {
  const { m, seen } = matcher({ talk: { code: "KeyV" } });
  m.key(V, true, NONE);
  m.releaseAll();
  m.releaseAll();
  // the real key-up afterwards is not reported twice
  m.key(V, false, NONE);
  assert.deepEqual(seen, ["talk:down", "talk:up"]);
});

// ------------------------------------------------------------ controller

function setup({ trusted = true, startThrows = false } = {}) {
  const state = { focused: false };
  const calls = [];
  const sent = [];
  const contents = {
    mainFrame: { top: true },
    send: (...args) => sent.push(args),
  };
  const platform = {
    platform: "win32",
    wayland: false,
    trusted: () => trusted,
    focused: () => state.focused,
  };
  const listener = {
    start(binds) {
      if (startThrows) throw new Error("no library");
      calls.push(["start", binds]);
    },
    stop() {
      calls.push(["stop"]);
    },
  };
  const controller = createGlobalKeysController(
    listener,
    () => contents,
    platform,
    cleanBinds,
  );
  const event = { sender: contents, senderFrame: contents.mainFrame };
  return { controller, calls, sent, contents, event, platform, state };
}

test("the listener runs only while the app window holds binds", () => {
  const { controller, calls, event } = setup();
  assert.equal(controller.status(event).state, "ready");
  assert.deepEqual(calls, []);

  assert.equal(controller.set(event, { talk: { code: "KeyV" } }).state, "on");
  assert.deepEqual(calls, [["start", { talk: { code: "KeyV" } }]]);

  // no usable bind: stopped
  assert.equal(controller.set(event, { talk: { code: "Nope" } }).state, "ready");
  assert.deepEqual(calls.at(-1), ["stop"]);

  controller.set(event, { talk: { code: "KeyV" } });
  controller.clear(event);
  assert.deepEqual(calls.at(-1), ["stop"]);
  assert.equal(controller.status(event).state, "ready");
});

test("only the app window's top frame may ask", () => {
  const { controller, calls, contents } = setup();
  const embed = { sender: contents, senderFrame: { top: false } };
  const other = { sender: {}, senderFrame: contents.mainFrame };
  for (const event of [embed, other, undefined]) {
    assert.equal(controller.status(event), undefined);
    assert.equal(controller.set(event, { talk: { code: "KeyV" } }), undefined);
    controller.clear(event);
  }
  assert.deepEqual(calls, []);
});

test("bound keys reach the window; a key still held goes up when the listener stops", () => {
  const { controller, sent, event, state } = setup();
  controller.onAction("talk", true); // not running: ignored
  assert.deepEqual(sent, []);

  controller.set(event, { talk: { code: "KeyV" } });
  // with the key comes whether the Zrzur window was the one in front
  state.focused = true;
  controller.onAction("mute", true);
  assert.deepEqual(sent.at(-1), [GLOBAL_KEYS_EVENT, "mute", true, true]);
  state.focused = false;
  controller.onAction("mute", false);
  controller.onAction("talk", true);
  assert.deepEqual(sent.at(-1), [GLOBAL_KEYS_EVENT, "talk", true, false]);
  controller.clear(event);
  assert.deepEqual(sent.slice(-2), [
    [GLOBAL_KEYS_EVENT, "talk", false],
    [GLOBAL_KEYS_STATUS, { platform: "win32", wayland: false, state: "ready" }],
  ]);
});

test("a listener that fails says so, with the reason, and holds nothing", () => {
  const failing = setup({ startThrows: true });
  const status = failing.controller.set(failing.event, {
    talk: { code: "KeyV" },
  });
  assert.equal(status.state, "error");
  assert.equal(status.detail, "no library");

  const { controller, sent, event } = setup();
  controller.set(event, { talk: { code: "KeyV" } });
  controller.onAction("talk", true);
  controller.onFailure("listener ended (code 1)");
  assert.deepEqual(sent.slice(-2), [
    [GLOBAL_KEYS_EVENT, "talk", false],
    [
      GLOBAL_KEYS_STATUS,
      {
        platform: "win32",
        wayland: false,
        state: "error",
        detail: "listener ended (code 1)",
      },
    ],
  ]);
  // asking again starts fresh
  assert.equal(controller.set(event, { talk: { code: "KeyV" } }).state, "on");
});

test("without the system's permission (macOS) nothing starts", () => {
  const { controller, calls, event } = setup({ trusted: false });
  assert.equal(controller.status(event).state, "permission");
  assert.equal(
    controller.set(event, { talk: { code: "KeyV" } }).state,
    "permission",
  );
  assert.deepEqual(calls, []);
});

test("a reload, a crash or a closed window stops the listener", () => {
  for (const [name, details] of [
    ["did-start-navigation", { isMainFrame: true, isSameDocument: false }],
    ["render-process-gone", undefined],
    ["destroyed", undefined],
  ]) {
    const { controller, calls, event } = setup();
    const handlers = {};
    controller.watch({ on: (event, fn) => (handlers[event] = fn) });
    controller.set(event, { talk: { code: "KeyV" } });
    handlers[name](details);
    assert.deepEqual(calls.at(-1), ["stop"], name);
  }
  // moving inside the page (same document) keeps it
  const { controller, calls, event } = setup();
  const handlers = {};
  controller.watch({ on: (event, fn) => (handlers[event] = fn) });
  controller.set(event, { talk: { code: "KeyV" } });
  handlers["did-start-navigation"]({ isMainFrame: true, isSameDocument: true });
  assert.equal(calls.at(-1)[0], "start");
});
