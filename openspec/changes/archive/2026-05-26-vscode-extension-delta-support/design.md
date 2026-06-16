## Context

The `vscode-devspec` extension is a thin presentation layer over the `devspec` CLI. Every view (`changes`, `phase`, `activity`) and provider (`codeLens`, `diagnostics`) reads data through `WorkspaceSnapshot`, which is built by calling `devspec status --json` and parsing the result. The architecture is deliberate: the CLI is the single source of truth; the extension never re-implements business logic.

DevSpec just shipped a capability-spec system (per-capability living specs at `.devspec/specs/<cap>/spec.md`, edited by per-change deltas, merged via `/devspec:sync`) and migrated its slash commands from flat `/devspec-<verb>` to namespaced `/devspec:<verb>` layout. The extension is currently unaware of both. This change closes that gap with five user-facing additions plus a syntax fix that propagates the namespace migration.

The extension code already has the patterns we need: a tree provider that reads from `WorkspaceSnapshot` (`changesTree.ts`), a CodeLens provider that matches by file path / extension (`codeLens.ts`), a welcome-view text + command-button pattern (registered in `package.json`), and a copy-to-clipboard command pattern (`copySlashCommandCommand` in `commands.ts`). We're following these patterns, not inventing new architecture.

## Goals / Non-Goals

**Goals:**

- Surface every CLI-side capability concept (capabilities, deltas, sync, conflicts) in the extension's visible surfaces — without re-implementing any of the CLI's logic.
- Fix the slash-command syntax across the extension as a direct consequence of DevSpec's namespace migration — these strings appear in command titles, welcome views, copy commands, and any extension-generated text.
- Use the existing snapshot pattern: the snapshot calls `devspec specs list --json` and `devspec specs status --json` once, then everything else reads from the snapshot. No view talks to the CLI directly.
- Reuse the existing CodeLens provider for the new file patterns, not a separate provider.
- Leave the existing `CoherenceDiagnostics` provider alone — the new `delta-format` / `capability-exists` / `delta-capability-match` / `requirement-conflict` rules from `delta-specs-guards` produce drift findings in the standard JSON shape that the diagnostics provider already consumes.

**Non-Goals:**

- VS Code API mocking and full unit tests for the new tree provider — the repo has `vitest` configured but no existing test infrastructure for UI surfaces. Skip until there's a broader testing investment.
- A custom webview for capabilities (parallel to the existing board/map webviews). Tree view is enough for v1.
- A drag-to-sync gesture or in-tree editing of delta files. Tree is read-only; users edit the underlying markdown files directly.
- Re-rendering the Map webview's content. The existing `MapWebviewManager` already renders `.devspec/maps/`; DevSpec's CLI now writes capability map files into `maps/capabilities/`, so they appear without code changes here.

## Decisions

### D1. Tree view, not webview

The Capabilities surface is a `vscode.TreeDataProvider` registered under `devspec.capabilities` in `package.json`'s `contributes.views.devspec`, mirroring the existing Phase and Activity views.

**Why tree over webview:**

- Capabilities are inherently a tree (capability → requirements). A tree view renders this for free with `vscode.TreeItem`.
- Tree views integrate with VS Code's built-in conventions (icons, context menus, tooltips) without HTML/CSS plumbing.
- Existing tree patterns in this extension (`changesTree.ts`, `phaseTree.ts`) provide a copy-paste template.
- A webview would be overkill for v1 and adds maintenance burden (mermaid/marked deps already loaded for the map webview, but a capabilities-specific webview would need its own renderer).

**Alternative considered:** A capabilities dashboard webview with capability cards and click-to-edit deltas. Rejected for v1 — too much UI work for marginal value over a tree.

### D2. Snapshot extension follows the existing CLI-call pattern

`buildSnapshot()` already invokes `devspec status --json`. We add two more calls:

```ts
// snapshot.ts
const specsListRes = await runDevspec(["specs", "list", "--json"], root);
if (specsListRes.exitCode === 0) {
  const parsed = JSON.parse(specsListRes.stdout) as Array<{
    capability: string;
    status: "clean" | "dirty";
    changes: string[];
  }>;
  snapshot.capabilities = parsed.map((c) => ({
    name: c.capability,
    status: c.status,
    dirtyIn: c.changes,
  }));
}

// For each active change, gather pending deltas:
for (const change of snapshot.changes) {
  if (change.archived) continue;
  const statusRes = await runDevspec(["specs", "status", change.slug, "--json"], root);
  if (statusRes.exitCode === 0) {
    const parsed = JSON.parse(statusRes.stdout) as Array<{ slug: string; pending: string[] }>;
    change.pendingDeltas = parsed[0]?.pending ?? [];
  } else {
    change.pendingDeltas = [];
  }
}
```

