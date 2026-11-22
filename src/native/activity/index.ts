/**
 * Rich presence on the desktop: what the person is doing right now.
 *
 * Three ways in, all on this computer only:
 * 1. Programs that are running, matched against `detectable.json` and the
 *    programs the person added (a scan every 15 seconds at most).
 * 2. Apps and games over the local RPC: named pipes `zrzur-ipc-0..9`
 *    (Windows) or sockets of that name in the runtime folder (macOS, Linux),
 *    speaking the common presence protocol (`frames.ts`, `rpcProtocol.ts`).
 *    As an opt-in, also the common `discord-ipc-N` name, only while that
 *    other app is not running.
 * 3. The Zrzur browser extension over a WebSocket on 127.0.0.1, after
 *    pairing with a code shown in settings (`websocket.ts`).
 *
 * Nothing runs unless the person shares their activity (the page tells
 * this module). The page sends what is here to the server; this module
 * never talks to the network. Nothing is written about what ran when:
 * stored are only the person's choices (entries turned off or renamed,
 * programs added, apps blocked, the paired extension).
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, readlinkSync, unlinkSync } from "node:fs";
import { Server, Socket, connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { app, ipcMain } from "electron";
import Store from "electron-store";

import { mainWindow } from "../window";

import detectableList from "./detectable.json";
import {
  Detectable,
  DetectableKind,
  Override,
  RunningProcess,
  detect,
  namesNeedingPath,
  parsePs,
  parseTasklist,
  platformOf,
  procEntry,
  userEntry,
} from "./detection";
import { FrameError, FrameReader, encodeFrame } from "./frames";
import { DataActivity, RpcConnection } from "./rpcProtocol";
import {
  WsError,
  WsReader,
  closeFrame,
  codeMatches,
  encodeWs,
  handshake,
  newPairingCode,
  originAllowed,
  textFrame,
} from "./websocket";
import { siteActivity } from "./sites";

const SCAN_EVERY_MS = 15_000;
const PIPE_COUNT = 10;
const MAX_CONNECTIONS = 16;
/** Ports tried for the extension, in order */
export const EXTENSION_PORTS = [48653, 48654, 48655];
const PAIRING_MS = 5 * 60_000;

type SeenApp = { id: string; name: string; blocked: boolean };

type Settings = {
  detection: boolean;
  overrides: Record<string, Override>;
  added: Detectable[];
  apps: SeenApp[];
  discordCompat: boolean;
  pairedOrigins: string[];
};

const store = new Store<Settings>({
  name: "zrzur-activity",
  defaults: {
    detection: true,
    overrides: {},
    added: [],
    apps: [],
    discordCompat: false,
    pairedOrigins: [],
  },
});

function settings(): Settings {
  return {
    detection: store.get("detection"),
    overrides: store.get("overrides"),
    added: store.get("added"),
    apps: store.get("apps"),
    discordCompat: store.get("discordCompat"),
    pairedOrigins: store.get("pairedOrigins"),
  };
}

const platform = platformOf(process.platform);

/* State while the app runs (never stored) */
let sharing = false;
let running: RunningProcess[] = [];
const pathCache = new Map<number, string | undefined>();
let detected: { entry: Detectable; pid: number; since: string } | undefined;
type RpcSource = {
  key: string;
  appId: string;
  appName: string;
  pid?: number;
  activity: DataActivity;
  at: number;
};
/** Activities from apps right now, newest last */
let rpcSources: RpcSource[] = [];
let scanTimer: NodeJS.Timeout | undefined;
let pipeServers: Server[] = [];
let wsServer: Server | undefined;
let wsPort: number | undefined;
let pairingCode: string | undefined;
let pairingUntil = 0;
const sockets = new Set<Socket>();
let lastSent = "";

/* What the page sends to the server */
export type ActivityUpdate = {
  rpc: DataActivity | null;
  desktop: DataActivity | null;
  /** Which app set `rpc`, for the settings page */
  rpcApp?: string;
};

