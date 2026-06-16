## Context

The `vscode-devspec` extension is a thin presentation layer over the `devspec` CLI — every workflow operation either runs a `devspec` subcommand or copies a slash-command string to the clipboard. The previous `vscode-extension-delta-support` change added the Capabilities surface; this change closes three smaller gaps surfaced in the post-implementation gap analysis: lifecycle quick actions (next / complete / log), comprehensive slash-command copy coverage (the missing 8 of 15), and status-bar enrichment.

All three pieces follow patterns the codebase already has: `nextCommand` and `logDecisionCommand` mirror `planChangeCommand` (input box + `runDevspec` shell-out + notification); the CodeLens-triggered `completeTask` follows the lens-with-command pattern already used for the contract.md test-fence lens; the new copy commands mirror `copyIterate` / `copyOnboard` exactly; the status bar already has an `update(snapshot)` method that just needs additional state to render. There is no new architectural concept here — just more instances of established patterns.

Three subtleties need explicit decisions: (1) whether the status bar's "next task" segment uses a per-change CLI call in `buildSnapshot` (cost) or lazy-loads on hover (latency); (2) how the tasks.md CodeLens passes the line number to `devspec complete` (the existing lens emits a non-clickable placeholder; we need to make it clickable + slug-aware); (3) whether `devspec.next` is one command that does both "show in notification" and "advance to first pending task", or two commands separated.

## Goals / Non-Goals

**Goals:**

- Every existing pattern reused. No new providers, no new view types, no architectural surface.
- All 15 DevSpec slash commands get a copy button, matching the post-namespace-migration surface DevSpec ships.
- The three lifecycle CLI verbs most used during in-editor work (next, complete, log) become one-click from the right places (changes tree, tasks.md, alignment-relevant context).
- Status bar becomes the at-a-glance "what should I do next" surface, not just a phase indicator.
- Snapshot extension stays additive (no breaking changes to `WorkspaceSnapshot` or `ChangeSummary` consumers).

**Non-Goals:**

- UAT view (separate change).
- Doctor-in-UI rendering (separate change).
- Unified "DevSpec Command Palette" command (defer).
- Drag-to-sync, drag-to-merge, or other gestural interactions (defer).
- Inline editing of capability spec files via the Capabilities tree (defer).
- Migration of any existing command IDs or behaviour. Strictly additive.

## Decisions

### D1. Status bar next-task data comes from a single CLI call per snapshot

`buildSnapshot()` currently makes 1 + N CLI calls (status once + specs status per active change). This change adds one more call per active change: `devspec next <slug> --json`. Total snapshot build: 1 (status) + N (specs status) + N (next) = 1 + 2N calls. For typical N ∈ [1, 5], snapshot stays under ~300 ms — acceptable.

```ts
// snapshot.ts (extension)
for (const change of snapshot.changes) {
  if (change.archived) continue;
  const nextRes = await runDevspec(["next", change.slug, "--json"], root);
  if (nextRes.exitCode === 0 && nextRes.stdout.trim()) {
    try {
      const parsed = JSON.parse(nextRes.stdout) as { text?: string; line?: number };
      if (parsed.text && typeof parsed.line === "number") {
        change.nextTask = { text: parsed.text, line: parsed.line };
      }
    } catch {
      /* leave null */
    }
  }
}
```

**`ChangeSummary` extension:**

```ts
interface ChangeSummary {
  // ...existing fields
  nextTask: { text: string; line: number } | null;
}
```

**Alternatives considered:**

- *Lazy-load via hover*: extension fetches `devspec next` only when the user hovers the status bar. Rejected — hover triggers in VS Code are flaky and we already pay the snapshot cost.
- *Compute from snapshot data alone*: parse `tasks.md` directly in the extension. Rejected — duplicates the CLI's task-resolution logic. The CLI is the truth.
- *Cache between refreshes*: only fetch `next` when `tasks.md` changes per the file watcher. Defer — the optimisation is real but adds caching invalidation logic. Revisit if real workspaces show snapshot lag.

### D2. CodeLens for `Mark complete` uses an internal command with line number

The existing `tasksLenses()` emits a `○ pending — devspec next shows the first one` lens per unchecked task. This change replaces that lens with a clickable one:

