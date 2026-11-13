/**
 * What the screen share picker shows for each thing that can be shared:
 * screens first, then windows, each with a small preview and (for windows)
 * the app's icon. No Electron import here, so it runs under `node --test`.
 *
 * The system names screens in its own language ("Gesamter Bildschirm",
 * "Screen 1"); the app names them itself, in the person's language, from
 * `screenNumber` and `screenCount`.
 */

/** The parts of an Electron NativeImage used here */
export interface ImageLike {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: { width?: number; height?: number }): ImageLike;
  toDataURL(): string;
  toJPEG(quality: number): { toString(encoding: "base64"): string };
}

/** The parts of an Electron DesktopCapturerSource used here */
export interface SourceLike {
  id: string;
  name: string;
  thumbnail?: ImageLike | null;
  appIcon?: ImageLike | null;
}

export interface PickerSource {
  /** Position in the list the system gave (what the page answers with) */
  idx: number;
  kind: "screen" | "window";
  /** The window's title; for a screen, the system's own name (not shown) */
  name: string;
  /** Kept for older pages */
  isFullScreen: boolean;
  /** Screens only: 1, 2, … in the system's order, and how many there are */
  screenNumber?: number;
  screenCount?: number;
  /** A small picture of what would be shared (data URL), when there is one */
  thumbnail?: string;
  /** Windows only: the app's icon (data URL), when there is one */
  image?: string;
}

/** Size asked from the system for each preview */
export const THUMBNAIL_SIZE = { width: 320, height: 180 };

const MAX_NAME = 160;

function usable(image: ImageLike | null | undefined): image is ImageLike {
  if (!image) return false;
  try {
    if (image.isEmpty()) return false;
    const { width, height } = image.getSize();
    return width > 0 && height > 0;
  } catch {
    return false;
  }
}

/** A JPEG data URL of the preview: a tenth of the size of a PNG */
function preview(image: ImageLike | null | undefined): string | undefined {
  if (!usable(image)) return undefined;
  try {
    const data = image.toJPEG(72).toString("base64");
    return data ? `data:image/jpeg;base64,${data}` : undefined;
  } catch {
    return undefined;
  }
}

/** The app icon at 64 px (it has transparency, so it stays a PNG) */
function icon(image: ImageLike | null | undefined): string | undefined {
  if (!usable(image)) return undefined;
  try {
    const { width, height } = image.getSize();
    const small = width >= height ? image.resize({ width: 64 }) : image.resize({ height: 64 });
    const url = (usable(small) ? small : image).toDataURL();
    // an icon the system could not read comes back as a URL with no data
    return /^data:image\/[a-z+]+;base64,.{16,}/.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The list for the picker. `idx` always points into the list the system
 * gave, whatever order the page shows.
 */
export function describeSources(sources: readonly SourceLike[]): PickerSource[] {
  const screenCount = sources.filter((source) =>
    source.id.startsWith("screen"),
  ).length;
  let screenNumber = 0;
  return sources.map((source, idx) => {
    const screen = source.id.startsWith("screen");
    const name = String(source.name ?? "").trim().slice(0, MAX_NAME);
    const described: PickerSource = {
      idx,
      kind: screen ? "screen" : "window",
      name,
      isFullScreen: screen,
      thumbnail: preview(source.thumbnail),
    };
    if (screen) {
      described.screenNumber = ++screenNumber;
      described.screenCount = screenCount;
    } else {
      described.image = icon(source.appIcon);
    }
    return described;
  });
}