function current(): ActivityUpdate {
  const { apps } = settings();
  const blocked = new Set(apps.filter((a) => a.blocked).map((a) => a.id));
  const live = rpcSources.filter((s) => !blocked.has(s.appId));
  const top = live[live.length - 1];
  let desktop: DataActivity | null = null;
  if (detected) {
    const sameAsApp =
      top &&
      (top.pid === detected.pid ||
        top.activity.name.toLowerCase() === detected.entry.name.toLowerCase());
    if (!sameAsApp) {
      desktop = {
        type: detected.entry.kind,
        name: detected.entry.name,
        started_at: detected.since,
      };
    }
  }
  return {
    rpc: top ? top.activity : null,
    desktop,
    rpcApp: top?.appName,
  };
}

function notify() {
  const update = current();
  const text = JSON.stringify(update);
  if (text === lastSent) return;
  lastSent = text;
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("activityUpdate", update);
}

function sendState() {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("activityState", state());
}

/* Programs running */

function list(): Detectable[] {
  return [...(detectableList as Detectable[]), ...settings().added];
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => resolve(error ? "" : String(stdout)),
    );
  });
}

async function windowsPaths(pids: number[]) {
  const ask = pids.filter((pid) => !pathCache.has(pid));
  if (!ask.length) return;
  // one PowerShell call for the new ones only; no admin needed for the
  // person's own programs (others answer without a path)
  const out = await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Get-Process -Id ${ask.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.Path)" }`,
  ]);
  for (const pid of ask) pathCache.set(pid, undefined);
  for (const line of out.split(/\r?\n/)) {
    const at = line.indexOf("|");
    if (at <= 0) continue;
    const pid = Number(line.slice(0, at));
    const path = line.slice(at + 1).trim();
    if (Number.isInteger(pid)) pathCache.set(pid, path || undefined);
  }
}

async function processList(): Promise<RunningProcess[]> {
  if (platform === "win") {
    const processes = parseTasklist(await run("tasklist.exe", ["/fo", "csv", "/nh"]));
    const want = namesNeedingPath(list(), platform);
    const needPath = processes.filter((p) => want.has(p.name.toLowerCase()));
    await windowsPaths(needPath.map((p) => p.pid));
    // forget processes that are gone
    const alive = new Set(processes.map((p) => p.pid));
    for (const pid of pathCache.keys()) if (!alive.has(pid)) pathCache.delete(pid);
    return processes.map((p) => ({ ...p, path: pathCache.get(p.pid) }));
  }
  if (platform === "mac") {
    return parsePs(await run("ps", ["-axo", "pid=,comm="]));
  }
  const out: RunningProcess[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    let exe: string | undefined;
    let comm: string | undefined;
    try {
      exe = readlinkSync(`/proc/${pid}/exe`);
    } catch {
      // another user's process: no path
    }
    if (!exe) {
      try {
        comm = readFileSync(`/proc/${pid}/comm`, "utf8");
      } catch {
        continue;
      }
    }
    const entry = procEntry(pid, exe, comm);
    if (entry) out.push(entry);
  }
  return out;
}

async function scan() {
  if (!sharing || !settings().detection) return;
  running = await processList();
  const found = detect(running, list(), settings().overrides, platform);
  if (!found) {
    detected = undefined;
  } else if (detected?.entry.id !== found.entry.id || detected.pid !== found.pid) {
    detected = { ...found, since: new Date().toISOString() };
  } else {
    detected = { ...detected, entry: found.entry };
  }
  notify();
}

function startScanning() {
  if (scanTimer || !settings().detection) return;
  void scan();
  scanTimer = setInterval(() => void scan(), SCAN_EVERY_MS);
  scanTimer.unref?.();
}

function stopScanning() {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = undefined;
  detected = undefined;
  running = [];
  pathCache.clear();
}

/* The local RPC */

function pipePath(name: string, index: number) {
  if (process.platform === "win32") return `\\\\?\\pipe\\${name}-${index}`;
  const base =
    process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || tmpdir();
  return join(base, `${name}-${index}`);
}

/** Whether something answers on a pipe (another app owns it) */
function answers(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    setTimeout(() => done(false), 500).unref?.();
  });
}

async function otherAppRunning() {
  for (let i = 0; i < PIPE_COUNT; i++) {
    if (await answers(pipePath("discord-ipc", i))) return true;
  }
  return false;
}

