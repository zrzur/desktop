/**
 * Frames of the local presence protocol that many games already speak: an
 * 8-byte header (opcode, then payload length, both unsigned 32-bit little
 * endian) followed by that many bytes of UTF-8 JSON.
 *
 * Written from the protocol as games use it; no code from any other app.
 * Pure (no Electron), so `node --test` checks it directly.
 */

export const OP_HANDSHAKE = 0;
export const OP_FRAME = 1;
export const OP_CLOSE = 2;
export const OP_PING = 3;
export const OP_PONG = 4;

/** Largest payload accepted (an activity is well under 2 KiB) */
export const MAX_PAYLOAD = 64 * 1024;
/** Most bytes kept waiting for the rest of a frame */
const MAX_BUFFERED = MAX_PAYLOAD + 8;

export type Frame = { op: number; data: unknown };

/** Why a connection is closed */
export class FrameError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function isKnownOp(op: number) {
  return op >= OP_HANDSHAKE && op <= OP_PONG;
}

/** Encode one frame */
export function encodeFrame(op: number, data: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(data ?? {}), "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/**
 * Collects bytes from a socket and hands out whole frames. Throws a
 * `FrameError` for anything that is not the protocol: an unknown opcode, a
 * payload over `MAX_PAYLOAD`, text that is not JSON or not an object. The
 * caller closes the connection then; nothing is kept.
 */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    if (this.buffer.length + chunk.length > MAX_BUFFERED) {
      this.buffer = Buffer.alloc(0);
      throw new FrameError("too_large", "frame too large");
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);

    const frames: Frame[] = [];
    while (this.buffer.length >= 8) {
      const op = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(4);
      if (!isKnownOp(op)) {
        this.buffer = Buffer.alloc(0);
        throw new FrameError("bad_opcode", `unknown opcode ${op}`);
      }
      if (length > MAX_PAYLOAD) {
        this.buffer = Buffer.alloc(0);
        throw new FrameError("too_large", "frame too large");
      }
      if (this.buffer.length < 8 + length) break;

      const body = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      let data: unknown;
      try {
        data = JSON.parse(body.toString("utf8"));
      } catch {
        this.buffer = Buffer.alloc(0);
        throw new FrameError("bad_json", "payload is not JSON");
      }
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        this.buffer = Buffer.alloc(0);
        throw new FrameError("bad_payload", "payload is not an object");
      }
      frames.push({ op, data });
    }
    return frames;
  }

  /** Bytes waiting for the rest of a frame */
  get pending(): number {
    return this.buffer.length;
  }
}
