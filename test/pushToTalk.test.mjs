import assert from "node:assert/strict";
import test from "node:test";

import {
  createPushToTalkController,
  pushToTalkAccelerator,
} from "../src/native/pushToTalkKeys.ts";

test("the push-to-talk key becomes Ctrl/Cmd+Shift with that key", () => {
  assert.equal(pushToTalkAccelerator("Backquote"), "CommandOrControl+Shift+`");
  assert.equal(pushToTalkAccelerator("KeyV"), "CommandOrControl+Shift+V");
  assert.equal(pushToTalkAccelerator("Digit4"), "CommandOrControl+Shift+4");
  assert.equal(pushToTalkAccelerator("F13"), "CommandOrControl+Shift+F13");
  assert.equal(pushToTalkAccelerator("Numpad5"), "CommandOrControl+Shift+num5");
  assert.equal(pushToTalkAccelerator("Space"), "CommandOrControl+Shift+Space");
  assert.equal(pushToTalkAccelerator("ArrowUp"), "CommandOrControl+Shift+Up");
});

test("keys the app never allows, unknown keys and odd input are refused", () => {
  for (const code of [
    "Escape",
    "Tab",
    "Enter",
    "ShiftLeft",
    "ControlRight",
    "MetaLeft",
    "AltLeft",
    "IntlBackslash",
    "KeyAA",
    "F25",
    "CommandOrControl+Q",
    "",
    5,
    undefined,
    { toString: () => "KeyV" },
  ])
    assert.equal(pushToTalkAccelerator(code), undefined, String(code));
});

/** Electron's globalShortcut and a window, as the controller sees them */
function fakes({ taken = [] } = {}) {
  const held = new Map();
  const shortcuts = {
    register(accelerator, callback) {
      if (taken.includes(accelerator) || held.has(accelerator)) return false;
      held.set(accelerator, callback);
      return true;
    },
    unregister(accelerator) {
      held.delete(accelerator);
    },
  };
  const sent = [];
  const app = { webContents: { send: (channel) => sent.push(channel) } };
  const controller = createPushToTalkController(shortcuts, () => app.webContents);
  const press = (accelerator) => held.get(accelerator)?.();
  return { held, sent, app, controller, press };
}

test("registering holds the combination and each press reaches the app", () => {
  const { held, sent, app, controller, press } = fakes();
  assert.equal(controller.set(app.webContents, "KeyV"), true);
  assert.deepEqual([...held.keys()], ["CommandOrControl+Shift+V"]);
  press("CommandOrControl+Shift+V");
  press("CommandOrControl+Shift+V");
  assert.deepEqual(sent, ["pushToTalkToggle", "pushToTalkToggle"]);
});

test("a new key replaces the old one; clearing gives it back", () => {
  const { held, app, controller } = fakes();
  controller.set(app.webContents, "KeyV");
  controller.set(app.webContents, "Backquote");
  assert.deepEqual([...held.keys()], ["CommandOrControl+Shift+`"]);
  controller.clear(app.webContents);
  assert.equal(held.size, 0);
});

test("a combination another app holds is reported, not taken over", () => {
  const { held, app, controller } = fakes({
    taken: ["CommandOrControl+Shift+V"],
  });
  assert.equal(controller.set(app.webContents, "KeyV"), false);
  assert.equal(held.size, 0);
});

test("only the app window may set or clear it", () => {
  const { held, app, controller } = fakes();
  const stranger = { send() {} };
  assert.equal(controller.set(stranger, "KeyV"), false);
  assert.equal(held.size, 0);
  controller.set(app.webContents, "KeyV");
  controller.clear(stranger);
  assert.equal(held.size, 1);
  // the window reloading or closing frees it
  controller.reset();
  assert.equal(held.size, 0);
});

test("an unknown key clears the previous combination and is refused", () => {
  const { held, app, controller } = fakes();
  controller.set(app.webContents, "KeyV");
  assert.equal(controller.set(app.webContents, "Escape"), false);
  assert.equal(held.size, 0);
});
