import { describe, it, expect } from "vitest";
import {
  composeStatusBar,
  noWorkspaceModel,
  cliMissingModel,
  truncate,
} from "./statusBarText.js";
import type { ChangeSummary, WorkspaceSnapshot } from "./workspace.js";

function change(over: Partial<ChangeSummary> = {}): ChangeSummary {
  return {
    slug: "c",
    title: "C",
    doneStages: 0,
    totalStages: 6,
    inProgressStage: null,
    blockingCount: 0,
    warningCount: 0,
    archived: false,
    pendingDeltas: [],
    nextTask: null,
    ...over,
  };
}

function snapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    root: "/repo",
    phase: "build",
    declaredPhase: false,
    backend: "go",
    architecture: "clean-architecture",
    methodology: "tdd",
    changes: [],
    capabilities: [],
    cliAvailable: true,
    ...over,
  };
}

describe("truncate", () => {
  it("leaves short strings untouched", () => {
    expect(truncate("short", 10)).toBe("short");
  });
  it("ellipsises long strings to max length", () => {
    const out = truncate("a very long task description indeed", 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("composeStatusBar", () => {
  it("shows a check icon and active count with no drift", () => {
    const m = composeStatusBar(snapshot({ changes: [change(), change()] }));
    expect(m.severity).toBe("none");
    expect(m.text).toBe("$(check) DevSpec: build · 2 active");
  });

  it("excludes archived changes from the active count", () => {
    const m = composeStatusBar(
      snapshot({ changes: [change(), change({ archived: true })] })
    );
    expect(m.text).toContain("· 1 active");
  });

  it("uses an error icon + severity when any change has blocking drift", () => {
    const m = composeStatusBar(snapshot({ changes: [change({ blockingCount: 2 })] }));
    expect(m.severity).toBe("error");
    expect(m.text.startsWith("$(error)")).toBe(true);
  });

  it("uses a warning icon + severity for warnings without blocks", () => {
    const m = composeStatusBar(snapshot({ changes: [change({ warningCount: 1 })] }));
    expect(m.severity).toBe("warning");
    expect(m.text.startsWith("$(warning)")).toBe(true);
  });

  it("adds a Δ segment summing pending deltas across active changes", () => {
    const m = composeStatusBar(
      snapshot({
        changes: [change({ pendingDeltas: ["a", "b"] }), change({ pendingDeltas: ["c"] })],
      })
    );
    expect(m.text).toContain("Δ3");
    expect(m.tooltip).toContain("**Pending deltas**");
  });

  it("surfaces the next task only when exactly one active change has one", () => {
    const one = composeStatusBar(
      snapshot({ changes: [change({ nextTask: { text: "do the thing", line: 9 } })] })
    );
    expect(one.text).toContain("do the thing");
    expect(one.tooltip).toContain("**Next task**");

    const many = composeStatusBar(
      snapshot({
        changes: [
          change({ slug: "a", nextTask: { text: "x", line: 1 } }),
          change({ slug: "b", nextTask: { text: "y", line: 2 } }),
        ],
      })
    );
    expect(many.text).not.toContain("$(checklist)");
    expect(many.tooltip).toContain("2 active changes have pending tasks");
  });

  it("truncates a long next-task label in the status text", () => {
    const long = "implement the entire booking subsystem end to end";
    const m = composeStatusBar(snapshot({ changes: [change({ nextTask: { text: long, line: 1 } })] }));
    expect(m.text).toContain("…");
    expect(m.text).not.toContain(long);
  });

  it("marks the phase as declared vs auto-detected in the tooltip", () => {
    expect(composeStatusBar(snapshot({ declaredPhase: true })).tooltip).toContain("(declared)");
    expect(composeStatusBar(snapshot({ declaredPhase: false })).tooltip).toContain("(auto-detected)");
  });
});

describe("fallback models", () => {
  it("no-workspace model has none severity", () => {
    const m = noWorkspaceModel();
    expect(m.severity).toBe("none");
    expect(m.text).toContain("no workspace");
  });
  it("cli-missing model has warning severity", () => {
    const m = cliMissingModel();
    expect(m.severity).toBe("warning");
    expect(m.text).toContain("CLI missing");
  });
});
