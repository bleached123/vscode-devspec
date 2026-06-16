/**
 * Convert assistant markdown into speech-friendly plain text (spec: "Spoken
 * text is speech-friendly"). Formatting markers are removed, not read aloud, and
 * fenced code blocks are announced rather than spelled out character by
 * character. Pure and vscode-free.
 */

const CODE_BLOCK_ANNOUNCEMENT = " (code block) ";

export function markdownToSpeech(input: string): string {
  let s = input.replace(/\r\n/g, "\n");

  // Fenced code blocks → a short spoken announcement (never read verbatim).
  s = s.replace(/```[\s\S]*?```/g, CODE_BLOCK_ANNOUNCEMENT);
  s = s.replace(/~~~[\s\S]*?~~~/g, CODE_BLOCK_ANNOUNCEMENT);

  // Images ![alt](url) → alt text only.
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Links [text](url) → text.
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Inline code `x` → x (drop the backticks).
  s = s.replace(/`([^`]+)`/g, "$1");

  // Headings: drop leading #'s.
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  // Blockquotes: drop leading >.
  s = s.replace(/^\s{0,3}>\s?/gm, "");
  // List markers at line start: -, *, +, or "1." → drop.
  s = s.replace(/^\s*([-*+]|\d+\.)\s+/gm, "");
  // Horizontal rules.
  s = s.replace(/^\s*([-*_])\1{2,}\s*$/gm, "");

  // Emphasis / bold / strikethrough markers (leave the inner words).
  s = s.replace(/(\*\*|__)(.*?)\1/g, "$2");
  s = s.replace(/(\*|_)(.*?)\1/g, "$2");
  s = s.replace(/~~(.*?)~~/g, "$1");

  // Strip simple HTML tags.
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");

  // Collapse whitespace: trim lines, collapse blank runs, then spaces.
  s = s
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return s;
}

/** True when, after conversion, there is nothing worth speaking. */
export function isSpeakable(input: string): boolean {
  const out = markdownToSpeech(input).replace(CODE_BLOCK_ANNOUNCEMENT.trim(), "").trim();
  return out.length > 0;
}