**Why per-change `specs status`** — the CLI's `specs status` (without slug) returns all active changes, but iterating per change keeps the snapshot building straightforward and allows graceful per-change error handling. Performance is acceptable: typical workspaces have 1–5 active changes, each call is ~50ms.

**Alternative considered:** Cache capability data in `snapshot.ts` between refreshes and re-fetch only on file watcher events targeting `.devspec/specs/` or `deltas/`. Defer — simpler approach first.

### D3. CodeLens provider extension, not a new provider

`DevspecCodeLensProvider` in `src/providers/codeLens.ts` already matches files by name and dispatches to per-file-type lens functions. We add two new branches:

```ts
provideCodeLenses(document) {
  // existing checks...
  if (isDeltaSpecFile(document.uri.fsPath)) return this.deltaSpecLenses(document);
  if (isCapabilitySpecFile(document.uri.fsPath)) return this.capabilitySpecLenses(document);
  // existing dispatch...
}
```

`isDeltaSpecFile` checks the path matches `.devspec/projects/*/deltas/*/spec.md`. `isCapabilitySpecFile` checks `.devspec/specs/*/spec.md`. Both are simple path-substring + segment-count checks.

Registration in `extension.ts` adds two new document selectors:

```ts
vscode.languages.registerCodeLensProvider(
  { language: "markdown", pattern: "**/.devspec/projects/*/deltas/*/spec.md" },
  codeLensProvider
),
vscode.languages.registerCodeLensProvider(
  { language: "markdown", pattern: "**/.devspec/specs/*/spec.md" },
  codeLensProvider
),
```

**Alternative considered:** Separate provider class per file type. Rejected — the existing provider already handles 4 file types via internal dispatch; adding 2 more is a small extension.

### D4. Delta count badge on Changes tree

The existing item description format is `${doneStages}/${totalStages}  ${driftLabel}`. We extend it:

```ts
const deltaPart = c.pendingDeltas.length > 0
  ? `  Δ${c.pendingDeltas.length}`
  : "";
item.description = `${c.doneStages}/${c.totalStages}${deltaPart}  ${driftLabel(c)}`;
```

The Greek delta character (Δ) is intentionally short — keeps the description line scannable. Tooltip is more verbose:

```
- Pending capability deltas: user-auth, billing  (2)
```

**Alternative considered:** A separate sub-tree node listing each pending delta as a child of the change. Rejected — adds visual noise to changes that are mostly in the build phase; the count + tooltip is enough at a glance.

### D5. Welcome views per-view, not shared

`package.json`'s `contributes.viewsWelcome` array gains a new entry keyed to `devspec.capabilities`. Existing entries for `devspec.changes` and `devspec.activity` get their slash-command references updated to the `/devspec:` form.

The new welcome content (when no capabilities exist):

```markdown
**No capabilities defined yet.**

Capabilities are living specs of what the system promises (e.g. `user-auth`, `billing`). Each lives at `.devspec/specs/<name>/spec.md` and is edited by per-change deltas.

To get started:

[Run devspec specs init…](command:devspec.initCapability)
[Copy /devspec:explore to clipboard](command:devspec.copyExplore)
```

(Where `devspec.initCapability` is a new command that prompts for a capability name and runs `devspec specs init <name>`, mirroring the existing `devspec.plan` pattern.)

**Alternative considered:** A single shared welcome view template across all DevSpec views. Rejected — VS Code's `viewsWelcome` is per-view by design; each view's empty state has different recovery suggestions.

### D6. Slash-command syntax migration is a bulk find-and-replace

Every `/devspec-<verb>` reference in extension source becomes `/devspec:<verb>`. There are ~15 references across `extension.ts`, `commands.ts`, and `package.json` (welcome view content + command titles). A single sed-style replace + manual verification handles it.

The `copyIterate`, `copyReview`, `copyCoordinate`, `copyIterateAll`, `copyOnboard` commands keep their internal command IDs unchanged (`devspec.copyIterate` etc.) — the rename only affects the *clipboard payload*. Existing keyboard shortcuts and command palette entries continue to work.

**Why not introduce a `devspecSlashPrefix` config option** that lets users opt back into the old syntax? — DevSpec dropped the old syntax in source; supporting both forms in the extension would be backwards-compat bloat for a system that has no shipped backwards-compat surface yet.

