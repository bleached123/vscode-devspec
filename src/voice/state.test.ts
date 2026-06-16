import { describe, it, expect } from "vitest";
import { SessionStateMachine } from "./state.js";

describe("SessionStateMachine", () => {
  it("starts idle", () => {
    expect(new SessionStateMachine().state(0)).toBe("idle");
  });

  it("shows thinking after a thinking block, then decays to idle", () => {
    const m = new SessionStateMachine({ thinkingDecayMs: 1000 });
    m.applySignal({ kind: "thinking" }, 0);
    expect(m.state(500)).toBe("thinking");
    expect(m.state(1500)).toBe("idle"); // decayed
  });

  it("shows working while a tool_use is unmatched, idle once its result arrives", () => {
    const m = new SessionStateMachine();
    m.applySignal({ kind: "tool_use", id: "t1", name: "Bash" }, 0);
    expect(m.state(10)).toBe("working");
    m.applySignal({ kind: "tool_result", id: "t1" }, 20);
    expect(m.state(30)).toBe("idle");
  });

  it("handles anonymous (id-less) tools via a counter", () => {
    const m = new SessionStateMachine();
    m.applySignal({ kind: "tool_use" }, 0);
    expect(m.state(1)).toBe("working");
    m.applySignal({ kind: "tool_result" }, 2);
    expect(m.state(3)).toBe("idle");
  });

  it("speaking takes precedence over working and thinking", () => {
    const m = new SessionStateMachine();
    m.applySignal({ kind: "tool_use", id: "t1" }, 0);
    m.setSpeaking(true);
    expect(m.state(10)).toBe("speaking");
    m.setSpeaking(false);
    expect(m.state(20)).toBe("working"); // tool still pending underneath
  });

  it("a text answer clears the thinking shimmer", () => {
    const m = new SessionStateMachine({ thinkingDecayMs: 10000 });
    m.applySignal({ kind: "thinking" }, 0);
    m.applySignal({ kind: "text", text: "done" }, 100);
    expect(m.state(200)).toBe("idle");
  });

  it("stays working while multiple tools are outstanding", () => {
    const m = new SessionStateMachine();
    m.applySignal({ kind: "tool_use", id: "a" }, 0);
    m.applySignal({ kind: "tool_use", id: "b" }, 1);
    m.applySignal({ kind: "tool_result", id: "a" }, 2);
    expect(m.state(3)).toBe("working"); // b still pending
    m.applySignal({ kind: "tool_result", id: "b" }, 4);
    expect(m.state(5)).toBe("idle");
  });
});
