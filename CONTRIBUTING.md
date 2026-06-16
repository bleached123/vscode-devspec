# Contributing to the DevSpec VS Code extension

This extension is a thin presentation layer over the [`devspec`](https://github.com/bleached123/devspec)
CLI — the CLI is the single source of truth. The extension shells out, parses
JSON, and renders sidebars, diagnostics, CodeLens, and webviews.

## Prerequisites

- Node.js 22 or 24
- The `devspec` CLI on your `PATH` (or set `devspec.cliPath` in settings) for
  manual testing against a real workspace

## Setup

```sh
npm ci
```

## Develop

- **Run the extension:** open this folder in VS Code and press `F5` to launch an
  Extension Development Host with the extension loaded. Open a folder that
  contains `.devspec/devspec.yaml` to populate the views.
- **Rebuild on change:** `npm run watch` (esbuild builds both the extension-host
  bundle and the webview bundles).

## Build artifacts

`npm run build` produces two things (see [esbuild.mjs](esbuild.mjs)):

- `dist/extension.js` — the Node-side extension host bundle (CJS, `vscode` external).
- `media/webview/*.js` — the browser-side webview bundles (IIFE; Mermaid + marked
  are bundled so the map/board panels work offline).

## Quality gates

These are the same checks CI runs ([.github/workflows/ci.yml](.github/workflows/ci.yml)):

```sh
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest run
npm run build       # esbuild
npm run package     # vsce package --no-dependencies → .vsix
```

### Tests

Unit tests are co-located as `src/**/*.test.ts` and run under Vitest. The
vscode-dependent code (providers, views, status bar) is kept thin: the testable
logic lives in vscode-free modules so it can be exercised without a VS Code host:

- [src/snapshot.ts](src/snapshot.ts) — parsing the CLI's JSON (tests mock `./cli.js`).
- [src/providers/codeLensCore.ts](src/providers/codeLensCore.ts) — path
  classification and markdown scanning for CodeLens.
- [src/statusBarText.ts](src/statusBarText.ts) — status-bar text/severity composition.

When you add behaviour that parses CLI output or formats UI text, put the pure
logic in one of these modules (or a new one) and add a test next to it.

## Releasing

Releases are automated by [.github/workflows/release.yml](.github/workflows/release.yml),
which runs on `v*.*.*` tags. See the comment block at the top of that file for
the one-time publisher/secret setup. The normal flow:

1. Set a real `publisher` in [package.json](package.json) (currently the
   placeholder `devspec-local`, which cannot publish to the Marketplace).
2. Bump `version` in `package.json` and add a `## v<x.y.z>` section to
   [CHANGELOG.md](CHANGELOG.md).
3. Commit, then `git tag v<x.y.z> && git push --follow-tags`.

The workflow verifies the tag matches `package.json`, packages the `.vsix`,
publishes to the Marketplace (and Open VSX if `OVSX_PAT` is set), and creates a
GitHub Release using the matching CHANGELOG section as the notes.
