/**
 * Pure parsing of Claude Code session-transcript JSONL lines. No filesystem,
 * no vscode — just turning raw lines into typed signals. The fs-touching
 * watcher lives in transcriptWatcher.ts and builds on these functions.
 *
 * Schema (confirmed by structure inspection of a real transcript): each line is
 * a complete JSON event with a top-level `type` and, for conversation events, a
 * `message: { role, content }`. `content` is either a string or an array of
 * typed blocks (`text` | `thinking` | `tool_use` | `tool_result`). Sidechain
 * (subagent) and meta lines are flagged with `isSidechain` / `isMeta`.
 */

export interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  input?: unknown;
  [k: string]: unknown;
}

export interface TranscriptLine {
  type?: string;
  uuid?: string;
  cwd?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  version?: string;
  message?: { role?: string; content?: ContentBlock[] | string };
  [k: string]: unknown;
}

export type Signal =
  | { kind: "text"; uuid?: string; text: string }
  | { kind: "thinking" }
  | { kind: "tool_use"; id?: string; name?: string; filePath?: string }
  | { kind: "tool_result"; id?: string };

/** Parse a single JSONL line. Returns null for blank lines or malformed JSON. */
export function parseLine(line: string): TranscriptLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const o = JSON.parse(trimmed) as TranscriptLine;
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

/** Best-effort file path out of a tool_use input (Read/Edit/Write/etc.). */
export function extractFilePath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  for (const key of ["file_path", "path", "notebook_path", "filePath"]) {
    const v = o[key];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/**
 * Classify a transcript line into zero or more signals. Sidechain and meta
 * lines yield nothing (we never speak subagent traffic — design D12). Only
 * assistant-role text becomes a speakable `text` signal.
 */
export function classifyLine(line: TranscriptLine | null): Signal[] {
  if (!line || line.isSidechain || line.isMeta) return [];
  const msg = line.message;
  if (!msg) return [];
  const role = msg.role;
  const content = msg.content;

  if (typeof content === "string") {
    return role === "assistant" && content.trim()
      ? [{ kind: "text", uuid: line.uuid, text: content }]
      : [];
  }
  if (!Array.isArray(content)) return [];

  const out: Signal[] = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    switch (b.type) {
      case "text":
        if (role === "assistant" && typeof b.text === "string" && b.text.trim()) {
          out.push({ kind: "text", uuid: line.uuid, text: b.text });
        }
        break;
      case "thinking":
        out.push({ kind: "thinking" });
        break;
      case "tool_use":
        out.push({
          kind: "tool_use",
          id: typeof b.id === "string" ? b.id : undefined,
          name: typeof b.name === "string" ? b.name : undefined,
          filePath: extractFilePath(b.input),
        });
        break;
      case "tool_result":
        out.push({
          kind: "tool_result",
          id: typeof b.tool_use_id === "string" ? b.tool_use_id : undefined,
        });
        break;
    }
  }
  return out;
}

/**
 * Does a transcript line belong to the given workspace? Matches the top-level
 * `cwd` against the workspace root, case-insensitively and separator-insensitively
 * (Windows paths in transcripts may differ in slash direction / drive casing).
 */
export function lineMatchesWorkspace(line: TranscriptLine | null, root: string): boolean {
  if (!line || typeof line.cwd !== "string") return false;
  return normalizePath(line.cwd) === normalizePath(root);
}

export function normalizePath(p: string): string {
  return p.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
}
