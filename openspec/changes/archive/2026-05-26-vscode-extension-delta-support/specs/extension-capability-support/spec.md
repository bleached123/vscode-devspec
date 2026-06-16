## ADDED Requirements

### Requirement: Capabilities tree view registered

The extension SHALL register a tree view with id `devspec.capabilities` inside the existing DevSpec activity bar panel, parallel to the existing Changes, Phase, and Activity views.

#### Scenario: View appears in the activity bar panel

- **WHEN** the extension is loaded into VS Code and the DevSpec activity bar icon is selected
- **THEN** four tree sections are visible — Changes, Phase & gates, Agent activity, and Capabilities

#### Scenario: Welcome message shown when no capabilities exist

- **WHEN** the workspace's `.devspec/specs/` directory is empty or absent
- **THEN** the Capabilities view renders the welcome content describing how to initialise a capability and providing a quick-action button

### Requirement: Capabilities view lists workspace capabilities with sync status

The extension SHALL list every capability defined in the workspace under the Capabilities view, with each entry showing the capability name and its dirty/clean sync status as reported by `devspec specs list --json`.

#### Scenario: Each capability has an item

- **WHEN** the workspace defines two capabilities `user-auth` and `billing` (both present under `.devspec/specs/`)
- **THEN** the Capabilities view shows two collapsible items, `user-auth` and `billing`

#### Scenario: Dirty status indicated by description text

- **WHEN** an in-flight change has unsynced deltas against capability `user-auth`
- **THEN** the `user-auth` item's description reports the change slug as the source of dirty state (e.g. "dirty · cancel-booking")

### Requirement: Capability item is collapsible to show requirements

The extension SHALL allow each capability item to be expanded to reveal the requirement headings parsed from `.devspec/specs/<capability>/spec.md`.

#### Scenario: Expanded item lists requirements

- **WHEN** the user expands the `user-auth` item and the main spec contains two `### Requirement:` headings (`Session storage`, `Password reset`)
- **THEN** the tree shows two child items named after each requirement

### Requirement: Changes tree shows pending-delta indicator

The extension SHALL extend the Changes tree's per-change item description to include a count of pending capability deltas when the change has any.

#### Scenario: Change with pending deltas shows count

- **WHEN** an active change `cancel-booking` has unsynced deltas against `user-auth` and `billing`
- **THEN** the change item's description includes a delta-count segment (e.g. `Δ2`) in addition to the existing `<done>/<total>` stage count and drift label

#### Scenario: Change without pending deltas has no count

- **WHEN** an active change has no pending deltas
- **THEN** the change item's description does not include the delta-count segment

#### Scenario: Tooltip lists pending delta capability names

- **WHEN** a change has pending deltas against `user-auth` and `billing`
- **THEN** hovering the change item shows a tooltip line naming both capabilities

### Requirement: Copy `/devspec:sync` slash command available

The extension SHALL register a command `devspec.copySync` that copies a `/devspec:sync` slash command template to the clipboard, with optional change-slug substitution mirroring the existing `devspec.copyIterate` / `devspec.copyReview` commands.

#### Scenario: Command copies generic template when invoked without context

- **WHEN** the user invokes `devspec.copySync` via the command palette without a change slug context
- **THEN** the clipboard contains `/devspec:sync <slug>` (literal placeholder for the user to replace)

#### Scenario: Command copies slug-substituted template when invoked from a change item

- **WHEN** the user invokes `devspec.copySync` from a Changes-tree item's context menu for change `cancel-booking`
- **THEN** the clipboard contains `/devspec:sync cancel-booking`

### Requirement: CodeLens on delta files

The extension SHALL surface a CodeLens above the first line of any file matching `.devspec/projects/*/deltas/*/spec.md`, offering quick-copy actions for the sync dry-run and the live sync slash commands.

#### Scenario: Delta file shows preview and sync lenses

- **WHEN** the user opens `.devspec/projects/cancel-booking/deltas/user-auth/spec.md`
- **THEN** at least two CodeLens entries appear above the file: one labelled with "preview" / "dry-run" and one labelled with "sync this delta", each invoking the existing `devspec.copySlashCommand` command with the appropriate template

#### Scenario: CodeLens disabled when codeLens.enabled is false

- **WHEN** the user sets `devspec.codeLens.enabled` to `false` in settings and opens a delta file
- **THEN** no CodeLens entries are shown (consistent with existing CodeLens-disabled behaviour for contract.md / tasks.md)

### Requirement: CodeLens on capability spec files

