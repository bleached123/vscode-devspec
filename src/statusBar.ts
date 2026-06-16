import * as vscode from "vscode";
import type { WorkspaceSnapshot } from "./workspace.js";
import {
  composeStatusBar,
  noWorkspaceModel,
  cliMissingModel,
  type StatusSeverity,
} from "./statusBarText.js";

export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "devspec.openMap";
    this.item.name = "DevSpec";
    // Show immediately so the user can confirm the extension activated.
    // The update() call later replaces this with the real phase + drift state.
    this.item.text = "$(loading~spin) DevSpec";
    this.item.tooltip =
      "DevSpec is starting up — open a folder containing .devspec/devspec.yaml. Run `DevSpec: Show extension log` for details.";
    this.item.show();
  }

  update(snapshot: WorkspaceSnapshot | null): void {
    // No workspace open — keep the item visible so the user knows the extension
    // is alive, but show a "no workspace" hint instead of hiding.
    const model = !snapshot
      ? noWorkspaceModel()
      : !snapshot.cliAvailable
        ? cliMissingModel()
        : composeStatusBar(snapshot);

    this.item.text = model.text;
    this.item.tooltip = new vscode.MarkdownString(model.tooltip);
    this.item.backgroundColor = severityColor(model.severity);
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}

function severityColor(severity: StatusSeverity): vscode.ThemeColor | undefined {
  switch (severity) {
    case "error":
      return new vscode.ThemeColor("statusBarItem.errorBackground");
    case "warning":
      return new vscode.ThemeColor("statusBarItem.warningBackground");
    default:
      return undefined;
  }
}
