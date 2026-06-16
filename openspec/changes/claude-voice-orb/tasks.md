## 0. Spike & decisions (do first)

- [~] 0.1 Spike (Q1/D5): satisfied-by-design via a runtime voices probe + native fallback (see D5); still needs a manual dev-host confirmation (tracked in 7.4).
- [x] 0.2 Decide Q5: orb panel home → sidebar webview view (D11).
- [x] 0.3 Decide Q3 (queue + skip-to-latest, D10) and Q6 (always filter sidechain, D12).
- [x] 0.4 Confirm transcript field stability — structure inspected; min shape keyed off `type`, `message.role`, `message.content[].type`, `cwd`, `isSidechain`, `isMeta`, `version`.

## 1. Scaffolding

- [x] 1.1 Add a second webview entry point `src/webview/orb.ts` to `esbuild.mjs` (browser/IIFE, alongside map.ts/board.ts) → `media/webview/orb.js`.
- [x] 1.2 Add config keys to `package.json`: `devspec.voice.enabled` (default false), `devspec.voice.rate`, `devspec.voice.voiceURI`.
- [x] 1.3 Add commands to `package.json`: `devspec.openOrb`, `devspec.voiceMute`, `devspec.voiceStop` (+ `voiceSkipLatest`); orb registered as a sidebar webview view.
- [x] 1.4 Confirm `.vscodeignore` ships `media/webview/orb.js` (and excludes its map) — verified via `vsce package` output.

## 2. Transcript watcher (extension host)

- [x] 2.1 Implement transcript discovery: resolve the per-project transcripts dir and select the session whose `cwd` matches the workspace root (case-insensitive), newest mtime among matches (D2; spec: "Active session transcript is discovered and watched").
- [x] 2.2 Re-point to a newer matching session when one appears; emit idle + no error when none exists.
- [x] 2.3 Implement incremental tailing from a saved byte offset via `fs.watch` + poll backstop; handle growth and rotation (offset > size ⇒ re-seek).
- [x] 2.4 Seek-to-end on activation (record end offset); never emit pre-activation events (D4; spec: "Only new assistant prose is spoken").
- [x] 2.5 Parse events into a typed stream; drop `isSidechain`/`isMeta`; classify `text`/`thinking`/`tool_use`/`tool_result` blocks; pair tool_use↔tool_result by id.
- [x] 2.6 Derive session state (idle/thinking/working/speaking) from the event stream (D3) and expose it to the webview.

## 3. Speech pipeline

- [x] 3.1 Implement markdown→speech conversion: strip emphasis/heading/list markup; omit or announce fenced code blocks (spec: "Spoken text is speech-friendly").
- [x] 3.2 Primary path: speak `text` blocks via Web Speech API in the orb webview; surface `boundary` and `end` events to the orb (D5).
- [x] 3.3 Fallback path: OS-native TTS (Windows SAPI / macOS `say` / Linux spd-say) from the host with a host-synthesized pulse envelope; one-time notice when falling back (D5).
- [x] 3.4 Capability probe (webview "ready" voices flag) selects primary vs fallback at runtime; `needFallback` safety net mid-run.
- [x] 3.5 Barge-in handling: queue-with-cap + "skip to latest" control per the 0.3 decision (D10).
- [x] 3.6 Offline operation: Web Speech + native paths require no API key and no network (spec: "Speech is produced offline").

## 4. Orb renderer (webview)

- [x] 4.1 Implement the Canvas 2D orb: glowing core (radial gradients) + wobble-displaced body (dependency-free layered-sine noise) (D6).
- [x] 4.2 Implement the four visual states (idle/thinking/working/speaking) and transitions (spec: "Orb visualizes Claude's session state").
- [x] 4.3 Drive the speaking pulse from `boundary` events (primary) or the synthesized envelope (fallback); settle on `end` (spec: "Orb animation is synchronized to speech").
- [x] 4.4 Performance: `requestAnimationFrame` throttling; pause animation when the webview is hidden; calm down when idle.

## 5. Theme & gaze

- [x] 5.1 Derive the orb palette from injected `--vscode-*` CSS variables via `getComputedStyle` (D7; spec: "Orb colour follows the active theme").
- [x] 5.2 Re-theme live on `onDidChangeActiveColorTheme` (host posts a message; variables also update) without reload.
- [x] 5.3 Track the cursor focus target via `onDidChangeTextEditorSelection`; derive "discussed code" from the most recent file-touching `tool_use` matching the active editor (D8). NOTE: path:line parsing from spoken text deferred to Q4.
- [x] 5.4 Map the focus target to the orb's gaze (directional lean + highlight bias per Q2); update as the target changes.

## 6. Controls, consent & privacy

- [x] 6.1 Off by default; gate all speaking on `devspec.voice.enabled` (spec: "Voicing is opt-in and controllable").
- [x] 6.2 Wire mute/stop/skip commands + a webview-view toolbar; persist mute in globalState; stop cancels speech + queue.
- [x] 6.3 Ensure the orb still visualizes state when disabled/muted (state is posted independent of the speech gate).
- [x] 6.4 No transcript egress on the offline path: Web Speech runs in-webview, native TTS shells to the OS — no network calls (spec: "Transcript content stays local").

## 7. Tests & verification

- [x] 7.1 Unit-test the transcript parser/state machine (vscode-free core module): cwd matching, sidechain/meta filtering, block classification, tool pairing, state derivation.
- [x] 7.2 Unit-test markdown→speech conversion against the spec scenarios.
- [x] 7.3 Unit-test theme-palette derivation, gaze focus-target selection, and the barge-in queue (pure helpers).
- [~] 7.4 Manual verification (F5 host) of each spec scenario — PENDING: requires running the Extension Development Host (also confirms the 0.1 Web Speech spike on Windows).
- [x] 7.5 `npm run typecheck`, `npm test` (79 passing), `npm run build`, and `npm run package` all pass; CHANGELOG.md updated.
