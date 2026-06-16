/**
 * Pure, vscode-free core of the CodeLens provider: path classification,
 * slug/capability extraction, and the markdown scanners. Kept separate from
 * codeLens.ts so it can be unit-tested without a VS Code host — the provider
 * is then a thin mapping from these results onto vscode.CodeLens objects.
 */

// --- path classification -------------------------------------------------

/** …/.devspec/projects/<slug>/<doc>.md (NOT under deltas/). */
export function isWithinDevspecChange(filePath: string): boolean {
  return /[\\/]\.devspec[\\/]projects[\\/][^\\/]+[\\/][^\\/]+\.md$/.test(filePath);
}

/** …/.claude/commands/<name>.md OR .claude/commands/<subdir>/<name>.md */
export function isClaudeCommandFile(filePath: string): boolean {
  return /[\\/]\.claude[\\/]commands[\\/]([^\\/]+[\\/])?[^\\/]+\.md$/.test(filePath);
}

/** …/.devspec/projects/<slug>/deltas/<cap>/spec.md */
export function isDeltaSpecFile(filePath: string): boolean {
  return /[\\/]\.devspec[\\/]projects[\\/][^\\/]+[\\/]deltas[\\/][^\\/]+[\\/]spec\.md$/.test(
    filePath
  );
}

/** …/.devspec/specs/<cap>/spec.md */
export function isCapabilitySpecFile(filePath: string): boolean {
  return /[\\/]\.devspec[\\/]specs[\\/][^\\/]+[\\/]spec\.md$/.test(filePath);
}

export function extractSlugFromDeltaPath(filePath: string): string | null {
  const m = /[\\/]\.devspec[\\/]projects[\\/]([^\\/]+)[\\/]deltas[\\/]/.exec(filePath);
  return m?.[1] ?? null;
}

export function extractCapabilityFromSpecPath(filePath: string): string | null {
  const m = /[\\/]\.devspec[\\/]specs[\\/]([^\\/]+)[\\/]spec\.md$/.exec(filePath);
  return m?.[1] ?? null;
}

/** …/.devspec/projects/<slug>/<doc>.md (NOT under deltas/). */
export function extractSlugFromChangeFilePath(filePath: string): string | null {
  const m = /[\\/]\.devspec[\\/]projects[\\/]([^\\/]+)[\\/][^\\/]+\.md$/.exec(filePath);
  return m?.[1] ?? null;
}

// --- contract.md scanning ------------------------------------------------

export const RESERVED_TS_KEYWORDS = new Set([
  "function",
  "interface",
  "type",
  "class",
  "enum",
  "const",
  "let",
  "var",
  "return",
  "if",
  "for",
  "while",
  "switch",
  "new",
  "throw",
  "import",
  "export",
  "default",
]);

export interface ContractScan {
  /** One entry per `\`\`\`yaml tests` fence; `line` is the 0-based fence line. */
  testFences: Array<{ line: number; count: number }>;
  /** API method declarations inside ts fences; `line` is 0-based. */
  apiMethods: Array<{ line: number; name: string }>;
}

/** Count `- name:` entries inside ```yaml tests fences and surface API method
 *  declarations inside ```ts fences. Mirrors the old inline provider logic. */
export function scanContract(text: string): ContractScan {
  const lines = text.split(/\r?\n/);
  const testFences: ContractScan["testFences"] = [];
  const apiMethods: ContractScan["apiMethods"] = [];

  let inYamlTests = false;
  let yamlFenceStart = -1;
  let testCount = 0;
  let inTsFence = false;

  const apiMethodRegex = /^\s*(?:function\s+)?([a-z]\w*)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (/^```ya?ml\s+tests\s*$/i.test(line)) {
      inYamlTests = true;
      yamlFenceStart = i;
      testCount = 0;
      continue;
    }
    if (inYamlTests && /^```\s*$/.test(line)) {
      testFences.push({ line: yamlFenceStart, count: testCount });
      inYamlTests = false;
      yamlFenceStart = -1;
      continue;
    }
    if (inYamlTests && /^\s*-\s+name\s*:/.test(line)) {
      testCount++;
    }

    if (/^```(?:ts|typescript)\b/.test(line)) {
      inTsFence = true;
      continue;
    }
    if (inTsFence && /^```\s*$/.test(line)) {
      inTsFence = false;
      continue;
    }
    if (inTsFence) {
      const m = apiMethodRegex.exec(line);
      const name = m?.[1] ?? "";
      if (name && !RESERVED_TS_KEYWORDS.has(name)) {
        apiMethods.push({ line: i, name });
      }
    }
  }
  return { testFences, apiMethods };
}

// --- tasks.md scanning ---------------------------------------------------

export interface TasksScan {
  checked: number;
  unchecked: number;
  /** Unchecked task lines; `line` is 0-based. */
  pending: Array<{ line: number; text: string }>;
}

export function scanTasks(text: string): TasksScan {
  const lines = text.split(/\r?\n/);
  const taskRegex = /^\s*[-*]\s*\[( |x|X)\]\s+(.+?)\s*$/;
  let checked = 0;
  let unchecked = 0;
  const pending: TasksScan["pending"] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = taskRegex.exec(lines[i] ?? "");
    if (!m) continue;
    const isChecked = m[1] !== " ";
    if (isChecked) {
      checked++;
    } else {
      unchecked++;
      pending.push({ line: i, text: m[2] ?? "" });
    }
  }
  return { checked, unchecked, pending };
}

/** Requirement count in a capability spec body. */
export function countRequirements(text: string): number {
  return (text.match(/^### Requirement:/gm) ?? []).length;
}
