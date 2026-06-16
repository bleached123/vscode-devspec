# vscode-devspec

VS Code extension for [DevSpec](https://github.com/REPLACE_WITH_OWNER/DevSpec) — brings the spec-driven engineering workflow into the editor.

## What it does

- **Activity Bar sidebar** with four trees: "Changes" (lifecycle stages, coherence health, pending-delta count per change), "Capabilities" (living capability specs + sync status), "Phase & gates" (workspace phase, stack, drift summary, CLI version), and "Agent activity" (recent alignment.md decisions).
- **Status bar item** showing current workspace phase + active-change count + drift colour + pending-delta count (`Δ<N>`) + truncated next-task summary when one is pending. Click → opens the workspace map.
- **Lifecycle quick actions** — right-click a change to mark the first pending task complete, log a decision to `alignment.md`, or copy any of the 15 `/devspec:` slash commands to the clipboard. Tasks.md CodeLens entries are clickable to mark individual tasks complete.
- **Coherence diagnostics in the Problems panel** — runs `devspec coherence <slug> --json` per active change, surfaces drift findings (including the new delta-format / capability-exists / requirement-conflict rules) under each change's `contract.md`. Refreshes on file save (debounced 600ms).
- **CodeLens** above test fences and API methods in `contract.md`, above task lists in `tasks.md`, above capability deltas (`deltas/<cap>/spec.md` — quick-copy `/devspec:sync` previews), and above living capability specs (`specs/<cap>/spec.md` — show contributing changes).
- **Interactive map webview** — opens `.devspec/maps/workspace.md` and friends in a custom Mermaid-rendering panel. Drill-down via clickable nodes navigates between L0 → L1 → L1.5 (capabilities) → L2 → L3 layers. **Mermaid + marked are bundled into the extension** — works offline and behind locked-down corporate proxies, no CDN calls at runtime.
- **Commands** in the palette: `DevSpec: Plan change…`, `DevSpec: Initialise capability…`, `DevSpec: Coherence check`, `DevSpec: Open map`, `DevSpec: Open interactive map…`, `DevSpec: Initialize workspace…`, plus copy commands for every `/devspec:<verb>` slash command (`iterate`, `review`, `coordinate`, `iterate-all`, `onboard`, `sync`, `explore`).

The extension is a **thin presentation layer** over the [DevSpec CLI](https://github.com/REPLACE_WITH_OWNER/DevSpec). It shells out to `devspec` on PATH and consumes JSON output (`status --json`, `coherence --json`) — the CLI remains the single source of truth.

## Requirements

- VS Code **1.92+**
- The `devspec` CLI installed and on PATH (or set `devspec.cliPath` in settings to an absolute path).

## Install (local development, before marketplace publish)

```bash
git clone https://github.com/REPLACE_WITH_OWNER/vscode-devspec.git
cd vscode-devspec
npm install
npm run build
npx vsce package --no-dependencies
code --install-extension vscode-devspec-0.0.3.vsix --force
```

Then reload VS Code (Command Palette → `Developer: Reload Window`). The DevSpec icon appears in the Activity Bar.

**Heads-up on `code` resolution (Windows)**: on Windows installs of VS Code, the GUI binary `Code.exe` and the CLI shim `bin/code` are both on `PATH`. Depending on PATH ordering, `code --install-extension foo.vsix` may invoke `Code.exe` (which silently does nothing useful with that flag) instead of the shim. Verify the install actually took with:

```bash
code --list-extensions --show-versions | grep devspec
```

If it doesn't appear, invoke the shim explicitly:

```bash
'/c/Users/<you>/AppData/Local/Programs/Microsoft VS Code/bin/code' --install-extension vscode-devspec-0.0.3.vsix --force
```

## Develop

```bash
npm run watch     # esbuild in watch mode
# Then press F5 in VS Code — launches an Extension Development Host with this
# extension loaded. Open a DevSpec workspace in that host and iterate.
```

The `.vscode/launch.json` configuration is wired so F5 always runs the freshly-built extension.

## Settings

| Setting | Default | Description |
|---|---|---|
| `devspec.cliPath` | `"devspec"` | Path to the CLI binary. Defaults to `devspec` (resolved via PATH). |
| `devspec.coherenceOnSave` | `true` | Run coherence checks when files in `.devspec/projects/` are saved. |
| `devspec.codeLens.enabled` | `true` | Show CodeLens summaries above test fences, API methods, and task lists. |

## Architecture

```
src/
├── extension.ts            # activate/deactivate, wires everything together
├── cli.ts                  # shells out to the devspec CLI, parses JSON
├── workspace.ts            # locates .devspec/, defines snapshot types
├── snapshot.ts             # builds a WorkspaceSnapshot from CLI output
├── statusBar.ts            # status bar item
├── commands.ts             # plan, coherence, openMap, init, openChange
├── views/
│   ├── changesTree.ts      # sidebar "Changes" tree
│   ├── phaseTree.ts        # sidebar "Phase & gates" tree
│   └── mapWebview.ts       # interactive map webview (host side, builds HTML + CSP)
├── webview/
│   └── map.ts              # webview client (Mermaid + marked, bundled to media/webview/map.js)
└── providers/
    ├── diagnostics.ts      # CoherenceDiagnostics → Problems panel
    └── codeLens.ts         # CodeLens for contract.md / tasks.md

media/
├── devspec.svg             # extension icon
└── webview/
    └── map.js              # built browser bundle (~3 MB; includes Mermaid 11 + marked 14)
```

The build produces two artefacts:

- **`dist/extension.js`** — Node-side, ~20 KB. Targets `node20`, CommonJS, `vscode` external.
- **`media/webview/map.js`** — browser-side IIFE, ~3 MB. Bundles Mermaid + marked so the interactive map renders without network access. Compresses to ~890 KB inside the .vsix.

The webview HTML is generated by `mapWebview.ts` with a strict Content-Security-Policy locked to the webview's own origin — no remote scripts, no inline scripts other than a single per-render nonce'd bootstrap payload.

### CLI contract

The extension depends on these CLI behaviours (added in DevSpec 0.1+):

- `devspec --version` — used to detect CLI availability.
- `devspec status --json` — always emits a JSON object, even with no changes. Shape:
  ```json
  {
    "phase": { "effective", "detected", "declared", "strict" },
    "config": { "backend", "architecture", "methodology", "frontend?", "infrastructure?", "pipeline?" },
    "changes": [
      {
        "slug", "title", "doneStages", "totalStages", "inProgressStage",
        "blockingCount", "warningCount", "archived",
        "totalTests", "implementedTests", "stubbedTests"
      }
    ]
  }
  ```
- `devspec coherence <slug> --json` — emits `{ slug, drifts: [{rule, severity, message, hint?}], blockingCount, warningCount, ignoredRules }`.
- `devspec map` — regenerates `.devspec/maps/*.md`. Called by both the "Open map" command and the interactive webview on every render.

If the CLI is missing or older than these contracts, the sidebar shows a friendly warning and the status bar item turns amber.

## Roadmap

This extension shipped a deliberate "full feature set" v0: tree views, status bar, commands, diagnostics, CodeLens, and an interactive Mermaid webview. Next iterations are driven by real usage:

- Inline drift fixes — accept a remediation from the Problems panel and apply it.
- Source ↔ test navigation — jump from a test in `contract.md` to its implementation.
- Quick actions on tree nodes — advance stage, complete task, scaffold tests.
- Theme polish — light/dark Mermaid theme, custom palette per phase.

## License

MIT.
