/**
 * One local RPC connection: the handshake, `SET_ACTIVITY`, ping and close.
 * Pure: it takes frames and gives back frames to send and what changed, so
 * `node --test` checks it without sockets.
 *
 * Privacy: an app learns nothing about the person. The `READY` answer
 * carries a placeholder user (some game libraries refuse an answer without
 * one), never the account's id, name or picture.
 */

import type { Frame } from "./frames";

export const OP_HANDSHAKE = 0;
export const OP_FRAME = 1;
export const OP_CLOSE = 2;
export const OP_PING = 3;
export const OP_PONG = 4;

/** Kinds of activity, as Zrzur names them */
export type ActivityType =
  | "Playing"
  | "Listening"
  | "Watching"
  | "Streaming"
  | "Competing"
  | "Using";

/** An activity in Zrzur's shape (`DataActivity` of the API) */
export type DataActivity = {
  type: ActivityType;
  name: string;
  details?: string;
  state?: string;
  started_at?: string;
  ends_at?: string;
  application_id?: string;
  large_image?: string;
  large_text?: string;
  small_image?: string;
  small_text?: string;
  buttons?: { label: string; url: string }[];
};

/** What the connection did */
export type RpcChange =
  | { kind: "ready"; clientId: string }
  | {
      kind: "activity";
      clientId: string;
      pid?: number;
      /** `null`: the app cleared its activity */
      activity: Omit<DataActivity, "name"> & { name?: string } | null;
    }
  | { kind: "close"; reason: string };

export type RpcStep = { send: Frame[]; changes: RpcChange[]; close?: boolean };

const TEXT_MAX = 128;
const LABEL_MAX = 32;
const URL_MAX = 512;

/** The numbers games send for the kind of activity */
const TYPES: Record<number, ActivityType> = {
  0: "Playing",
  1: "Streaming",
  2: "Listening",
  3: "Watching",
  5: "Competing",
};

/**
 * The server's rule for shown text (backend `util::activity::hidden_char`):
 * control characters and line or paragraph separators become spaces,
 * format characters (bidi overrides and isolates, zero-width spaces, the
 * byte order mark, tags) go; the zero-width joiner and non-joiner stay.
 */
export function cleanText(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/(?![‌‍])\p{Cf}/gu, "")
    .trim();
}

function text(value: unknown, max = TEXT_MAX): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = cleanText(value);
  if (!clean) return undefined;
  return Array.from(clean).slice(0, max).join("").trim();
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  if (url.length > URL_MAX || !url.startsWith("https://")) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username)
      return undefined;
  } catch {
    return undefined;
  }
  return url;
}

/** Seconds or milliseconds since 1970 (games send both) to an ISO time */
export function timeOf(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return undefined;
  const ms = value < 1e12 ? value * 1000 : value;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/**
 * Turn an activity as games send it into Zrzur's shape. Picture keys that
 * are not `https://` addresses mean pictures uploaded to another service:
 * they are left out. The name comes from the app or, when missing, from
 * what the desktop knows about the program (the caller fills it).
 */
export function toDataActivity(
  raw: unknown,
): (Omit<DataActivity, "name"> & { name?: string }) | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  const timestamps = (a.timestamps ?? {}) as Record<string, unknown>;
  const assets = (a.assets ?? {}) as Record<string, unknown>;

  const buttons = Array.isArray(a.buttons)
    ? (a.buttons as unknown[])
        .map((button) => {
          if (typeof button !== "object" || button === null) return undefined;
          const b = button as Record<string, unknown>;
          const label = text(b.label, LABEL_MAX);
          const url = httpsUrl(b.url);
          return label && url ? { label, url } : undefined;
        })
        .filter((b): b is { label: string; url: string } => !!b)
        .slice(0, 2)
    : [];

  // a number as games send it, or Zrzur's own name (our extensions say
  // "Using" for an editor or a browser)
  const named = Object.values(TYPES).concat("Using") as ActivityType[];
  const out: Omit<DataActivity, "name"> & { name?: string } = {
    type:
      typeof a.type === "number" && TYPES[a.type]
        ? TYPES[a.type]
        : typeof a.type === "string" && named.includes(a.type as ActivityType)
          ? (a.type as ActivityType)
          : "Playing",
  };
  const name = text(a.name);
  if (name) out.name = name;
  const details = text(a.details);
  if (details) out.details = details;
  const state = text(a.state);
  if (state) out.state = state;
  const start = timeOf(timestamps.start);
  const end = timeOf(timestamps.end);
  if (start) out.started_at = start;
  if (end && (!start || end > start)) out.ends_at = end;
  const largeImage = httpsUrl(assets.large_image);
  if (largeImage) out.large_image = largeImage;
  const largeText = text(assets.large_text);
  if (largeText) out.large_text = largeText;
  const smallImage = httpsUrl(assets.small_image);
  if (smallImage) out.small_image = smallImage;
  const smallText = text(assets.small_text);
  if (smallText) out.small_text = smallText;
  if (buttons.length) out.buttons = buttons;
  return out;
}

