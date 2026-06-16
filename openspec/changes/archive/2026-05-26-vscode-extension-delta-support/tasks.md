## 1. Snapshot data extension

- [x] 1.1 Extend `WorkspaceSnapshot` in `src/workspace.ts` with `capabilities: CapabilitySummary[]` and add the `CapabilitySummary` interface (`{ name: string; status: "clean" | "dirty"; dirtyIn: string[] }`)
- [x] 1.2 Extend `ChangeSummary` in `src/workspace.ts` with `pendingDeltas: string[]`
- [x] 1.3 In `src/snapshot.ts`, add a `devspec specs list --json` call; parse the JSON; populate `snapshot.capabilities`; tolerate non-zero exit (set to empty array)
- [x] 1.4 In `src/snapshot.ts`, iterate active changes and call `devspec specs status <slug> --json` per change; populate each `ChangeSummary.pendingDeltas`; tolerate non-zero exit (set to empty array)
- [x] 1.5 Initialise `pendingDeltas: []` in `mapChange()` so the field is always present
- [x] 1.6 Verify the snapshot fallback paths (CLI absent, JSON parse error) leave the new fields as empty arrays

## 2. Capabilities tree view

- [x] 2.1 Create `src/views/capabilitiesTree.ts` exporting `CapabilitiesTreeProvider implements vscode.TreeDataProvider<CapabilityNode>`; follow the pattern of `src/views/changesTree.ts`
- [x] 2.2 Define `CapabilityNode` discriminated union: `{ kind: "capability"; capability: CapabilitySummary }` and `{ kind: "requirement"; capability: string; name: string }` and `{ kind: "empty"; message: string }`
- [x] 2.3 Implement `refresh(snapshot)`, `getTreeItem(node)`, `getChildren(node?)` — capability items collapsible, requirement items leaf
- [x] 2.4 For requirement extraction, parse each capability's `.devspec/specs/<cap>/spec.md` for `### Requirement: <name>` headings (lazy: do it inside `getChildren` when a capability is expanded)
- [x] 2.5 Show dirty status in the item's description (e.g. `dirty · cancel-booking, billing`) and use a meaningful ThemeIcon (e.g. `circle-large-filled` for clean, `circle-large-outline` for dirty, or `symbol-class` / `package` for capabilities generically)
- [x] 2.6 Register the provider in `src/extension.ts`: instantiate alongside the existing tree providers, register via `vscode.window.registerTreeDataProvider("devspec.capabilities", capabilitiesProvider)`, and call `capabilitiesProvider.refresh(snapshot)` in the refresh function

## 3. Changes tree delta indicator

- [x] 3.1 In `src/views/changesTree.ts`, extend the `change`-kind branch of `getTreeItem` to append a delta-count segment to the description when `c.pendingDeltas.length > 0` (e.g. `Δ${count}`)
- [x] 3.2 Extend the tooltip MarkdownString to include a line listing pending capability names when present (e.g. `- Pending deltas: user-auth, billing (2)`)
- [x] 3.3 Manually verify against a workspace with pending deltas that the badge appears and tooltip lists capabilities

## 4. CodeLens extensions

- [x] 4.1 Add `isDeltaSpecFile(p: string): boolean` helper in `src/providers/codeLens.ts` checking the path matches `.devspec/projects/<slug>/deltas/<cap>/spec.md` (use path segments)
- [x] 4.2 Add `isCapabilitySpecFile(p: string): boolean` helper checking `.devspec/specs/<cap>/spec.md`
- [x] 4.3 Extend `provideCodeLenses(document)` to dispatch to new methods `deltaSpecLenses` and `capabilitySpecLenses` when those checks match
- [x] 4.4 Implement `deltaSpecLenses(document)`: extract slug from path (`projects/<slug>/deltas/...`), emit two lenses — one calling `devspec.copySlashCommand` with `/devspec:sync <slug> --dry-run` ("Preview merge"), one calling `devspec.copySlashCommand` with `/devspec:sync <slug>` ("Sync this delta")
- [x] 4.5 Implement `capabilitySpecLenses(document)`: count `### Requirement:` headings in the document, emit a count lens; emit a "Show contributing changes" lens calling a new command `devspec.showContributingChanges` with the capability name (extracted from path)
- [x] 4.6 In `src/extension.ts`, register two new `CodeLensProvider` selectors for the new patterns:
  - `{ language: "markdown", pattern: "**/.devspec/projects/*/deltas/*/spec.md" }`
  - `{ language: "markdown", pattern: "**/.devspec/specs/*/spec.md" }`
