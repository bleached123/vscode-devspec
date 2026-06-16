## ADDED Requirements

### Requirement: Tasks.md CodeLens is clickable to mark complete

The extension SHALL make each unchecked-task CodeLens in `tasks.md` a clickable command that invokes the underlying `devspec complete <slug> <task-text> --line <N>` shell-out.

#### Scenario: Lens click marks task complete

- **WHEN** a user opens `.devspec/projects/cancel-booking/tasks.md` and clicks the CodeLens above an unchecked task at line 5 with text "Implement validation"
- **THEN** the extension invokes `devspec complete cancel-booking "Implement validation" --line 5`, the task's checkbox flips to `[x]`, and the CodeLens disappears for that task

#### Scenario: Lens labels reflect clickable affordance

- **WHEN** the user opens a `tasks.md` file with at least one unchecked task
- **THEN** the lens text reads "Mark complete" (or equivalent action-oriented label), not the pre-change passive label "pending — devspec next shows the first one"

### Requirement: devspec.next command surfaces the first pending task

The extension SHALL register a command `devspec.next` that runs `devspec next <slug>` for the inferred or selected change and shows the result in an information notification with two action buttons: open tasks.md at the task line, and mark the task complete.

#### Scenario: Next command shows notification with actions

- **WHEN** a user invokes `devspec.next` with the cursor in a file under `.devspec/projects/cancel-booking/` and the change has at least one pending task
- **THEN** an information message displays the task text and offers two buttons: "Open tasks.md" and "Mark complete"

#### Scenario: Open tasks.md action opens the file at the task line

- **WHEN** the user clicks "Open tasks.md" from the notification
- **THEN** `tasks.md` opens in the editor with the cursor on the task line (1-based)

#### Scenario: Mark complete action invokes completeTaskAtLine

- **WHEN** the user clicks "Mark complete" from the notification
- **THEN** the extension invokes the internal `devspec.completeTaskAtLine` command with the slug, line, and task text from the next-result

#### Scenario: No pending tasks shows informational message

- **WHEN** `devspec.next` is invoked against a change with zero pending tasks
- **THEN** the notification reads "No pending tasks in <slug>." (or equivalent) and contains no action buttons

### Requirement: devspec.logDecision command appends to alignment.md

The extension SHALL register a command `devspec.logDecision` that prompts the user for a decision string and an optional reason, then runs `devspec log <slug> "<decision>" [--because "<reason>"]`.

#### Scenario: User provides only the decision

- **WHEN** the user invokes `devspec.logDecision` for change `cancel-booking`, types "Approved partial refund policy" in the first input, and leaves the reason input blank
- **THEN** the extension runs `devspec log cancel-booking "Approved partial refund policy"` (no `--because` flag), and the decision appears appended to `.devspec/projects/cancel-booking/alignment.md`

#### Scenario: User provides decision and reason

- **WHEN** the user provides decision "Switch to PostgreSQL" and reason "MySQL replication too slow for our SLO"
- **THEN** the extension runs `devspec log cancel-booking "Switch to PostgreSQL" --because "MySQL replication too slow for our SLO"`

#### Scenario: Slug inferred from active editor

- **WHEN** the user invokes `devspec.logDecision` while a file under `.devspec/projects/cancel-booking/` is the active editor and there is no context-menu slug provided
- **THEN** the slug `cancel-booking` is used without further prompting

#### Scenario: Slug picked when none can be inferred

- **WHEN** the user invokes `devspec.logDecision` from the command palette with no slug-bearing context
- **THEN** the extension shows a quick-pick of active change slugs; the selection becomes the slug

#### Scenario: User cancels at any step

- **WHEN** the user presses Escape at the decision input
- **THEN** the command exits silently without running any CLI

### Requirement: Eight new copy commands close the slash-command surface

The extension SHALL register copy-to-clipboard commands for every DevSpec slash command currently lacking one: `copyNew`, `copyContinue`, `copyVerify`, `copyArchive`, `copyGrill`, `copyTriage`, `copyUatDesign`, `copyRefreshStandards`.

#### Scenario: copyNew copies the new template

- **WHEN** the user invokes `devspec.copyNew`
- **THEN** the clipboard contains `/devspec:new <title>` (with `<title>` as a literal placeholder)

#### Scenario: copyContinue substitutes slug from context

- **WHEN** the user right-clicks change `cancel-booking` in the changes tree and invokes "Copy /devspec:continue"
- **THEN** the clipboard contains `/devspec:continue cancel-booking`

#### Scenario: copyVerify substitutes slug from context

- **WHEN** the user invokes `devspec.copyVerify` from a change-tree item for `cancel-booking`
- **THEN** the clipboard contains `/devspec:verify cancel-booking`

#### Scenario: copyArchive substitutes slug from context

- **WHEN** the user invokes `devspec.copyArchive` from a change-tree item for `cancel-booking`
- **THEN** the clipboard contains `/devspec:archive cancel-booking`

#### Scenario: copyGrill infers stage from active editor

- **WHEN** the user invokes `devspec.copyGrill` while the active editor is `.devspec/projects/cancel-booking/design.md`
- **THEN** the clipboard contains `/devspec:grill design cancel-booking`

