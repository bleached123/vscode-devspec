## Context

The vscode-devspec extension is a thin presentation layer over the `devspec`
CLI and integrates with Claude Code only in a *write-only, blind* way today — it
focuses the panel and writes slash commands to the clipboard. There is **no
public Claude Code API to read assistant responses**.

The viable seam is the Claude Code session transcript. Each session writes an
append-only JSONL file under `~/.claude/projects/<encoded-workspace>/<uuid>.jsonl`.
A structure-only inspection of a real transcript confirmed:

- Every line is a **complete JSON event** (not a streamed delta), tagged with a
  top-level `type` (`assistant`, `user`, `tool`/`tool_result`, snapshots, etc.).
- Assistant lines carry `message.content[]` of typed blocks:
  `text`, `thinking` (carries a `signature` — encrypted), `tool_use`; tool
  results arrive on user-role lines as `tool_result` blocks.
- Useful top-level fields: **`cwd`** (the session's working directory),
  `timestamp`, `uuid`, `parentUuid`, `sessionId`, `requestId`, `version`, and the
  flags **`isSidechain`** (subagent traffic) and **`isMeta`**.

The extension already has the infrastructure this feature needs: a two-context
esbuild build (extension host + webview bundles) and two existing webview
managers (`mapWebview.ts`, `boardWebview.ts`) to model the orb webview on. An
**Agent activity** tree view already exists; this feature is positioned as its
living visual successor.

See [proposal.md](proposal.md) for motivation and
[specs/claude-voice-orb/spec.md](specs/claude-voice-orb/spec.md) for the
normative requirements this design satisfies.

## Goals / Non-Goals

**Goals:**

- Speak new assistant prose **offline**, no API key, no network, by default.
- An ambient **orb** webview with idle / thinking / working / speaking states,
  driven by the live transcript.
- Orb colour follows the active VS Code theme; orb orients toward a focus target
  (discussed code or cursor).
- Voicing is **opt-in**; the orb still visualizes state when muted.
- Reuse the existing webview + esbuild patterns; add no required runtime deps for
  the offline path.

**Non-Goals:**

- Cloud / premium voices (ElevenLabs, OpenAI). Designed-for as a later tiered
  upgrade, but out of scope here.
- Speech-to-text / voicing the user, or sending input back to Claude.
- Reading code blocks aloud verbatim.
- Voicing multiple sessions simultaneously, or sidechain/subagent traffic.
- A literal spatial eye-tracking of editor pixels (see gaze decision).

## Decisions

### D1 — Text source: tail the session JSONL

Watch the active session transcript and react to appended events. Alternatives:
a Claude Code extension API (**does not exist**); scraping the chat UI (no
accessible surface, brittle). Because each line is a *complete* event, parsing is
line-oriented and a `text` block can be spoken the moment its line appears — no
streaming-delta reassembly needed.

### D2 — Locate the session by `cwd`, newest first

Resolve the per-project transcripts directory, then **match the session whose
`cwd` equals the workspace root** (case-insensitive on Windows) rather than
reconstructing the encoded directory name — the observed encoding has
inconsistent drive-letter casing (`c--Dev-…` vs `C--Dev-…`) and is unsafe to
rebuild. Among matches, pick the **most recently modified** file; re-point when a
newer matching session appears. This satisfies the discovery/most-recent/follows
requirements.

### D3 — What is spoken, and the state machine

Speak only `type:"assistant"` lines, `message.content[]` blocks of `type:"text"`.
**Skip** `thinking` and `tool_use` blocks, and **drop** any line with
`isSidechain` or `isMeta` true. Derive orb state:

```
new text block ............... speaking (until utterance ends)
latest assistant turn has a
  tool_use with no matching
  tool_result yet ............ working
recent thinking block ........ thinking
no new events > threshold .... idle
```

Tool_use/tool_result are paired by their ids to know when a tool is "still
running."

### D4 — Seek-to-end on activation

On activation, record the current end (byte length and last-seen `uuid`) and only
emit events after it, so the backlog is never spoken. Watch with `fs.watch` plus
incremental reads from the saved offset; handle file growth and rotation
(offset > size ⇒ re-seek).

### D5 — TTS engine: Web Speech API (primary), OS-native (fallback)

Primary: the **Web Speech API** inside the orb webview — offline, keyless, and
crucially it emits `SpeechSynthesisUtterance` **`boundary`** events that give
word-accurate animation sync (the SpeechSynthesis output is *not* routable
through a WebAudio `AnalyserNode`, so boundary events are the only sync signal —
which is exactly why this engine is chosen over routing raw audio).

Risk: `speechSynthesis.getVoices()` can return empty inside Electron webviews on
some platforms. **Mitigation / gating spike (T0):** probe voices (after the
`voiceschanged` event); if none, **degrade to OS-native TTS** (Windows SAPI via
PowerShell `System.Speech.Synthesis`, macOS `say`) driven from the host, with a
host-synthesized pulse envelope (word count × rate) instead of boundary events,
and surface a one-time notice. Cloud voices are a later tier behind the same
seam.

### D6 — Orb renderer: Canvas 2D (default)

Render the orb with **Canvas 2D**: layered radial gradients for the glowing core
plus simplex-noise–displaced rings for the undulating surface. Alternatives:
**Three.js + GLSL** shader blob (most organic, but adds a heavy WebGL dependency
and WebGL availability is not guaranteed in every webview host — overkill for an
always-on ambient element) and **pure CSS/SVG** (lightest but too flat for the
"living energy" look). Canvas 2D is the balance: organic enough, no heavy dep,
predictable performance, `requestAnimationFrame`-throttled and **paused when the
webview is hidden**. A shader upgrade remains possible behind the same renderer
interface.

### D7 — Theme colour via injected `--vscode-*` CSS variables

VS Code injects `--vscode-*` CSS custom properties into webviews. Read tokens
like `--vscode-editor-background`, `--vscode-editor-foreground`, and an accent
(e.g. `--vscode-focusBorder` / `--vscode-charts-*`) via `getComputedStyle` to
build the palette, and recompute when the host posts an
`onDidChangeActiveColorTheme` message (the injected variables also update live).
Rejected: parsing the theme's JSON — fragile and unnecessary.

### D8 — Gaze / attention target

Cursor focus is direct: track `window.activeTextEditor.selection.active` via
`onDidChangeTextEditorSelection`. "Discussed code" in v1 is derived cheaply from
the **file argument of the most recent file-touching `tool_use`** (Read/Edit/etc.)
and explicit `path:line` references in the latest spoken text; richer
symbol-level NLP is a fast-follow. Because the orb webview is a separate panel
with no true spatial relationship to editor pixels, **"orient toward" is
interpreted as a directional lean + subtle indicator** (e.g. the orb's highlight
and a faint tether bias toward the target editor group / line region), not literal
pixel eye-tracking. The exact visual is an open question (Q2).

### D11 — Orb home (Q5, resolved): sidebar webview view

**Resolved: a webview *view* in the DevSpec activity-bar container**, beside
Changes / Capabilities / Phase & gates / Agent activity (`registerWebviewViewProvider`).
This gives an always-visible ambient presence and cements the "evolution of Agent
activity" framing, at the cost of a smaller orb than an editor-area panel would
allow. (Editor-area panel remains possible later for a "cinematic" mode.)

### D12 — Sidechain (Q6, resolved): always filtered

**Resolved: `isSidechain` traffic is never spoken** — only the main conversation.
No opt-in toggle in v1 (avoids config surface and narrating subagent chatter).

### D9 — Opt-in, controls, config

Off by default. Config: `devspec.voice.enabled` (default `false`),
`devspec.voice.rate`, `devspec.voice.voiceURI`. Commands: open orb, mute/stop.
Webview toolbar mirrors mute/stop. Mute state persists. When disabled/muted the
orb still renders state (D3) without speaking.

### D10 — Barge-in policy

**Resolved (Q3): queue + skip-to-latest.** Newly arrived messages queue behind
the current utterance with a small cap (drop oldest when exceeded); a
"skip to latest" control jumps the queue. Chosen over cancel-and-speak-latest,
which risks clipping useful prose.

## Risks / Trade-offs

- **Web Speech voices empty in webview** → probe + OS-native fallback + one-time
  notice (D5). This is the gating spike T0.
- **Transcript schema drift across Claude Code versions** → key only off stable
  fields (`type`, `message.role`, block `type`, `cwd`, `isSidechain`), tolerate
  unknown keys, guard on `version`, fail safe to idle rather than erroring.
- **Wrong session / multi-window** → match `cwd` + newest mtime + re-point;
  surface the watched session in the UI.
- **Narrating subagent chatter** → filter `isSidechain` (D3).
- **Backlog blast on activation** → seek-to-end (D4).
- **Always-on animation cost** → rAF throttle, pause on webview hide, calm down
  when idle (D6).
- **Reading markup/code aloud** → markdown→speech strip; code fences omitted or
  announced (covered by spec).
- **Privacy** → all processing local; no transcript egress on the offline path.

## Migration Plan

Additive, off by default — no data migration. Rollout is internal/dogfood behind
the `devspec.voice.enabled` toggle. Suggested sequence: **T0 spike (Web Speech in
webview)** → transcript watcher (host) → orb renderer (webview) → wiring +
theme/gaze → controls/polish. Rollback is simply disabling the setting/command;
the rest of the extension is unaffected.

## Open Questions

- **Q1 (gates everything):** Does `speechSynthesis` expose usable voices inside a
  VS Code webview on the target platforms? **Approach:** rather than block on a
  manual spike, the implementation ships a *runtime* probe (D5) that selects
  primary vs native fallback automatically, so the architecture is correct either
  way. Still needs one manual confirmation in the Extension Development Host
  (task 7.4) to know which path is the default on Windows.
- **Q2:** The exact gaze visual metaphor, given the orb panel has no spatial
  relationship to editor pixels (directional lean? tether? glance animation?).
  v1 ships a directional lean toward the editor area; refine later.
- ~~**Q3**~~ Resolved — see D10 (queue + skip-to-latest).
- **Q4:** How far to push "discussed code" detection in v1 (cursor + last file
  tool_use, vs symbol/identifier resolution).
- ~~**Q5**~~ Resolved — see D11 (sidebar webview view).
- ~~**Q6**~~ Resolved — see D12 (always filter sidechain).
