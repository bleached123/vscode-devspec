/**
 * Webview-side entry for the DevSpec interactive map. Bundled by esbuild as
 * a standalone IIFE that runs in the panel's iframe.
 *
 * Mermaid + marked are bundled in (no CDN at runtime), so the panel works
 * offline and behind locked-down corporate proxies.
 */
import mermaid from "mermaid";
import { marked } from "marked";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

interface BootstrapPayload {
  layer: string;
  prose: string;
  diagrams: string[];
  isDark: boolean;
}

const PLACEHOLDER_RE = /&lt;&lt;&lt;DIAGRAM_PLACEHOLDER_INDEX_(\d+)&gt;&gt;&gt;/g;

declare global {
  interface Window {
    __DEVSPEC__: BootstrapPayload;
  }
}

const vscode = acquireVsCodeApi();

async function boot(): Promise<void> {
  const payload = window.__DEVSPEC__;
  if (!payload) {
    document.getElementById("content")!.textContent =
      "Bootstrap payload missing — please reload the panel.";
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    theme: payload.isDark ? "dark" : "default",
    securityLevel: "loose",
    fontFamily: "var(--vscode-editor-font-family, monospace)",
  });

  // Render markdown prose, then splice the diagram placeholders back in.
  // marked.parse can return string | Promise<string> depending on options;
  // we run it synchronously by passing async: false.
  const proseHtml = marked.parse(payload.prose, { async: false }) as string;
  const html = proseHtml.replace(PLACEHOLDER_RE, (_m, idx: string) => {
    const i = parseInt(idx, 10);
    const source = payload.diagrams[i] ?? "";
    return `<div class="mermaid-block"><pre class="mermaid">${escapeHtml(source)}</pre></div>`;
  });

  const content = document.getElementById("content");
  if (!content) return;
  content.innerHTML = html;

  // Run mermaid on the freshly-mounted blocks. mermaid.run() will replace each
  // <pre class="mermaid"> with rendered SVG.
  try {
    await mermaid.run({ nodes: document.querySelectorAll("pre.mermaid") });
  } catch (err) {
    const errEl = document.createElement("pre");
    errEl.className = "mermaid-error";
    errEl.textContent = `Mermaid render error:\n${(err as Error).message}`;
    content.prepend(errEl);
  }

  // Intercept clicks on links whose href ends in .md — those are the
  // CLI-generated drill-down links between layers.
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const link = t.closest("a[href]") as HTMLAnchorElement | null;
    if (!link) return;
    const href = link.getAttribute("href") ?? "";
    if (!href.endsWith(".md")) return;
    ev.preventDefault();
    const layer = href.replace(/\.md$/, "");
    vscode.postMessage({ type: "navigate", target: layer });
  });

  // Toolbar buttons
  document.querySelectorAll<HTMLButtonElement>("button[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.go ?? "workspace";
      vscode.postMessage({ type: "navigate", target });
    });
  });
  document.getElementById("refresh-btn")?.addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });
  document.getElementById("open-source-btn")?.addEventListener("click", () => {
    vscode.postMessage({ type: "openSource", file: `${payload.layer}.md` });
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

void boot();