/** A placeholder: apps never learn who is signed in */
const PLACEHOLDER_USER = {
  id: "0",
  username: "zrzur",
  discriminator: "0",
  global_name: null,
  avatar: null,
  bot: false,
  flags: 0,
  premium_type: 0,
};

function error(nonce: unknown, code: number, message: string): Frame {
  return {
    op: OP_FRAME,
    data: { cmd: "SET_ACTIVITY", evt: "ERROR", nonce, data: { code, message } },
  };
}

/** Ids only Zrzur's own parts may use */
export const RESERVED_CLIENT_IDS = ["zrzur", "zrzur-browser-extension"];

/** A client id: what the app calls itself; short and plain */
function clientIdOf(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const id = String(value).trim();
  if (!id || id.length > 64 || !/^[A-Za-z0-9._-]+$/.test(id)) return undefined;
  if (RESERVED_CLIENT_IDS.includes(id.toLowerCase())) return undefined;
  return id;
}

/** The state of one connection */
export class RpcConnection {
  clientId?: string;
  /**
   * On the common-name pipe, games expect a fuller `READY` answer (a
   * placeholder user and empty hosts), kept only there for interop; Zrzur's
   * own pipe answers with the version alone.
   */
  private compat: boolean;

  constructor(options: { compat?: boolean } = {}) {
    this.compat = options.compat === true;
  }

  /** Handle one frame */
  receive(frame: Frame): RpcStep {
    const data = frame.data as Record<string, unknown>;

    if (!this.clientId) {
      if (frame.op !== OP_HANDSHAKE) {
        return {
          send: [{ op: OP_CLOSE, data: { code: 1003, message: "handshake first" } }],
          changes: [{ kind: "close", reason: "no handshake" }],
          close: true,
        };
      }
      const clientId = clientIdOf(data.client_id);
      const version = Number(data.v ?? 1);
      if (!clientId || version !== 1) {
        return {
          send: [{ op: OP_CLOSE, data: { code: 4000, message: "invalid client id or version" } }],
          changes: [{ kind: "close", reason: "bad handshake" }],
          close: true,
        };
      }
      this.clientId = clientId;
      return {
        send: [
          {
            op: OP_FRAME,
            data: {
              cmd: "DISPATCH",
              evt: "READY",
              nonce: null,
              data: this.compat
                ? {
                    v: 1,
                    config: { cdn_host: "", api_endpoint: "", environment: "production" },
                    user: PLACEHOLDER_USER,
                  }
                : { v: 1 },
            },
          },
        ],
        changes: [{ kind: "ready", clientId }],
      };
    }

    switch (frame.op) {
      case OP_PING:
        return { send: [{ op: OP_PONG, data }], changes: [] };
      case OP_CLOSE:
        return { send: [], changes: [{ kind: "close", reason: "app closed" }], close: true };
      case OP_HANDSHAKE:
        return {
          send: [{ op: OP_CLOSE, data: { code: 1003, message: "already shook hands" } }],
          changes: [{ kind: "close", reason: "second handshake" }],
          close: true,
        };
      case OP_FRAME: {
        const nonce = data.nonce ?? null;
        if (data.cmd !== "SET_ACTIVITY") {
          return {
            send: [
              {
                op: OP_FRAME,
                data: {
                  cmd: typeof data.cmd === "string" ? data.cmd.slice(0, 32) : null,
                  evt: "ERROR",
                  nonce,
                  data: { code: 4000, message: "only SET_ACTIVITY is supported" },
                },
              },
            ],
            changes: [],
          };
        }
        const args = (data.args ?? {}) as Record<string, unknown>;
        const pid =
          typeof args.pid === "number" && Number.isInteger(args.pid) && args.pid > 0
            ? args.pid
            : undefined;
        if (args.activity === undefined || args.activity === null) {
          return {
            send: [{ op: OP_FRAME, data: { cmd: "SET_ACTIVITY", evt: null, nonce, data: null } }],
            changes: [{ kind: "activity", clientId: this.clientId, pid, activity: null }],
          };
        }
        const activity = toDataActivity(args.activity);
        if (!activity) return { send: [error(nonce, 4000, "activity is not an object")], changes: [] };
        return {
          send: [{ op: OP_FRAME, data: { cmd: "SET_ACTIVITY", evt: null, nonce, data: args.activity } }],
          changes: [{ kind: "activity", clientId: this.clientId, pid, activity }],
        };
      }
      default:
        return { send: [], changes: [{ kind: "close", reason: "unknown" }], close: true };
    }
  }
}
