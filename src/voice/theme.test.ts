import { describe, it, expect } from "vitest";
import { derivePalette } from "./theme.js";

describe("derivePalette", () => {
  it("derives colours from --vscode-* tokens", () => {
    const p = derivePalette({
      "--vscode-editor-background": "#101418",
      "--vscode-editor-foreground": "#e0e0e0",
      "--vscode-focusBorder": "#3794ff",
    });
    expect(p.background).toBe("#101418");
    expect(p.core).toBe("#e0e0e0");
    expect(p.glow).toBe("#3794ff");
    expect(p.accent).toBe("#3794ff");
  });

  it("falls back to defaults when tokens are missing or blank", () => {
    const p = derivePalette({ "--vscode-editor-background": "  " });
    expect(p.background).toBe("#1e1e1e");
    expect(p.core).toBe("#cfe8ff");
    expect(p.glow).toBe("#4aa3ff");
  });

  it("uses a charts/button colour for the accent when focusBorder is absent", () => {
    const p = derivePalette({ "--vscode-charts-blue": "#5599ff" });
    expect(p.glow).toBe("#5599ff");
  });
});
