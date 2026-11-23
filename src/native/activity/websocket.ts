/**
 * The smallest WebSocket server the browser extension needs (RFC 6455):
 * the opening handshake, text frames from the client (always masked), text
 * frames back, ping/pong and close. Written here so no library is added.
 * Pure apart from `node:crypto`, so `node --test` checks it.
 *
 * Who may connect:
 * - only the loopback address (the server listens on 127.0.0.1 alone);
 * - only a browser extension: the `Origin` header must be
 *   `chrome-extension://<id>` or `moz-extension://<id>`, never a web page,
 *   never a wildcard, never missing;
 * - after pairing, only the one origin that was paired (`pairedOrigins`).
 */

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Largest message accepted from the extension */
export const MAX_MESSAGE = 16 * 1024;
/** Largest handshake request */
export const MAX_HANDSHAKE = 8 * 1024;

const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension):\/\/[a-z0-9-]{8,64}$/;

/** Whether an origin is a browser extension at all */
export function isExtensionOrigin(origin: string | undefined): boolean {
  return !!origin && EXTENSION_ORIGIN.test(origin);
}

/**
 * Whether this origin may talk: an extension origin, and when anything is
 * paired, one of the paired origins (exact match).
 */
export function originAllowed(
  origin: string | undefined,
  paired: string[],
  pairing: boolean,
): boolean {
  if (!isExtensionOrigin(origin)) return false;
  if (paired.includes(origin!)) return true;
  // a new extension may only come in while a pairing code is shown
  return pairing;
}

/** A six-digit pairing code, shown in Zrzur's settings */
export function newPairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Compare a code without telling by the time taken how close it was */
export function codeMatches(expected: string | undefined, given: unknown) {
  if (!expected || typeof given !== "string" || given.length !== expected.length)
    return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

export type Handshake =
  | { ok: true; origin: string; response: string }
  | { ok: false; status: number; response: string };

function refuse(status: number, reason: string): Handshake {
  return {
    ok: false,
    status,
    response: `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  };
}

/** Read the opening request and answer it */
export function handshake(
  request: string,
  allow: (origin: string | undefined) => boolean,
): Handshake {
  if (request.length > MAX_HANDSHAKE) return refuse(431, "Request Header Fields Too Large");
  const [first, ...lines] = request.split("\r\n");
  if (!/^GET \/ HTTP\/1\.1$/.test(first ?? "")) return refuse(400, "Bad Request");
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const name = line.slice(0, at).trim().toLowerCase();
    if (name in headers) return refuse(400, "Bad Request"); // no repeated headers
    headers[name] = line.slice(at + 1).trim();
  }
  if (headers["upgrade"]?.toLowerCase() !== "websocket") return refuse(400, "Bad Request");
  if (!/\bupgrade\b/i.test(headers["connection"] ?? "")) return refuse(400, "Bad Request");
  if (headers["sec-websocket-version"] !== "13") return refuse(426, "Upgrade Required");
  const key = headers["sec-websocket-key"];
  if (!key || !/^[A-Za-z0-9+/]{22}==$/.test(key)) return refuse(400, "Bad Request");
  // the browser always sends the extension's origin; nothing else comes in
  const origin = headers["origin"];
  if (!allow(origin)) return refuse(403, "Forbidden");
  const host = headers["host"] ?? "";
  if (!/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(host)) return refuse(403, "Forbidden");

  const accept = createHash("sha1").update(key + GUID).digest("base64");
  return {
    ok: true,
    origin: origin!,
    response:
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  };
}

export type WsMessage =
  | { kind: "text"; text: string }
  | { kind: "ping"; data: Buffer }
  | { kind: "close" };

export class WsError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/** Reads client frames; refuses unmasked, oversized and fragmented-binary input */
export class WsReader {
  private buffer: Buffer = Buffer.alloc(0);
  private parts: Buffer[] = [];
  private partsLength = 0;

  push(chunk: Buffer): WsMessage[] {
    if (this.buffer.length + chunk.length > MAX_MESSAGE + 14) {
      throw new WsError(1009, "message too big");
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const out: WsMessage[] = [];
    for (;;) {
      if (this.buffer.length < 2) break;
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      if ((b0 & 0x70) !== 0) throw new WsError(1002, "reserved bits");
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      if (!masked) throw new WsError(1002, "client frames must be masked");
      let length = b1 & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) break;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        throw new WsError(1009, "message too big");
      }
      if (length > MAX_MESSAGE) throw new WsError(1009, "message too big");
      if (this.buffer.length < offset + 4 + length) break;
      const mask = this.buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(this.buffer.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      this.buffer = this.buffer.subarray(offset + 4 + length);

      switch (opcode) {
        case 0x0: // continuation
        case 0x1: {
          // text
          if (opcode === 0x1 && this.parts.length) throw new WsError(1002, "unfinished message");
          if (opcode === 0x0 && !this.parts.length) throw new WsError(1002, "nothing to continue");
          this.parts.push(payload);
          this.partsLength += payload.length;
          if (this.partsLength > MAX_MESSAGE) throw new WsError(1009, "message too big");
          if (fin) {
            const text = Buffer.concat(this.parts).toString("utf8");
            this.parts = [];
            this.partsLength = 0;
            out.push({ kind: "text", text });
          }
          break;
        }
        case 0x8:
          out.push({ kind: "close" });
          return out;
        case 0x9:
          if (!fin || length > 125) throw new WsError(1002, "bad ping");
          out.push({ kind: "ping", data: payload });
          break;
        case 0xa:
          break; // pong
        default:
          throw new WsError(1003, "only text messages");
      }
    }
    return out;
  }
}

/** A frame from the server (never masked) */
export function encodeWs(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  const header =
    length < 126
      ? Buffer.from([0x80 | opcode, length])
      : Buffer.from([0x80 | opcode, 126, (length >> 8) & 0xff, length & 0xff]);
  return Buffer.concat([header, payload]);
}

export function textFrame(value: unknown): Buffer {
  return encodeWs(0x1, Buffer.from(JSON.stringify(value), "utf8"));
}

export function closeFrame(code: number): Buffer {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  return encodeWs(0x8, payload);
}
