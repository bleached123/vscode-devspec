import * as path from "node:path";
import * as vscode from "vscode";
import { runDevspec } from "../cli.js";
import { buildSnapshot } from "../snapshot.js";
import type { WorkspaceSnapshot } from "../workspace.js";
import { log } from "../log.js";

const LIFECYCLE_STAGES = [
  "discovery",
  "proposal",
  "design",
  "contract",
  "alignment",
  "tasks",
] as const;
type Stage = (typeof LIFECYCLE_STAGES)[number];
type Column = Stage | "done";

interface MoveMsg {
  type: "move";
  slug: string;
  from: Column;
  to: Column;
}
interface RefreshMsg {
  type: "refresh";
}
type WebviewInbound = MoveMsg | RefreshMsg;

/**
 * Interactive kanban panel. The webview shows seven columns (the six
 * lifecycle stages + "done"). Drag a card from one column to another and we
 * call `devspec advance` (moving right) or `devspec rewind` (moving left),
 * then rebuild the snapshot and push fresh state back to the webview.
 */
export class BoardWebviewManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private root: string | null = null;
  private readonly extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  dispose(): void {
    this.panel?.dispose();
  }

  async open(root: string): Promise<void> {
    this.root = root;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      await this.pushState();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "devspec.board",
      "DevSpec board",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
      }
    );
    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "devspec.svg");

    this.panel.onDidDispose(() => {
      this.panel = null;
      this.root = null;
    });

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewInbound) => {
      if (!this.root) return;
      if (msg.type === "refresh") {
        await this.pushState();
      } else if (msg.type === "move") {
        await this.handleMove(msg);
      }
    });

    await this.renderInitial();
  }

  /** Re-render the panel with the latest snapshot, if open. */
  async refresh(): Promise<void> {
    if (!this.panel || !this.root) return;
    await this.pushState();
  }

  private async renderInitial(): Promise<void> {
    if (!this.panel || !this.root) return;
    const snapshot = await buildSnapshot(this.root);
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "webview", "board.js")
    );
    this.panel.webview.html = renderHtml({
      cspSource: this.panel.webview.cspSource,
      scriptUri: scriptUri.toString(),
      bootstrap: stateFromSnapshot(snapshot),
    });
  }

  private async pushState(): Promise<void> {
    if (!this.panel || !this.root) return;
    const snapshot = await buildSnapshot(this.root);
    this.panel.webview.postMessage({
      type: "state",
      state: stateFromSnapshot(snapshot),
    });
  }

  private async handleMove(msg: MoveMsg): Promise<void> {
    if (!this.root) return;
    log.info(`board: move ${msg.slug} from ${msg.from} → ${msg.to}`);
    try {
      await applyMove(this.root, msg.slug, msg.from, msg.to);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`board: move failed — ${message}`);
      this.panel?.webview.postMessage({ type: "error", message });
    }
    await this.pushState();
  }
}

function columnIndex(col: Column): number {
  if (col === "done") return LIFECYCLE_STAGES.length;
  return LIFECYCLE_STAGES.indexOf(col as Stage);
}

/**
 * Forward move: call `devspec advance <slug> <stage>` once per stage from
 * the source column up to (but not including) the destination column. The
 * destination's stage itself becomes "in_progress" after we're done.
 *
 * Backward move: call `devspec rewind <slug> <target-stage>` once — rewind
 * sets the target stage AND every later stage back to pending in one call.
 *
 * Moving INTO the virtual "done" column = advance every remaining stage.
 */
async function applyMove(root: string, slug: string, from: Column, to: Column): Promise<void> {
  const fromIdx = columnIndex(from);
  const toIdx = columnIndex(to);
  if (fromIdx < 0 || toIdx < 0) {
    throw new Error(`Unknown column: ${from} → ${to}`);
  }
  if (fromIdx === toIdx) return;

  if (toIdx > fromIdx) {
    // Forward: advance every stage from `from` through one less than `to`,
    // OR through `tasks` (the last real stage) when destination is "done".
    const stopBeforeIdx = to === "done" ? LIFECYCLE_STAGES.length : toIdx;
    for (let i = fromIdx; i < stopBeforeIdx; i++) {
      const stage = LIFECYCLE_STAGES[i];
      if (!stage) continue;
      const r = await runDevspec(["advance", slug, stage], root);
      if (r.exitCode !== 0) {
        throw new Error(
          `\`devspec advance ${slug} ${stage}\` failed: ${(r.stderr || r.stdout || "no detail").trim()}`
        );
      }
    }
  } else {
    // Backward: rewind to the target stage.
    const targetStage =
      to === "done"
        ? (LIFECYCLE_STAGES[LIFECYCLE_STAGES.length - 1] ?? "tasks")
        : (to as Stage);
    const r = await runDevspec(["rewind", slug, targetStage], root);
    if (r.exitCode !== 0) {
      throw new Error(
        `\`devspec rewind ${slug} ${targetStage}\` failed: ${(r.stderr || r.stdout || "no detail").trim()}`
      );
    }
  }
}

