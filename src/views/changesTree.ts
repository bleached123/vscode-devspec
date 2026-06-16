import * as path from "node:path";
import * as vscode from "vscode";
import type { WorkspaceSnapshot, ChangeSummary } from "../workspace.js";

/** Top-level kind in the tree. */
type Node =
  | { kind: "change"; change: ChangeSummary }
  | { kind: "stage"; change: ChangeSummary; stage: string }
  | { kind: "empty"; message: string };

export class ChangesTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private snapshot: WorkspaceSnapshot | null = null;

  refresh(snapshot: WorkspaceSnapshot | null): void {
    this.snapshot = snapshot;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "empty") {
      const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("info");
      item.contextValue = "info";
      return item;
    }
    if (node.kind === "change") {
      const c = node.change;
      const item = new vscode.TreeItem(
        c.slug,
        c.totalStages > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
      );
      const deltaPart =
        c.pendingDeltas.length > 0 ? `  Δ${c.pendingDeltas.length}` : "";
      item.description = `${c.doneStages}/${c.totalStages}${deltaPart}  ${driftLabel(c)}`;
      item.tooltip = new vscode.MarkdownString(
        `**${c.title}**\n\n` +
          `- Stages: ${c.doneStages} / ${c.totalStages} done\n` +
          (c.inProgressStage ? `- Current: \`${c.inProgressStage}\`\n` : "") +
          `- Coherence: ${c.blockingCount} blocking, ${c.warningCount} warning` +
          (c.pendingDeltas.length > 0
            ? `\n- Pending deltas: ${c.pendingDeltas.join(", ")} (${c.pendingDeltas.length})`
            : "")
      );
      item.iconPath = changeIcon(c);
      item.contextValue = "change";
      item.command = {
        command: "devspec.openChange",
        title: "Open change",
        arguments: [c.slug],
      };
      return item;
    }
    // stage
    const item = new vscode.TreeItem(node.stage, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(stageIcon(node));
    item.contextValue = "stage";
    item.resourceUri = vscode.Uri.file(
      path.join(
        this.snapshot?.root ?? "",
        ".devspec",
        "projects",
        node.change.slug,
        `${node.stage}.md`
      )
    );
    item.command = {
      command: "vscode.open",
      title: "Open stage doc",
      arguments: [item.resourceUri],
    };
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    // Return [] (not a "Loading…" pseudo-node) so VS Code shows the
    // viewsWelcome content registered in package.json instead of a stuck row.
    if (!this.snapshot) return [];
    if (!this.snapshot.cliAvailable) {
      return [
        { kind: "empty", message: `devspec CLI not found: ${this.snapshot.cliError ?? "unknown"}` },
      ];
    }
    if (!node) {
      const active = this.snapshot.changes.filter((c) => !c.archived);
      if (active.length === 0) return [];
      return active.map((change) => ({ kind: "change", change }));
    }
    if (node.kind === "change") {
      return LIFECYCLE_STAGES.map((stage) => ({ kind: "stage", change: node.change, stage }));
    }
    return [];
  }
}

const LIFECYCLE_STAGES = [
  "discovery",
  "proposal",
  "design",
  "contract",
  "alignment",
  "tasks",
];

function driftLabel(c: ChangeSummary): string {
  if (c.blockingCount > 0) return `🔴 ${c.blockingCount} block`;
  if (c.warningCount > 0) return `🟡 ${c.warningCount} warn`;
  return "🟢 clean";
}

function changeIcon(c: ChangeSummary): vscode.ThemeIcon {
  if (c.blockingCount > 0) return new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
  if (c.warningCount > 0)
    return new vscode.ThemeIcon("warning", new vscode.ThemeColor("editorWarning.foreground"));
  if (c.doneStages === c.totalStages)
    return new vscode.ThemeIcon("check-all", new vscode.ThemeColor("charts.purple"));
  return new vscode.ThemeIcon("circle-outline");
}

function stageIcon(node: Extract<Node, { kind: "stage" }>): string {
  // We don't know stage status from the summary alone — TODO: fetch per-change
  // status when expanded. For now show a neutral icon; the user clicks through
  // to the doc.
  return "file";
}
