import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CliRunResult } from "./cli.js";

// Mock the CLI layer so buildSnapshot is exercised purely against canned JSON —
// this guards the parsing contract between the extension and `devspec`.
const isCliAvailable = vi.fn();
const runDevspec = vi.fn();
vi.mock("./cli.js", () => ({
  isCliAvailable: (...a: unknown[]) => isCliAvailable(...a),
  runDevspec: (...a: unknown[]) => runDevspec(...a),
}));

const { buildSnapshot } = await import("./snapshot.js");

function ok(stdout: string): CliRunResult {
  return { stdout, stderr: "", exitCode: 0 };
}
function fail(stderr = "boom", exitCode = 1): CliRunResult {
  return { stdout: "", stderr, exitCode };
}

/** Route runDevspec by the args array it was called with. */
function route(map: {
  status?: CliRunResult;
  specsList?: CliRunResult;
  specsStatus?: (slug: string) => CliRunResult;
  next?: (slug: string) => CliRunResult;
}) {
  runDevspec.mockImplementation((args: string[]) => {
    if (args[0] === "status") return Promise.resolve(map.status ?? fail());
    if (args[0] === "specs" && args[1] === "list") return Promise.resolve(map.specsList ?? ok("[]"));
    if (args[0] === "specs" && args[1] === "status")
      return Promise.resolve(map.specsStatus?.(args[2] ?? "") ?? fail());
    if (args[0] === "next") return Promise.resolve(map.next?.(args[1] ?? "") ?? fail());
    return Promise.resolve(fail("unexpected args: " + args.join(" ")));
  });
}

beforeEach(() => {
  isCliAvailable.mockReset();
  runDevspec.mockReset();
});

describe("buildSnapshot — CLI unavailable", () => {
  it("returns a safe fallback snapshot with the error", async () => {
    isCliAvailable.mockResolvedValue({ ok: false, error: "devspec not found on PATH" });
    const snap = await buildSnapshot("/repo");
    expect(snap.cliAvailable).toBe(false);
    expect(snap.cliError).toBe("devspec not found on PATH");
    expect(snap.phase).toBe("unknown");
    expect(snap.changes).toEqual([]);
    expect(snap.capabilities).toEqual([]);
    // Must not have attempted any further CLI calls.
    expect(runDevspec).not.toHaveBeenCalled();
  });
});

