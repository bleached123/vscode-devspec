import { describe, it, expect } from "vitest";
import { SpeechQueue } from "./queue.js";

describe("SpeechQueue", () => {
  it("dequeues in FIFO order", () => {
    const q = new SpeechQueue();
    q.enqueue({ id: "1", text: "a" });
    q.enqueue({ id: "2", text: "b" });
    expect(q.next()?.id).toBe("1");
    expect(q.next()?.id).toBe("2");
    expect(q.next()).toBeNull();
  });

  it("drops the oldest items when over the cap", () => {
    const q = new SpeechQueue(2);
    q.enqueue({ id: "1", text: "a" });
    q.enqueue({ id: "2", text: "b" });
    q.enqueue({ id: "3", text: "c" }); // evicts "1"
    expect(q.size).toBe(2);
    expect(q.next()?.id).toBe("2");
  });

  it("skipToLatest collapses to the newest item", () => {
    const q = new SpeechQueue();
    q.enqueue({ id: "1", text: "a" });
    q.enqueue({ id: "2", text: "b" });
    q.enqueue({ id: "3", text: "c" });
    expect(q.skipToLatest()?.id).toBe("3");
    expect(q.size).toBe(0);
    expect(q.skipToLatest()).toBeNull();
  });
});
