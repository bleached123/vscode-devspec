## Why

When Claude Code is working in the editor, its output is silent text the user
must watch and read. There is no ambient sense of *presence* — whether Claude is
thinking, running a tool, or has finished — without staring at the panel. This
change gives Claude a voice and a face: an animated "orb" (inspired by the AI in
the film *Superintelligence*) that speaks new assistant prose aloud, pulses with
the voice, takes on the editor's theme colour, and orients toward the code under
discussion. It is the living visual evolution of the existing **Agent activity**
view, turning a passive list into an ambient, glanceable presence.

## What Changes

- **NEW** A webview-hosted "orb" panel that renders an animated sphere with three
  visual states — *thinking*, *working* (tool running), and *speaking* — driven
  by the live state of the active Claude Code session.
- **NEW** Transcript watching: the extension watches the active Claude Code
  session transcript (`~/.claude/projects/<encoded-workspace>/<session>.jsonl`),
  detects new assistant text messages from activation forward (never the
  backlog), and skips `thinking` and `tool_use` blocks.
- **NEW** Offline text-to-speech: new assistant prose is spoken via the Web
  Speech API inside the orb webview (no API key, no network). Markdown is
  stripped to speech-friendly text; code fences are skipped or announced.
- **NEW** Word-synced animation: the orb pulses using `SpeechSynthesisUtterance`
  `boundary` events so the visual reacts to the actual cadence of speech.
- **NEW** Theme-aware colour: the orb derives its palette from the active VS Code
  colour theme and re-themes when the user switches themes.
- **NEW** Gaze / attention: the orb orients toward the code being discussed or
  the current cursor position, giving a sense of where Claude's focus is.
- **NEW** Controls + consent: a master toggle (opt-in, not auto-speaking),
  mute/stop, and voice/rate/pitch settings. The orb still visualizes state when
  muted.

## Capabilities

### New Capabilities

- `claude-voice-orb`: Watching the active Claude Code transcript, speaking new
  assistant prose offline, and rendering a theme-aware, gaze-aware, voice-synced
  animated orb that visualizes Claude's thinking/working/speaking state.

### Modified Capabilities

<!-- None. The orb is positioned as a successor presentation to the existing
     Agent activity view but does not change the requirements of the
     `extension-capability-support` capability or any other existing spec. -->

## Impact

- **Affected code (vscode-devspec extension):**
  - New webview manager (alongside `mapWebview.ts` / `boardWebview.ts`) and a new
    webview bundle (alongside `media/webview/map.js`, `board.js`) via the
    existing esbuild two-context setup.
  - New transcript-watcher module on the extension host (`fs.watch` + JSONL
    parsing + markdown→speech stripping).
  - New configuration keys (e.g. `devspec.voice.enabled`, `devspec.voice.rate`,
    voice selection) and new commands (open orb, mute/stop).
  - Optional: a bridge from the existing **Agent activity** view to launch the orb.
- **Dependencies:** No new runtime npm dependencies are required for the offline
  path (Web Speech API is built into the webview environment). The orb renderer
  may add a small graphics dependency depending on the rendering approach chosen
  in design (shader/Canvas/CSS) — to be decided in `design.md`.
- **Validation risk / gating spike:** Whether `speechSynthesis.getVoices()`
  returns usable voices inside a VS Code (Electron) webview is unconfirmed and
  platform-dependent (typically works on Windows via SAPI5). This must be spiked
  before the offline-TTS approach is locked in. Fallback if it fails: OS-native
  TTS (Windows SAPI / macOS `say`) with a host-faked pulse envelope, losing
  word-accurate orb sync.
- **Privacy:** Transcript reading is entirely local; no transcript content leaves
  the machine. Speaking is opt-in.
