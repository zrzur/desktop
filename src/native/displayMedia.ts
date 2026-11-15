/**
 * The answer to a screen share request (`setDisplayMediaRequestHandler`).
 * No Electron import here, so it runs under `node --test`.
 *
 * Electron 44 refuses a request only with `callback(null)`. An empty object
 * means "allowed, but nothing to share" and throws "Video was requested, but
 * no video stream was provided" in the main process: an error dialog every
 * time someone closed the picker without choosing.
 */

/** What the handler hands to Electron's callback (null = refused) */
export type DisplayStreams<Source> = {
  video: Source;
  audio?: "loopback";
} | null;

/**
 * @param sources what the system offered
 * @param idx the picked entry, or anything else when the picker was closed
 * @param keepAudio the person kept "share sound" on
 * @param audioRequested the page asked for audio
 */
export function displayStreams<Source>(
  sources: readonly Source[],
  idx: unknown,
  keepAudio: boolean,
  audioRequested: boolean,
): DisplayStreams<Source> {
  if (
    typeof idx !== "number" ||
    !Number.isInteger(idx) ||
    idx < 0 ||
    idx >= sources.length
  ) {
    return null;
  }
  // loopback audio is whole-system audio (Windows); only sent when the page
  // asked for audio and the person kept it on
  return keepAudio && audioRequested
    ? { video: sources[idx], audio: "loopback" }
    : { video: sources[idx] };
}

/**
 * Wrap Electron's callback so it is answered once, and a refusal or a
 * rejected answer never becomes an uncaught exception in the main process.
 */
export function answerOnce<T>(
  callback: (streams: T) => void,
  onError: (error: unknown) => void = () => undefined,
): (streams: T) => void {
  let answered = false;
  return (streams) => {
    if (answered) return;
    answered = true;
    try {
      callback(streams);
    } catch (error) {
      onError(error);
    }
  };
}