function appName(clientId: string, pid: number | undefined): string {
  const known = settings().apps.find((a) => a.id === clientId);
  if (known) return known.name;
  // the program behind it, when it is on the list
  const process = pid ? running.find((p) => p.pid === pid) : undefined;
  if (process) {
    const entry = detect([process], list(), {}, platform);
    if (entry) return entry.entry.name;
    return process.name.replace(/\.exe$/i, "");
  }
  return clientId;
}

function remember(clientId: string, name: string) {
  const apps = settings().apps;
  if (apps.some((a) => a.id === clientId)) return;
  store.set("apps", [...apps, { id: clientId, name, blocked: false }].slice(-50));
  sendState();
}

function dropSource(key: string) {
  const before = rpcSources.length;
  rpcSources = rpcSources.filter((s) => s.key !== key);
  if (rpcSources.length !== before) notify();
}

let connectionCount = 0;

function serveRpc(socket: Socket) {
  if (connectionCount >= MAX_CONNECTIONS) {
    socket.destroy();
    return;
  }
  connectionCount++;
  sockets.add(socket);
  const key = `${Date.now()}-${Math.random()}`;
  const reader = new FrameReader();
  const connection = new RpcConnection();
  const end = () => {
    if (socket.destroyed) return;
    socket.end();
    setTimeout(() => socket.destroy(), 200).unref?.();
  };
  socket.on("data", (chunk: Buffer) => {
    let frames;
    try {
      frames = reader.push(chunk);
    } catch (error) {
      if (error instanceof FrameError) end();
      return;
    }
    for (const frame of frames) {
      const step = connection.receive(frame);
      for (const out of step.send) socket.write(encodeFrame(out.op, out.data));
      for (const change of step.changes) {
        if (change.kind === "activity") {
          const name = change.activity?.name ?? appName(change.clientId, change.pid);
          remember(change.clientId, appName(change.clientId, change.pid));
          if (!change.activity) {
            dropSource(key);
          } else {
            rpcSources = [
              ...rpcSources.filter((s) => s.key !== key),
              {
                key,
                appId: change.clientId,
                appName: appName(change.clientId, change.pid),
                pid: change.pid,
                activity: { ...change.activity, name },
                at: Date.now(),
              },
            ];
            notify();
          }
        }
      }
      if (step.close) {
        end();
        break;
      }
    }
  });
  const gone = () => {
    if (!sockets.delete(socket)) return;
    connectionCount--;
    dropSource(key);
  };
  socket.on("close", gone);
  socket.on("error", gone);
  socket.setTimeout(0);
}

function listenOn(path: string): Promise<Server | undefined> {
  return new Promise((resolve) => {
    if (process.platform !== "win32" && existsSync(path)) {
      // a socket file left by a crash; only ever our own name
      try {
        unlinkSync(path);
      } catch {
        resolve(undefined);
        return;
      }
    }
    const server = createServer(serveRpc);
    server.maxConnections = MAX_CONNECTIONS;
    server.once("error", () => resolve(undefined));
    server.listen(path, () => resolve(server));
  });
}

async function listenFirstFree(name: string) {
  for (let i = 0; i < PIPE_COUNT; i++) {
    const path = pipePath(name, i);
    if (await answers(path)) continue;
    const server = await listenOn(path);
    if (server) return server;
  }
  return undefined;
}

async function startRpc() {
  if (pipeServers.length) return;
  const own = await listenFirstFree("zrzur-ipc");
  if (own) pipeServers.push(own);
  if (settings().discordCompat && !(await otherAppRunning())) {
    const compat = await listenFirstFree("discord-ipc");
    if (compat) pipeServers.push(compat);
  }
}

function stopRpc() {
  for (const server of pipeServers) server.close();
  pipeServers = [];
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  connectionCount = 0;
  rpcSources = [];
}

/* The browser extension */

function pairing() {
  return !!pairingCode && Date.now() < pairingUntil;
}

