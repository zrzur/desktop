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

import { ChildProcess, execFile, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  unlinkSync,
} from "node:fs";
import { Server, Socket, connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { IpcMainInvokeEvent, Notification, app, ipcMain } from "electron";
import Store from "electron-store";

import { shellLanguage } from "../locale";
import { mainWindow } from "../window";

import { compatStep, mayRemoveSocketFile } from "./compat";
import detectableList from "./detectable.json";
import {
  Detectable,
  DetectableKind,
  Override,
  RunningProcess,
  detect,
  namesNeedingPath,
  otherChatAppRunning,
  parseGetProcess,
  parsePaths,
  parsePs,
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

/** An app that reported once. `decided` false: held until Show or Block. */
type SeenApp = {
  id: string;
  name: string;
  blocked: boolean;
  decided?: boolean;
  /** The program behind it, when the system said */
  path?: string;
};

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

/** Typed access to the store (electron-store's typings are broken, as in config.ts) */
const kv = store as never as {
  get<K extends keyof Settings>(key: K): Settings[K];
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
};

function settings(): Settings {
  return {
    detection: kv.get("detection"),
    overrides: kv.get("overrides"),
    added: kv.get("added"),
    apps: kv.get("apps"),
    discordCompat: kv.get("discordCompat"),
    pairedOrigins: kv.get("pairedOrigins"),
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
let ownServer: Server | undefined;
let compatServer: Server | undefined;
let compatPath: string | undefined;
let compatTimer: NodeJS.Timeout | undefined;
const compatSockets = new Set<Socket>();
let wsServer: Server | undefined;
let wsPort: number | undefined;
let pairingCode: string | undefined;
let pairingUntil = 0;
/** Wrong codes since the code was shown; the code is dropped at the limit */
let pairingMisses = 0;
const PAIRING_TRIES = 5;
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
  // blocked apps never show; a new app is held until the person decides
  // (apps from before the question existed count as decided)
  const held = new Set(
    apps.filter((a) => a.blocked || a.decided === false).map((a) => a.id),
  );
  const live = rpcSources.filter((s) => !held.has(s.appId));
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

/*
 * Windows: one PowerShell, started while scanning and kept, answers
 * Get-Process in about 0.2 s (measured 2026-11-22; `tasklist` took 6 to 25 s
 * on the same busy computer). It runs with the person's rights; no admin.
 */
let shell: ChildProcess | undefined;
let shellOut = "";
let shellTurn: Promise<unknown> = Promise.resolve();
const END = "<<zrzur-end>>";

function stopShell() {
  shell?.kill();
  shell = undefined;
  shellOut = "";
}

function askShell(command: string): Promise<string> {
  return new Promise<string>((resolve) => {
    if (!shell || shell.exitCode !== null) {
      shell = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "-"],
        { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
      );
      shell.stdout?.setEncoding("utf8");
      shell.on("exit", () => (shell = undefined));
      shell.stdin?.write("[Console]::OutputEncoding = [Text.Encoding]::UTF8\n");
    }
    const current = shell;
    const timer = setTimeout(() => {
      current.stdout?.off("data", onData);
      stopShell();
      resolve("");
    }, 10_000);
    function onData(chunk: string) {
      shellOut += chunk;
      const at = shellOut.indexOf(END);
      if (at < 0) return;
      const out = shellOut.slice(0, at);
      shellOut = shellOut.slice(at + END.length);
      clearTimeout(timer);
      current.stdout?.off("data", onData);
      resolve(out);
    }
    current.stdout?.on("data", onData);
    current.stdin?.write(`${command}; "${END}"\n`);
  });
}

/** One question at a time to the shell */
function powershell(command: string): Promise<string> {
  const turn = shellTurn.then(() => askShell(command));
  shellTurn = turn.catch(() => undefined);
  return turn;
}

async function windowsPaths(pids: number[]) {
  const ask = pids.filter((pid) => Number.isInteger(pid) && !pathCache.has(pid));
  if (!ask.length) return;
  // the new ones only; the person's own programs answer with a path
  const paths = parsePaths(
    await powershell(
      `Get-Process -Id ${ask.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.Path)" }`,
    ),
  );
  for (const pid of ask) pathCache.set(pid, paths.get(pid));
}

async function processList(): Promise<RunningProcess[]> {
  if (platform === "win") {
    const processes = parseGetProcess(
      await powershell('Get-Process | ForEach-Object { "$($_.Id)|$($_.ProcessName)" }'),
    );
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
  stopShell();
  detected = undefined;
  running = [];
  pathCache.clear();
}

/* The local RPC */

function pipePath(name: string, index: number) {
  if (process.platform === "win32") return `\\\\?\\pipe\\${name}-${index}`;
  // the per-user runtime folder first: only this user can reach it
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

/** Whether another app answers on a `discord-ipc-N` pipe that is not ours */
async function otherPipeAnswers() {
  for (let i = 0; i < PIPE_COUNT; i++) {
    const path = pipePath("discord-ipc", i);
    if (path === compatPath) continue;
    if (await answers(path)) return true;
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

/** The program behind a pid, if the system says */
function programPath(pid: number | undefined): string | undefined {
  if (!pid) return undefined;
  return running.find((p) => p.pid === pid)?.path ?? pathCache.get(pid);
}

/** Whether a pid is a program on Zrzur's own list (shown without asking) */
function shippedProgram(pid: number | undefined) {
  const process = pid ? running.find((p) => p.pid === pid) : undefined;
  return !!process && !!detect([process], detectableList as Detectable[], {}, platform);
}

/** Keep the list of apps: blocked ones always stay, the others up to 50 */
function keepApps(apps: SeenApp[]) {
  const blocked = apps.filter((a) => a.blocked);
  const others = apps.filter((a) => !a.blocked).slice(-50);
  return apps.filter((a) => blocked.includes(a) || others.includes(a));
}

/** Words of the "new app" notice (legal T-4), in the shell's language */
function askText(app: string) {
  const language = shellLanguage();
  if (language === "ar") return `يريد ${app} أن يُظهر ما تفعله على زرزور.`;
  if (language === "de") return `${app} möchte auf Zrzur zeigen, was du gerade machst.`;
  return `${app} wants to show what you are doing on Zrzur.`;
}

/**
 * Note an app the first time it reports. A new app is held: nothing it
 * sends is shown until the person picks Show or Block (legal RP-03).
 * Programs on Zrzur's own list and the paired browser extension are shown
 * without asking.
 */
function remember(clientId: string, name: string, path: string | undefined, allow: boolean) {
  const apps = settings().apps;
  if (apps.some((a) => a.id === clientId)) return;
  kv.set(
    "apps",
    keepApps([...apps, { id: clientId, name, blocked: false, decided: allow, path }]),
  );
  sendState();
  if (!allow && Notification.isSupported()) {
    const notice = new Notification({ title: "Zrzur", body: askText(name) });
    notice.on("click", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.webContents.send("activityAsk", clientId);
      }
    });
    notice.show();
  }
}

function dropSource(key: string) {
  const before = rpcSources.length;
  rpcSources = rpcSources.filter((s) => s.key !== key);
  if (rpcSources.length !== before) notify();
}

let connectionCount = 0;

function serveRpc(compat: boolean) {
  return (socket: Socket) => {
    if (connectionCount >= MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }
    connectionCount++;
    sockets.add(socket);
    if (compat) compatSockets.add(socket);
    const key = `${Date.now()}-${Math.random()}`;
    const reader = new FrameReader();
    const connection = new RpcConnection({ compat });
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
          if (change.kind !== "activity") continue;
          const shownName = appName(change.clientId, change.pid);
          remember(change.clientId, shownName, programPath(change.pid), shippedProgram(change.pid));
          if (!change.activity) {
            dropSource(key);
            continue;
          }
          rpcSources = [
            ...rpcSources.filter((s) => s.key !== key),
            {
              key,
              appId: change.clientId,
              appName: shownName,
              pid: change.pid,
              activity: {
                ...change.activity,
                name: change.activity.name ?? shownName,
                // the app's own id: Trust & Safety can stop an app by it
                application_id: change.clientId,
              },
              at: Date.now(),
            },
          ];
          notify();
        }
        if (step.close) {
          end();
          break;
        }
      }
    });
    const gone = () => {
      if (!sockets.delete(socket)) return;
      compatSockets.delete(socket);
      connectionCount--;
      dropSource(key);
    };
    socket.on("close", gone);
    socket.on("error", gone);
    socket.setTimeout(0);
  };
}

/**
 * Listen on one pipe or socket. A socket file left by a crash is removed
 * only for Zrzur's own name and only when nobody answers on it; a file of
 * another app's name is never touched (legal RP-06). On macOS and Linux the
 * socket is the user's alone (0600).
 */
function listenOn(path: string, own: boolean, compat: boolean): Promise<Server | undefined> {
  return new Promise((resolve) => {
    if (process.platform !== "win32" && existsSync(path)) {
      // answers() was asked just before: nobody is on it
      if (!own || !mayRemoveSocketFile(basename(path), false)) {
        resolve(undefined);
        return;
      }
      try {
        unlinkSync(path);
      } catch {
        resolve(undefined);
        return;
      }
    }
    const server = createServer(serveRpc(compat));
    server.maxConnections = MAX_CONNECTIONS;
    server.once("error", () => resolve(undefined));
    server.listen(path, () => {
      if (process.platform !== "win32") {
        try {
          chmodSync(path, 0o600);
        } catch {
          server.close();
          resolve(undefined);
          return;
        }
      }
      resolve(server);
    });
  });
}

async function listenFirstFree(name: string, own: boolean, compat: boolean) {
  for (let i = 0; i < PIPE_COUNT; i++) {
    const path = pipePath(name, i);
    if (await answers(path)) continue;
    const server = await listenOn(path, own, compat);
    if (server) return { server, path };
  }
  return undefined;
}

async function startRpc() {
  if (!ownServer) {
    const own = await listenFirstFree("zrzur-ipc", true, false);
    ownServer = own?.server;
  }
  await refreshCompat();
  startCompatWatch();
}

/** Close the common-name pipe and the games connected to it */
function closeCompat() {
  compatServer?.close();
  compatServer = undefined;
  compatPath = undefined;
  for (const socket of compatSockets) socket.destroy();
  compatSockets.clear();
}

/**
 * The common-name pipe is open only while the person wants it, shares,
 * and the other chat app is not running: checked at start and every scan.
 * When that app starts, even after Zrzur, Zrzur steps aside at once and
 * comes back only after it is gone (legal RP-06).
 */
async function refreshCompat() {
  const wanted = sharing && settings().discordCompat;
  let otherRunning = false;
  if (wanted) {
    if (!scanTimer) running = await processList();
    otherRunning = otherChatAppRunning(running, platform) || (await otherPipeAnswers());
  }
  const step = compatStep({ sharing, wanted, otherRunning, open: !!compatServer });
  if (step === "close") closeCompat();
  if (step === "open") {
    const compat = await listenFirstFree("discord-ipc", false, true);
    compatServer = compat?.server;
    compatPath = compat?.path;
  }
}

function startCompatWatch() {
  if (compatTimer) return;
  compatTimer = setInterval(() => void refreshCompat(), SCAN_EVERY_MS);
  compatTimer.unref?.();
}

function stopRpc() {
  if (compatTimer) clearInterval(compatTimer);
  compatTimer = undefined;
  closeCompat();
  ownServer?.close();
  ownServer = undefined;
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
          kv.set("pairedOrigins", [...new Set([...settings().pairedOrigins, origin])].slice(-4));
          pairingCode = undefined;
          // paired on purpose with a code: shown without asking again
          remember("zrzur-browser-extension", "Zrzur browser extension", undefined, true);
          sendState();
          reply({ type: "paired" });
        } else {
          // a code cannot be guessed: a few wrong tries and it is gone
          pairingMisses++;
          if (pairingMisses >= PAIRING_TRIES) {
            pairingCode = undefined;
            sendState();
          }
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
    pipes: (ownServer ? 1 : 0) + (compatServer ? 1 : 0),
    /** The common-name pipe is open now (closed while the other app runs) */
    compatOpen: !!compatServer,
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
  // only the app's own page, in the main window's top frame, may ask:
  // never another window, a frame inside it, or a sign-in page
  const handle = (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
  ) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!mainWindow || mainWindow.isDestroyed() || event.senderFrame !== mainWindow.webContents.mainFrame)
        throw new Error("activity: not the app window");
      return listener(event, ...args);
    });

  handle("activityDecideApp", (_event, id: unknown, show: unknown) => {
    kv.set(
      "apps",
      settings().apps.map((a) =>
        a.id === id ? { ...a, decided: true, blocked: show !== true } : a,
      ),
    );
    lastSent = "";
    notify();
    return state();
  });

  handle("activityState", () => state());
  handle("activityCurrent", () => current());

  handle("activitySetSharing", async (_event, on: unknown) => {
    const next = on === true;
    if (next === sharing) return state();
    sharing = next;
    if (sharing) await start();
    else stop();
    return state();
  });

  handle("activitySetDetection", (_event, on: unknown) => {
    kv.set("detection", on === true);
    if (on === true && sharing) startScanning();
    else {
      stopScanning();
      notify();
    }
    return state();
  });

  handle("activitySetEntry", (_event, id: unknown, change: unknown) => {
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
    kv.set("overrides", overrides);
    void scan();
    return state();
  });

  handle("activityRunning", async () => {
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
      kv.set(
        "added",
        [...added, userEntry(index, withPath, platform, name, kind as DetectableKind)].slice(-100),
      );
      void scan();
      return state();
    },
  );

  handle("activityRemoveAdded", (_event, id: unknown) => {
    kv.set(
      "added",
      settings().added.filter((entry) => entry.id !== id),
    );
    const overrides = { ...settings().overrides };
    if (typeof id === "string") delete overrides[id];
    kv.set("overrides", overrides);
    void scan();
    return state();
  });

  handle("activityBlockApp", (_event, id: unknown, blocked: unknown) => {
    kv.set(
      "apps",
      settings().apps.map((a) =>
        a.id === id ? { ...a, blocked: blocked === true, decided: true } : a,
      ),
    );
    notify();
    return state();
  });

  handle("activityForgetApp", (_event, id: unknown) => {
    // a blocked app is never forgotten: it would come back unasked
    kv.set(
      "apps",
      settings().apps.filter((a) => a.id !== id || a.blocked),
    );
    if (id === "zrzur-browser-extension") kv.set("pairedOrigins", []);
    notify();
    return state();
  });

  handle("activitySetCompat", async (_event, on: unknown) => {
    kv.set("discordCompat", on === true);
    await refreshCompat();
    notify();
    return state();
  });

  handle("activityStartPairing", () => {
    pairingMisses = 0;
    pairingCode = newPairingCode();
    pairingUntil = Date.now() + PAIRING_MS;
    return state();
  });

  handle("activityStopPairing", () => {
    pairingCode = undefined;
    return state();
  });

  app.on("will-quit", () => stop());
}
