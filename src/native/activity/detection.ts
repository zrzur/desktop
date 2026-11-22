/**
 * Which known program is running: the process list against Zrzur's own
 * list (`detectable.json`) and the programs the person added. Pure, so
 * `node --test` checks it.
 *
 * Privacy: only the program's name leaves this module. Window titles, tab
 * titles and file names are never read.
 *
 * A renamed program does not count: an entry can ask for a part of the
 * path (`hint`), and a match needs the executable name and that hint.
 */

export type DetectableKind =
  | "Playing"
  | "Listening"
  | "Watching"
  | "Streaming"
  | "Competing"
  | "Using";

/** One entry of the list */
export type Detectable = {
  /** Stable id: `game.<slug>` or `app.<slug>`, or `user.<n>` for an added one */
  id: string;
  /** Name shown to others */
  name: string;
  /** game → Playing, app → Using (Listening for music players) */
  category: "game" | "app";
  kind: DetectableKind;
  /** Executable names per system, compared without case */
  exe: { win?: string[]; mac?: string[]; linux?: string[] };
  /** Parts of the path, any one of which must be there (without case,
   * `/` and `\` alike). Empty or missing: the name is enough. */
  hint?: string[];
};

/** What the person changed about an entry */
export type Override = { name?: string; off?: boolean };

/** A program running now */
export type RunningProcess = {
  pid: number;
  /** Executable file name, for example `cs2.exe` */
  name: string;
  /** Full path when the system tells it */
  path?: string;
};

export type Platform = "win" | "mac" | "linux";

export function platformOf(nodePlatform: string): Platform {
  if (nodePlatform === "win32") return "win";
  if (nodePlatform === "darwin") return "mac";
  return "linux";
}

function norm(value: string) {
  return value.toLowerCase().replace(/\\/g, "/");
}

/** The executable names an entry answers to on this system */
export function namesFor(entry: Detectable, platform: Platform): string[] {
  return (entry.exe[platform] ?? []).map((name) => name.toLowerCase());
}

/** Whether a hint asks for the path (and so for a path lookup) */
export function needsPath(entry: Detectable) {
  return !!entry.hint && entry.hint.length > 0;
}

/** Whether one running process is this entry */
export function matches(
  entry: Detectable,
  process: RunningProcess,
  platform: Platform,
): boolean {
  const name = process.name.toLowerCase();
  if (!namesFor(entry, platform).includes(name)) return false;
  if (!needsPath(entry)) return true;
  if (!process.path) return false;
  const path = norm(process.path);
  return entry.hint!.some((hint) => path.includes(norm(hint)));
}

export type Detected = {
  entry: Detectable;
  pid: number;
};

/**
 * The entry to show from what is running. Games come before apps, then the
 * list's order; entries turned off are skipped; a renamed entry shows the
 * person's name for it.
 */
export function detect(
  processes: RunningProcess[],
  list: Detectable[],
  overrides: Record<string, Override>,
  platform: Platform,
): Detected | undefined {
  const usable = list
    .filter((entry) => !overrides[entry.id]?.off)
    .map((entry) =>
      overrides[entry.id]?.name
        ? { ...entry, name: overrides[entry.id].name! }
        : entry,
    );
  const ordered = [
    ...usable.filter((entry) => entry.category === "game"),
    ...usable.filter((entry) => entry.category !== "game"),
  ];
  for (const entry of ordered) {
    const process = processes.find((p) => matches(entry, p, platform));
    if (process) return { entry, pid: process.pid };
  }
  return undefined;
}

/** Executable names worth a path lookup: named by an entry with a hint */
export function namesNeedingPath(list: Detectable[], platform: Platform) {
  const names = new Set<string>();
  for (const entry of list) {
    if (!needsPath(entry)) continue;
    for (const name of namesFor(entry, platform)) names.add(name);
  }
  return names;
}