function serveExtension(socket: Socket) {
  if (connectionCount >= MAX_CONNECTIONS) {
    socket.destroy();
    return;
  }
  connectionCount++;
  sockets.add(socket);
  const key = `ext-${Date.now()}-${Math.random()}`;
  let open = false;
  let origin = "";
  let request = "";
  const reader = new WsReader();
  const gone = () => {
    if (!sockets.delete(socket)) return;
    connectionCount--;
    dropSource(key);
  };
  socket.on("close", gone);
  socket.on("error", gone);
  socket.setTimeout(30_000, () => {
    if (!open) socket.destroy();
  });

  const paired = () => settings().pairedOrigins.includes(origin);
  const reply = (value: unknown) => socket.write(textFrame(value));

  socket.on("data", (chunk: Buffer) => {
    if (!open) {
      request += chunk.toString("latin1");
      if (request.length > 8192) {
        socket.destroy();
        return;
      }
      if (!request.includes("\r\n\r\n")) return;
      const answer = handshake(request.split("\r\n\r\n")[0], (o) =>
        originAllowed(o, settings().pairedOrigins, pairing()),
      );
      socket.write(answer.response);
      if (!answer.ok) {
        socket.end();
        return;
      }
      open = true;
      origin = answer.origin;
      reply({ type: "ready", paired: paired() });
      return;
    }
    let messages;
    try {
      messages = reader.push(chunk);
    } catch (error) {
      socket.write(closeFrame(error instanceof WsError ? error.code : 1002));
      socket.end();
      return;
    }
    for (const message of messages) {
      if (message.kind === "close") {
        socket.write(closeFrame(1000));
        socket.end();
        return;
      }
      if (message.kind === "ping") {
        socket.write(encodeWs(0xa, message.data));
        continue;
      }
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(message.text);
      } catch {
        continue;
      }
      if (data.type === "pair") {
        if (pairing() && codeMatches(pairingCode, data.code)) {
          store.set("pairedOrigins", [...new Set([...settings().pairedOrigins, origin])].slice(-4));
          pairingCode = undefined;
          remember("zrzur-browser-extension", "Zrzur browser extension");
          sendState();
          reply({ type: "paired" });
        } else {
          reply({ type: "pairFailed" });
        }
        continue;
      }
      if (!paired()) {
        reply({ type: "notPaired" });
        continue;
      }
      if (data.type === "site") {
        const activity = siteActivity(data.site, data.name, data.kind);
        // the same site keeps the time it started
        const before = rpcSources.find((s) => s.key === key);
        if (activity && before && before.activity.name === activity.name)
          activity.started_at = before.activity.started_at;
        if (!activity) {
          dropSource(key);
        } else {
          rpcSources = [
            ...rpcSources.filter((s) => s.key !== key),
            {
              key,
              appId: "zrzur-browser-extension",
              appName: "Zrzur browser extension",
              activity,
              at: Date.now(),
            },
          ];
          notify();
        }
      }
    }
  });
}

async function startExtensionServer() {
  if (wsServer) return;
  for (const port of EXTENSION_PORTS) {
    const server = createServer(serveExtension);
    const ok = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      // loopback only: nothing on the network can reach it
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (ok) {
      wsServer = server;
      wsPort = port;
      return;
    }
  }
}

function stopExtensionServer() {
  wsServer?.close();
  wsServer = undefined;
  wsPort = undefined;
}

/* On and off */

async function start() {
  await startRpc();
  await startExtensionServer();
  startScanning();
  sendState();
}

function stop() {
  stopScanning();
  stopRpc();
  stopExtensionServer();
  notify();
  sendState();
}

/** What the settings page shows */
function state() {
  const s = settings();
  const all = list();
  return {
    sharing,
    detection: s.detection,
    discordCompat: s.discordCompat,
    platform,
    entries: all.map((entry) => ({
      id: entry.id,
      name: s.overrides[entry.id]?.name ?? entry.name,
      originalName: entry.name,
      category: entry.category,
      kind: entry.kind,
      off: !!s.overrides[entry.id]?.off,
      added: entry.id.startsWith("user."),
      running: detected?.entry.id === entry.id,
    })),
    apps: s.apps.map((a) => ({
      ...a,
      active: rpcSources.some((source) => source.appId === a.id),
    })),
    extension: {
      port: wsPort,
      paired: s.pairedOrigins.length,
      pairingCode: pairing() ? pairingCode : undefined,
    },
    pipes: pipeServers.length,
  };
}

