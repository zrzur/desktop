/**
 * How long to wait before asking the Zrzur address again while it cannot be
 * reached: quick at first (a blip is over in seconds), then slower, never
 * more than once every 30 s, so a long outage costs next to nothing.
 */
const DELAYS_MS = [2000, 3000, 5000, 10_000, 20_000, 30_000];

export function nextRetryDelay(attempt: number): number {
  const index = Math.max(0, Math.floor(attempt));
  return DELAYS_MS[Math.min(index, DELAYS_MS.length - 1)];
}
