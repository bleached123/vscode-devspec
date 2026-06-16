# Changelog

All notable changes to the DevSpec VS Code extension are documented here.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/), and
the project adheres to [Semantic Versioning](https://semver.org/).

The release workflow extracts the section matching the pushed tag (e.g. `v0.1.0`
→ the `## v0.1.0` block) and uses it as the GitHub Release notes, so keep each
version heading in the `## v<x.y.z>` form.

## Unreleased

- Claude voice orb: a sidebar webview that watches the active Claude Code session
  transcript and speaks new assistant prose aloud (offline, via the Web Speech
  API with an OS-native fallback). An animated orb takes its colour from the
  active theme, pulses with the voice, orients toward the cursor / discussed
  code, and visualizes thinking / working / speaking state. Off by default
  (`devspec.voice.enabled`); mute/stop/skip controls in the view toolbar.
- CI workflow: typecheck, cross-platform test matrix (ubuntu/macos/windows ×
  node 22/24), and a build + `vsce package` job that uploads the `.vsix`.
- Release workflow: tag-driven `vsce publish` (and optional Open VSX) gated on a
  `marketplace` environment, with the `.vsix` attached to the GitHub Release.
- Expanded unit test suite covering snapshot parsing (the extension ↔ CLI JSON
  contract), CodeLens scanning, and status-bar composition.

## v0.1.0

- Initial feature-complete release: Changes / Capabilities / Phase & gates /
  Agent activity sidebars, status-bar phase + drift summary, coherence
  diagnostics in the Problems panel, CodeLens on contract/tasks/delta/spec
  files, interactive workspace map and Kanban board webviews, and copy-buttons
  for the `/devspec:*` slash commands.
