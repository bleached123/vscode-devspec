/**
 * Derive the orb's colour palette from VS Code's injected `--vscode-*` CSS
 * variables (design D7). Pure: takes a name→value map (the webview reads it via
 * getComputedStyle) and returns a palette, with sensible fallbacks so a missing
 * token never produces an empty colour.
 */

export interface OrbPalette {
  background: string;
  core: string;
  glow: string;
  accent: string;
}

const FALLBACK: OrbPalette = {
  background: "#1e1e1e",
  core: "#cfe8ff",
  glow: "#4aa3ff",
  accent: "#7dd3fc",
};

function pick(vars: Record<string, string>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = vars[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function derivePalette(vars: Record<string, string>): OrbPalette {
  const background = pick(vars, "--vscode-editor-background", "--vscode-sideBar-background");
  const foreground = pick(vars, "--vscode-editor-foreground", "--vscode-foreground");
  const accent = pick(
    vars,
    "--vscode-focusBorder",
    "--vscode-charts-blue",
    "--vscode-button-background",
    "--vscode-textLink-foreground"
  );
  return {
    background: background ?? FALLBACK.background,
    core: foreground ?? FALLBACK.core,
    glow: accent ?? FALLBACK.glow,
    accent: accent ?? FALLBACK.accent,
  };
}