function stateFromSnapshot(snapshot: WorkspaceSnapshot): object {
  return {
    phase: snapshot.phase,
    backend: snapshot.backend,
    architecture: snapshot.architecture,
    workspaceRoot: snapshot.root,
    changes: snapshot.changes.map((c) => ({
      slug: c.slug,
      title: c.title,
      doneStages: c.doneStages,
      totalStages: c.totalStages,
      inProgressStage: c.inProgressStage,
      blockingCount: c.blockingCount,
      warningCount: c.warningCount,
      archived: c.archived,
    })),
  };
}

function renderHtml(args: { cspSource: string; scriptUri: string; bootstrap: object }): string {
  const nonce = randomNonce();
  const csp = [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}' ${args.cspSource}`,
    `style-src ${args.cspSource} 'unsafe-inline'`,
    `img-src ${args.cspSource} data:`,
  ].join("; ");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>DevSpec board</title>
  <style>
    html, body {
      height: 100%;
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .page { display: flex; flex-direction: column; height: 100vh; }
    .toolbar {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      padding: 0.6rem 1rem;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editorGroupHeader-tabsBackground);
    }
    .toolbar h1 { font-size: 0.95rem; margin: 0; font-weight: 600; }
    .toolbar #meta { font-size: 0.8rem; color: var(--vscode-descriptionForeground); flex: 1; margin-left: 0.5rem; }
    .toolbar button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 0; padding: 0.3rem 0.7rem; border-radius: 3px; cursor: pointer;
      font-size: 0.8rem;
    }
    .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    #error-banner {
      display: none; padding: 0.5rem 1rem; background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground); border-bottom: 1px solid var(--vscode-inputValidation-errorBorder);
      font-size: 0.85rem;
    }
    #board {
      flex: 1; display: grid; grid-template-columns: repeat(7, minmax(180px, 1fr));
      gap: 0.5rem; padding: 0.75rem; overflow-x: auto; align-items: stretch;
    }
    .column {
      display: flex; flex-direction: column;
      background: var(--vscode-sideBar-background);
      border-radius: 4px; min-height: 60vh; min-width: 180px;
    }
    .column.done-col { background: color-mix(in srgb, var(--vscode-sideBar-background) 80%, #3fb950 8%); }
    .column-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.5rem 0.75rem; font-size: 0.8rem;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .column-title { font-weight: 600; text-transform: capitalize; }
    .column-count {
      background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
      padding: 0 0.4rem; border-radius: 8px; font-size: 0.7rem;
    }
    .column-body { flex: 1; padding: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; min-height: 40vh; }
    .column-body.drag-over { background: color-mix(in srgb, var(--vscode-list-hoverBackground) 60%, transparent); outline: 1px dashed var(--vscode-focusBorder); }
    .empty-hint { color: var(--vscode-descriptionForeground); font-size: 0.75rem; text-align: center; padding: 1rem 0.25rem; opacity: 0.5; }
    .card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px; padding: 0.55rem 0.65rem; cursor: grab;
      transition: transform 0.08s, box-shadow 0.08s;
    }
    .card:hover { box-shadow: 0 1px 3px rgba(0,0,0,0.25); }
    .card.dragging { opacity: 0.4; cursor: grabbing; }
    .card-block { border-left: 3px solid #f85149; }
    .card-warn { border-left: 3px solid #d29922; }
    .card-clean { border-left: 3px solid #3fb950; }
    .card-title { font-size: 0.85rem; font-weight: 600; margin-bottom: 0.2rem; }
    .card-slug { font-size: 0.7rem; color: var(--vscode-descriptionForeground); margin-bottom: 0.4rem; }
    .card-slug code { font-family: var(--vscode-editor-font-family, monospace); }
    .card-meta { display: flex; align-items: center; gap: 0.4rem; font-size: 0.7rem; }
    .progress { flex: 1; height: 4px; background: var(--vscode-progressBar-background, #444); border-radius: 2px; overflow: hidden; }
    .progress-fill { height: 100%; background: var(--vscode-charts-blue, #1f6feb); }
    .progress-text { color: var(--vscode-descriptionForeground); white-space: nowrap; }
    .badge { padding: 1px 5px; border-radius: 3px; font-size: 0.65rem; }
    .badge.block { background: rgba(248, 81, 73, 0.2); }
    .badge.warn { background: rgba(210, 153, 34, 0.2); }
    .badge.clean { background: rgba(63, 185, 80, 0.15); }
  </style>
</head>
<body>
  <div class="page">
    <div class="toolbar">
      <h1>📋 DevSpec board</h1>
      <span id="meta"></span>
      <button id="refresh-btn">↻ Refresh</button>
    </div>
    <div id="error-banner"></div>
    <div id="board"></div>
  </div>
  <script nonce="${nonce}">
    window.__DEVSPEC_BOARD__ = ${JSON.stringify(args.bootstrap)};
  </script>
  <script nonce="${nonce}" src="${args.scriptUri}"></script>
</body>
</html>`;
}

function randomNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