#### Scenario: copyGrill falls back to template when no stage context

- **WHEN** the user invokes `devspec.copyGrill` with no stage-doc editor active
- **THEN** the clipboard contains `/devspec:grill <stage> <slug>` (literal placeholders)

#### Scenario: Workspace-scoped copy commands take no arguments

- **WHEN** the user invokes `devspec.copyTriage`, `devspec.copyUatDesign`, or `devspec.copyRefreshStandards`
- **THEN** the clipboard contains `/devspec:triage`, `/devspec:uat-design`, or `/devspec:refresh-standards` respectively (no slug substitution)

### Requirement: Status bar shows pending-delta count when any change has pending deltas

The extension SHALL append a `Δ<N>` segment to the status bar item's text whenever at least one active change has pending capability-spec deltas, where `<N>` is the total count across all active changes.

#### Scenario: Status bar shows Δ when pending deltas exist

- **WHEN** active changes `cancel-booking` and `add-feature` have 2 and 1 pending deltas respectively
- **THEN** the status bar item's text contains the segment `Δ3`

#### Scenario: No Δ segment when no pending deltas

- **WHEN** no active change has any pending deltas
- **THEN** the status bar item's text does not contain a `Δ` segment

### Requirement: Status bar shows next-task summary for the single in-progress change

The extension SHALL append a truncated next-task summary to the status bar item's text when exactly one in-progress change has a `nextTask` value, truncating the task text at 30 characters with an ellipsis.

#### Scenario: Single in-progress change with next task

- **WHEN** exactly one active change has a `nextTask` value with text "Implement cancellation policy validation"
- **THEN** the status bar item's text contains a segment like `📋 Implement cancellation polic…` (or equivalent truncation)

#### Scenario: Multiple in-progress changes suppress the next-task segment

- **WHEN** two or more active changes have `nextTask` values
- **THEN** the status bar item's text does not contain the next-task segment (existing change-count segment is sufficient to convey "you have work")

#### Scenario: Tooltip includes detailed pending state

- **WHEN** the status bar item is hovered
- **THEN** the tooltip shows the workspace phase, active-change count, pending-delta breakdown by capability, and the next-task text + slug when present

### Requirement: WorkspaceSnapshot carries next-task data per change

The extension SHALL extend `ChangeSummary` (in `src/workspace.ts`) with an optional `nextTask: { text: string; line: number } | null` field, and `buildSnapshot()` (in `src/snapshot.ts`) SHALL populate it by invoking `devspec next <slug> --json` per active change.

#### Scenario: Snapshot includes next task when one exists

- **WHEN** `devspec next cancel-booking --json` returns `{ "slug": "cancel-booking", "task": { "text": "Implement validation", "line": 5, "checked": false }, "done": false, "totalTasks": 7 }`
- **THEN** the matching `ChangeSummary` has `nextTask: { text: "Implement validation", line: 5 }` (extension extracts `task.text` and `task.line` from the nested payload)

#### Scenario: Snapshot has null nextTask when none exists

- **WHEN** `devspec next <slug> --json` returns no pending-task result (empty body or non-zero exit)
- **THEN** the matching `ChangeSummary` has `nextTask: null`

#### Scenario: Snapshot tolerates malformed JSON

- **WHEN** `devspec next <slug> --json` returns output that fails JSON parsing
- **THEN** the matching `ChangeSummary` has `nextTask: null` and no exception propagates

### Requirement: Right-click context menu adds new lifecycle and copy entries

The extension SHALL add the following commands to the changes-tree right-click context menu: `devspec.next`, `devspec.logDecision`, `devspec.copyContinue`, `devspec.copyVerify`, `devspec.copyArchive`. These appear in addition to the existing `coherence`, `copyIterate`, `copyReview`, `copyIterateAll`, `copyCoordinate`, `copySync` entries.

#### Scenario: New entries appear on right-click

- **WHEN** the user right-clicks an active change item in the Changes tree
- **THEN** the context menu includes entries for "Next task", "Log decision", "Copy /devspec:continue", "Copy /devspec:verify", and "Copy /devspec:archive"

#### Scenario: copyNew is NOT on the change-item context menu

- **WHEN** the user right-clicks an active change item
- **THEN** "Copy /devspec:new" is not in the context menu (it has no slug-scoped context)

### Requirement: Internal completeTaskAtLine command is hidden from the command palette

The extension SHALL hide the internal command `devspec.completeTaskAtLine` from the VS Code command palette via the `commandPalette` menu's `when: false` clause, since it is only meaningful when invoked from a tasks.md CodeLens with line + slug arguments.

#### Scenario: Command palette does not list completeTaskAtLine

- **WHEN** the user opens the VS Code command palette and types "DevSpec"
- **THEN** "DevSpec: completeTaskAtLine" (or equivalent) does not appear in the results

#### Scenario: All other new commands ARE palette-visible

- **WHEN** the user opens the command palette and types "DevSpec"
- **THEN** entries for `devspec.next`, `devspec.logDecision`, and each of the eight new copy commands appear in the results
