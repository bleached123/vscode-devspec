import * as vscode from "vscode";
import { findWorkspaceRoot } from "./workspace.js";
import { buildSnapshot } from "./snapshot.js";
import { ChangesTreeProvider } from "./views/changesTree.js";
import { PhaseTreeProvider } from "./views/phaseTree.js";
import { AgentActivityTreeProvider } from "./views/agentActivityTree.js";
import { CapabilitiesTreeProvider } from "./views/capabilitiesTree.js";
import { MapWebviewManager } from "./views/mapWebview.js";
import { BoardWebviewManager } from "./views/boardWebview.js";
import { StatusBar } from "./statusBar.js";
import { OrbViewProvider } from "./voice/orbView.js";
import { CoherenceDiagnostics } from "./providers/diagnostics.js";
import { DevspecCodeLensProvider } from "./providers/codeLens.js";
import { log } from "./log.js";
import {
  planChangeCommand,
  coherenceCommand,
  openMapCommand,
  initCommand,
  openChangeCommand,
  copySlashCommandCommand,
  regenerateClaudeMdCommand,
  initCapabilityCommand,
  showContributingChangesCommand,
  nextCommand,
  logDecisionCommand,
  completeTaskAtLineCommand,
} from "./commands.js";
import type { WorkspaceSnapshot } from "./workspace.js";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log.info("============================================================");
  log.info(`vscode-devspec activating (${context.extension.id} v${context.extension.packageJSON.version})`);
  log.info(`platform: ${process.platform} · node: ${process.version} · vscode: ${vscode.version}`);
  log.info(
    `workspace folders: ${
      (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath).join(", ") || "(none)"
    }`
  );

  // Show a once-per-install welcome notification so the user has visible proof
  // that the extension activated. Subsequent activations are silent.
  const welcomeShownKey = "devspec.welcomeShown";
  if (!context.globalState.get<boolean>(welcomeShownKey)) {
    void context.globalState.update(welcomeShownKey, true);
    void vscode.window
      .showInformationMessage(
        "DevSpec extension is active. Click the DevSpec icon in the Activity Bar, or run \"DevSpec: Show extension log\" to see what it's doing.",
        "Show log",
        "Dismiss"
      )
      .then((choice) => {
        if (choice === "Show log") log.show();
      });
  }

  const changesProvider = new ChangesTreeProvider();
  const phaseProvider = new PhaseTreeProvider();
  const activityProvider = new AgentActivityTreeProvider();
  const capabilitiesProvider = new CapabilitiesTreeProvider();
  const statusBar = new StatusBar();
  const diagnostics = new CoherenceDiagnostics();
  const codeLensProvider = new DevspecCodeLensProvider();
  const mapWebview = new MapWebviewManager(context.extensionUri);
  const boardWebview = new BoardWebviewManager(context.extensionUri);
  const orb = new OrbViewProvider(context);
  context.subscriptions.push(statusBar, diagnostics, mapWebview, boardWebview, orb);

  // Latest snapshot — shared with command handlers that need workspace state
  // outside the tree-provider context (e.g. showContributingChanges).
  let latestSnapshot: WorkspaceSnapshot | null = null;

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("devspec.changes", changesProvider),
    vscode.window.registerTreeDataProvider("devspec.phase", phaseProvider),
    vscode.window.registerTreeDataProvider("devspec.activity", activityProvider),
    vscode.window.registerTreeDataProvider("devspec.capabilities", capabilitiesProvider),
    vscode.window.registerWebviewViewProvider(OrbViewProvider.viewId, orb),
    vscode.languages.registerCodeLensProvider(
      { language: "markdown", pattern: "**/.devspec/projects/**/*.md" },
      codeLensProvider
    ),
    vscode.languages.registerCodeLensProvider(
      { language: "markdown", pattern: "**/.devspec/specs/*/spec.md" },
      codeLensProvider
    ),
    vscode.languages.registerCodeLensProvider(
      { language: "markdown", pattern: "**/.claude/commands/**/*.md" },
      codeLensProvider
    )
  );

  const refresh = async (): Promise<void> => {
    try {
      const root = await findWorkspaceRoot();
      if (!root) {
        log.info("refresh: no .devspec/devspec.yaml found in any open folder");
        latestSnapshot = null;
        changesProvider.refresh(null);
        void phaseProvider.refresh(null);
        void activityProvider.refresh(null);
        capabilitiesProvider.refresh(null);
        statusBar.update(null);
        return;
      }
      log.info(`refresh: workspace root = ${root}`);
      const snapshot = await buildSnapshot(root);
      latestSnapshot = snapshot;
      log.info(
        `refresh: phase=${snapshot.phase} backend=${snapshot.backend} changes=${snapshot.changes.length} capabilities=${snapshot.capabilities.length} cliAvailable=${snapshot.cliAvailable}`
      );
      changesProvider.refresh(snapshot);
      void phaseProvider.refresh(snapshot);
      void activityProvider.refresh(snapshot);
      capabilitiesProvider.refresh(snapshot);
      statusBar.update(snapshot);
      codeLensProvider.refresh();
      void diagnostics.refreshAll(
        root,
        snapshot.changes.filter((c) => !c.archived).map((c) => c.slug)
      );
      void mapWebview.refresh();
      void boardWebview.refresh();
    } catch (err) {
      log.error("refresh failed", err);
      latestSnapshot = null;
      changesProvider.refresh(null);
      void phaseProvider.refresh(null);
      void activityProvider.refresh(null);
      capabilitiesProvider.refresh(null);
      statusBar.update(null);
    }
  };

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("devspec.refresh", () => refresh()),
    vscode.commands.registerCommand("devspec.plan", () => planChangeCommand(refresh)),
    vscode.commands.registerCommand("devspec.coherence", (arg?: unknown) => {
      if (arg && typeof arg === "object" && "change" in arg) {
        const ch = (arg as { change: { slug: string } }).change;
        return coherenceCommand(ch.slug);
      }
      return coherenceCommand();
    }),
    vscode.commands.registerCommand("devspec.openMap", () => openMapCommand()),
    vscode.commands.registerCommand("devspec.openWebviewMap", async () => {
      const root = await findWorkspaceRoot();
      if (!root) {
        vscode.window.showWarningMessage("No DevSpec workspace open.");
        return;
      }
      await mapWebview.open(root);
    }),
    vscode.commands.registerCommand("devspec.openBoard", async () => {
      const root = await findWorkspaceRoot();
      if (!root) {
        vscode.window.showWarningMessage("No DevSpec workspace open.");
        return;
      }
      await boardWebview.open(root);
    }),
    vscode.commands.registerCommand("devspec.init", () => initCommand()),
    vscode.commands.registerCommand("devspec.openChange", (slug: string) => openChangeCommand(slug)),
    vscode.commands.registerCommand("devspec.showLog", () => log.show()),
    vscode.commands.registerCommand("devspec.regenerateClaudeMd", () =>
      regenerateClaudeMdCommand(refresh)
    ),
    vscode.commands.registerCommand(
      "devspec.copySlashCommand",
      (template: string, slug?: string) => copySlashCommandCommand(template, slug)
    ),
    vscode.commands.registerCommand("devspec.copyIterate", (arg?: unknown) =>
      copySlashCommandCommand("/devspec:iterate <slug>", slugFrom(arg))
    ),
    vscode.commands.registerCommand("devspec.copyReview", (arg?: unknown) =>
      copySlashCommandCommand("/devspec:review <slug>", slugFrom(arg))
    ),
    vscode.commands.registerCommand("devspec.copyCoordinate", () =>
      copySlashCommandCommand("/devspec:coordinate")
    ),
    vscode.commands.registerCommand("devspec.copyIterateAll", () =>
      copySlashCommandCommand("/devspec:iterate-all")
    ),
    vscode.commands.registerCommand("devspec.copyOnboard", () =>
      copySlashCommandCommand("/devspec:onboard")
    ),
    vscode.commands.registerCommand("devspec.copySync", (arg?: unknown) =>
      copySlashCommandCommand("/devspec:sync <slug>", slugFrom(arg))
    ),
    vscode.commands.registerCommand("devspec.copyExplore", () =>
      copySlashCommandCommand("/devspec:explore")
    ),
    vscode.commands.registerCommand("devspec.initCapability", () =>
      initCapabilityCommand(refresh)
    ),
    vscode.commands.registerCommand(
      "devspec.showContributingChanges",
      (capability: string) => showContributingChangesCommand(capability, () => latestSnapshot)
    ),
    // Lifecycle quick actions (vscode-extension-quality-of-life)
    vscode.commands.registerCommand("devspec.next", (arg?: unknown) =>
      nextCommand(slugFrom(arg))
    ),
    vscode.commands.registerCommand("devspec.logDecision", (arg?: unknown) =>
      logDecisionCommand(slugFrom(arg))
    ),
    vscode.commands.registerCommand(
      "devspec.completeTaskAtLine",
      (slug: string, line: number, text: string) =>
        completeTaskAtLineCommand(slug, line, text)
    ),
    // Eight new copy commands closing the slash-command surface
    vscode.commands.registerCommand("devspec.copyNew", () =>
      copySlashCommandCommand("/devspec:new <title>")
    ),
    vscode.commands.registerCommand("devspec.copyContinue", (arg?: unknown) =>
      copySlashCommandCommand("/devspec:continue <slug>", slugFrom(arg))
    ),
    vscode.commands.registerCommand("devspec.copyVerify", (arg?: unknown) =>
      copySlashCommandCommand("/devspec:verify <slug>", slugFrom(arg))
    ),
    vscode.commands.registerCommand("devspec.copyArchive", (arg?: unknown) =>
      copySlashCommandCommand("/devspec:archive <slug>", slugFrom(arg))
    ),
    vscode.commands.registerCommand("devspec.copyGrill", () => {
      const stage = inferStageFromActiveEditor();
      const template = stage
        ? `/devspec:grill ${stage} <slug>`
        : "/devspec:grill <stage> <slug>";
      return copySlashCommandCommand(template);
    }),
    vscode.commands.registerCommand("devspec.copyTriage", () =>
      copySlashCommandCommand("/devspec:triage")
    ),
    vscode.commands.registerCommand("devspec.copyUatDesign", () =>
      copySlashCommandCommand("/devspec:uat-design")
    ),
    vscode.commands.registerCommand("devspec.copyRefreshStandards", () =>
      copySlashCommandCommand("/devspec:refresh-standards")
    ),
    // Claude voice orb (claude-voice-orb)
    vscode.commands.registerCommand("devspec.openOrb", () => orb.reveal()),
    vscode.commands.registerCommand("devspec.voiceMute", () => orb.toggleMute()),
    vscode.commands.registerCommand("devspec.voiceStop", () => orb.stop()),
    vscode.commands.registerCommand("devspec.voiceSkipLatest", () => orb.skipToLatest())
  );

  context.subscriptions.push({ dispose: () => log.dispose() });

  // Refresh when files inside .devspec/ change.
  const watcher = vscode.workspace.createFileSystemWatcher("**/.devspec/**");
  context.subscriptions.push(
    watcher,
    watcher.onDidChange((uri) => {
      void refresh();
      void refreshDiagnosticsForFile(uri, diagnostics);
    }),
    watcher.onDidCreate(() => refresh()),
    watcher.onDidDelete(() => refresh())
  );

  // Diagnostics also fire on file save (if coherenceOnSave is enabled)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const enabled = vscode.workspace
        .getConfiguration("devspec")
        .get<boolean>("coherenceOnSave", true);
      if (!enabled) return;
      const root = await findWorkspaceRoot();
      if (!root) return;
      diagnostics.scheduleFromFile(root, doc.uri);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => refresh())
  );

  await refresh();
}

async function refreshDiagnosticsForFile(
  uri: vscode.Uri,
  diagnostics: CoherenceDiagnostics
): Promise<void> {
  const root = await findWorkspaceRoot();
  if (!root) return;
  diagnostics.scheduleFromFile(root, uri);
}

/**
 * If the active editor is a DevSpec lifecycle stage doc (discovery/proposal/
 * design/contract/alignment/tasks .md), return the stage name. Else null.
 */
function inferStageFromActiveEditor(): string | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const m = /[\\/]\.devspec[\\/]projects[\\/][^\\/]+[\\/](discovery|proposal|design|contract|alignment|tasks)\.md$/.exec(
    editor.document.uri.fsPath
  );
  return m?.[1] ?? null;
}

/** Extract a slug from a context-menu argument (TreeItem-shaped) or pass through. */
function slugFrom(arg: unknown): string | undefined {
  if (arg && typeof arg === "object" && "change" in arg) {
    const ch = (arg as { change?: { slug?: string } }).change;
    if (ch?.slug) return ch.slug;
  }
  return undefined;
}

export function deactivate(): void {
  // intentional: subscriptions cleaned up by VS Code via context.subscriptions
}
