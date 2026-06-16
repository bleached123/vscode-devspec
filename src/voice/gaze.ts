/**
 * Gaze / attention targeting (design D8, Q2). The orb webview lives in the
 * sidebar (left), with editors to its right, so "orient toward the discussed
 * code or the cursor" is interpreted as a directional lean. Pure: maps a focus
 * target to a 2D unit-ish vector the renderer uses to bias the orb's highlight.
 */

export interface FocusTarget {
  /** 0-based line of interest. */
  line: number;
  /** Total lines in the focused document (>= 1). */
  lineCount: number;
  /** Where the target came from. */
  source: "cursor" | "discussed";
}

export interface GazeVector {
  x: number;
  y: number;
}

/** Base horizontal lean toward the editor area (sidebar is on the left). */
const EDITOR_BIAS_X = 0.7;
/** How far the vertical glance swings between top and bottom of the file. */
const VERTICAL_RANGE = 0.6;

export function gazeVector(focus: FocusTarget | null): GazeVector {
  if (!focus) return { x: 0, y: 0 };
  const lineCount = Math.max(1, focus.lineCount);
  const frac = clamp(focus.line / lineCount, 0, 1); // 0 = top, 1 = bottom
  const y = (frac - 0.5) * 2 * VERTICAL_RANGE; // -range (up) .. +range (down)
  // "Discussed" code pulls a touch harder than a passive cursor glance.
  const x = focus.source === "discussed" ? EDITOR_BIAS_X : EDITOR_BIAS_X * 0.8;
  return { x, y };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