/** Programs running now that the person could add (names only) */
function addable() {
  const known = new Set(
    list().flatMap((entry) => (entry.exe[platform] ?? []).map((n) => n.toLowerCase())),
  );
  const seen = new Set<string>();
  return running
    .filter((p) => {
      const name = p.name.toLowerCase();
      if (known.has(name) || seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((p) => ({ pid: p.pid, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 300);
}

export function initActivity() {
  ipcMain.handle("activityState", () => state());
  ipcMain.handle("activityCurrent", () => current());

  ipcMain.handle("activitySetSharing", async (_event, on: unknown) => {
    const next = on === true;
    if (next === sharing) return state();
    sharing = next;
    if (sharing) await start();
    else stop();
    return state();
  });

  ipcMain.handle("activitySetDetection", (_event, on: unknown) => {
    store.set("detection", on === true);
    if (on === true && sharing) startScanning();
    else {
      stopScanning();
      notify();
    }
    return state();
  });

  ipcMain.handle("activitySetEntry", (_event, id: unknown, change: unknown) => {
    if (typeof id !== "string" || !list().some((entry) => entry.id === id)) return state();
    const c = (change ?? {}) as { name?: unknown; off?: unknown };
    const overrides = { ...settings().overrides };
    const next: Override = { ...overrides[id] };
    if (typeof c.name === "string") {
      const name = c.name.trim().slice(0, 128);
      if (name) next.name = name;
      else delete next.name;
    }
    if (typeof c.off === "boolean") next.off = c.off;
    if (!next.name && !next.off) delete overrides[id];
    else overrides[id] = next;
    store.set("overrides", overrides);
    void scan();
    return state();
  });

  ipcMain.handle("activityRunning", async () => {
    if (!running.length) running = await processList();
    return addable();
  });

  ipcMain.handle(
    "activityAdd",
    async (_event, pid: unknown, name: unknown, kind: unknown) => {
      const kinds: DetectableKind[] = ["Playing", "Using", "Listening", "Watching"];
      const process = running.find((p) => p.pid === pid);
      if (!process || typeof name !== "string" || !kinds.includes(kind as DetectableKind))
        return state();
      if (platform === "win") await windowsPaths([process.pid]);
      const withPath = { ...process, path: process.path ?? pathCache.get(process.pid) };
      const added = settings().added;
      const index = added.reduce((n, e) => Math.max(n, Number(e.id.slice(5)) + 1), 0);
      store.set(
        "added",
        [...added, userEntry(index, withPath, platform, name, kind as DetectableKind)].slice(-100),
      );
      void scan();
      return state();
    },
  );

  ipcMain.handle("activityRemoveAdded", (_event, id: unknown) => {
    store.set(
      "added",
      settings().added.filter((entry) => entry.id !== id),
    );
    const overrides = { ...settings().overrides };
    if (typeof id === "string") delete overrides[id];
    store.set("overrides", overrides);
    void scan();
    return state();
  });

  ipcMain.handle("activityBlockApp", (_event, id: unknown, blocked: unknown) => {
    store.set(
      "apps",
      settings().apps.map((a) => (a.id === id ? { ...a, blocked: blocked === true } : a)),
    );
    notify();
    return state();
  });

  ipcMain.handle("activityForgetApp", (_event, id: unknown) => {
    store.set(
      "apps",
      settings().apps.filter((a) => a.id !== id),
    );
    if (id === "zrzur-browser-extension") store.set("pairedOrigins", []);
    notify();
    return state();
  });

  ipcMain.handle("activitySetCompat", async (_event, on: unknown) => {
    store.set("discordCompat", on === true);
    if (sharing) {
      stopRpc();
      await startRpc();
      notify();
    }
    return state();
  });

  ipcMain.handle("activityStartPairing", () => {
    pairingCode = newPairingCode();
    pairingUntil = Date.now() + PAIRING_MS;
    return state();
  });

  ipcMain.handle("activityStopPairing", () => {
    pairingCode = undefined;
    return state();
  });

  app.on("will-quit", () => stop());
}
