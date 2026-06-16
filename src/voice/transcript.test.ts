import { describe, it, expect } from "vitest";
import {
  parseLine,
  classifyLine,
  extractFilePath,
  lineMatchesWorkspace,
  normalizePath,
  type TranscriptLine,
} from "./transcript.js";

describe("parseLine", () => {
  it("parses a valid JSON line", () => {
    expect(parseLine('{"type":"assistant"}')).toEqual({ type: "assistant" });
  });
  it("returns null for blank or malformed lines", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("   ")).toBeNull();
    expect(parseLine("not json{")).toBeNull();
  });
});

describe("classifyLine", () => {
  const assistant = (content: unknown, extra: Partial<TranscriptLine> = {}): TranscriptLine => ({
    type: "assistant",
    uuid: "u1",
    message: { role: "assistant", content: content as never },
    ...extra,
  });

  it("emits a text signal for assistant prose", () => {
    const sigs = classifyLine(assistant([{ type: "text", text: "Hello there" }]));
    expect(sigs).toEqual([{ kind: "text", uuid: "u1", text: "Hello there" }]);
  });

  it("skips thinking and tool_use from speech but records them as signals", () => {
    const sigs = classifyLine(
      assistant([
        { type: "thinking", thinking: "secret", signature: "x" },
        { type: "text", text: "Answer" },
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.ts" } },
      ])
    );
    expect(sigs.map((s) => s.kind)).toEqual(["thinking", "text", "tool_use"]);
    const tool = sigs.find((s) => s.kind === "tool_use");
    expect(tool).toMatchObject({ id: "t1", name: "Read", filePath: "/a.ts" });
  });

  it("does NOT speak sidechain (subagent) or meta lines (D12)", () => {
    expect(classifyLine(assistant([{ type: "text", text: "sub" }], { isSidechain: true }))).toEqual([]);
    expect(classifyLine(assistant([{ type: "text", text: "meta" }], { isMeta: true }))).toEqual([]);
  });

  it("does not speak user-role text", () => {
    const line: TranscriptLine = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    };
    expect(classifyLine(line)).toEqual([]);
  });

  it("emits tool_result with its tool_use_id", () => {
    const line: TranscriptLine = {
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1" }] },
    };
    expect(classifyLine(line)).toEqual([{ kind: "tool_result", id: "t1" }]);
  });

  it("handles string content for assistant messages", () => {
    const line: TranscriptLine = { uuid: "u2", message: { role: "assistant", content: "plain" } };
    expect(classifyLine(line)).toEqual([{ kind: "text", uuid: "u2", text: "plain" }]);
  });

  it("ignores empty/whitespace text blocks", () => {
    expect(classifyLine(assistant([{ type: "text", text: "   " }]))).toEqual([]);
  });

  it("returns [] for null or message-less lines", () => {
    expect(classifyLine(null)).toEqual([]);
    expect(classifyLine({ type: "file-history-snapshot" })).toEqual([]);
  });
});

describe("extractFilePath", () => {
  it("reads common path keys", () => {
    expect(extractFilePath({ file_path: "/x" })).toBe("/x");
    expect(extractFilePath({ path: "/y" })).toBe("/y");
    expect(extractFilePath({ notebook_path: "/z.ipynb" })).toBe("/z.ipynb");
  });
  it("returns undefined when absent", () => {
    expect(extractFilePath({ command: "ls" })).toBeUndefined();
    expect(extractFilePath(null)).toBeUndefined();
  });
});

describe("workspace matching", () => {
  it("normalizes separators, trailing slash, and case", () => {
    expect(normalizePath("C:\\Dev\\App\\")).toBe("c:/dev/app");
    expect(normalizePath("c:/dev/app")).toBe("c:/dev/app");
  });
  it("matches a line's cwd against the workspace root regardless of slash/case", () => {
    const line: TranscriptLine = { cwd: "C:\\Dev\\vscode-devspec" };
    expect(lineMatchesWorkspace(line, "c:/Dev/vscode-devspec")).toBe(true);
    expect(lineMatchesWorkspace(line, "c:/Dev/other")).toBe(false);
    expect(lineMatchesWorkspace({}, "c:/Dev/vscode-devspec")).toBe(false);
  });
});
