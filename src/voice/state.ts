import type { Signal } from "./transcript.js";

/**
 * Pure session-state machine (design D3). Folds transcript signals plus a
 * "speaking" flag into the orb's visual state. Deterministic: callers pass the
 * current time in, so it is trivially unit-testable and has no hidden clock.
 *
 * Precedence: speaking > working (a tool is still running) > thinking (recent
 * thinking block) > idle.
 */

export type OrbState = "idle" | "thinking" | "working" | "speaking";

export interface StateMachineOptions {
  /** How long after the last thinking block we keep showing "thinking" (ms). */
  thinkingDecayMs?: number;
}

export class SessionStateMachine {
  private readonly pendingTools = new Set<string>();
  /** Tool runs without an id still count toward "working" via this counter. */
  private anonymousTools = 0;
  private lastThinkingAt = -Infinity;
  private speaking = false;
  private readonly thinkingDecayMs: number;

  constructor(opts: StateMachineOptions = {}) {
    this.thinkingDecayMs = opts.thinkingDecayMs ?? 8000;
  }

  /** Fold one signal into the machine. `now` is the event time in ms. */
  applySignal(sig: Signal, now: number): void {
    switch (sig.kind) {
      case "thinking":
        this.lastThinkingAt = now;
        break;
      case "tool_use":
        if (sig.id) this.pendingTools.add(sig.id);
        else this.anonymousTools++;
        break;
      case "tool_result":
        if (sig.id && this.pendingTools.delete(sig.id)) {
          /* matched */
        } else if (this.anonymousTools > 0) {
          this.anonymousTools--;
        }
        break;
      case "text":
        // A spoken/printed answer means any "thinking" shimmer should stop.
        this.lastThinkingAt = -Infinity;
        break;
    }
  }

  setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
  }

  private working(): boolean {
    return this.pendingTools.size > 0 || this.anonymousTools > 0;
  }

  /** Current state given the wall-clock `now` (ms). */
  state(now: number): OrbState {
    if (this.speaking) return "speaking";
    if (this.working()) return "working";
    if (now - this.lastThinkingAt < this.thinkingDecayMs) return "thinking";
    return "idle";
  }
}
