import assert from "node:assert/strict";
import test from "node:test";

import { describeSources } from "../src/native/screenSources.ts";

const PNG = "data:image/png;base64," + "A".repeat(40);
function image({ empty = false, width = 32, height = 32, url = PNG, jpeg = "QUJD" } = {}) {
  return {
    isEmpty: () => empty,
    getSize: () => ({ width, height }),
    resize: () => image({ width: 64, height: 64, url, jpeg }),
    toDataURL: () => url,
    toJPEG: () => ({ toString: () => jpeg }),
  };
}

test("screens are numbered in the system's order; windows keep their title and icon", () => {
  const list = describeSources([
    { id: "screen:0:0", name: "Gesamter Bildschirm", thumbnail: image() },
    { id: "window:11:0", name: "  Notes  ", thumbnail: image(), appIcon: image() },
    { id: "screen:1:0", name: "Screen 2", thumbnail: image() },
  ]);
  assert.deepEqual(
    list.map((s) => [s.idx, s.kind, s.screenNumber, s.screenCount, s.isFullScreen]),
    [
      [0, "screen", 1, 2, true],
      [1, "window", undefined, undefined, false],
      [2, "screen", 2, 2, true],
    ],
  );
  assert.equal(list[1].name, "Notes");
  assert.equal(list[1].image, PNG);
  assert.equal(list[0].image, undefined);
  assert.equal(list[0].thumbnail, "data:image/jpeg;base64,QUJD");
});

test("an icon or preview the system could not read is left out, never sent broken", () => {
  const [a, b, c, d] = describeSources([
    { id: "window:1:0", name: "No pictures" },
    { id: "window:2:0", name: "Empty", thumbnail: image({ empty: true }), appIcon: image({ empty: true }) },
    { id: "window:3:0", name: "No data", thumbnail: image({ jpeg: "" }), appIcon: image({ url: "data:image/png;base64," }) },
    {
      id: "window:4:0",
      name: "Throws",
      thumbnail: { isEmpty: () => { throw new Error("gone"); } },
      appIcon: image({ width: 0, height: 0 }),
    },
  ]);
  for (const source of [a, b, c, d]) {
    assert.equal(source.image, undefined, source.name);
    assert.equal(source.thumbnail, undefined, source.name);
    assert.equal(source.kind, "window");
  }
});

test("a very long window title is cut", () => {
  const [source] = describeSources([{ id: "window:1:0", name: "x".repeat(900) }]);
  assert.equal(source.name.length, 160);
});
