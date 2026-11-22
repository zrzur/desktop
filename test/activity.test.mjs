import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  detect,
  matches,
  namesNeedingPath,
  parseGetProcess,
  parsePaths,
  parsePs,
  parseTasklist,
  platformOf,
  procEntry,
  userEntry,
  validateList,
} from "../src/native/activity/detection.ts";
import {
  FrameError,
  FrameReader,
  MAX_PAYLOAD,
  OP_CLOSE,
  OP_FRAME,
  OP_HANDSHAKE,
  OP_PING,
  OP_PONG,
  encodeFrame,
} from "../src/native/activity/frames.ts";
import {
  RpcConnection,
  timeOf,
  toDataActivity,
} from "../src/native/activity/rpcProtocol.ts";
import { cleanDomain, siteActivity } from "../src/native/activity/sites.ts";
import {
  MAX_MESSAGE,
  WsError,
  WsReader,
  codeMatches,
  encodeWs,
  handshake,
  isExtensionOrigin,
  newPairingCode,
  originAllowed,
} from "../src/native/activity/websocket.ts";

const list = JSON.parse(
  readFileSync(new URL("../src/native/activity/detectable.json", import.meta.url), "utf8"),
);

/* Frames */

test("a frame survives the trip and arrives in any number of pieces", () => {
  const bytes = encodeFrame(OP_FRAME, { cmd: "SET_ACTIVITY", nonce: "1" });
  assert.equal(bytes.readUInt32LE(0), OP_FRAME);
  assert.equal(bytes.readUInt32LE(4), bytes.length - 8);

  const whole = new FrameReader().push(bytes);
  assert.deepEqual(whole, [{ op: OP_FRAME, data: { cmd: "SET_ACTIVITY", nonce: "1" } }]);

  const reader = new FrameReader();
  const out = [];
  for (const byte of bytes) out.push(...reader.push(Buffer.from([byte])));
  assert.equal(out.length, 1);
  assert.equal(reader.pending, 0);

  const two = Buffer.concat([encodeFrame(OP_PING, { a: 1 }), encodeFrame(OP_CLOSE, {})]);
  assert.deepEqual(
    new FrameReader().push(two).map((f) => f.op),
    [OP_PING, OP_CLOSE],
  );
});

test("an oversized frame is refused before its body arrives", () => {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(OP_FRAME, 0);
  header.writeUInt32LE(MAX_PAYLOAD + 1, 4);
  assert.throws(() => new FrameReader().push(header), (e) => e instanceof FrameError && e.code === "too_large");

  // and a flood without a valid header in sight
  const reader = new FrameReader();
  assert.throws(() => reader.push(Buffer.alloc(MAX_PAYLOAD + 64)), FrameError);
});

test("bad frames end the connection", () => {
  const unknownOp = Buffer.alloc(8);
  unknownOp.writeUInt32LE(9, 0);
  assert.throws(() => new FrameReader().push(unknownOp), (e) => e.code === "bad_opcode");

  const notJson = Buffer.concat([Buffer.from([1, 0, 0, 0, 3, 0, 0, 0]), Buffer.from("{{{")]);
  assert.throws(() => new FrameReader().push(notJson), (e) => e.code === "bad_json");

  for (const body of ["[1,2]", "42", "null", '"text"']) {
    const raw = Buffer.from(body);
    const header = Buffer.alloc(8);
    header.writeUInt32LE(OP_FRAME, 0);
    header.writeUInt32LE(raw.length, 4);
    assert.throws(() => new FrameReader().push(Buffer.concat([header, raw])), (e) => e.code === "bad_payload", body);
  }
});

test("half a frame waits for the rest", () => {
  const bytes = encodeFrame(OP_FRAME, { x: "y".repeat(100) });
  const reader = new FrameReader();
  assert.deepEqual(reader.push(bytes.subarray(0, 20)), []);
  assert.equal(reader.pending, 20);
  assert.equal(reader.push(bytes.subarray(20)).length, 1);
});

/* Protocol */

function hello(connection, clientId = "1234567890") {
  return connection.receive({ op: OP_HANDSHAKE, data: { v: 1, client_id: clientId } });
}

