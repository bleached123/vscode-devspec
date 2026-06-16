/**
 * Barge-in policy (design D10, Q3): queue + skip-to-latest. New utterances queue
 * behind the current one with a small cap (drop oldest when exceeded); a
 * "skip to latest" action collapses the queue to just the newest item. Pure data
 * structure — the orchestrator owns timing and actual speech.
 */

export interface SpeakItem {
  id: string;
  text: string;
  /** Speak even when voicing is disabled/muted (used by the test command). */
  force?: boolean;
}

export class SpeechQueue {
  private items: SpeakItem[] = [];
  constructor(private readonly cap = 5) {}

  enqueue(item: SpeakItem): void {
    this.items.push(item);
    while (this.items.length > this.cap) this.items.shift();
  }

  /** Remove and return the next item to speak, or null if empty. */
  next(): SpeakItem | null {
    return this.items.shift() ?? null;
  }

  /**
   * Collapse the queue to only its newest item and return it (or null). Used by
   * the "skip to latest" control after cancelling the current utterance.
   */
  skipToLatest(): SpeakItem | null {
    if (this.items.length === 0) return null;
    const latest = this.items[this.items.length - 1] ?? null;
    this.items = [];
    return latest;
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }
}
