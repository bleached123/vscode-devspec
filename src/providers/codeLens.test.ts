import { describe, it, expect } from "vitest";
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

describe("codeLens path classification", () => {
  it("matches delta file paths (posix + windows)", () => {
    expect(isDeltaSpecFile("/work/.devspec/projects/add-bookings/deltas/user-auth/spec.md")).toBe(true);
    expect(isDeltaSpecFile("C:\\work\\.devspec\\projects\\add-bookings\\deltas\\user-auth\\spec.md")).toBe(true);
  });

  it("does NOT match capability spec paths under the delta predicate", () => {
    expect(isDeltaSpecFile("/work/.devspec/specs/user-auth/spec.md")).toBe(false);
  });

  it("matches capability spec paths (posix + windows)", () => {
    expect(isCapabilitySpecFile("/work/.devspec/specs/user-auth/spec.md")).toBe(true);
    expect(isCapabilitySpecFile("C:\\work\\.devspec\\specs\\user-auth\\spec.md")).toBe(true);
  });

  it("does NOT match delta paths under the capability predicate", () => {
    expect(isCapabilitySpecFile("/work/.devspec/projects/x/deltas/user-auth/spec.md")).toBe(false);
  });

  it("matches both flat and namespaced claude command paths", () => {
    expect(isClaudeCommandFile("/work/.claude/commands/devspec-iterate.md")).toBe(true);
    expect(isClaudeCommandFile("/work/.claude/commands/devspec/iterate.md")).toBe(true);
    expect(isClaudeCommandFile("C:\\work\\.claude\\commands\\devspec\\iterate.md")).toBe(true);
  });

  it("does not treat .claude/skills files as command files", () => {
    expect(isClaudeCommandFile("/work/.claude/skills/devspec-grill/SKILL.md")).toBe(false);
  });

  it("matches change docs but not delta specs as 'within a change'", () => {
    expect(isWithinDevspecChange("/work/.devspec/projects/add-bookings/tasks.md")).toBe(true);
    expect(isWithinDevspecChange("/work/.devspec/projects/add-bookings/contract.md")).toBe(true);
  });
});

describe("codeLens slug/capability extraction", () => {
  it("extracts the slug from a delta path", () => {
    expect(extractSlugFromDeltaPath("/w/.devspec/projects/add-bookings/deltas/auth/spec.md")).toBe("add-bookings");
    expect(extractSlugFromDeltaPath("/w/.devspec/projects/x/contract.md")).toBeNull();
  });

  it("extracts the capability from a spec path", () => {
    expect(extractCapabilityFromSpecPath("/w/.devspec/specs/user-auth/spec.md")).toBe("user-auth");
    expect(extractCapabilityFromSpecPath("/w/.devspec/specs/user-auth/notes.md")).toBeNull();
  });

  it("extracts the slug from a change doc path (not delta)", () => {
    expect(extractSlugFromChangeFilePath("/w/.devspec/projects/add-bookings/tasks.md")).toBe("add-bookings");
  });
});

describe("scanContract", () => {
  it("counts `- name:` entries inside a yaml tests fence", () => {
    const text = [
      "# Contract",
      "```yaml tests",
      "  - name: creates a booking",
      "  - name: rejects double-booking",
      "```",
    ].join("\n");
    const { testFences } = scanContract(text);
    expect(testFences).toEqual([{ line: 1, count: 2 }]);
  });

  it("surfaces API methods inside ts fences, skipping reserved keywords", () => {
    const text = [
      "```ts",
      "function createBooking(req) {}",
      "cancelBooking(id) {}",
      "if (x) {}", // reserved → ignored
      "return (y);", // reserved → ignored
      "```",
    ].join("\n");
    const { apiMethods } = scanContract(text);
    expect(apiMethods.map((m) => m.name)).toEqual(["createBooking", "cancelBooking"]);
  });

  it("does not pick up method-like lines outside a ts fence", () => {
    const text = ["doThing()", "```ts", "realMethod()", "```", "other()"].join("\n");
    const { apiMethods } = scanContract(text);
    expect(apiMethods.map((m) => m.name)).toEqual(["realMethod"]);
  });

  it("handles CRLF line endings", () => {
    const text = "```yaml tests\r\n  - name: a\r\n```\r\n";
    expect(scanContract(text).testFences).toEqual([{ line: 0, count: 1 }]);
  });
});

describe("scanTasks", () => {
  it("counts checked/unchecked and lists pending tasks with 0-based lines", () => {
    const text = [
      "- [x] done one",
      "- [ ] pending one",
      "* [X] done two",
      "  - [ ] pending two",
      "not a task",
    ].join("\n");
    const scan = scanTasks(text);
    expect(scan.checked).toBe(2);
    expect(scan.unchecked).toBe(2);
    expect(scan.pending).toEqual([
      { line: 1, text: "pending one" },
      { line: 3, text: "pending two" },
    ]);
  });

  it("returns empty for a file with no tasks", () => {
    expect(scanTasks("# Tasks\n\njust prose")).toEqual({ checked: 0, unchecked: 0, pending: [] });
  });
});

describe("countRequirements", () => {
  it("counts `### Requirement:` headings", () => {
    const text = "### Requirement: A\nbody\n### Requirement: B\n## Not a requirement";
    expect(countRequirements(text)).toBe(2);
  });
});