test("the handshake answers READY with a placeholder user, never the account", () => {
  const connection = new RpcConnection();
  const step = hello(connection);
  assert.equal(step.close, undefined);
  assert.equal(step.send[0].data.evt, "READY");
  assert.deepEqual(step.send[0].data.data.user.id, "0");
  assert.deepEqual(step.changes, [{ kind: "ready", clientId: "1234567890" }]);
});

test("nothing before the handshake, one handshake only, a plain client id", () => {
  const first = new RpcConnection().receive({
    op: OP_FRAME,
    data: { cmd: "SET_ACTIVITY", args: { activity: { details: "x" } } },
  });
  assert.equal(first.close, true);

  for (const bad of ["", "a b", "x".repeat(65), "../pipe", null, { id: 1 }]) {
    const step = new RpcConnection().receive({ op: OP_HANDSHAKE, data: { v: 1, client_id: bad } });
    assert.equal(step.close, true, String(bad));
  }
  assert.equal(new RpcConnection().receive({ op: OP_HANDSHAKE, data: { v: 2, client_id: "1" } }).close, true);

  const connection = new RpcConnection();
  hello(connection);
  assert.equal(hello(connection).close, true);
});

test("SET_ACTIVITY becomes an activity; null clears it; ping gets a pong", () => {
  const connection = new RpcConnection();
  hello(connection);
  const start = 1_700_000_000; // seconds
  const step = connection.receive({
    op: OP_FRAME,
    data: {
      cmd: "SET_ACTIVITY",
      nonce: "n1",
      args: {
        pid: 4242,
        activity: {
          details: "Ranked match",
          state: "In a party (2 of 5)",
          timestamps: { start },
          assets: { large_image: "map_dust", large_text: "Dust", small_image: "https://img.example/rank.png" },
          buttons: [{ label: "Watch", url: "https://example.com/watch" }, { label: "Bad", url: "http://x.example" }],
        },
      },
    },
  });
  assert.equal(step.send[0].data.nonce, "n1");
  const change = step.changes[0];
  assert.equal(change.kind, "activity");
  assert.equal(change.pid, 4242);
  assert.equal(change.activity.type, "Playing");
  assert.equal(change.activity.details, "Ranked match");
  assert.equal(change.activity.started_at, new Date(start * 1000).toISOString());
  assert.equal(change.activity.large_image, undefined, "a picture key of another service is dropped");
  assert.equal(change.activity.small_image, "https://img.example/rank.png");
  assert.deepEqual(change.activity.buttons, [{ label: "Watch", url: "https://example.com/watch" }]);

  const cleared = connection.receive({ op: OP_FRAME, data: { cmd: "SET_ACTIVITY", nonce: "n2", args: { pid: 4242, activity: null } } });
  assert.equal(cleared.changes[0].activity, null);

  const pong = connection.receive({ op: OP_PING, data: { t: 1 } });
  assert.equal(pong.send[0].op, OP_PONG);
  assert.deepEqual(pong.send[0].data, { t: 1 });

  const other = connection.receive({ op: OP_FRAME, data: { cmd: "AUTHORIZE", nonce: "n3" } });
  assert.equal(other.send[0].data.evt, "ERROR");
  assert.deepEqual(other.changes, []);
});

test("activity texts are one line, cut to length, and times accept seconds or milliseconds", () => {
  const activity = toDataActivity({
    type: 2,
    name: " Song\nname ",
    details: "d".repeat(400),
    timestamps: { start: 1_700_000_000_000, end: 1_699_000_000_000 },
  });
  assert.equal(activity.type, "Listening");
  assert.equal(activity.name, "Song name");
  assert.equal(Array.from(activity.details).length, 128);
  assert.equal(activity.ends_at, undefined, "an end before the start is dropped");
  assert.equal(timeOf(1_700_000_000), timeOf(1_700_000_000_000));
  assert.equal(timeOf(-5), undefined);
  assert.equal(timeOf("1700000000"), undefined);
  assert.equal(toDataActivity(null), null);
  assert.equal(toDataActivity({ type: 99 }).type, "Playing");
  assert.equal(toDataActivity({ type: "Using" }).type, "Using", "Zrzur's own names");
  assert.equal(toDataActivity({ type: "Dancing" }).type, "Playing");
});

/* Detection */

