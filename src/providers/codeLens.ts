import * as path from "node:path";
import * as vscode from "vscode";
import {
  isWithinDevspecChange,
  isClaudeCommandFile,
  isDeltaSpecFile,
  isCapabilitySpecFile,
  extractSlugFromDeltaPath,
  extractCapabilityFromSpecPath,
  extractSlugFromChangeFilePath,
  scanContract,
  scanTasks,
  countRequirements,
} from "./codeLensCore.js";

/**
 * CodeLens above:
 *   - The `\`\`\`yaml tests` fence in contract.md — summarises test count
 *   - Each top-level API method declaration in contract.md's TS fence
 *     (heuristic: a line starting with `<word>(...)` inside a ts fence)
 *   - Each unchecked task line in tasks.md — "Open" + "Mark complete"
 *
 * This is presentational only: the underlying truth is the markdown file
 * itself. CodeLens commands shell out to the CLI when state changes.
 */
export class DevspecCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const enabled = vscode.workspace
      .getConfiguration("devspec")
      .get<boolean>("codeLens.enabled", true);
    if (!enabled) return [];
    if (
      !isWithinDevspecChange(document.uri.fsPath) &&
      !isClaudeCommandFile(document.uri.fsPath) &&
      !isDeltaSpecFile(document.uri.fsPath) &&
      !isCapabilitySpecFile(document.uri.fsPath)
    )
      return [];

    const filename = path.basename(document.uri.fsPath);
    if (isClaudeCommandFile(document.uri.fsPath)) return this.slashCommandLenses(document);
    if (isDeltaSpecFile(document.uri.fsPath)) return this.deltaSpecLenses(document);
    if (isCapabilitySpecFile(document.uri.fsPath)) return this.capabilitySpecLenses(document);
    if (filename === "contract.md") return this.contractLenses(document);
    if (filename === "tasks.md") return this.tasksLenses(document);
    return [];
  }

  /** CodeLens for delta files at `.devspec/projects/<slug>/deltas/<cap>/spec.md`. */
  private deltaSpecLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const slug = extractSlugFromDeltaPath(document.uri.fsPath);
    if (!slug) return [];
    const range = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(range, {
        title: `▸ Preview merge — copy /devspec:sync ${slug} --dry-run`,
        command: "devspec.copySlashCommand",
        arguments: [`/devspec:sync ${slug} --dry-run`],
      }),
      new vscode.CodeLens(range, {
        title: `✓ Sync this delta — copy /devspec:sync ${slug}`,
        command: "devspec.copySlashCommand",
        arguments: [`/devspec:sync ${slug}`],
      }),
    ];
  }

  /** CodeLens for capability spec files at `.devspec/specs/<cap>/spec.md`. */
  private capabilitySpecLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const capability = extractCapabilityFromSpecPath(document.uri.fsPath);
    if (!capability) return [];
    const reqCount = countRequirements(document.getText());
    const range = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(range, {
        title: `▸ ${reqCount} current requirement(s)`,
        command: "",
      }),
      new vscode.CodeLens(range, {
        title: `🔗 Show contributing changes`,
        command: "devspec.showContributingChanges",
        arguments: [capability],
      }),
    ];
  }

  /** CodeLens for `.claude/commands/<name>.md` — copy `/<name>` to clipboard. */
  private slashCommandLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const base = path.basename(document.uri.fsPath, ".md");
    return [
      new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: `📋 Copy /${base} to clipboard`,
        command: "devspec.copySlashCommand",
        arguments: [`/${base}`],
      }),
    ];
  }

  private contractLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const { testFences, apiMethods } = scanContract(document.getText());
    const lenses: vscode.CodeLens[] = [];

    for (const fence of testFences) {
      lenses.push(
        new vscode.CodeLens(new vscode.Range(fence.line, 0, fence.line, 0), {
          title: `▸ ${fence.count} contract test(s) — run \`devspec coherence\` to see implementation status`,
          command: "devspec.coherence",
        })
      );
    }
    for (const method of apiMethods) {
      lenses.push(
        new vscode.CodeLens(new vscode.Range(method.line, 0, method.line, 0), {
          title: `↪ API method \`${method.name}\` — \`devspec sync-contract\` checks source mapping`,
          command: "",
        })
      );
    }
    return lenses;
  }

  private tasksLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const { checked, unchecked, pending } = scanTasks(document.getText());
    const slug = extractSlugFromChangeFilePath(document.uri.fsPath);
    const lenses: vscode.CodeLens[] = [];

    for (const task of pending) {
      if (slug && task.text) {
        lenses.push(
          new vscode.CodeLens(new vscode.Range(task.line, 0, task.line, 0), {
            title: `○ Mark complete`,
            command: "devspec.completeTaskAtLine",
            arguments: [slug, task.line + 1, task.text],
          })
        );
      } else {
        // Fallback if slug couldn't be extracted (shouldn't happen given the
        // file selector, but keeps the lens informative).
        lenses.push(
          new vscode.CodeLens(new vscode.Range(task.line, 0, task.line, 0), {
            title: `○ pending`,
            command: "",
          })
        );
      }
    }
    if (lenses.length > 0 || checked > 0) {
      // Header lens at the top of the file
      lenses.unshift(
        new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
          title: `${checked}/${checked + unchecked} tasks complete`,
          command: "",
        })
      );
    }
    return lenses;
  }
}
