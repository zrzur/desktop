/**
 * The opt-in common-name pipe (legal RP-06), as decisions without Electron
 * so `node --test` checks them.
 *
 * - Open only while the person shares, wants it, and the other chat app is
 *   not running (no process of it, no other app answering that pipe name).
 * - When that app starts, even after Zrzur, close at once (step aside);
 *   open again only after it is gone.
 * - A socket file is removed only when it carries Zrzur's own name and
 *   nobody answers on it; a file of another app's name is never touched.
 */

export type CompatStep = "open" | "close" | "keep";

export function compatStep(state: {
  sharing: boolean;
  wanted: boolean;
  otherRunning: boolean;
  open: boolean;
}): CompatStep {
  const should = state.sharing && state.wanted && !state.otherRunning;
  if (should && !state.open) return "open";
  if (!should && state.open) return "close";
  return "keep";
}

/** Whether a left-over socket file may be removed before listening */
export function mayRemoveSocketFile(name: string, answering: boolean): boolean {
  return name.startsWith("zrzur-ipc-") && !answering;
}
