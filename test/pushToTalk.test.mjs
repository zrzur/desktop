import assert from "node:assert/strict";
import test from "node:test";

import {
  createPushToTalkController,
  pushToTalkAccelerator,
} from "../src/native/pushToTalkKeys.ts";

test("the push-to-talk key becomes Ctrl/Cmd+Shift with that key", () => {
  assert.equal(pushToTalkAccelerator("Backquote"), "CommandOrControl+Shift+`");
  assert.equal(pushToTalkAccelerator("KeyB"), "CommandOrControl+Shift+B");
  assert.equal(pushToTalkAccelerator("Digit4"), "CommandOrControl+Shift+4");
  assert.equal(pushToTalkAccelerator("F13"), "CommandOrControl+Shift+F13");
  assert.equal(pushToTalkAccelerator("Numpad5"), "CommandOrControl+Shift+num5");
});

test("combinations other apps use for editing and moving around are never taken", () => {
  // Ctrl+Shift+A/C/F/N/T/V/W/X/Z: select, copy, find, new window, reopen
  // tab, paste plain, close window, cut, redo; arrows, Space, Home/End and
  // PageUp/PageDown extend selections
  for (const code of [
    "KeyA",
    "KeyC",
    "KeyF",
    "KeyN",
    "KeyT",
    "KeyV",
    "KeyW",
    "KeyX",
    "KeyZ",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ])
    assert.equal(pushToTalkAccelerator(code), undefined, code);
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
    { toString: () => "KeyB" },
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
  const mainFrame = { name: "main" };
  const app = {
    webContents: { mainFrame, send: (channel) => sent.push(channel) },
  };
  const controller = createPushToTalkController(shortcuts, () => app.webContents);
  const press = (accelerator) => held.get(accelerator)?.();
  /** An IPC event from the app window's top frame */
  const own = { sender: app.webContents, senderFrame: mainFrame };
  return { held, sent, app, own, controller, press };
}

test("registering holds the combination and each press reaches the app", () => {
  const { held, sent, own, controller, press } = fakes();
  assert.equal(controller.set(own, "KeyB"), true);
  assert.deepEqual([...held.keys()], ["CommandOrControl+Shift+B"]);
  press("CommandOrControl+Shift+B");
  press("CommandOrControl+Shift+B");
  assert.deepEqual(sent, ["pushToTalkToggle", "pushToTalkToggle"]);
});

test("a new key replaces the old one; clearing gives it back", () => {
  const { held, own, controller } = fakes();
  controller.set(own, "KeyB");
  controller.set(own, "Backquote");
  assert.deepEqual([...held.keys()], ["CommandOrControl+Shift+`"]);
  controller.clear(own);
  assert.equal(held.size, 0);
});

test("a combination another app holds is reported, not taken over", () => {
  const { held, own, controller } = fakes({
    taken: ["CommandOrControl+Shift+B"],
  });
  assert.equal(controller.set(own, "KeyB"), false);
  assert.equal(held.size, 0);
});

test("only the app window's own page may set or clear it", () => {
  const { held, app, own, controller } = fakes();
  const stranger = { sender: { send() {} }, senderFrame: {} };
  // an embed inside the app window: right window, wrong frame
  const embed = { sender: app.webContents, senderFrame: { name: "embed" } };
  assert.equal(controller.set(stranger, "KeyB"), false);
  assert.equal(controller.set(embed, "KeyB"), false);
  assert.equal(controller.set(undefined, "KeyB"), false);
  assert.equal(held.size, 0);
  controller.set(own, "KeyB");
  controller.clear(stranger);
  controller.clear(embed);
  assert.equal(held.size, 1);
  // the window reloading or closing frees it
  controller.reset();
  assert.equal(held.size, 0);
});

test("an unknown key clears the previous combination and is refused", () => {
  const { held, own, controller } = fakes();
  controller.set(own, "KeyB");
  assert.equal(controller.set(own, "Escape"), false);
  assert.equal(held.size, 0);
});

test("a reload, crash or closed window frees the combination", () => {
  for (const event of ["did-start-navigation", "render-process-gone", "destroyed"]) {
    const { held, own, controller } = fakes();
    const listeners = new Map();
    const contents = { on: (name, listener) => listeners.set(name, listener) };
    controller.watch(contents);
    controller.set(own, "KeyB");
    listeners.get(event)?.({ isMainFrame: true, isSameDocument: false });
    assert.equal(held.size, 0, event);
  }
  // moving inside the page (hash, history) keeps it
  const { held, own, controller } = fakes();
  const listeners = new Map();
  controller.watch({ on: (name, listener) => listeners.set(name, listener) });
  controller.set(own, "KeyB");
  listeners.get("did-start-navigation")({ isMainFrame: true, isSameDocument: true });
  listeners.get("did-start-navigation")({ isMainFrame: false, isSameDocument: false });
  assert.equal(held.size, 1);
});
