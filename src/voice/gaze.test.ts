import { describe, it, expect } from "vitest";
import { gazeVector } from "./gaze.js";

describe("gazeVector", () => {
  it("looks forward (no lean) when there is no focus", () => {
    expect(gazeVector(null)).toEqual({ x: 0, y: 0 });
  });

  it("leans toward the editor (positive x) for a cursor target", () => {
    const v = gazeVector({ line: 0, lineCount: 100, source: "cursor" });
    expect(v.x).toBeGreaterThan(0);
  });

  it("leans harder for discussed code than for a passive cursor", () => {
    const cursor = gazeVector({ line: 50, lineCount: 100, source: "cursor" });
    const discussed = gazeVector({ line: 50, lineCount: 100, source: "discussed" });
    expect(discussed.x).toBeGreaterThan(cursor.x);
  });

  it("glances up for top-of-file and down for bottom-of-file", () => {
    const top = gazeVector({ line: 0, lineCount: 100, source: "cursor" });
    const bottom = gazeVector({ line: 99, lineCount: 100, source: "cursor" });
    expect(top.y).toBeLessThan(0);
    expect(bottom.y).toBeGreaterThan(0);
  });

  it("guards against a zero line count", () => {
    expect(() => gazeVector({ line: 0, lineCount: 0, source: "cursor" })).not.toThrow();
  });
});
