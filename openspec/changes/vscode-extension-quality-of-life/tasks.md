## 1. Snapshot extension (nextTask)

- [x] 1.1 Add `nextTask: { text: string; line: number } | null` to `ChangeSummary` in `src/workspace.ts`
- [x] 1.2 Initialise `nextTask: null` in `mapChange()` in `src/snapshot.ts` so the field is always present
- [x] 1.3 In `src/snapshot.ts`, iterate active changes and call `devspec next <slug> --json` per change; parse `{ text, line }`; populate each `ChangeSummary.nextTask`; tolerate non-zero exit / malformed JSON (leave as null)
- [x] 1.4 Verify the call sequence keeps total snapshot build under ~300 ms for typical workspaces (N ≤ 5 active changes)
- [x] 1.5 If `devspec next --json` shape turns out NOT to be `{ text, line }`, document the actual shape and update the parse accordingly (this is the open question from design.md)

## 2. devspec.next command

- [x] 2.1 Implement `nextCommand(slug?, snapshotProvider)` in `src/commands.ts` — infer slug if absent (existing `inferActiveChange` + `pickActiveChange` helpers), shell out to `runDevspec(["next", slug, "--json"], root)`, parse result
- [x] 2.2 When pending task found, show `vscode.window.showInformationMessage` with two action buttons: "Open tasks.md" and "Mark complete"; wire the buttons to `vscode.open` (with cursor at line) and `devspec.completeTaskAtLine` respectively
- [x] 2.3 When no pending tasks, show informational message "No pending tasks in <slug>." with no action buttons
- [x] 2.4 Register `devspec.next` command in `src/extension.ts`

## 3. devspec.logDecision command

- [x] 3.1 Implement `logDecisionCommand(slug?, root)` in `src/commands.ts` — two `showInputBox` calls (decision required, reason optional); validate decision non-empty
- [x] 3.2 Build the `devspec log <slug> <decision>` arg array; append `--because <reason>` when reason non-empty
- [x] 3.3 Shell out via `runDevspec(args, root)`; show info notification on success, error notification on non-zero exit
- [x] 3.4 Slug-resolution order: explicit arg → `inferActiveChange` from active editor → `pickActiveChange` quick-pick fallback
- [x] 3.5 Register `devspec.logDecision` command in `src/extension.ts`

## 4. completeTaskAtLine internal command + CodeLens update

- [x] 4.1 Implement `completeTaskAtLineCommand(slug, line, text, root)` in `src/commands.ts` — runs `devspec complete <slug> <text> --line <N>`; show error notification if exit non-zero (no notification on success — the file watcher will refresh the lens)
- [x] 4.2 Register the internal command in `src/extension.ts`
- [x] 4.3 In `src/providers/codeLens.ts`, modify `tasksLenses(document)`:
  - extract slug from path via new helper `extractSlugFromTasksPath(p)` (or reuse `isWithinDevspecChange` + path parsing)
  - replace the existing pending-task placeholder lens with a clickable lens: `{ title: "○ Mark complete", command: "devspec.completeTaskAtLine", arguments: [slug, lineNumber, taskText] }`
  - keep the header lens (`X/Y tasks complete`) as informational

## 5. Eight new copy commands

- [x] 5.1 In `src/extension.ts`, register `devspec.copyNew` → `copySlashCommandCommand("/devspec:new <title>")` (no slug substitution; literal placeholder)
- [x] 5.2 Register `devspec.copyContinue` → `copySlashCommandCommand("/devspec:continue <slug>", slugFrom(arg))`
- [x] 5.3 Register `devspec.copyVerify` → `copySlashCommandCommand("/devspec:verify <slug>", slugFrom(arg))`
- [x] 5.4 Register `devspec.copyArchive` → `copySlashCommandCommand("/devspec:archive <slug>", slugFrom(arg))`
- [x] 5.5 Register `devspec.copyGrill` → extract stage from active editor's filename (when matching `*.devspec/projects/*/[stage].md`); if extractable, `copySlashCommandCommand("/devspec:grill <stage> <slug>", ...)` with both substituted; else fall back to literal placeholders
- [x] 5.6 Register `devspec.copyTriage` → `copySlashCommandCommand("/devspec:triage")` (no args)
- [x] 5.7 Register `devspec.copyUatDesign` → `copySlashCommandCommand("/devspec:uat-design")` (no args)
- [x] 5.8 Register `devspec.copyRefreshStandards` → `copySlashCommandCommand("/devspec:refresh-standards")` (no args)
- [x] 5.9 Add command entries to `package.json` `contributes.commands` for all eight (titles like "DevSpec: Copy /devspec:new", icons follow existing copy command conventions)

## 6. Status bar enrichment

- [x] 6.1 In `src/statusBar.ts`, extend `update(snapshot)` to compute and append `Δ<N>` segment when `snapshot.changes.some(c => !c.archived && c.pendingDeltas.length > 0)`; N = sum of `pendingDeltas.length` across active changes
- [x] 6.2 Extend `update(snapshot)` to compute the "single in-progress change" check: find active changes with `nextTask !== null`; if exactly one, append `📋 <truncated-task-text>` segment (truncate at 30 chars + ellipsis)
- [x] 6.3 Extend the tooltip (MarkdownString) to include the pending-delta breakdown (capability + change slug pairs) and the next-task text + slug when present
- [x] 6.4 Ensure segments are conditional — empty states do NOT show empty segments
- [x] 6.5 Manual verification: open a test workspace with pending deltas and a pending task, confirm status bar renders correctly

## 7. Right-click context menu rearrangement

- [x] 7.1 In `package.json` `contributes.menus.view/item/context`, add the 5 new entries scoped to `view == devspec.changes && viewItem == change`:
  - `devspec.next` (group `lifecycle@1`)
  - `devspec.logDecision` (group `lifecycle@2`)
  - `devspec.copyContinue` (group `agent@6`)
  - `devspec.copyVerify` (group `agent@7`)
  - `devspec.copyArchive` (group `agent@8`)
- [x] 7.2 Hide `devspec.completeTaskAtLine` from the command palette via `contributes.menus.commandPalette` with `when: false`
- [x] 7.3 Verify the menu still renders cleanly (8 items max before considering a submenu split)

## 8. Build, typecheck, smoke

- [x] 8.1 Run `npm run typecheck` — confirm zero errors
- [x] 8.2 Run `npm run build` — confirm clean esbuild
- [x] 8.3 Run `npm test` — confirm vitest runs cleanly (existing tests still pass; this change doesn't add new test files unless a small regex helper warrants one)
- [x] 8.4 Run `npm run package` — confirm the `.vsix` builds without error

## 9. CLI verification (DevSpec side)

- [x] 9.1 Manually run `devspec next <slug> --json` against a DevSpec workspace and capture the actual JSON shape; confirm it matches `{ text: string; line: number }` (or note the actual shape for parse adjustment)
- [x] 9.2 If the JSON shape is incompatible or undocumented, file the divergence: either land a small DevSpec-side spec-lock change first, or fall back to parsing the human-readable output via regex (note this in alignment.md if it happens)

## 10. README touch-up

- [x] 10.1 If `README.md` lists features or commands, add the three new lifecycle commands (next, logDecision, completeTaskAtLine-via-CodeLens) and mention the eight new copy commands as a group
- [x] 10.2 Update any references to status bar content to mention the new `Δ` and `📋` segments