```ts
new vscode.CodeLens(new vscode.Range(i, 0, i, 0), {
  title: `○ Mark complete`,
  command: "devspec.completeTaskAtLine",
  arguments: [slug, i + 1, taskText],
});
```

A new internal command `devspec.completeTaskAtLine(slug, line, text)` runs `devspec complete <slug> <text> --line <N>`. The line argument disambiguates duplicate task text and matches the CLI's exact behaviour (per the existing CLI surface: `complete <slug> <match> [--line <n>]`).

The slug is extracted from the file path (`.devspec/projects/<slug>/tasks.md`) — the helper already exists as `extractSlugFromTasksPath` (or we add it parallel to `extractSlugFromDeltaPath` from the previous change).

The internal command is hidden from the palette via `commandPalette` `when: false` (existing pattern).

**Alternative considered:** "Mark complete" via right-click context menu on tasks-tree items. Rejected — there's no tasks-tree view; tasks live in `tasks.md` and CodeLens is the existing in-file affordance.

### D3. `devspec.next` is one command, shows in a notification with two actions

When invoked (either from the command palette or a future right-click action), `devspec.next` runs `devspec next <slug>` for the inferred/selected change and shows the result in an information message with two action buttons:

```
ℹ️ Next task in cancel-booking:
   "Implement cancellation policy validation"
   [Open tasks.md]  [Mark complete]
```

- "Open tasks.md" → `vscode.commands.executeCommand("vscode.open", uri)` with cursor at the task line.
- "Mark complete" → `vscode.commands.executeCommand("devspec.completeTaskAtLine", slug, line, text)`.

When `devspec next` reports no pending tasks, the notification shows: `✓ No pending tasks in <slug>. Advance the stage or move on.`

**Alternative considered:** Two separate commands (`devspec.showNext` + `devspec.advanceToNext`). Rejected — fragmenting the discovery makes it harder to find the right command; one with action buttons matches VS Code's existing notification idiom.

### D4. `devspec.logDecision` is a two-step input flow

```ts
const decision = await vscode.window.showInputBox({
  title: "DevSpec: Log decision",
  prompt: "One-line decision to append to alignment.md",
  validateInput: (v) => (v.trim().length === 0 ? "decision is required" : undefined),
});
if (!decision) return;

const reason = await vscode.window.showInputBox({
  title: "DevSpec: Log decision (optional reason)",
  prompt: "Why was this decision taken? (leave blank to skip)",
});

const args = ["log", slug, decision];
if (reason && reason.trim()) args.push("--because", reason.trim());
await runDevspec(args, root);
```

The slug is inferred from the active editor (via the existing `inferActiveChange`) or comes from the right-click context. If neither resolves, the command falls back to a quick-pick of active slugs (mirroring `pickActiveChange` in `commands.ts`).

**Alternative considered:** Single multi-line input box with structured parsing (e.g. `decision | reason`). Rejected — VS Code's input box is single-line; multi-line custom UI would be a webview, which is overkill.

### D5. Status bar segments are conditional + truncated

The status bar item's `text` is composed of segments separated by `  `:

```
<phase>  <change-count>  Δ<delta-count>  📋 <next-task-truncated>
```

Logic:

- `<phase>` and `<change-count>` always present (existing behaviour).
- `Δ<delta-count>` only appears when ≥1 active change has `pendingDeltas.length > 0`. Count is the sum across all active changes.
- `📋 <next-task-truncated>` only appears when any active change has a `nextTask` value AND there's only one in-progress change (avoids ambiguity when multiple changes have pending tasks; in that case we just show the count via existing `<change-count>`).
- Task text truncates at 30 characters with an ellipsis.

The status bar item's tooltip becomes more verbose:

```markdown
**Workspace phase:** ready
**Active changes:** 2

**Pending deltas:** user-auth (cancel-booking), billing (cancel-booking)

**Next task:** Implement cancellation policy validation
  (in `cancel-booking`, click to open tasks.md)
```

**Alternative considered:** Always show the next-task segment even with multiple in-progress changes; pick the most-recent. Rejected — silent ambiguity is worse than restraint. The tooltip can show details.

### D6. The 8 new copy commands follow the existing pattern verbatim

Each new copy command is a one-line registration mirroring the existing `copyIterate`/`copyOnboard`:

