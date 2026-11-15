import assert from "node:assert/strict";
import test from "node:test";

import { answerOnce, displayStreams } from "../src/native/displayMedia.ts";

const sources = ["screen:0", "window:1"];

test("closing the picker refuses with null, never an empty object", () => {
  for (const idx of [-1, 2, 1.5, "0", undefined, null, NaN]) {
    assert.equal(displayStreams(sources, idx, true, true), null, String(idx));
  }
  assert.equal(displayStreams([], 0, false, false), null);
});

test("a picked source is shared; system sound only when asked and kept", () => {
  assert.deepEqual(displayStreams(sources, 1, false, true), { video: "window:1" });
  assert.deepEqual(displayStreams(sources, 1, true, false), { video: "window:1" });
  assert.deepEqual(displayStreams(sources, 0, true, true), {
    video: "screen:0",
    audio: "loopback",
  });
});

test("the callback is answered once and its error does not escape", () => {
  const calls = [];
  const errors = [];
  const answer = answerOnce(
    (streams) => {
      calls.push(streams);
      // what Electron 44 does with an empty answer to a video request
      if (streams && !streams.video)
        throw new TypeError("Video was requested, but no video stream was provided");
    },
    (error) => errors.push(error),
  );
  answer({});
  answer(null);
  assert.equal(calls.length, 1);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /no video stream/);
});
