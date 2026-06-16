import * as path from "node:path";
import * as vscode from "vscode";
import { runDevspec } from "../cli.js";

interface CoherenceReport {
  slug: string;
  drifts: Drift[];
  blockingCount: number;
  warningCount: number;
  ignoredRules: string[];
}

interface Drift {
  rule: string;
  severity: "block" | "warn";
  message: string;
  hint?: string;
}

/**
 * Manages coherence diagnostics for the workspace. Each active change's
 * drifts surface under its `contract.md` (closest single anchor file we have
 * — coherence rules don't currently emit file/line). The user clicks into the
 * Problems panel entry and lands on the contract, from which they can drill
 * via the sidebar tree.
 */
export class CoherenceDiagnostics implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly debounceMs = 600;
  private pendingByChange = new Map<string, NodeJS.Timeout>();

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection("devspec.coherence");
  }

  dispose(): void {
    for (const t of this.pendingByChange.values()) clearTimeout(t);
    this.collection.dispose();
  }

  /** Force a fresh run for a single change. */
  async refresh(root: string, slug: string): Promise<void> {
    const r = await runDevspec(["coherence", slug, "--json"], root);
    if (!r.stdout.trim()) {
      // Coherence command writes to stdout for both success and drift; an empty
      // stdout means execution failed before any output. Clear stale entries.
      this.clearForChange(root, slug);
      return;
    }
    let report: CoherenceReport;
    try {
      report = JSON.parse(r.stdout) as CoherenceReport;
    } catch {
      this.clearForChange(root, slug);
      return;
    }
    this.applyReport(root, report);
  }

  /** Refresh all active changes. Used on activation + workspace events. */
  async refreshAll(root: string, slugs: string[]): Promise<void> {
    await Promise.all(slugs.map((s) => this.refresh(root, s)));
  }

  /** Debounced: queue a refresh for the change owning `fileUri`, if any. */
  scheduleFromFile(root: string, fileUri: vscode.Uri): void {
    const slug = slugFromFile(root, fileUri.fsPath);
    if (!slug) return;
    const prev = this.pendingByChange.get(slug);
    if (prev) clearTimeout(prev);
    this.pendingByChange.set(
      slug,
      setTimeout(() => {
        this.pendingByChange.delete(slug);
        void this.refresh(root, slug);
      }, this.debounceMs)
    );
  }

  private applyReport(root: string, report: CoherenceReport): void {
    const anchor = vscode.Uri.file(
      path.join(root, ".devspec", "projects", report.slug, "contract.md")
    );
    const diagnostics: vscode.Diagnostic[] = report.drifts.map((d) => {
      const range = new vscode.Range(0, 0, 0, 0); // top-of-file anchor
      const message = d.hint ? `${d.message}\n${d.hint}` : d.message;
      const diag = new vscode.Diagnostic(
        range,
        message,
        d.severity === "block"
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning
      );
      diag.code = d.rule;
      diag.source = "devspec";
      return diag;
    });
    this.collection.set(anchor, diagnostics);
  }

  private clearForChange(root: string, slug: string): void {
    this.collection.set(
      vscode.Uri.file(path.join(root, ".devspec", "projects", slug, "contract.md")),
      []
    );
  }
}

function slugFromFile(root: string, filePath: string): string | null {
  const projectsRoot = path.join(root, ".devspec", "projects");
  if (!filePath.startsWith(projectsRoot)) return null;
  const rel = path.relative(projectsRoot, filePath);
  const slug = rel.split(path.sep)[0];
  return slug ?? null;
}