test("the shipped list is well formed and no id repeats", () => {
  assert.deepEqual(validateList(list), []);
  assert.ok(list.length >= 80);
  assert.ok(list.some((e) => e.category === "game"));
  assert.ok(list.some((e) => e.category === "app"));
  assert.equal(list.find((e) => e.id === "app.spotify").kind, "Listening");
  assert.equal(list.find((e) => e.id === "app.visual-studio-code").kind, "Using");
});

test("the list checker catches mistakes", () => {
  assert.ok(validateList({}).length > 0);
  const bad = [
    { id: "game.x", name: "X", category: "game", kind: "Using", exe: { win: ["x.exe"] } },
    { id: "game.x", name: "X", category: "game", kind: "Playing", exe: { win: ["x"] } },
    { id: "nope", name: "", category: "other", kind: "Playing", exe: {} },
  ];
  const problems = validateList(bad);
  assert.ok(problems.some((p) => p.includes("a game is Playing")));
  assert.ok(problems.some((p) => p.includes("id used twice")));
  assert.ok(problems.some((p) => p.includes("is not an .exe")));
  assert.ok(problems.some((p) => p.includes("no executable")));
});

const cs2 = list.find((e) => e.id === "game.counter-strike-2");
const code = list.find((e) => e.id === "app.visual-studio-code");

test("a match needs the name and the path hint: a renamed program is no game", () => {
  const real = { pid: 1, name: "cs2.exe", path: "D:\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe" };
  assert.equal(matches(cs2, real, "win"), true);
  assert.equal(matches(cs2, { ...real, name: "CS2.EXE" }, "win"), true, "names compare without case");
  assert.equal(matches(cs2, { pid: 2, name: "cs2.exe", path: "C:\\Users\\me\\Downloads\\cs2.exe" }, "win"), false);
  assert.equal(matches(cs2, { pid: 3, name: "cs2.exe" }, "win"), false, "no path, no match for a hinted entry");
  assert.equal(matches(cs2, real, "mac"), false, "names are per system");
});

test("games come before apps, entries can be turned off or renamed", () => {
  const running = [
    { pid: 10, name: "Code.exe", path: "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" },
    { pid: 11, name: "cs2.exe", path: "E:/SteamLibrary/steamapps/common/cs2/cs2.exe" },
  ];
  assert.equal(detect(running, list, {}, "win").entry.id, "game.counter-strike-2");
  assert.equal(
    detect(running, list, { "game.counter-strike-2": { off: true } }, "win").entry.id,
    "app.visual-studio-code",
  );
  const renamed = detect(running, list, { "game.counter-strike-2": { name: "CS" } }, "win");
  assert.equal(renamed.entry.name, "CS");
  assert.equal(renamed.pid, 11);
  assert.equal(detect([], list, {}, "win"), undefined);
});

test("macOS and Linux paths match their hints", () => {
  const mac = parsePs("  501 /Applications/Visual Studio Code.app/Contents/MacOS/Electron\n  77 /usr/sbin/cfprefsd\n");
  assert.equal(mac.length, 2);
  assert.equal(detect(mac, list, {}, "mac").entry.id, "app.visual-studio-code");

  const linux = [procEntry(900, "/usr/share/code/code", undefined), procEntry(901, undefined, "bash\n")];
  assert.equal(detect(linux, list, {}, "linux").entry.id, "app.visual-studio-code");
  assert.deepEqual(procEntry(901, undefined, "bash\n"), { pid: 901, name: "bash" });
  assert.equal(procEntry(902, "/opt/x/y (deleted)", undefined).path, "/opt/x/y");
  assert.equal(procEntry(903, undefined, undefined), undefined);
  assert.equal(platformOf("win32"), "win");
  assert.equal(platformOf("darwin"), "mac");
  assert.equal(platformOf("linux"), "linux");
});

test("tasklist output is read without paths and names that need one are known", () => {
  const out = '"System Idle Process","0","Services","0","8 K"\r\n"cs2.exe","4242","Console","1","2,000,000 K"\r\n"explorer.exe","1200","Console","1","90,000 K"\r\nINFO: nothing\r\n';
  const processes = parseTasklist(out);
  assert.deepEqual(processes.map((p) => p.name), ["cs2.exe", "explorer.exe"]);
  assert.equal(processes[0].pid, 4242);
  const names = namesNeedingPath(list, "win");
  assert.ok(names.has("cs2.exe"));
  assert.ok(!names.has("explorer.exe"));
});

