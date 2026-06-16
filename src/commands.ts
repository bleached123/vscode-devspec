import * as path from "node:path";
import * as vscode from "vscode";
import { runDevspec } from "./cli.js";
import { findWorkspaceRoot } from "./workspace.js";
import type { WorkspaceSnapshot } from "./workspace.js";

/**
 * Prompt for a title, run `devspec plan "<title>"` in the workspace root.
 */
export async function planChangeCommand(refresh: () => Promise<void>): Promise<void> {
  const root = await findWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("No DevSpec workspace open.");
    return;
  }
  const title = await vscode.window.showInputBox({
    title: "DevSpec: Plan change",
    prompt: "What's the change about? (used to generate the slug + lifecycle docs)",
    placeHolder: "e.g. Add booking cancellation",
    validateInput: (v) => (v.trim().length === 0 ? "title is required" : undefined),
  });
  if (!title) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `DevSpec: planning "${title}"…`,
      cancellable: false,
    },
    async () => {
      const r = await runDevspec(["plan", title], root);
      if (r.exitCode !== 0) {
        vscode.window.showErrorMessage(`devspec plan failed: ${r.stderr.trim() || r.stdout.trim()}`);
        return;
      }
      vscode.window.showInformationMessage(`Planned: ${title}`);
    }
  );
  await refresh();
}

/**
 * Run `devspec coherence <slug>` either against a slug argument or against
 * the change inferred from the active editor.
 */
export async function coherenceCommand(slug?: string): Promise<void> {
  const root = await findWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("No DevSpec workspace open.");
    return;
  }
  const target = slug ?? (await inferActiveChange(root));
  if (!target) {
    vscode.window.showWarningMessage(
      "No change inferred from the active editor — right-click a change in the sidebar or open a file under .devspec/projects/<slug>/."
    );
    return;
  }
  const output = ensureOutputChannel();
  output.clear();
  output.appendLine(`$ devspec coherence ${target}`);
  output.show(true);
  const r = await runDevspec(["coherence", target], root);
  if (r.stdout) output.append(r.stdout);
  if (r.stderr) output.append(r.stderr);
  output.appendLine(`\n[exit ${r.exitCode}]`);
}

export async function openMapCommand(): Promise<void> {
  const root = await findWorkspaceRoot();
  if (!root) return;
  const indexPath = path.join(root, ".devspec", "maps", "index.md");
  const uri = vscode.Uri.file(indexPath);
  // Regenerate first so the user sees fresh content
  const r = await runDevspec(["map"], root, { timeoutMs: 10_000 });
  if (r.exitCode !== 0) {
    vscode.window.showWarningMessage(
      `devspec map failed; opening last-generated map. (${r.stderr.trim() || "no details"})`
    );
  }
  await vscode.commands.executeCommand("markdown.showPreview", uri);
}

export async function initCommand(): Promise<void> {
  // We don't run init for the user — interactive choice space is too big.
  // Open a terminal pre-filled with the command instead.
  const terminal = vscode.window.createTerminal("devspec init");
  terminal.show();
  terminal.sendText(
    "devspec init --backend <rust|node-typescript|dotnet|python|go> --architecture <clean-architecture|layered|vertical-slice> --methodology <ddd|tdd|bdd|lightweight> --pipeline github",
    false
  );
}

export async function openChangeCommand(slug: string): Promise<void> {
  const root = await findWorkspaceRoot();
  if (!root) return;
  // Open the contract.md if it has substantive content, else the first
  // non-empty doc in lifecycle order. Falls back to status.yaml.
  const order = ["contract.md", "design.md", "proposal.md", "discovery.md", "alignment.md", "tasks.md"];
  for (const name of order) {
    const p = path.join(root, ".devspec", "projects", slug, name);
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(p));
      if (stat.size > 0) {
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(p));
        return;
      }
    } catch {
      // doesn't exist; try next
    }
  }
  // Fall through — open the change folder
  await vscode.commands.executeCommand(
    "revealInExplorer",
    vscode.Uri.file(path.join(root, ".devspec", "projects", slug))
  );
}

let outputChannel: vscode.OutputChannel | null = null;
function ensureOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("DevSpec");
  }
  return outputChannel;
}

async function inferActiveChange(root: string): Promise<string | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const filePath = editor.document.uri.fsPath;
  const projectsRoot = path.join(root, ".devspec", "projects");
  if (!filePath.startsWith(projectsRoot)) return null;
  const rel = path.relative(projectsRoot, filePath);
  const slug = rel.split(path.sep)[0];
  return slug ?? null;
}

// ─── Claude / agent integration ────────────────────────────────────────────

/**
 * Copy a slash-command invocation to the clipboard, then try to focus the
 * Claude Code panel if the user has it installed. Falls back to a notification
 * with a "Show me where to paste" affordance.
 */
