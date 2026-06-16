import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { WorkspaceSnapshot } from "../workspace.js";

/**
 * "Agent activity" view: shows the most recent log entries from each active
 * change's alignment.md. The `devspec log <slug> "<decision>" [--rule <name>]`
 * CLI writes timestamped lines into the alignment doc — those are our event
 * stream. We pull the last N globally, sorted descending by timestamp.
 *
 * Parsing is forgiving: we look for any line starting with a heading like
 * `## 2026-05-18 14:30 — <body>` or `- 2026-05-18 14:30 — <body>` and take
 * what we find. Free-text alignment content between entries is ignored.
 */

const MAX_ENTRIES = 25;

type Node =
  | { kind: "entry"; entry: ActivityEntry }
  | { kind: "empty"; message: string };

interface ActivityEntry {
  slug: string;
  timestamp: string; // ISO-ish raw string as parsed
  message: string;
  rule: string | null;
}

export class AgentActivityTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private snapshot: WorkspaceSnapshot | null = null;
  private entries: ActivityEntry[] = [];

  async refresh(snapshot: WorkspaceSnapshot | null): Promise<void> {
    this.snapshot = snapshot;
    this.entries = snapshot ? await collectEntries(snapshot) : [];
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "empty") {
      const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }
    const e = node.entry;
    const item = new vscode.TreeItem(e.message, vscode.TreeItemCollapsibleState.None);
    item.description = `${humanizeAge(e.timestamp)} · ${e.slug}${e.rule ? ` · ${e.rule}` : ""}`;
    item.iconPath = new vscode.ThemeIcon(iconForRule(e.rule));
    item.tooltip = new vscode.MarkdownString(
      `**${e.slug}**\n\n` +
        `_${e.timestamp}_\n\n` +
        `${e.message}` +
        (e.rule ? `\n\n**Rule**: \`${e.rule}\`` : "")
    );
    item.resourceUri = this.snapshot
      ? vscode.Uri.file(
          path.join(this.snapshot.root, ".devspec", "projects", e.slug, "alignment.md")
        )
      : undefined;
    item.command = item.resourceUri
      ? { command: "vscode.open", title: "Open alignment.md", arguments: [item.resourceUri] }
      : undefined;
    return item;
  }

  getChildren(): Node[] {
    if (!this.snapshot) return [];
    if (this.entries.length === 0) {
      return [
        {
          kind: "empty",
          message: "No log entries yet. Run `devspec log <slug> \"<decision>\"` or the Ralph loop to populate.",
        },
      ];
    }
    return this.entries.slice(0, MAX_ENTRIES).map((entry) => ({ kind: "entry" as const, entry }));
  }
}

async function collectEntries(snapshot: WorkspaceSnapshot): Promise<ActivityEntry[]> {
  const all: ActivityEntry[] = [];
  for (const change of snapshot.changes) {
    if (change.archived) continue;
    const alignmentPath = path.join(
      snapshot.root,
      ".devspec",
      "projects",
      change.slug,
      "alignment.md"
    );
    let raw: string;
    try {
      raw = await fs.readFile(alignmentPath, "utf8");
    } catch {
      continue;
    }
    for (const entry of parseAlignment(change.slug, raw)) all.push(entry);
  }
  // Descending by raw timestamp string (ISO 8601 sorts correctly as text)
  all.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  return all;
}

const LINE_RE =
  /^\s*(?:[-*#]+\s+)?(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?)\s*[—–-]\s*(.+?)\s*$/;

function parseAlignment(slug: string, raw: string): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const timestamp = m[1] ?? "";
    let body = m[2] ?? "";
    let rule: string | null = null;
    const ruleMatch = /\[?\s*rule:\s*([\w-]+)\s*\]?/i.exec(body);
    if (ruleMatch) {
      rule = ruleMatch[1] ?? null;
      body = body.replace(ruleMatch[0], "").trim();
    }
    body = body.replace(/^[`*_]+|[`*_]+$/g, "").trim();
    if (!body) continue;
    out.push({ slug, timestamp, message: body, rule });
  }
  return out;
}

function iconForRule(rule: string | null): string {
  if (!rule) return "comment-discussion";
  if (rule === "review-blocked") return "shield";
  if (rule === "check-failure") return "error";
  if (rule.includes("granularity") || rule.includes("coverage")) return "warning";
  if (rule.startsWith("api-")) return "symbol-method";
  return "git-commit";
}

function humanizeAge(rawTimestamp: string): string {
  const parsed = Date.parse(rawTimestamp);
  if (Number.isNaN(parsed)) return rawTimestamp;
  const diffMs = Date.now() - parsed;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