### D7. Initial capability scaffolding via `devspec.initCapability` command

The Capabilities welcome view's "Run devspec specs init" button maps to a new command `devspec.initCapability`:

```ts
async function initCapabilityCommand(refresh: () => Promise<void>): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "Capability name (kebab-case, e.g. user-auth)",
    validateInput: (v) => /^[a-z][a-z0-9-]*$/.test(v) ? null : "Use lowercase kebab-case",
  });
  if (!name) return;
  const root = await findWorkspaceRoot();
  if (!root) return;
  const r = await runDevspec(["specs", "init", name], root);
  if (r.exitCode === 0) {
    vscode.window.showInformationMessage(`Created capability "${name}"`);
    await refresh();
  } else {
    vscode.window.showErrorMessage(`Failed: ${r.stderr.trim()}`);
  }
}
```

This mirrors the existing `planChangeCommand` pattern. Keeps the user in VS Code for the workflow.

### D8. CodeLens commands shell out via existing `copySlashCommand` pattern

The new lenses on delta + capability spec files invoke `devspec.copySlashCommand` with the appropriate template (e.g. `/devspec:sync <slug> --dry-run`). The command is already registered and works; lenses just provide the argument.

**Alternative considered:** Run `devspec specs sync --dry-run` directly from a lens and show the preview in a webview or notification. Rejected — the slash-command-to-clipboard pattern is what other lenses use, keeping UX consistent. The user then pastes into Claude Code where the skill runs the dry-run + presents the preview.

## Risks / Trade-offs

- **Snapshot now makes 1 + N CLI calls** (`specs list` once, `specs status` per active change) → mitigated by typical N=1–5 active changes; total snapshot time stays under ~200ms. If it becomes a bottleneck, consolidate to a single `specs status --json` call (without slug) which already returns all changes — design.md only shows per-change for readability; the implementation can pick whichever the CLI supports.
- **Tree view shows stale data between refreshes** → mitigated by the existing file-watcher pattern in `extension.ts`. Adding `.devspec/specs/` and `.devspec/projects/*/deltas/` to the watched paths makes the Capabilities view refresh on the same triggers as everything else.
- **CodeLens flicker on rapid edits** → mitigated by VS Code's built-in debouncing. The provider's `refresh()` method is already debounced via VS Code's CodeLens infrastructure.
- **Slash command syntax change in copy buttons** is observable: anyone with shell history of `/devspec-iterate` now sees `/devspec:iterate` copied. The DevSpec CLI made the same change, so the extension's copy text now matches reality.
- **`devspec.initCapability` command duplicates `devspec specs init` shell call** — mitigated by keeping the command thin (validate name → shell out → refresh). No business logic in the extension.
- **The new view appears even when the user has no interest in capabilities** — VS Code's tree views render empty / welcome state cheaply. The Capabilities view's welcome message explains the feature; users who don't want it can collapse the section. No way to conditionally hide a view based on data without restart-affecting machinery.

## Migration Plan

The extension has not been published to a marketplace — version is `0.0.6`, distributed only as a local `.vsix`. There is no upgrade story to worry about.

For the user (the only consumer of this extension at present):

1. Re-build via `npm run build`.
2. Package via `npm run package`.
3. Install the new `.vsix` over the old one.
4. Reload VS Code window.

The new Capabilities view appears in the DevSpec activity bar panel. Existing views continue to work; the slash-command copy text changes from `/devspec-<verb>` to `/devspec:<verb>` form.

## Open Questions

- **Should the Capabilities view's delete/rename actions exist?** No CLI support for deleting or renaming a capability exists in DevSpec yet. Deferred to whenever DevSpec adds that.
- **Should the snapshot's `specs list` call fail gracefully when the CLI doesn't have the `specs` subcommand** (i.e. an older DevSpec version)? Yes — catch the non-zero exit and treat capabilities as empty. DevSpec CLI versions before delta-specs-foundational won't have the command.
- **Does the new file watcher pattern in `extension.ts` capture both `specs/` and `deltas/` changes?** The current watcher is `**/.devspec/**` which already covers everything under `.devspec/`. No additional watcher needed.
- **Should `devspec.initCapability` validate the name against existing capabilities to avoid duplicates?** The CLI is idempotent (`specs init` on an existing name is a no-op), so duplicate-checking in the extension is unnecessary.
- **A "Sync delta now" CodeLens that actually runs the sync** instead of copying to clipboard? Tempting but breaks the clipboard-pattern convention. Defer until the user expresses friction.
