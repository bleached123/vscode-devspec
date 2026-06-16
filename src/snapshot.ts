import { runDevspec, isCliAvailable } from "./cli.js";
import type { WorkspaceSnapshot, ChangeSummary, CapabilitySummary } from "./workspace.js";

/**
 * Build a complete view of the workspace by calling out to the CLI. The CLI
 * is the single source of truth — this extension is a thin presentation layer.
 *
 * The fallback fields are populated when the CLI is missing or errors out, so
 * the sidebar can still render *something* instead of going blank.
 */
export async function buildSnapshot(root: string): Promise<WorkspaceSnapshot> {
  const cli = await isCliAvailable(root);
  const snapshot: WorkspaceSnapshot = {
    root,
    phase: "unknown",
    declaredPhase: false,
    backend: "?",
    architecture: "?",
    methodology: "?",
    changes: [],
    capabilities: [],
    cliAvailable: cli.ok,
  };
  if (!cli.ok) {
    snapshot.cliError = cli.error;
    return snapshot;
  }
  snapshot.cliVersion = cli.version;

  // Status (JSON output) gives us phase + per-change stages + drift counts
  const statusRes = await runDevspec(["status", "--json"], root);
  if (statusRes.exitCode === 0 && statusRes.stdout.trim()) {
    try {
      const parsed = JSON.parse(statusRes.stdout) as RawStatus;
      snapshot.phase = parsed.phase?.effective ?? snapshot.phase;
      snapshot.declaredPhase = Boolean(parsed.phase?.declared);
      snapshot.backend = parsed.config?.backend ?? snapshot.backend;
      snapshot.architecture = parsed.config?.architecture ?? snapshot.architecture;
      snapshot.methodology = parsed.config?.methodology ?? snapshot.methodology;
      snapshot.changes = (parsed.changes ?? []).map(mapChange);
    } catch (err) {
      snapshot.cliError = `status --json parse error: ${(err as Error).message}`;
    }
  } else if (statusRes.stderr) {
    snapshot.cliError = statusRes.stderr.trim();
  }

  // Capability data (added in the delta-specs slices of DevSpec). Tolerant of
  // older CLI versions that don't ship the `specs` subcommand.
  const specsListRes = await runDevspec(["specs", "list", "--json"], root);
  if (specsListRes.exitCode === 0 && specsListRes.stdout.trim()) {
    try {
      const parsed = JSON.parse(specsListRes.stdout) as RawCapability[];
      snapshot.capabilities = parsed.map(mapCapability);
    } catch {
      /* leave as [] */
    }
  }

  // Per-change pending deltas. Run only against active changes to keep snapshot
  // build time bounded. Failures fall through to empty arrays.
  for (const change of snapshot.changes) {
    if (change.archived) continue;
    const statusJsonRes = await runDevspec(
      ["specs", "status", change.slug, "--json"],
      root
    );
    if (statusJsonRes.exitCode !== 0 || !statusJsonRes.stdout.trim()) continue;
    try {
      const parsed = JSON.parse(statusJsonRes.stdout) as Array<{
        slug?: string;
        pending?: string[];
      }>;
      const entry = parsed.find((e) => e.slug === change.slug) ?? parsed[0];
      if (entry?.pending) change.pendingDeltas = entry.pending;
    } catch {
      /* leave as [] */
    }
  }

  // Per-change next-task. `devspec next <slug> --json` returns:
  //   { slug, task: { text, line, checked, section } | null, done, totalTasks }
  for (const change of snapshot.changes) {
    if (change.archived) continue;
    const nextRes = await runDevspec(["next", change.slug, "--json"], root);
    if (nextRes.exitCode !== 0 || !nextRes.stdout.trim()) continue;
    try {
      const parsed = JSON.parse(nextRes.stdout) as {
        task?: { text?: string; line?: number } | null;
        done?: boolean;
      };
      if (
        parsed.task &&
        typeof parsed.task.text === "string" &&
        typeof parsed.task.line === "number"
      ) {
        change.nextTask = { text: parsed.task.text, line: parsed.task.line };
      }
    } catch {
      /* leave as null */
    }
  }

  return snapshot;
}

interface RawStatus {
  phase?: { effective?: string; declared?: string | null };
  config?: { backend?: string; architecture?: string; methodology?: string };
  changes?: RawChange[];
}

interface RawChange {
  slug?: string;
  title?: string;
  doneStages?: number;
  totalStages?: number;
  inProgressStage?: string | null;
  blockingCount?: number;
  warningCount?: number;
  archived?: boolean;
}

function mapChange(c: RawChange): ChangeSummary {
  return {
    slug: c.slug ?? "?",
    title: c.title ?? c.slug ?? "?",
    doneStages: c.doneStages ?? 0,
    totalStages: c.totalStages ?? 6,
    inProgressStage: c.inProgressStage ?? null,
    blockingCount: c.blockingCount ?? 0,
    warningCount: c.warningCount ?? 0,
    archived: c.archived === true,
    pendingDeltas: [],
    nextTask: null,
  };
}

interface RawCapability {
  capability?: string;
  status?: "clean" | "dirty";
  changes?: string[];
}

function mapCapability(c: RawCapability): CapabilitySummary {
  return {
    name: c.capability ?? "?",
    status: c.status === "dirty" ? "dirty" : "clean",
    dirtyIn: c.changes ?? [],
  };
}
