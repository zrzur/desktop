/**
 * Downloads one update package and proves it is the file the feed listed:
 * exact size and SHA-1. Progress is the number of bytes written, nothing
 * estimated. Used by the start-up window (startupFlow.ts).
 *
 * `fetch` is passed in: Electron's `net.fetch` in the app (system proxy),
 * Node's own in the tests.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface DownloadRequest {
  url: string;
  /** Final path; the bytes go to `<file>.part` until they are verified */
  file: string;
  size: number;
  sha1: string;
  fetch: typeof fetch;
  onProgress?: (received: number, total: number) => void;
  /** Give up when no byte arrives for this long (default 20 s) */
  stallMs?: number;
}

/** What went wrong, in words fit for the "Details" box (no addresses with secrets) */
export class DownloadError extends Error {
  received: number;
  total: number;
  constructor(message: string, received: number, total: number) {
    super(message);
    this.name = "DownloadError";
    this.received = received;
    this.total = total;
  }
}

function sha1OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha1");
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** True when the file is already there, whole and with the right hash */
export async function isVerifiedFile(
  file: string,
  size: number,
  sha1: string,
): Promise<boolean> {
  try {
    if (fs.statSync(file).size !== size) return false;
    return (await sha1OfFile(file)) === sha1.toLowerCase();
  } catch {
    return false;
  }
}

export async function downloadPackage(request: DownloadRequest): Promise<void> {
  const { url, file, size, sha1, onProgress } = request;
  const stallMs = request.stallMs ?? 20_000;

  // a finished, verified download from an earlier try is used as it is
  if (await isVerifiedFile(file, size, sha1)) {
    onProgress?.(size, size);
    return;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = `${file}.part`;
  const abort = new AbortController();
  let received = 0;
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      abort.abort();
    }, stallMs);
  };

  const out = fs.createWriteStream(part);
  const closed = new Promise<void>((resolve, reject) => {
    out.on("close", resolve);
    out.on("error", reject);
  });
  const hash = createHash("sha1");
  try {
    watch();
    const response = await request.fetch(url, {
      signal: abort.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok || !response.body) {
      throw new DownloadError(
        `the server answered ${response.status}`,
        0,
        size,
      );
    }
    onProgress?.(0, size);
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      watch();
      received += value.byteLength;
      if (received > size) {
        abort.abort();
        throw new DownloadError(
          "the file is larger than the update list says",
          received,
          size,
        );
      }
      hash.update(value);
      if (!out.write(value))
        await new Promise((resolve) => out.once("drain", resolve));
      onProgress?.(received, size);
    }
    clearTimeout(timer);
    out.end();
    await closed;
    if (received !== size) {
      throw new DownloadError("the download ended early", received, size);
    }
    if (hash.digest("hex") !== sha1.toLowerCase()) {
      throw new DownloadError(
        "the file does not match the update list (SHA-1 differs)",
        received,
        size,
      );
    }
    fs.renameSync(part, file);
  } catch (error) {
    clearTimeout(timer);
    out.destroy();
    await closed.catch(() => undefined);
    fs.rmSync(part, { force: true });
    if (error instanceof DownloadError) throw error;
    const reason = stalled
      ? `no data for ${Math.round(stallMs / 1000)} seconds`
      : describeError(error);
    throw new DownloadError(reason, received, size);
  }
}

/** A short technical line from any thrown value (Chromium and Node both nest the cause) */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code: unknown }).code)
      : "";
  const inner = cause instanceof Error ? cause.message : "";
  return [error.message, code || inner].filter(Boolean).join(": ");
}
