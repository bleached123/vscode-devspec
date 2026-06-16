## Why

The CLI ↔ extension gap analysis surfaced three classes of friction inside the editor: (1) common lifecycle operations like "tick this task off", "what's next", and "log a decision" require dropping to a terminal even though the user is already in VS Code; (2) DevSpec ships 15 slash commands but the extension only has copy buttons for 7, so the other 8 require manual typing; and (3) the status bar item shows the workspace phase + a drift count but nothing about *what the user should do next*, missing an opportunity to be the at-a-glance source of next-action information.

None of these are bugs — the CLI does each thing correctly — but each represents an editor-context UX miss that this change closes with thin, mostly-mechanical additions to the existing extension architecture. All three target the same archetype (a user who lives in VS Code and wants to act on their DevSpec workspace without context-switching).

## What Changes

- **Right-click "Mark complete" action on tasks.md CodeLens** — each unchecked task in `tasks.md` already shows a `○ pending — devspec next shows the first one` CodeLens. This change makes that lens clickable: invoking it calls `devspec complete <slug> "<task-text>" --line <N>` and the file refreshes. The header lens (`X/Y tasks complete`) stays informational.
- **New command `devspec.next`** — runs `devspec next <slug>` for the inferred or selected change, surfaces the first unchecked task in a notification with two actions: "Open tasks.md" (jumps to the line) and "Mark complete" (runs `devspec complete`).
- **New command `devspec.logDecision`** — prompts the user via input box for a decision string + optional `--because <reason>` field, calls `devspec log <slug> "<decision>" --because "<reason>"`, surfaces the result as a notification. Exposed as a right-click action on changes-tree items so the slug is contextual.
- **Eight new copy-slash-command commands** — `copyNew`, `copyContinue`, `copyVerify`, `copyArchive`, `copyGrill`, `copyTriage`, `copyUatDesign`, `copyRefreshStandards`. Each follows the existing `copyIterate` / `copyOnboard` pattern. `copyGrill` accepts a stage argument from context (currently active editor's stage doc).
- **Status bar enrichment** — the status bar item gains two new pieces of state alongside the existing phase + drift count: (a) a `Δ<N>` pending-deltas count when any active change has unsynced deltas, and (b) a "next task: <truncated task text>" segment when an active change has a pending task. Both segments only show when there's a value to surface; empty states stay clean. Click behaviour stays — opens the workspace map.
- **Context-menu rearrangement on changes tree** — the existing 4-button `agent@` group gains the 5 new copy commands (`copySync` already added, plus copyNew/copyContinue/copyVerify/copyArchive). The legacy "iterate / review / coordinate / iterate-all / onboard" buttons stay; the new ones cover the post-skill-suite lifecycle.

## Capabilities

### New Capabilities

- `extension-quality-of-life`: a thin layer of editor-context wrappers around `devspec` CLI verbs (next, complete, log) plus a comprehensive slash-command clipboard surface (covering all 15 DevSpec slash commands) plus richer status-bar state. All three increase the proportion of DevSpec workflow operations a user can perform without leaving the editor.

### Modified Capabilities

None. This change does not modify the requirements of `extension-capability-support` (the existing main spec from the previous change). The features here are orthogonal to capability-deltas surfacing.

## Impact

**New source files**
- No new files expected. All additions fit into existing modules.

**Modified source files**
- `src/commands.ts` — add `nextCommand`, `completeTaskCommand`, `logDecisionCommand`. Each is a thin shell-out following the `planChangeCommand` pattern.
- `src/extension.ts` — register the three new lifecycle commands and the eight new copy commands.
- `src/providers/codeLens.ts` — extend `tasksLenses()` so each pending-task lens becomes clickable (invokes `devspec.completeTaskAtLine`); add a new internal command `devspec.completeTaskAtLine` that takes a line number + slug.
- `src/statusBar.ts` — extend `update()` to append the Δ count + next-task segments when present; both come from the existing `WorkspaceSnapshot`.
- `package.json`:
  - `contributes.commands` — add 11 new command entries (3 lifecycle + 8 copy)
  - `contributes.menus.view/item/context` — add the 5 new lifecycle/copy commands to the changes-tree right-click menu, plus `logDecision`
  - `contributes.menus.commandPalette` — hide internal commands (`completeTaskAtLine`)

**Snapshot extension (minor)**
- `src/workspace.ts` — `ChangeSummary` may need a `nextTask: { text: string; line: number } | null` field for the status bar's next-task segment. Snapshot population in `src/snapshot.ts` would call `devspec next <slug> --json` per active change (acceptable cost — same pattern as `specs status` per change in the previous slice). If `devspec next` doesn't ship a `--json` flag, we fall back to parsing the regular output; see design.md for the decision.

**Tests**
- The existing `test/cli/...` smoke patterns in DevSpec don't apply here (extension has very limited test infra). Continue the precedent set in the previous change: add focused regex/pure-function tests where they fit; don't try to mock the VS Code API.

**Backward compatibility**
- Purely additive. No existing command renamed or removed. No existing behaviour changes. The status bar gets longer when state demands it; otherwise unchanged.

**Out of scope** (genuinely separate work)
- UAT view (the largest remaining gap from the analysis) — bigger UI investment, its own change.
- Doctor diagnostics rendered in a UI panel — bigger UI investment, its own change.
- A unified "DevSpec command palette" command exposing every CLI verb — orthogonal redesign, defer.
- Drag-to-sync interactions on deltas — defer.
- Inline editing of capability spec files via the Capabilities tree — defer.