test("Get-Process lines become processes with their .exe, paths by id", () => {
  const processes = parseGetProcess(
    ["4242|cs2", "10|League of Legends", "11|osu!", "bad line", "0|Idle", "12|C:\\x\\y", "13|Code.exe", ""].join("\r\n"),
  );
  assert.deepEqual(processes, [
    { pid: 4242, name: "cs2.exe" },
    { pid: 10, name: "League of Legends.exe" },
    { pid: 11, name: "osu!.exe" },
    { pid: 13, name: "Code.exe" },
  ]);
  const paths = parsePaths(["4242|D:\\Steam\\steamapps\\common\\cs2.exe", "10|", ""].join("\r\n"));
  assert.equal(paths.get(4242), "D:\\Steam\\steamapps\\common\\cs2.exe");
  assert.equal(paths.has(10), true);
  assert.equal(paths.get(10), undefined, "no path for another user's program");
  const found = detect(processes.map((p) => ({ ...p, path: paths.get(p.pid) })), list, {}, "win");
  assert.equal(found.entry.id, "game.counter-strike-2");
});

test("a program the person adds keeps its folder as the hint", () => {
  const entry = userEntry(3, { pid: 5, name: "MyGame.exe", path: "C:\\Games\\My Game\\MyGame.exe" }, "win", "  My Game  ", "Playing");
  assert.equal(entry.id, "user.3");
  assert.equal(entry.name, "My Game");
  assert.equal(entry.category, "game");
  assert.deepEqual(entry.hint, ["c:/games/my game"]);
  assert.equal(matches(entry, { pid: 6, name: "mygame.exe", path: "C:\\Games\\My Game\\MyGame.exe" }, "win"), true);
  assert.equal(matches(entry, { pid: 7, name: "MyGame.exe", path: "C:\\Temp\\MyGame.exe" }, "win"), false);
  assert.equal(userEntry(0, { pid: 1, name: "tool" }, "linux", "", "Using").name, "tool");
});

/* The extension's WebSocket */

const KEY = "dGhlIHNhbXBsZSBub25jZQ==";
function request(headers) {
  return ["GET / HTTP/1.1", ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)].join("\r\n");
}
const good = {
  Host: "127.0.0.1:48653",
  Upgrade: "websocket",
  Connection: "Upgrade",
  "Sec-WebSocket-Key": KEY,
  "Sec-WebSocket-Version": "13",
  Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
};