export async function copySlashCommandCommand(template: string, slug?: string): Promise<void> {
  const root = await findWorkspaceRoot();
  let resolved = template;
  if (resolved.includes("<slug>")) {
    const target = slug ?? (await inferActiveChange(root ?? "")) ?? (await pickActiveChange());
    if (!target) {
      vscode.window.showWarningMessage(
        "Cannot resolve a change — open a file under `.devspec/projects/<slug>/` or use the right-click menu on the Changes tree."
      );
      return;
    }
    resolved = resolved.replace("<slug>", target);
  }
  await vscode.env.clipboard.writeText(resolved);

  // Try to open Claude Code's chat / command surface. We probe a few known
  // command IDs in order — silently fall through if none exist. The
  // clipboard-write above is the contract; this is best-effort polish.
  const focused = await focusClaudeCode();

  const tail = focused
    ? "Claude Code panel focused — paste with Ctrl/Cmd+V and hit Enter."
    : "Paste it into Claude Code's chat panel.";
  vscode.window.showInformationMessage(`Copied \`${resolved}\` to clipboard. ${tail}`);
}

async function focusClaudeCode(): Promise<boolean> {
  // The extension ID has changed historically; probe a couple. If installed
  // but inactive, getExtension(...).activate() ensures it can receive commands.
  const candidates = ["anthropic.claude-code", "Anthropic.claude-code"];
  for (const id of candidates) {
    const ext = vscode.extensions.getExtension(id);
    if (!ext) continue;
    try {
      if (!ext.isActive) await ext.activate();
    } catch {
      // ignore
    }
  }

  // Try a list of known commands Claude Code may expose. The first one that
  // succeeds wins. None of these are public API — they're best-effort probes.
  const tryCommands = [
    "claude-code.openChat",
    "claude-code.focus",
    "claude-code.open",
    "workbench.view.extension.claude-code",
    "anthropic.claude-code.openChat",
  ];
  for (const cmd of tryCommands) {
    try {
      await vscode.commands.executeCommand(cmd);
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

async function pickActiveChange(): Promise<string | null> {
  const root = await findWorkspaceRoot();
  if (!root) return null;
  // Read the project folder names — cheap, no CLI shell-out needed.
  const projectsDir = path.join(root, ".devspec", "projects");
  let entries: string[];
  try {
    const dirents = await vscode.workspace.fs.readDirectory(vscode.Uri.file(projectsDir));
    entries = dirents.filter(([, kind]) => kind === vscode.FileType.Directory).map(([n]) => n).sort();
  } catch {
    return null;
  }
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0] ?? null;
  const pick = await vscode.window.showQuickPick(entries, {
    title: "DevSpec: which change?",
    placeHolder: "select the change this slash command will target",
  });
  return pick ?? null;
}

/**
 * Show the first pending task for the inferred or selected change in a
 * notification with two action buttons: "Open tasks.md" and "Mark complete".
 */
export async function nextCommand(slug?: string): Promise<void> {
  const root = await findWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("No DevSpec workspace open.");
    return;
  }
  const target = slug ?? (await inferActiveChange(root)) ?? (await pickActiveChange());
  if (!target) {
    vscode.window.showWarningMessage(
      "No change inferred — open a file under `.devspec/projects/<slug>/` or pick from the sidebar."
    );
    return;
  }
  const r = await runDevspec(["next", target, "--json"], root);
  if (r.exitCode !== 0 || !r.stdout.trim()) {
    vscode.window.showWarningMessage(
      `devspec next failed: ${r.stderr.trim() || r.stdout.trim() || "no details"}`
    );
    return;
  }
  let parsed: { task?: { text?: string; line?: number } | null; done?: boolean };
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    vscode.window.showWarningMessage("devspec next: could not parse JSON output");
    return;
  }
  const task = parsed.task;
  if (!task || typeof task.text !== "string" || typeof task.line !== "number") {
    vscode.window.showInformationMessage(
      `No pending tasks in ${target}. Advance the stage or move on.`
    );
    return;
  }
  const tasksUri = vscode.Uri.file(
    path.join(root, ".devspec", "projects", target, "tasks.md")
  );
  const choice = await vscode.window.showInformationMessage(
    `Next task in ${target}: "${task.text}"`,
    "Open tasks.md",
    "Mark complete"
  );
  if (choice === "Open tasks.md") {
    const doc = await vscode.workspace.openTextDocument(tasksUri);
    const editor = await vscode.window.showTextDocument(doc);
    const lineIdx = Math.max(0, task.line - 1);
    editor.selection = new vscode.Selection(lineIdx, 0, lineIdx, 0);
    editor.revealRange(new vscode.Range(lineIdx, 0, lineIdx, 0));
  } else if (choice === "Mark complete") {
    await completeTaskAtLineCommand(target, task.line, task.text);
  }
}

/**
 * Append a decision to a change's alignment.md via `devspec log`. Prompts for
 * the decision text and an optional reason; both run through input boxes.
 */