```ts
vscode.commands.registerCommand("devspec.copyNew", (arg?: unknown) =>
  copySlashCommandCommand("/devspec:new <title>", slugFrom(arg))
),
```

`copyGrill` differs slightly — the slash command takes a `<stage>` argument. If invoked from a stage doc context (`.devspec/projects/<slug>/<stage>.md`), the stage is extracted from the file name; otherwise the user gets `/devspec:grill <stage> <slug>` as the clipboard literal (with placeholders).

`copyContinue` and `copyVerify` and `copyArchive` take an optional slug arg from context (like `copyIterate`).

`copyTriage` and `copyRefreshStandards` are workspace-level (no slug); follow `copyCoordinate` pattern.

`copyUatDesign` is workspace-level (no slug or stage).

### D7. Right-click context menu rearrangement

The changes-tree right-click menu currently has:

```
inline:    coherence
agent@1:   copyIterate
agent@2:   copyReview
agent@3:   copyIterateAll
agent@4:   copyCoordinate
agent@5:   copySync                   (added in previous change)
```

This change adds:

```
lifecycle@1: next
lifecycle@2: logDecision
agent@6:     copyContinue
agent@7:     copyVerify
agent@8:     copyArchive
```

`copyNew` is NOT in the context menu — it's not slug-scoped (new change creation doesn't need a context). Available via command palette only.

Total menu items per change: 5 lifecycle/agent items become 8. Acceptable but worth re-grouping into a submenu if it grows further.

### D8. Command palette hiding

Hide from palette via `when: false`:

- `devspec.completeTaskAtLine` — internal, lens-only.

All other new commands are palette-visible (including the copy commands — users may want to invoke them without a tree right-click).

## Risks / Trade-offs

- **Snapshot build time grows** by N calls (`devspec next` per active change) → mitigation: typical N ≤ 5 keeps total < 300 ms. If real workspaces show lag, switch to lazy-load behind a hover or file-watcher trigger (defer until observed).
- **Status bar gets wider** → mitigation: each segment is conditional. Empty states stay short. Truncation cap at 30 chars for task text.
- **`devspec next --json` exists per CLI source check, but JSON shape is implicit** → mitigation: design assumes `{ text, line }`. Verify during implementation; if shape differs, adjust the parse or fall back to text output regex.
- **CodeLens click invokes a CLI mutation** → mitigation: `devspec complete` is non-destructive (toggles a checkbox in a markdown file). No confirmation needed. The tasks.md file's existing watcher refreshes the lens after.
- **Eight new copy commands grow `package.json`** → mitigation: each is ~5 lines of JSON; total +40 lines is acceptable. The pattern is repetitive, not novel.
- **`devspec.logDecision` two-step flow could feel heavy** → mitigation: the reason step is optional (empty input skips). For users who reach for it constantly, the input flow is 5 keystrokes + Tab + 0–10 keystrokes; better than terminal-switch.

## Migration Plan

Strictly additive. No existing command renamed, no existing behaviour changed. Users on `0.0.6` re-install the next `.vsix` and the new commands + status segments appear. No data migration.

Rollback: revert the source changes; existing commands continue to work. No persisted state.

## Open Questions

- **Should `devspec next --json` ship in DevSpec proper if its shape turns out to be ambiguous?** Probably yes — a clean JSON contract is worth a small CLI-side spec update. If we discover the shape isn't well-defined, this change can pause and a tiny DevSpec change adds it before resuming.
- **Should the status bar's `Δ<count>` segment be clickable** to open the Capabilities view? Tempting but VS Code status-bar items have a single command. Could split into multiple status items but that's noisy. Defer.
- **Should `copyGrill` infer the stage from the active editor**, or always prompt? Inferring is more magical; prompting is more predictable. Lean toward inferring with a fallback prompt when no stage doc is open.
- **Should `devspec.logDecision` offer a quick-pick of recent decisions** to amend? No — `devspec log` is append-only. Amending an entry means editing alignment.md directly.
- **Does the existing `inferActiveChange` helper handle delta and capability spec files?** It looks for `.devspec/projects/<slug>/`. Delta files are nested deeper (`projects/<slug>/deltas/<cap>/spec.md`) but the slug is still the second segment — verify the helper extracts it correctly.
