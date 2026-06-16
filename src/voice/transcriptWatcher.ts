import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  classifyLine,
  parseLine,
  lineMatchesWorkspace,
  type Signal,
} from "./transcript.js";

/**
 * Watches the active Claude Code session transcript for the current workspace
 * and emits newly-appended signals (design D2/D4). Discovery matches by the
 * transcript's `cwd` field rather than the casing-inconsistent encoded dir name;
 * tailing reads incrementally from a saved byte offset and seeks to end on
 * activation so the backlog is never replayed.
 */

export interface TranscriptWatcherOptions {
  /** Override the projects root (tests). Defaults to ~/.claude/projects. */
  projectsRoot?: string;
  /** Poll interval (ms) — backstop for unreliable fs.watch. */
  pollMs?: number;
  onSignals: (signals: Signal[]) => void;
}

export function defaultProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/**
 * Find the most-recently-modified transcript whose `cwd` matches `root`.
 * Returns null when none exists. Reads only the head of each candidate.
 */
export async function discoverSession(
  root: string,
  projectsRoot = defaultProjectsRoot()
): Promise<string | null> {
  let dirs: string[];
  try {
    dirs = await fsp.readdir(projectsRoot);
  } catch {
    return null; // no ~/.claude/projects yet
  }

  const candidates: { file: string; mtime: number }[] = [];
  for (const d of dirs) {
    const dir = path.join(projectsRoot, d);
    let entries: string[];
    try {
      const st = await fsp.stat(dir);
      if (!st.isDirectory()) continue;
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".jsonl")) continue;
      const file = path.join(dir, f);
      try {
        const st = await fsp.stat(file);
        candidates.push({ file, mtime: st.mtimeMs });
      } catch {
        /* skip */
      }
    }
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  for (const c of candidates) {
    if (await fileMatchesWorkspace(c.file, root)) return c.file;
  }
  return null;
}

/** Read the head of a transcript and check its `cwd` against the workspace. */
async function fileMatchesWorkspace(file: string, root: string): Promise<boolean> {
  let head: string;
  try {
    const fh = await fsp.open(file, "r");
    try {
      const buf = Buffer.alloc(64 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      head = buf.toString("utf8", 0, bytesRead);
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
  for (const line of head.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed && typeof parsed.cwd === "string") {
      return lineMatchesWorkspace(parsed, root);
    }
  }
  return false;
}

export class TranscriptWatcher {
  private current: string | null = null;
  private offset = 0;
  private carry = "";
  private fsWatcher: fs.FSWatcher | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(
    private readonly root: string,
    private readonly opts: TranscriptWatcherOptions
  ) {}

  async start(): Promise<void> {
    await this.repoint(true);
    const pollMs = this.opts.pollMs ?? 1000;
    this.timer = setInterval(() => void this.tick(), pollMs);
  }

  /** Re-run discovery; switch to a newer matching session, seeking to its end. */
  private async repoint(initial: boolean): Promise<void> {
    const found = await discoverSession(this.root, this.opts.projectsRoot);
    if (found && found !== this.current) {
      this.current = found;
      this.carry = "";
      try {
        const st = await fsp.stat(found);
        this.offset = st.size; // seek-to-end: never speak the backlog (D4)
      } catch {
        this.offset = 0;
      }
      this.rewatch(found);
    } else if (!found && initial) {
      this.current = null; // no transcript yet — idle, no error
    }
  }

  private rewatch(file: string): void {
    this.fsWatcher?.close();
    try {
      this.fsWatcher = fs.watch(file, () => void this.readNew());
    } catch {
      this.fsWatcher = null; // rely on the poll timer
    }
  }

  private async tick(): Promise<void> {
    if (this.disposed) return;
    await this.repoint(false);
    await this.readNew();
  }

  private async readNew(): Promise<void> {
    if (!this.current) return;
    let size: number;
    try {
      size = (await fsp.stat(this.current)).size;
    } catch {
      return;
    }
    if (size < this.offset) {
      // Truncated/rotated — reseek to end rather than replay.
      this.offset = size;
      this.carry = "";
      return;
    }
    if (size === this.offset) return;

    let chunk = "";
    try {
      const fh = await fsp.open(this.current, "r");
      try {
        const len = size - this.offset;
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, this.offset);
        chunk = buf.toString("utf8", 0, bytesRead);
        this.offset += bytesRead;
      } finally {
        await fh.close();
      }
    } catch {
      return;
    }

    const text = this.carry + chunk;
    const lines = text.split(/\r?\n/);
    this.carry = lines.pop() ?? ""; // last fragment may be a partial line
    const signals: Signal[] = [];
    for (const line of lines) {
      signals.push(...classifyLine(parseLine(line)));
    }
    if (signals.length) this.opts.onSignals(signals);
  }

  get currentSession(): string | null {
    return this.current;
  }

  dispose(): void {
    this.disposed = true;
    this.fsWatcher?.close();
    this.fsWatcher = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
