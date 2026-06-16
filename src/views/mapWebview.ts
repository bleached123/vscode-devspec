import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { runDevspec } from "../cli.js";

/**
 * A webview panel that renders the DevSpec maps interactively. The CLI
 * generates the Mermaid markdown files; this panel reads them, extracts the
 * mermaid blocks, and renders them via mermaid.js loaded from a CDN (jsdelivr).
 *
 * Drill-down: clicking a node calls back via `postMessage` and we navigate to
 * the next layer.
 */
export class MapWebviewManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private currentLayer: string = "workspace";
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

    // Regenerate maps first so the user always sees fresh content
    await runDevspec(["map"], root, { timeoutMs: 15_000 });

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      await this.render(this.currentLayer);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "devspec.map",
      "DevSpec map",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(root, ".devspec", "maps")),
          vscode.Uri.joinPath(this.extensionUri, "media"),
        ],
      }
    );
    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "devspec.svg");

    this.panel.onDidDispose(() => {
      this.panel = null;
    });

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      switch (msg.type) {
        case "navigate":
          await this.render(msg.target);
          break;
        case "openSource": {
          if (!this.root) return;
          const target = path.join(this.root, ".devspec", "maps", msg.file);
          await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(target));
          break;
        }
        case "refresh":
          await runDevspec(["map"], root, { timeoutMs: 15_000 });
          await this.render(this.currentLayer);
          break;
      }
    });

    await this.render("workspace");
  }

  /** Refresh in place — called when files change. */
  async refresh(): Promise<void> {
    if (!this.panel || !this.root) return;
    await runDevspec(["map"], this.root, { timeoutMs: 15_000 });
    await this.render(this.currentLayer);
  }

  private async render(layer: string): Promise<void> {
    if (!this.panel || !this.root) return;
    this.currentLayer = layer;

    const mapsDir = path.join(this.root, ".devspec", "maps");
    const targetFile = path.join(mapsDir, `${layer}.md`);

    let markdown = "";
    try {
      markdown = await fs.readFile(targetFile, "utf8");
    } catch (err) {
      markdown = `_Map file \`${layer}.md\` not found. Run \`devspec map\` in the workspace._\n\n${(err as Error).message}`;
    }

    const { diagrams, prose } = extractMermaidBlocks(markdown);
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "webview", "map.js")
    );
    this.panel.webview.html = renderHtml({
      layer,
      prose,
      diagrams,
      cspSource: this.panel.webview.cspSource,
      scriptUri: scriptUri.toString(),
      isDark:
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast,
    });
  }
}

type WebviewMessage =
  | { type: "navigate"; target: string }
  | { type: "openSource"; file: string }
  | { type: "refresh" };

interface ExtractedContent {
  prose: string; // markdown stripped of mermaid blocks
  diagrams: string[]; // raw mermaid source per block, in document order
}

function extractMermaidBlocks(markdown: string): ExtractedContent {
  const diagrams: string[] = [];
  const placeholderPattern = "<<<DIAGRAM_PLACEHOLDER_INDEX_$$>>>";
  const stripped = markdown.replace(
    /```mermaid\s*\n([\s\S]*?)```/g,
    (_full, body: string) => {
      const idx = diagrams.length;
      diagrams.push(body.trim());
      return placeholderPattern.replace("$$", String(idx));
    }
  );
  return { prose: stripped, diagrams };
}

function renderHtml(args: {
  layer: string;
  prose: string;
  diagrams: string[];
  cspSource: string;
  scriptUri: string;
  isDark: boolean;
}): string {
  const nonce = randomNonce();
  // Lock everything down to webview-local sources. No remote origins —
  // mermaid + marked are bundled into media/webview/map.js.
  const csp = [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}' ${args.cspSource}`,
    `style-src ${args.cspSource} 'unsafe-inline'`,
    `font-src ${args.cspSource} data:`,
    `img-src ${args.cspSource} data:`,
  ].join("; ");

  const bootstrap = JSON.stringify({
    layer: args.layer,
    prose: args.prose,
    diagrams: args.diagrams,
    isDark: args.isDark,
  });

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>DevSpec map — ${escapeHtml(args.layer)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 1rem 1.5rem;
      max-width: 1100px;
      margin: 0 auto;
    }
    h1 { font-size: 1.4rem; }
    h2 { font-size: 1.15rem; margin-top: 1.5rem; }
    a { color: var(--vscode-textLink-foreground); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code, pre code { font-family: var(--vscode-editor-font-family); }
    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 0.75rem;
      border-radius: 4px;
      overflow-x: auto;
    }
    .mermaid-block { margin: 1rem 0; padding: 0.75rem; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; }
    .mermaid-block .mermaid { background: transparent; }
    .mermaid-error { color: var(--vscode-errorForeground); border-left: 3px solid var(--vscode-errorForeground); padding-left: 0.75rem; }
    .toolbar { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: center; }
    .toolbar button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 0;
      padding: 0.35rem 0.75rem;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .toolbar button:hover { background: var(--vscode-button-hoverBackground); }
    .toolbar .layer-tag { font-size: 0.85rem; color: var(--vscode-descriptionForeground); }
    table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 0.3rem 0.5rem; text-align: left; }
    th { background: var(--vscode-editorGroupHeader-tabsBackground); }
    blockquote { border-left: 3px solid var(--vscode-textBlockQuote-border); margin: 0; padding-left: 0.75rem; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="layer-tag">Layer:</span>
    <button data-go="workspace">Workspace</button>
    <button data-go="arch">Architecture</button>
    <button id="refresh-btn">↻ Refresh</button>
    <button id="open-source-btn">Open source .md</button>
  </div>
  <div id="content">Loading…</div>
  <script nonce="${nonce}">
    window.__DEVSPEC__ = ${bootstrap};
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
