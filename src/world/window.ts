import { contextBridge, ipcRenderer } from "electron";

import { version } from "../../package.json";
import { platformBridge } from "./platform";

contextBridge.exposeInMainWorld("native", {
  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
    desktop: () => version,
  },

  // the system, so the app shows the macOS, Windows or Linux shortcuts
  ...platformBridge(),

  minimise: () => ipcRenderer.send("minimise"),
  maximise: () => ipcRenderer.send("maximise"),
  close: () => ipcRenderer.send("close"),

  setBadgeCount: (count: number) => ipcRenderer.send("setBadgeCount", count),
  /** A call rings (true) or stopped ringing (false): flash the taskbar */
  callAttention: (on: boolean) =>
    ipcRenderer.send("callAttention", on === true),
  // restart the app (after a setting that needs it)
  relaunch: () => ipcRenderer.send("relaunch"),
  // the page shown while Zrzur cannot be reached: ask again now
  retryLoad: () => ipcRenderer.send("retryLoad"),

  onceScreenPicker: (
    onScreenPick: (
      sources: {
        idx: number;
        kind?: "screen" | "window";
        name: string;
        isFullScreen: boolean;
        screenNumber?: number;
        screenCount?: number;
        thumbnail?: string;
        image?: string;
      }[],
    ) => void,
  ) => {
    const eventName = "screenPicker";
    ipcRenderer.removeAllListeners(eventName);
    ipcRenderer.once(eventName, (_, sources) => onScreenPick(sources));
  },
  screenPickerCallback: (idx: number, audio: boolean) =>
    ipcRenderer.send("screenPickerCallback", idx, audio),

  isWayland: () => ipcRenderer.invoke("getIsWayland"),

  // Push to talk from other apps: Ctrl/Cmd+Shift with the push-to-talk key
  // toggles talking (Electron sees no key release outside the window)
  pushToTalk: {
    register: (code: string) =>
      ipcRenderer.invoke("pushToTalkSet", String(code)) as Promise<boolean>,
    unregister: () => ipcRenderer.send("pushToTalkClear"),
    onToggle: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("pushToTalkToggle", listener);
      return () => {
        ipcRenderer.removeListener("pushToTalkToggle", listener);
      };
    },
  },

  // What the person is doing right now (rich presence): programs running,
  // apps over the local RPC and the paired browser extension. Runs only
  // while the page says the person shares their activity.
  activity: {
    state: () => ipcRenderer.invoke("activityState"),
    current: () => ipcRenderer.invoke("activityCurrent"),
    setSharing: (on: boolean) =>
      ipcRenderer.invoke("activitySetSharing", on === true),
    setDetection: (on: boolean) =>
      ipcRenderer.invoke("activitySetDetection", on === true),
    setEntry: (id: string, change: { name?: string; off?: boolean }) =>
      ipcRenderer.invoke("activitySetEntry", String(id), {
        name: typeof change?.name === "string" ? change.name : undefined,
        off: typeof change?.off === "boolean" ? change.off : undefined,
      }),
    running: () => ipcRenderer.invoke("activityRunning"),
    add: (pid: number, name: string, kind: string) =>
      ipcRenderer.invoke("activityAdd", Number(pid), String(name), String(kind)),
    removeAdded: (id: string) =>
      ipcRenderer.invoke("activityRemoveAdded", String(id)),
    blockApp: (id: string, blocked: boolean) =>
      ipcRenderer.invoke("activityBlockApp", String(id), blocked === true),
    // a new app asked to show what you do: Show (true) or Block (false)
    decideApp: (id: string, show: boolean) =>
      ipcRenderer.invoke("activityDecideApp", String(id), show === true),
    onAsk: (callback: (id: string) => void) => {
      const listener = (_event: unknown, id: unknown) => callback(String(id));
      ipcRenderer.on("activityAsk", listener);
      return () => {
        ipcRenderer.removeListener("activityAsk", listener);
      };
    },
    forgetApp: (id: string) => ipcRenderer.invoke("activityForgetApp", String(id)),
    setCompat: (on: boolean) =>
      ipcRenderer.invoke("activitySetCompat", on === true),
    startPairing: () => ipcRenderer.invoke("activityStartPairing"),
    stopPairing: () => ipcRenderer.invoke("activityStopPairing"),
    onUpdate: (callback: (update: unknown) => void) => {
      const listener = (_event: unknown, update: unknown) => callback(update);
      ipcRenderer.on("activityUpdate", listener);
      return () => {
        ipcRenderer.removeListener("activityUpdate", listener);
      };
    },
    onState: (callback: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => callback(state);
      ipcRenderer.on("activityState", listener);
      return () => {
        ipcRenderer.removeListener("activityState", listener);
      };
    },
  },

  // Keys that work in games: push to talk, push to mute, mute and deafen
  // from any app. The listener runs only while the page holds binds, and
  // the page hears only its own binds going down and up.
  globalKeys: {
    status: () => ipcRenderer.invoke("globalKeysStatus"),
    set: (binds: unknown) => ipcRenderer.invoke("globalKeysSet", binds),
    clear: () => ipcRenderer.send("globalKeysClear"),
    askPermission: () => ipcRenderer.invoke("globalKeysAskPermission"),
    onEvent: (
      callback: (action: string, down: boolean, focused?: boolean) => void,
    ) => {
      const listener = (
        _event: unknown,
        action: string,
        down: boolean,
        focused?: boolean,
      ) => callback(action, down, focused);
      ipcRenderer.on("globalKeysEvent", listener);
      return () => {
        ipcRenderer.removeListener("globalKeysEvent", listener);
      };
    },
    onStatus: (callback: (status: unknown) => void) => {
      const listener = (_event: unknown, status: unknown) => callback(status);
      ipcRenderer.on("globalKeysStatus", listener);
      return () => {
        ipcRenderer.removeListener("globalKeysStatus", listener);
      };
    },
  },
});
