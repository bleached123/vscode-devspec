import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import type { WorkspaceSnapshot } from "../workspace.js";

/** Compact view of the workspace phase + summary chips. */
export class PhaseTreeProvider implements vscode.TreeDataProvider<PhaseNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<PhaseNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private snapshot: WorkspaceSnapshot | null = null;
  private claudeMdAge: { ageDays: number | null; missing: boolean } = { ageDays: null, missing: true };

  async refresh(snapshot: WorkspaceSnapshot | null): Promise<void> {
    this.snapshot = snapshot;
    this.claudeMdAge = snapshot ? await loadClaudeMdAge(snapshot.root) : { ageDays: null, missing: true };
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: PhaseNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon);
    if (node.description) item.description = node.description;
    if (node.tooltip) item.tooltip = node.tooltip;
    if (node.command) item.command = node.command;
    if (node.contextValue) item.contextValue = node.contextValue;
    return item;
  }

  async getChildren(): Promise<PhaseNode[]> {
    const s = this.snapshot;
    if (!s) return []; // → viewsWelcome shows
    if (!s.cliAvailable) {
      return [
        {
          label: "CLI unavailable",
          icon: "warning",
          description: s.cliError ?? "",
        },
      ];
    }
    const active = s.changes.filter((c) => !c.archived);
    const blocking = active.reduce((sum, c) => sum + c.blockingCount, 0);
    const warning = active.reduce((sum, c) => sum + c.warningCount, 0);
    return [
      {
        label: "Phase",
        description: `${s.phase}${s.declaredPhase ? " (declared)" : " (auto)"}`,
        icon: "rocket",
      },
      {
        label: "Stack",
        description: `${s.backend} · ${s.architecture} · ${s.methodology}`,
        icon: "layers",
      },
      {
        label: "Active changes",
        description: String(active.length),
        icon: "list-tree",
      },
      {
        label: "Coherence",
        description:
          blocking > 0 ? `🔴 ${blocking} blocking` : warning > 0 ? `🟡 ${warning} warning` : "🟢 clean",
        icon: blocking > 0 ? "error" : warning > 0 ? "warning" : "check",
      },
      {
        label: "CLI",
        description: s.cliVersion ?? "unknown",
        icon: "terminal",
      },
      this.claudeMdNode(),
    ];
  }

  private claudeMdNode(): PhaseNode {
    if (this.claudeMdAge.missing) {
      return {
        label: "CLAUDE.md",
        description: "missing — click to generate",
        icon: "warning",
        tooltip: "AI agents (Claude Code, etc.) read CLAUDE.md for workspace standards. Click to run `devspec claude`.",
        command: { command: "devspec.regenerateClaudeMd", title: "Regenerate CLAUDE.md" },
        contextValue: "claudeMd",
      };
    }
    const days = this.claudeMdAge.ageDays ?? 0;
    const stale = days > 7;
    return {
      label: "CLAUDE.md",
      description: `${formatAge(days)}${stale ? " · stale" : ""}`,
      icon: stale ? "warning" : "check",
      tooltip: stale
        ? "Standards may have changed since CLAUDE.md was last generated. Click to regenerate."
        : "CLAUDE.md is current. Click to regenerate anyway.",
      command: { command: "devspec.regenerateClaudeMd", title: "Regenerate CLAUDE.md" },
      contextValue: "claudeMd",
    };
  }
}

interface PhaseNode {
  label: string;
  description?: string;
  icon?: string;
  tooltip?: string;
  command?: vscode.Command;
  contextValue?: string;
}

async function loadClaudeMdAge(root: string): Promise<{ ageDays: number | null; missing: boolean }> {
  try {
    const stat = await fs.stat(path.join(root, "CLAUDE.md"));
    const ageMs = Date.now() - stat.mtimeMs;
    return { ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)), missing: false };
  } catch {
    return { ageDays: null, missing: true };
  }
}

function formatAge(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}