The extension SHALL surface a CodeLens above the first line of any file matching `.devspec/specs/*/spec.md` showing the requirement count and offering a "Show contributing changes" action.

#### Scenario: Capability spec file shows requirement count

- **WHEN** the user opens `.devspec/specs/user-auth/spec.md` with three `### Requirement:` headings
- **THEN** a CodeLens entry above the file reads `▸ 3 current requirement(s)` (or equivalent)

#### Scenario: Show contributing changes lens lists active deltas

- **WHEN** the user invokes the "Show contributing changes" CodeLens action on `user-auth/spec.md` and active change `cancel-booking` has a pending delta against `user-auth`
- **THEN** a quick-pick appears listing `cancel-booking` (and any other contributing changes); selecting an entry opens the corresponding delta file

### Requirement: Welcome view links use the new `/devspec:` syntax

The extension SHALL render all welcome-view command links using the namespaced `/devspec:<verb>` slash-command form rather than the legacy flat `/devspec-<verb>` form.

#### Scenario: changes-view welcome uses /devspec:onboard

- **WHEN** the user opens the DevSpec panel in a workspace with no active changes
- **THEN** the welcome content renders a link to copy `/devspec:onboard` (not `/devspec-onboard`)

#### Scenario: activity-view welcome uses /devspec:iterate

- **WHEN** the user opens the Agent activity view with no logged decisions
- **THEN** the welcome content renders a link to copy `/devspec:iterate` (not `/devspec-iterate`)

### Requirement: Copy slash command templates use the new `/devspec:` syntax

The extension SHALL produce slash-command clipboard payloads using the namespaced `/devspec:<verb>` form for all existing copy commands (`copyIterate`, `copyReview`, `copyCoordinate`, `copyIterateAll`, `copyOnboard`) and any new copy commands introduced in this change.

#### Scenario: copyIterate clipboard payload uses new syntax

- **WHEN** the user invokes the `devspec.copyIterate` command for change `cancel-booking`
- **THEN** the clipboard contains `/devspec:iterate cancel-booking` (not `/devspec-iterate cancel-booking`)

#### Scenario: copyOnboard clipboard payload uses new syntax

- **WHEN** the user invokes `devspec.copyOnboard` from any context
- **THEN** the clipboard contains `/devspec:onboard`

### Requirement: WorkspaceSnapshot carries capability data

The extension SHALL extend `WorkspaceSnapshot` (in `src/workspace.ts`) to include a `capabilities: CapabilitySummary[]` field and each `ChangeSummary` to include a `pendingDeltas: string[]` field; `buildSnapshot()` (in `src/snapshot.ts`) SHALL populate both by invoking `devspec specs list --json` and `devspec specs status --json` (per change).

#### Scenario: Snapshot reports capabilities when CLI returns data

- **WHEN** `devspec specs list --json` returns `[{ "capability": "user-auth", "status": "clean", "changes": [] }]`
- **THEN** `snapshot.capabilities` is an array containing `{ name: "user-auth", status: "clean", dirtyIn: [] }`

#### Scenario: Snapshot reports per-change pending deltas

- **WHEN** active change `cancel-booking` has pending deltas against `user-auth` (via `devspec specs status cancel-booking --json` returning `[{ "slug": "cancel-booking", "pending": ["user-auth"], "synced": [] }]`)
- **THEN** the matching `ChangeSummary` has `pendingDeltas: ["user-auth"]`

#### Scenario: Snapshot tolerates missing specs subcommand

- **WHEN** the workspace uses a `devspec` CLI version that does not support the `specs` subcommand (non-zero exit from `devspec specs list --json`)
- **THEN** `snapshot.capabilities` is an empty array and every `ChangeSummary.pendingDeltas` is an empty array — no exception thrown, snapshot still usable

### Requirement: New initCapability command

The extension SHALL register a command `devspec.initCapability` that prompts the user for a capability name (validating lowercase kebab-case), runs `devspec specs init <name>`, and refreshes the snapshot on success.

#### Scenario: Command rejects invalid name

- **WHEN** the user invokes `devspec.initCapability` and enters `User_Auth`
- **THEN** the input box rejects the input with a message about kebab-case

#### Scenario: Command runs CLI and refreshes on success

- **WHEN** the user invokes `devspec.initCapability` and enters `billing`
- **THEN** the extension shells out to `devspec specs init billing`, shows an informational message on success, and triggers a snapshot refresh causing the Capabilities view to re-render with the new capability
