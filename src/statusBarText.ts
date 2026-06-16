import type { WorkspaceSnapshot } from "./workspace.js";

/**
 * Pure composition of the status-bar item from a snapshot. Kept vscode-free so
 * the text/severity logic is unit-testable; StatusBar maps `severity` onto a
 * ThemeColor and renders `tooltip` as a MarkdownString.
 */

export type StatusSeverity = "none" | "warning" | "error";

export interface StatusBarModel {
  text: string;
  severity: StatusSeverity;
  /** Markdown source for the tooltip. */
  tooltip: string;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

/** No workspace open. */
export function noWorkspaceModel(): StatusBarModel {
  return {
    text: "$(circle-slash) DevSpec: no workspace",
    severity: "none",
    tooltip:
      "No folder containing `.devspec/devspec.yaml` is open.\n\nOpen one, or run `DevSpec: Initialize workspace…` from the command palette.",
  };
}

/** CLI not found / not runnable. */
export function cliMissingModel(): StatusBarModel {
  return {
    text: "$(warning) DevSpec: CLI missing",
    severity: "warning",
    tooltip: "Install the devspec CLI or set devspec.cliPath in settings.",
  };
}

/** The normal case: phase + active count + drift + pending deltas + next task. */
export function composeStatusBar(snapshot: WorkspaceSnapshot): StatusBarModel {
  const active = snapshot.changes.filter((c) => !c.archived);
  const blocking = active.reduce((sum, c) => sum + c.blockingCount, 0);
  const warning = active.reduce((sum, c) => sum + c.warningCount, 0);
  const totalDeltas = active.reduce((sum, c) => sum + c.pendingDeltas.length, 0);

  // Next task: only surface when exactly one active change has a pending task
  // (avoids ambiguity when multiple changes have work).
  const withNextTask = active.filter((c) => c.nextTask !== null);
  const soleNext =
    withNextTask.length === 1 && withNextTask[0]?.nextTask ? withNextTask[0] : null;
  const nextTaskSegment =
    soleNext && soleNext.nextTask
      ? `  $(checklist) ${truncate(soleNext.nextTask.text, 30)}`
      : "";

  const deltaSegment = totalDeltas > 0 ? `  Δ${totalDeltas}` : "";

  const severity: StatusSeverity = blocking > 0 ? "error" : warning > 0 ? "warning" : "none";
  const icon = blocking > 0 ? "$(error)" : warning > 0 ? "$(warning)" : "$(check)";
  const text = `${icon} DevSpec: ${snapshot.phase} · ${active.length} active${deltaSegment}${nextTaskSegment}`;

  const deltaLines =
    totalDeltas > 0
      ? `\n\n**Pending deltas**:\n` +
        active
          .filter((c) => c.pendingDeltas.length > 0)
          .map((c) => `- ${c.pendingDeltas.join(", ")} (in \`${c.slug}\`)`)
          .join("\n")
      : "";

  const nextLines =
    soleNext && soleNext.nextTask
      ? `\n\n**Next task**: ${soleNext.nextTask.text}  \n` +
        `_(in \`${soleNext.slug}\`, line ${soleNext.nextTask.line})_`
      : withNextTask.length > 1
        ? `\n\n**Next tasks**: ${withNextTask.length} active changes have pending tasks`
        : "";

  const tooltip =
    `**Phase**: \`${snapshot.phase}\`${snapshot.declaredPhase ? " (declared)" : " (auto-detected)"}\n\n` +
    `**Stack**: ${snapshot.backend} · ${snapshot.architecture} · ${snapshot.methodology}\n\n` +
    `**Active changes**: ${active.length}\n\n` +
    `**Drift**: ${blocking} blocking · ${warning} warning` +
    deltaLines +
    nextLines +
    `\n\n_Click to open the workspace map._`;

  return { text, severity, tooltip };
}