describe("buildSnapshot — happy path", () => {
  beforeEach(() => {
    isCliAvailable.mockResolvedValue({ ok: true, version: "0.1.0" });
  });

  it("parses phase, config, and changes from status --json", async () => {
    route({
      status: ok(
        JSON.stringify({
          phase: { effective: "build", declared: "build" },
          config: { backend: "go", architecture: "clean-architecture", methodology: "tdd" },
          changes: [
            {
              slug: "add-bookings",
              title: "Add bookings",
              doneStages: 2,
              totalStages: 6,
              inProgressStage: "design",
              blockingCount: 1,
              warningCount: 3,
              archived: false,
            },
          ],
        })
      ),
      specsList: ok("[]"),
      specsStatus: () => ok("[]"),
      next: () => ok(JSON.stringify({ task: null, done: false })),
    });

    const snap = await buildSnapshot("/repo");
    expect(snap.cliVersion).toBe("0.1.0");
    expect(snap.phase).toBe("build");
    expect(snap.declaredPhase).toBe(true);
    expect(snap.backend).toBe("go");
    expect(snap.architecture).toBe("clean-architecture");
    expect(snap.methodology).toBe("tdd");
    expect(snap.changes).toHaveLength(1);
    const c = snap.changes[0]!;
    expect(c.slug).toBe("add-bookings");
    expect(c.doneStages).toBe(2);
    expect(c.blockingCount).toBe(1);
    expect(c.warningCount).toBe(3);
  });

  it("applies defaults for missing change fields (mapChange)", async () => {
    route({
      status: ok(JSON.stringify({ changes: [{ slug: "bare" }] })),
    });
    const snap = await buildSnapshot("/repo");
    const c = snap.changes[0]!;
    expect(c.title).toBe("bare"); // falls back to slug
    expect(c.totalStages).toBe(6); // default
    expect(c.doneStages).toBe(0);
    expect(c.inProgressStage).toBeNull();
    expect(c.archived).toBe(false);
    expect(c.pendingDeltas).toEqual([]);
    expect(c.nextTask).toBeNull();
  });

  it("declaredPhase is false when no phase is declared", async () => {
    route({ status: ok(JSON.stringify({ phase: { effective: "discovery", declared: null } })) });
    const snap = await buildSnapshot("/repo");
    expect(snap.phase).toBe("discovery");
    expect(snap.declaredPhase).toBe(false);
  });

  it("parses capabilities and maps dirty status", async () => {
    route({
      status: ok(JSON.stringify({ changes: [] })),
      specsList: ok(
        JSON.stringify([
          { capability: "user-auth", status: "dirty", changes: ["add-bookings"] },
          { capability: "billing", status: "clean", changes: [] },
        ])
      ),
    });
    const snap = await buildSnapshot("/repo");
    expect(snap.capabilities).toEqual([
      { name: "user-auth", status: "dirty", dirtyIn: ["add-bookings"] },
      { name: "billing", status: "clean", dirtyIn: [] },
    ]);
  });

  it("merges pending deltas and next-task into the matching active change", async () => {
    route({
      status: ok(JSON.stringify({ changes: [{ slug: "add-bookings", title: "Add bookings" }] })),
      specsStatus: (slug) =>
        ok(JSON.stringify([{ slug, pending: ["user-auth", "billing"] }])),
      next: (slug) =>
        ok(JSON.stringify({ slug, task: { text: "write the handler", line: 12 }, done: false })),
    });
    const snap = await buildSnapshot("/repo");
    const c = snap.changes[0]!;
    expect(c.pendingDeltas).toEqual(["user-auth", "billing"]);
    expect(c.nextTask).toEqual({ text: "write the handler", line: 12 });
  });

  it("does not fetch deltas/next-task for archived changes", async () => {
    route({
      status: ok(JSON.stringify({ changes: [{ slug: "old", archived: true }] })),
    });
    await buildSnapshot("/repo");
    const calledWith = runDevspec.mock.calls.map((c) => (c[0] as string[]).join(" "));
    expect(calledWith).toContain("status --json");
    expect(calledWith.some((a) => a.startsWith("specs status"))).toBe(false);
    expect(calledWith.some((a) => a.startsWith("next"))).toBe(false);
  });
});

describe("buildSnapshot — tolerant of errors", () => {
  beforeEach(() => {
    isCliAvailable.mockResolvedValue({ ok: true, version: "0.1.0" });
  });

  it("records a parse error when status --json is malformed", async () => {
    route({ status: ok("not json{") });
    const snap = await buildSnapshot("/repo");
    expect(snap.cliError).toMatch(/status --json parse error/);
    expect(snap.changes).toEqual([]);
  });

  it("surfaces stderr when status exits non-zero", async () => {
    route({ status: fail("workspace not initialised") });
    const snap = await buildSnapshot("/repo");
    expect(snap.cliError).toBe("workspace not initialised");
  });

  it("tolerates a CLI without the specs subcommand (leaves capabilities empty)", async () => {
    route({
      status: ok(JSON.stringify({ changes: [] })),
      specsList: fail("unknown command: specs"),
    });
    const snap = await buildSnapshot("/repo");
    expect(snap.capabilities).toEqual([]);
  });

  it("leaves next-task null when the next payload is malformed", async () => {
    route({
      status: ok(JSON.stringify({ changes: [{ slug: "x" }] })),
      specsStatus: () => ok("[]"),
      next: () => ok("garbage"),
    });
    const snap = await buildSnapshot("/repo");
    expect(snap.changes[0]!.nextTask).toBeNull();
  });
});