- [x] 4.7 Implement `devspec.showContributingChanges` command in `src/commands.ts`: take a capability name, read the current snapshot, find active changes with `pendingDeltas` containing the capability, show a `vscode.window.showQuickPick` listing them, on selection open the corresponding delta file via `vscode.window.showTextDocument`
- [x] 4.8 Register the new command in `src/extension.ts` and add the command entry to `package.json` (hidden from command palette via `when: false`)

## 5. Copy-sync command

- [x] 5.1 Add `devspec.copySync` command registration in `src/extension.ts` following the `copyIterate` pattern: takes optional context arg, extracts slug if present, calls `copySlashCommandCommand("/devspec:sync <slug>", slug)`
- [x] 5.2 Add the command entry to `package.json` with title `DevSpec: Copy /devspec:sync (sync capability deltas)` and a meaningful icon (e.g. `$(sync)`)
- [x] 5.3 Add a context-menu entry under `view/item/context` for the changes view (so right-click on a change → "Copy /devspec:sync …")
- [x] 5.4 Add the command to the changes welcome view content (or activity-view welcome) as a button

## 6. Slash command syntax migration

- [x] 6.1 In `src/extension.ts`, update existing `copyIterate` / `copyReview` / `copyCoordinate` / `copyIterateAll` / `copyOnboard` template strings from `/devspec-<verb>` to `/devspec:<verb>`
- [x] 6.2 In `src/commands.ts`, scan for any hard-coded `/devspec-<verb>` references and update
- [x] 6.3 In `package.json`:
  - `contributes.viewsWelcome[*].contents` — replace `/devspec-onboard`, `/devspec-iterate` references with `/devspec:onboard`, `/devspec:iterate`
  - `contributes.commands[*].title` — replace command titles like `Copy /devspec-iterate for this change` with `/devspec:iterate`
- [x] 6.4 Run `grep -rE "/devspec-[a-z]" src package.json` and verify zero results

## 7. New `devspec.initCapability` command

- [x] 7.1 Implement `initCapabilityCommand(refresh)` in `src/commands.ts`: prompt via `vscode.window.showInputBox` with regex validator `/^[a-z][a-z0-9-]*$/`, on confirm shell out to `runDevspec(["specs", "init", name], root)`, show info/error message, call `refresh()` on success
- [x] 7.2 Register the command in `src/extension.ts`
- [x] 7.3 Add the command entry to `package.json` with title `DevSpec: Initialise capability…` and icon `$(symbol-class)`

## 8. Capabilities view welcome content

- [x] 8.1 Add a `viewsWelcome` entry to `package.json` keyed to `devspec.capabilities`:
  ```
  **No capabilities defined yet.**

  Capabilities are living specs of what the system promises (e.g. user-auth, billing). Each lives at .devspec/specs/<name>/spec.md and is edited by per-change deltas.

  [Initialise capability…](command:devspec.initCapability)
  [Copy /devspec:explore](command:devspec.copyExplore)
  ```
- [x] 8.2 Add `devspec.copyExplore` command in `src/extension.ts` for the welcome view button — copies `/devspec:explore` to clipboard
- [x] 8.3 Add the corresponding command entry to `package.json`

## 9. Package.json contribute updates

- [x] 9.1 Add the new view `devspec.capabilities` to `contributes.views.devspec`:
  ```
  { "id": "devspec.capabilities", "name": "Capabilities", "type": "tree" }
  ```
- [x] 9.2 Confirm the existing `viewsContainers` entry remains unchanged
- [x] 9.3 Verify the menus block remains consistent — view/title menus for the Capabilities view need at least a refresh icon

## 10. Build, typecheck, smoke

- [x] 10.1 Run `npm run typecheck` — confirm zero errors
- [x] 10.2 Run `npm run build` — confirm clean build
- [x] 10.3 Run `npm test` — confirm vitest runs cleanly (no test failures, even if no tests exist for the new code)
- [x] 10.4 Package via `npm run package` to produce `vscode-devspec-<version>.vsix`; smoke check that the package builds without error

## 11. Documentation

- [x] 11.1 If `README.md` references the old slash command syntax, update to `/devspec:<verb>` form
- [x] 11.2 If `README.md` mentions the views, add a brief mention of the new Capabilities view (one bullet under "What's in the sidebar" or equivalent)
