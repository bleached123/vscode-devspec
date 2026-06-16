import { describe, it, expect } from "vitest";
import { markdownToSpeech, isSpeakable } from "./speechText.js";

describe("markdownToSpeech", () => {
  it("does not speak emphasis/heading/list markup literally", () => {
    const out = markdownToSpeech("# Title\n\n- **bold** and _italic_ and `code`");
    expect(out).not.toContain("#");
    expect(out).not.toContain("*");
    expect(out).not.toContain("`");
    expect(out).toContain("Title");
    expect(out).toContain("bold");
    expect(out).toContain("italic");
    expect(out).toContain("code");
  });

  it("announces fenced code blocks rather than reading them verbatim", () => {
    const out = markdownToSpeech("Here is code:\n```ts\nconst x = 1;\n```\nDone");
    expect(out).not.toContain("const x = 1");
    expect(out.toLowerCase()).toContain("code block");
    expect(out).toContain("Here is code");
    expect(out).toContain("Done");
  });

  it("reduces links and images to their text/alt", () => {
    expect(markdownToSpeech("see [the docs](https://x.y)")).toContain("the docs");
    expect(markdownToSpeech("see [the docs](https://x.y)")).not.toContain("https");
    expect(markdownToSpeech("![a cat](cat.png)")).toContain("a cat");
  });

  it("strips blockquotes and ordered-list markers", () => {
    const out = markdownToSpeech("> quoted\n1. first\n2. second");
    expect(out).not.toContain(">");
    expect(out).not.toMatch(/^\s*1\./m);
    expect(out).toContain("first");
  });

  it("collapses whitespace", () => {
    expect(markdownToSpeech("a\n\n\nb   c")).toBe("a\nb c");
  });
});

describe("isSpeakable", () => {
  it("is false for code-only or empty content", () => {
    expect(isSpeakable("```\ncode\n```")).toBe(false);
    expect(isSpeakable("   ")).toBe(false);
  });
  it("is true for real prose", () => {
    expect(isSpeakable("Hello world")).toBe(true);
  });
});
