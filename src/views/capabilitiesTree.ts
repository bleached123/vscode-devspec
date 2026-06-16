import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { WorkspaceSnapshot, CapabilitySummary } from "../workspace.js";

type Node =
  | { kind: "capability"; capability: CapabilitySummary }
  | { kind: "requirement"; capability: string; name: string }
  | { kind: "empty"; message: string };

export class CapabilitiesTreeProvider implements vscode.TreeDataProvider<Node> {
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
    if (node.kind === "capability") {
      const c = node.capability;
      const item = new vscode.TreeItem(c.name, vscode.TreeItemCollapsibleState.Collapsed);
      if (c.status === "dirty") {
        item.description = `dirty${c.dirtyIn.length > 0 ? ` · ${c.dirtyIn.join(", ")}` : ""}`;
        item.iconPath = new vscode.ThemeIcon(
          "circle-large-outline",
          new vscode.ThemeColor("notificationsWarningIcon.foreground")
        );
      } else {
        item.description = "clean";
        item.iconPath = new vscode.ThemeIcon(
          "circle-large-filled",
          new vscode.ThemeColor("testing.iconPassed")
        );
      }
      item.tooltip = new vscode.MarkdownString(
        `**Capability:** \`${c.name}\`\n\n` +
          `- Status: ${c.status}\n` +
          (c.dirtyIn.length > 0
            ? `- Dirty in: ${c.dirtyIn.map((s) => `\`${s}\``).join(", ")}\n`
            : "")
      );
      item.contextValue = "capability";
      item.resourceUri = vscode.Uri.file(
        path.join(this.snapshot?.root ?? "", ".devspec", "specs", c.name, "spec.md")
      );
      item.command = {
        command: "vscode.open",
        title: "Open capability spec",
        arguments: [item.resourceUri],
      };
      return item;
    }
    // requirement
    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon("symbol-method");
    item.contextValue = "requirement";
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!this.snapshot) return [];
    if (!this.snapshot.cliAvailable) {
      return [{ kind: "empty", message: "devspec CLI not found" }];
    }

    if (!node) {
      if (this.snapshot.capabilities.length === 0) {
        // Return [] so VS Code shows the viewsWelcome content for the empty state.
        return [];
      }
      return this.snapshot.capabilities.map(
        (c) => ({ kind: "capability", capability: c }) satisfies Node
      );
    }

    if (node.kind === "capability") {
      const names = await readRequirementNames(
        this.snapshot.root,
        node.capability.name
      );
      if (names.length === 0) {
        return [
          { kind: "empty", message: "No requirements yet — edit the spec to add some" },
        ];
      }
      return names.map(
        (name) =>
          ({ kind: "requirement", capability: node.capability.name, name }) satisfies Node
      );
    }

    return [];
  }
}

async function readRequirementNames(root: string, capability: string): Promise<string[]> {
  const file = path.join(root, ".devspec", "specs", capability, "spec.md");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const names: string[] = [];
  const re = /^### Requirement:\s*(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[1]) names.push(m[1].trim());
  }
  return names;
}