export async function logDecisionCommand(slug?: string): Promise<void> {
  const root = await findWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("No DevSpec workspace open.");
    return;
  }
  const target = slug ?? (await inferActiveChange(root)) ?? (await pickActiveChange());
  if (!target) {
    vscode.window.showWarningMessage(
      "No change inferred — open a file under `.devspec/projects/<slug>/` or pick from the sidebar."
    );
    return;
  }
  const decision = await vscode.window.showInputBox({
    title: `DevSpec: Log decision in ${target}`,
    prompt: "One-line decision to append to alignment.md",
    validateInput: (v) => (v.trim().length === 0 ? "decision is required" : undefined),
  });
  if (!decision) return;
  const reason = await vscode.window.showInputBox({
    title: `DevSpec: Reason (optional)`,
    prompt: "Why was this decision taken? (leave blank to skip)",
  });
  const args = ["log", target, decision.trim()];
  if (reason && reason.trim()) {
    args.push("--because", reason.trim());
  }
  const r = await runDevspec(args, root);
  if (r.exitCode !== 0) {
    vscode.window.showErrorMessage(
      `devspec log failed: ${r.stderr.trim() || r.stdout.trim() || "no details"}`
    );
    return;
  }
  vscode.window.showInformationMessage(`Logged decision in ${target}`);
}

/**
 * Internal: mark a task complete at a specific line. Invoked by the
 * tasks.md CodeLens click handler. Runs `devspec complete <slug> <text> --line <N>`.
 */
export async function completeTaskAtLineCommand(
  slug: string,
  line: number,
  text: string
): Promise<void> {
  const root = await findWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("No DevSpec workspace open.");
    return;
  }
  const r = await runDevspec(
    ["complete", slug, text, "--line", String(line)],
    root
  );
  if (r.exitCode !== 0) {
    vscode.window.showErrorMessage(
      `devspec complete failed: ${r.stderr.trim() || r.stdout.trim() || "no details"}`
    );
  }
  // Silent on success — the file watcher refreshes the tasks.md CodeLens.
}

/**
 * Initialise a new capability via `devspec specs init <name>`. Prompts the user
 * for the name; validates kebab-case before shelling out. Triggers a snapshot
 * refresh on success so the new capability appears in the Capabilities view.
 */
export async function initCapabilityCommand(refresh: () => Promise<void>): Promise<void> {
  const root = await findWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("No DevSpec workspace open.");
    return;
  }
  const name = await vscode.window.showInputBox({
    title: "DevSpec: Initialise capability",
    prompt: "Capability name (lowercase kebab-case, e.g. user-auth)",
    validateInput: (v) =>
      /^[a-z][a-z0-9-]*$/.test(v) ? undefined : "Use lowercase kebab-case (a–z, 0–9, hyphen).",
  });
  if (!name) return;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `DevSpec: initialising capability "${name}"…`,
      cancellable: false,
    },
    async () => {
      const r = await runDevspec(["specs", "init", name], root);
      if (r.exitCode !== 0) {
        vscode.window.showErrorMessage(
          `devspec specs init failed: ${r.stderr.trim() || r.stdout.trim()}`
        );
        return;
      }
      vscode.window.showInformationMessage(`Created capability "${name}"`);
    }
  );
  await refresh();
}

/**
 * From a capability spec file's CodeLens, present a quick-pick of active
 * changes that have a pending delta against the capability, and open the
 * selected change's delta file.
 */
export async function showContributingChangesCommand(
  capability: string,
  snapshotProvider: () => WorkspaceSnapshot | null
): Promise<void> {
  const snapshot = snapshotProvider();
  if (!snapshot) {
    vscode.window.showWarningMessage("No DevSpec workspace snapshot available.");
    return;
  }
  const contributors = snapshot.changes.filter(
    (c) => !c.archived && c.pendingDeltas.includes(capability)
  );
  if (contributors.length === 0) {
    vscode.window.showInformationMessage(
      `No active changes have pending deltas against "${capability}".`
    );
    return;
  }
  const pick = await vscode.window.showQuickPick(
    contributors.map((c) => ({
      label: c.slug,
      description: `${c.doneStages}/${c.totalStages} stages`,
      slug: c.slug,
    })),
    {
      title: `Active changes with pending deltas against "${capability}"`,
      placeHolder: "select a change to open its delta file",
    }
  );
  if (!pick) return;
  const deltaPath = path.join(
    snapshot.root,
    ".devspec",
    "projects",
    pick.slug,
    "deltas",
    capability,
    "spec.md"
  );
  await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(deltaPath));
}

/**
 * Regenerate CLAUDE.md by shelling out to `devspec claude`.
 */
export async function regenerateClaudeMdCommand(refresh: () => Promise<void>): Promise<void> {
  const root = await findWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("No DevSpec workspace open.");
    return;
  }
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DevSpec: regenerating CLAUDE.md…",
      cancellable: false,
    },
    async () => {
      const r = await runDevspec(["claude"], root);
      if (r.exitCode !== 0) {
        vscode.window.showErrorMessage(
          `devspec claude failed: ${r.stderr.trim() || r.stdout.trim() || "no details"}`
        );
        return;
      }
      vscode.window.showInformationMessage("CLAUDE.md regenerated.");
    }
  );
  await refresh();
}