/** Check a list file: every entry well formed, ids unique */
export function validateList(list: unknown): string[] {
  const problems: string[] = [];
  if (!Array.isArray(list)) return ["the list is not an array"];
  const ids = new Set<string>();
  for (const [index, raw] of list.entries()) {
    const entry = raw as Detectable;
    const where = `entry ${index} (${entry?.id})`;
    if (!entry || typeof entry !== "object") {
      problems.push(`${where}: not an object`);
      continue;
    }
    if (!/^(game|app)\.[a-z0-9-]+$/.test(entry.id ?? ""))
      problems.push(`${where}: id must be game.<slug> or app.<slug>`);
    if (ids.has(entry.id)) problems.push(`${where}: id used twice`);
    ids.add(entry.id);
    if (!entry.name || entry.name.length > 128) problems.push(`${where}: name`);
    if (entry.category !== "game" && entry.category !== "app")
      problems.push(`${where}: category`);
    if (!entry.id?.startsWith(entry.category + "."))
      problems.push(`${where}: id does not match category`);
    const kinds = ["Playing", "Listening", "Watching", "Streaming", "Competing", "Using"];
    if (!kinds.includes(entry.kind)) problems.push(`${where}: kind`);
    if (entry.category === "game" && entry.kind !== "Playing")
      problems.push(`${where}: a game is Playing`);
    const all = [...(entry.exe?.win ?? []), ...(entry.exe?.mac ?? []), ...(entry.exe?.linux ?? [])];
    if (all.length === 0) problems.push(`${where}: no executable`);
    for (const name of all)
      if (!name || /[\\/]/.test(name)) problems.push(`${where}: executable ${name}`);
    for (const name of entry.exe?.win ?? [])
      if (!name.toLowerCase().endsWith(".exe")) problems.push(`${where}: ${name} is not an .exe`);
  }
  return problems;
}

/* Process lists. Each needs no special permission. */

/** `tasklist /fo csv /nh` (Windows): image name and pid, no path */
export function parseTasklist(output: string): RunningProcess[] {
  const out: RunningProcess[] = [];
  for (const line of output.split(/\r?\n/)) {
    const cells = line.match(/"([^"]*)"/g);
    if (!cells || cells.length < 2) continue;
    const name = cells[0].slice(1, -1);
    const pid = Number(cells[1].slice(1, -1));
    if (name && Number.isInteger(pid) && pid > 0) out.push({ pid, name });
  }
  return out;
}

/**
 * Windows `Get-Process` lines written as `<id>|<name>` or `<id>|<path>`:
 * the process name has no `.exe`, so it is added back
 */
export function parseGetProcess(output: string): RunningProcess[] {
  const out: RunningProcess[] = [];
  for (const line of output.split(/\r?\n/)) {
    const at = line.indexOf("|");
    if (at <= 0) continue;
    const pid = Number(line.slice(0, at));
    const name = line.slice(at + 1).trim();
    if (!Number.isInteger(pid) || pid <= 0 || !name || /[\\/]/.test(name)) continue;
    out.push({ pid, name: /\.exe$/i.test(name) ? name : `${name}.exe` });
  }
  return out;
}

/** `<id>|<path>` lines from `Get-Process -Id ...`: the paths by id */
export function parsePaths(output: string): Map<number, string | undefined> {
  const paths = new Map<number, string | undefined>();
  for (const line of output.split(/\r?\n/)) {
    const at = line.indexOf("|");
    if (at <= 0) continue;
    const pid = Number(line.slice(0, at));
    const path = line.slice(at + 1).trim();
    if (Number.isInteger(pid) && pid > 0) paths.set(pid, path || undefined);
  }
  return paths;
}

/** `ps -axo pid=,comm=` (macOS): the command is the full path */
export function parsePs(output: string): RunningProcess[] {
  const out: RunningProcess[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!m) continue;
    const path = m[2];
    const name = path.split("/").pop() ?? path;
    out.push({ pid: Number(m[1]), name, path });
  }
  return out;
}

/**
 * Linux: one process from `/proc/<pid>`: the `exe` link when readable (own
 * processes), else `comm`
 */
export function procEntry(
  pid: number,
  exe: string | undefined,
  comm: string | undefined,
): RunningProcess | undefined {
  if (exe) {
    const path = exe.replace(/ \(deleted\)$/, "");
    return { pid, name: path.split("/").pop() ?? path, path };
  }
  const name = comm?.trim();
  return name ? { pid, name } : undefined;
}

/** A program the person added from the running list */
export function userEntry(
  index: number,
  process: RunningProcess,
  platform: Platform,
  name: string,
  kind: DetectableKind,
): Detectable {
  const folder = process.path
    ? norm(process.path).split("/").slice(0, -1).join("/")
    : undefined;
  return {
    id: `user.${index}`,
    name: name.trim().slice(0, 128) || process.name,
    category: kind === "Playing" ? "game" : "app",
    kind,
    exe: { [platform]: [process.name] },
    // the folder it ran from, so a different program with the same name
    // does not count
    hint: folder ? [folder] : undefined,
  };
}
