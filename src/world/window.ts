import { contextBridge, ipcRenderer } from "electron";

import { version } from "../../package.json";

contextBridge.exposeInMainWorld("native", {
  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
    desktop: () => version,
  },

  minimise: () => ipcRenderer.send("minimise"),
  maximise: () => ipcRenderer.send("maximise"),
  close: () => ipcRenderer.send("close"),

  setBadgeCount: (count: number) => ipcRenderer.send("setBadgeCount", count),

  onceScreenPicker: (
    onScreenPick: (
      sources: {
        idx: number;
        name: string;
        isFullScreen: boolean;
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
