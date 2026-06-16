## Why

The DevSpec CLI just gained a capability-spec system across two slices (`delta-specs-foundational` and `delta-specs-guards` in the DevSpec repo's `openspec/`). The new system introduces living per-capability specs under `.devspec/specs/<capability>/spec.md`, per-change deltas under `.devspec/projects/<slug>/deltas/<capability>/spec.md`, and the `/devspec:sync` workflow that merges deltas into the main spec. DevSpec also reorganised its Claude Code slash commands into a `/devspec:<verb>` namespace.

The VS Code extension (this repo, `vscode-devspec`) is the user's primary visual surface for DevSpec when they're editing code. After the CLI changes, the extension is missing:

- **No Capabilities view** — users have to read the filesystem to know what capabilities exist and whether any have pending deltas.
- **No delta status on the Changes tree** — users can't tell at a glance which active changes have pending capability deltas.
- **No `/devspec:sync` quick action** — the welcome view has copy buttons for other slash commands (`/devspec:onboard`, `/devspec:iterate`); sync deserves one too.
- **No CodeLens on delta files** — opening `deltas/<cap>/spec.md` should offer a one-click "preview sync" or "sync this delta" action, mirroring the contract.md / tasks.md CodeLens pattern.
- **No CodeLens on capability spec files** — opening `.devspec/specs/<cap>/spec.md` should surface "show contributing changes" so users can navigate to the deltas modifying this capability.

Separately, the existing copy commands in `extension.ts` and `commands.ts` (`copyIterate`, `copyReview`, `copyOnboard`, etc.) hard-code the old `/devspec-<verb>` flat syntax. After DevSpec's namespace migration, those commands produce strings that no longer match the slash commands actually shipped in workspaces. This is a real bug — fixing it is part of this change.

## What Changes

- **New tree view `devspec.capabilities`** in the activity bar's DevSpec panel, parallel to the existing Changes / Phase / Activity views. Lists every capability defined in the workspace via `devspec specs list --json`, with sync status (clean / dirty) and the change(s) responsible for any dirty state. Each capability entry is collapsible to show its current requirement headings (parsed from `.devspec/specs/<cap>/spec.md`).
- **Delta status indicator on Changes tree items** — each change item's description grows a delta-count badge (`Δ N` or similar) when the change has pending deltas. Clicking the change continues to open the change directory; the badge is informational.
- **New command `devspec.copySync`** registered in `extension.ts` and exposed as a welcome-view button on the new Capabilities view: copies `/devspec:sync <slug>` to clipboard. Mirrors the existing `devspec.copyOnboard` and `devspec.copyIterate` pattern.
- **CodeLens on delta files** (`*/deltas/<cap>/spec.md` under `.devspec/projects/`) — adds a lens above the file:
  - `▸ Preview merge with /devspec:sync <slug> --dry-run` — copies the dry-run slash command to clipboard
  - `✓ Sync this delta` — copies `/devspec:sync <slug>` to clipboard
- **CodeLens on capability spec files** (`.devspec/specs/<cap>/spec.md`) — adds a lens:
  - `Show contributing changes` — opens a quick-pick listing each in-flight change with a pending delta against this capability, navigating to the delta file when selected
  - `N current requirement(s)` — informational count
- **Welcome view text updates**:
  - `devspec.changes` welcome view: existing `/devspec-onboard` link updates to `/devspec:onboard` (consequence of the rename); add a one-liner mentioning the new Capabilities view if you've defined any
  - `devspec.activity` welcome view: existing `/devspec-iterate` link updates to `/devspec:iterate`
  - New `devspec.capabilities` welcome view: instructions on how to define a capability (`devspec specs init <name>`) and link to the DevSpec docs
- **Slash command syntax fix across the extension** — every `/devspec-<verb>` reference in `extension.ts`, `commands.ts`, `package.json` (welcome views + command titles), and any other source file updates to `/devspec:<verb>`. Includes the `copySlashCommand` arguments for iterate, review, coordinate, iterateAll, onboard.
- **`WorkspaceSnapshot` extension** — `src/workspace.ts` and `src/snapshot.ts` grow capability data: a `capabilities` array (each with `{ name, status: "clean" | "dirty", dirtyIn: string[] }`) and each `ChangeSummary` gets a `pendingDeltas` field (`string[]` of capability names with unsynced deltas). The snapshot calls `devspec specs list --json` and `devspec specs status --json` and merges the data.

## Capabilities

### New Capabilities

- `extension-capability-support`: the full set of VS Code extension surfaces that expose DevSpec's capability-spec model to the user — Capabilities tree view, delta status on the Changes tree, copy-sync command + welcome-view button, CodeLens on delta and capability spec files, welcome-view text updates, and the slash-command syntax fix that propagates DevSpec's namespace migration into the extension.

### Modified Capabilities

None. The extension currently has no OpenSpec specs (this is the first change in the repo's OpenSpec workflow), so there is nothing to MODIFY.

## Impact

**New source files**
- `src/views/capabilitiesTree.ts` — the new tree provider for the Capabilities view

**Modified source files**
- `src/workspace.ts` — extend `ChangeSummary` with `pendingDeltas: string[]`; add `CapabilitySummary` interface and `capabilities: CapabilitySummary[]` on `WorkspaceSnapshot`
- `src/snapshot.ts` — call `devspec specs list --json` and `devspec specs status --json`; merge into snapshot
- `src/extension.ts` — register the new tree provider, register `devspec.copySync` command, register CodeLens for delta + capability spec file patterns, update existing copy commands to `/devspec:` syntax
- `src/views/changesTree.ts` — add delta-count description segment to each change item; include `pendingDeltas` count in tooltip
- `src/providers/codeLens.ts` — extend to recognise delta files and capability spec files, emit appropriate lenses
- `src/commands.ts` — `copySlashCommandCommand` keeps current shape but the template strings update to `/devspec:<verb>` form
- `package.json` — register the new view in `contributes.views.devspec`, add the `devspec.copySync` command, add a welcome view for `devspec.capabilities`, update existing welcome views and command titles to `/devspec:<verb>` form

**Tests**
- The repo has `vitest` configured but no tests under `src/` yet (`npm test` runs `vitest run` against an empty test set). This change adds a smoke test for snapshot capability parsing and the CodeLens file-pattern matching where pure functions allow it. VS Code API mocking is out of scope.

**Backward compatibility**
- DevSpec is pre-ship; the extension is also pre-ship (`v0.0.6`, never published to a marketplace). The slash-command syntax change is observable in the sense that copied-to-clipboard text changes form, but no user workflow breaks because the matching DevSpec CLI also migrated.
- The new Capabilities view appears only when the user opens a workspace whose `.devspec/specs/` directory has at least one capability defined. Workspaces with no capabilities see the welcome view with init instructions. No existing functionality regresses.

**Out of scope** (genuinely separate work)
- Diagnostics on bad delta format — the `delta-format` coherence rule from `delta-specs-guards` is what produces the findings; the existing `CoherenceDiagnostics` provider in `src/providers/diagnostics.ts` already surfaces coherence findings into the Problems panel without modification, so delta-format findings will appear automatically. No explicit work required here.
- Capability layer in the map webview — the DevSpec CLI's `devspec map` ships L1.5 capability index + drill-downs as markdown files under `.devspec/maps/capabilities/`. The existing `MapWebviewManager` renders the directory it's pointed at; the new capability map files will surface automatically. No explicit work required here either.
- Drag-to-sync interactions in the new Capabilities tree — gestures beyond the basic tree are out of scope.
- Webview-style Capabilities dashboard — only the tree view is in scope. A future enhancement could add a richer interactive webview parallel to the board webview.
