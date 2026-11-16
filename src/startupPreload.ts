// Preload of the start-up window only (native/startup). The page gets four
// narrow functions: it receives ready-made words and reports a click, whether
// "Details" is open, and its own height. Nothing else of the app is reachable.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("startup", {
  onView: (callback: (view: unknown) => void) => {
    ipcRenderer.on("startup:view", (_event, view) => callback(view));
  },
  choose: (choice: string) =>
    ipcRenderer.send("startup:choice", choice === "retry" ? "retry" : "open"),
  detailsOpen: (open: boolean) =>
    ipcRenderer.send("startup:details", open === true),
  height: (height: number) =>
    ipcRenderer.send("startup:height", Number(height)),
});
