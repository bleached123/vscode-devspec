## ADDED Requirements

### Requirement: Orb panel can be opened

The extension SHALL contribute a command that opens a webview panel rendering the
animated orb, and SHALL offer an entry point to it from the existing Agent
activity view.

#### Scenario: Command opens the orb

- **WHEN** the user runs the "DevSpec: Open Claude orb" command from the command palette
- **THEN** a webview panel opens displaying the animated orb

#### Scenario: Entry point from Agent activity

- **WHEN** the user activates the launch action on the Agent activity view
- **THEN** the orb panel opens (or is revealed if already open)

### Requirement: Orb visualizes Claude's session state

The orb SHALL render distinct visual states for *idle*, *thinking*, *working*
(a tool is running), and *speaking*, and SHALL transition between them in
response to the live state of the active Claude Code session.

#### Scenario: Idle when no activity

- **WHEN** the active session has produced no new events for the idle threshold
- **THEN** the orb renders its idle (slow "breathing") state

#### Scenario: Speaking state while voicing a message

- **WHEN** the orb is speaking a new assistant message
- **THEN** the orb renders its speaking state for the duration of that utterance

#### Scenario: Working state while a tool runs

- **WHEN** the active session's latest assistant turn contains a tool-use block that has not yet produced a result
- **THEN** the orb renders its working state

### Requirement: Active session transcript is discovered and watched

The extension SHALL locate the Claude Code session transcript for the current
workspace under the per-project transcripts directory, select the most recently
modified session when several exist, watch it for appended events, and re-point
to a newer session if one appears.

#### Scenario: Most recent session is chosen

- **WHEN** the workspace's transcripts directory contains multiple session files
- **THEN** the extension watches the session file with the most recent modification time

#### Scenario: Follows a newly started session

- **WHEN** a new session file appears in the transcripts directory while the orb is open
- **THEN** the extension switches to watching the new session

#### Scenario: No transcript present

- **WHEN** no transcript exists for the current workspace
- **THEN** the orb renders its idle state and surfaces no error

### Requirement: Only new assistant prose is spoken

From the moment voicing is activated, the extension SHALL speak only assistant
text produced after that point, and SHALL NOT read previously existing
transcript history. The extension SHALL exclude `thinking` blocks, `tool_use`
blocks, and `tool_result` content from spoken output.

#### Scenario: Backlog is not read on activation

- **WHEN** voicing is activated on a session that already contains prior assistant messages
- **THEN** none of the pre-existing messages are spoken

#### Scenario: New assistant message is spoken

- **WHEN** a new assistant text message is appended to the watched transcript while voicing is active
- **THEN** the extension speaks that message's prose

#### Scenario: Internal blocks are skipped

- **WHEN** a new assistant turn contains thinking and tool-use blocks alongside prose
- **THEN** only the prose is spoken and the thinking and tool-use content is not

### Requirement: Spoken text is speech-friendly

The extension SHALL convert assistant markdown into speech-friendly text before
speaking it: formatting markers (e.g. emphasis, headings, list bullets) MUST NOT
be spoken literally, and fenced code blocks MUST be omitted or announced rather
than read character-by-character.

#### Scenario: Formatting markers are not spoken

- **WHEN** an assistant message contains bold, italic, headings, or list markup
- **THEN** the spoken output contains the readable words without speaking the markup characters

#### Scenario: Code fences are not read aloud verbatim

- **WHEN** an assistant message contains a fenced code block
- **THEN** the code block is either omitted from speech or replaced by a short spoken announcement

### Requirement: Speech is produced offline

The extension SHALL speak assistant prose using an offline text-to-speech path
that requires no API key and no network access for its default configuration.

#### Scenario: Speaks without network or key

- **WHEN** voicing is active and the machine has no configured TTS API key and no network access
- **THEN** assistant prose is still spoken aloud

### Requirement: Orb animation is synchronized to speech

While speaking, the orb SHALL animate in time with the speech cadence, advancing
its pulse as words are spoken and returning to a non-speaking state when the
utterance ends.

#### Scenario: Pulse tracks words

- **WHEN** an utterance is being spoken
- **THEN** the orb's pulse advances as successive words are voiced

#### Scenario: Settles when speech ends

- **WHEN** an utterance finishes
- **THEN** the orb leaves the speaking state

### Requirement: Orb colour follows the active theme

The orb SHALL derive its colour palette from the active VS Code colour theme, and
SHALL update its palette when the user changes the theme without requiring a
reload.

#### Scenario: Palette matches theme on open

- **WHEN** the orb panel is opened under a given colour theme
- **THEN** the orb's colours are derived from that theme

#### Scenario: Re-themes on theme change

- **WHEN** the user switches to a different colour theme while the orb is open
- **THEN** the orb updates its colours to match the new theme

### Requirement: Orb orients toward the discussed code or cursor

The orb SHALL indicate attention by orienting toward a focus target — the code
location under discussion when one can be determined, otherwise the current
editor cursor position — and SHALL update that orientation as the focus target
changes.

#### Scenario: Orients to the cursor

- **WHEN** there is an active text editor and no more specific focus target
- **THEN** the orb orients toward the editor's cursor position

#### Scenario: Updates as focus moves

- **WHEN** the focus target changes (the cursor moves or a different code location becomes the subject)
- **THEN** the orb updates its orientation toward the new target

### Requirement: Voicing is opt-in and controllable

Speaking SHALL be opt-in and off by default; the extension MUST provide controls
to enable/disable voicing, stop the current utterance, and adjust voice settings
(at least rate and voice selection). When voicing is disabled or muted, the orb
SHALL continue to visualize session state without speaking.

#### Scenario: Off by default

- **WHEN** the extension is installed and the orb is opened without the user enabling voicing
- **THEN** no assistant prose is spoken

#### Scenario: Stop halts current speech

- **WHEN** the user invokes the stop control while an utterance is being spoken
- **THEN** speech stops promptly

#### Scenario: Muted orb still shows state

- **WHEN** voicing is disabled but the orb panel is open
- **THEN** the orb still reflects the session's thinking/working/idle state

### Requirement: Transcript content stays local

The extension SHALL process transcript content only locally; transcript text MUST
NOT be transmitted off the machine by the default offline path.

#### Scenario: No transcript egress on the offline path

- **WHEN** voicing runs on the default offline path
- **THEN** no transcript content is sent over the network