test("only a browser extension origin may open the socket, a paired one after pairing", () => {
  assert.equal(isExtensionOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop"), true);
  assert.equal(isExtensionOrigin("moz-extension://0d5a3e7c-6b64-4d1e-9f1d-6a2b9d2e1f00"), true);
  for (const bad of [undefined, "", "null", "*", "https://evil.example", "http://127.0.0.1", "chrome-extension://", "chrome-extension://abc/../x", "file://"]) {
    assert.equal(isExtensionOrigin(bad), false, String(bad));
  }
  const paired = ["chrome-extension://abcdefghijklmnopabcdefghijklmnop"];
  assert.equal(originAllowed(paired[0], paired, false), true);
  assert.equal(originAllowed("chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", paired, false), false);
  assert.equal(originAllowed("chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", paired, true), true, "only while pairing");
  assert.equal(originAllowed("https://evil.example", paired, true), false);
});

test("the handshake answers with the right accept key and refuses the rest", () => {
  const ok = handshake(request(good), () => true);
  assert.equal(ok.ok, true);
  const accept = createHash("sha1").update(KEY + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  assert.equal(accept, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  assert.ok(ok.response.includes(`Sec-WebSocket-Accept: ${accept}`));

  assert.equal(handshake(request({ ...good, Origin: "https://evil.example" }), (o) => isExtensionOrigin(o)).status, 403);
  const noOrigin = { ...good };
  delete noOrigin.Origin;
  assert.equal(handshake(request(noOrigin), (o) => isExtensionOrigin(o)).status, 403);
  assert.equal(handshake(request({ ...good, Host: "evil.example:48653" }), () => true).status, 403, "DNS rebinding");
  assert.equal(handshake(request({ ...good, "Sec-WebSocket-Version": "8" }), () => true).status, 426);
  assert.equal(handshake(request({ ...good, Upgrade: "h2c" }), () => true).status, 400);
  assert.equal(handshake("POST / HTTP/1.1\r\n", () => true).status, 400);
  assert.equal(handshake("GET / HTTP/1.1\r\n" + "X: y\r\n".repeat(2000), () => true).status, 431);
  assert.equal(handshake(request(good) + "\r\nOrigin: https://evil.example", () => true).status, 400, "repeated header");
});

function clientFrame(opcode, text, { fin = true, mask = true } = {}) {
  const payload = Buffer.from(text);
  const key = Buffer.from([1, 2, 3, 4]);
  const len = payload.length;
  const head = len < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, (mask ? 0x80 : 0) | len]) : Buffer.from([(fin ? 0x80 : 0) | opcode, (mask ? 0x80 : 0) | 126, len >> 8, len & 0xff]);
  const body = Buffer.from(payload);
  if (mask) for (let i = 0; i < body.length; i++) body[i] ^= key[i % 4];
  return Buffer.concat([head, mask ? key : Buffer.alloc(0), body]);
}

test("masked text frames are read, in pieces and in parts", () => {
  const reader = new WsReader();
  const frame = clientFrame(0x1, '{"type":"site","site":"youtube.com"}');
  const out = [];
  for (let i = 0; i < frame.length; i += 3) out.push(...reader.push(frame.subarray(i, i + 3)));
  assert.deepEqual(out, [{ kind: "text", text: '{"type":"site","site":"youtube.com"}' }]);

  const parts = Buffer.concat([clientFrame(0x1, "hel", { fin: false }), clientFrame(0x0, "lo")]);
  assert.deepEqual(new WsReader().push(parts), [{ kind: "text", text: "hello" }]);
  assert.equal(new WsReader().push(clientFrame(0x9, "p"))[0].kind, "ping");
  assert.equal(new WsReader().push(clientFrame(0x8, ""))[0].kind, "close");
});

test("unmasked, binary and oversized frames are refused", () => {
  assert.throws(() => new WsReader().push(clientFrame(0x1, "x", { mask: false })), (e) => e instanceof WsError && e.code === 1002);
  assert.throws(() => new WsReader().push(clientFrame(0x2, "x")), (e) => e.code === 1003);
  assert.throws(() => new WsReader().push(clientFrame(0x1, "x".repeat(MAX_MESSAGE + 1))), (e) => e.code === 1009);
  assert.throws(() => new WsReader().push(Buffer.from([0x81, 0xff, 0, 0, 0, 0, 0, 0, 0, 1])), (e) => e.code === 1009);
  assert.throws(() => new WsReader().push(clientFrame(0x0, "orphan")), (e) => e.code === 1002);
  const server = encodeWs(0x1, Buffer.from("ok"));
  assert.equal(server[1] & 0x80, 0, "server frames are not masked");
});

test("pairing codes are six digits and compared exactly", () => {
  for (let i = 0; i < 20; i++) assert.match(newPairingCode(), /^\d{6}$/);
  assert.equal(codeMatches("123456", "123456"), true);
  assert.equal(codeMatches("123456", "123457"), false);
  assert.equal(codeMatches("123456", 123456), false);
  assert.equal(codeMatches(undefined, "123456"), false);
  assert.equal(codeMatches("123456", "12345"), false);
});

test("the extension reports a domain only", () => {
  assert.equal(cleanDomain("www.YouTube.com"), "youtube.com");
  for (const bad of ["https://youtube.com/watch?v=1", "youtube.com/path", "localhost", "a..b", "-a.com", "", 5, "exa mple.com"]) {
    assert.equal(cleanDomain(bad), undefined, String(bad));
  }
  const activity = siteActivity("youtube.com", "YouTube", "Watching");
  assert.equal(activity.type, "Watching");
  assert.equal(activity.name, "YouTube");
  assert.equal(siteActivity("youtube.com", "", "Dancing").type, "Using");
  assert.equal(siteActivity("youtube.com", "", "Dancing").name, "youtube.com");
  assert.equal(siteActivity("https://youtube.com/x", "Y", "Watching"), null);
});
