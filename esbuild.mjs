import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** Node-side (extension host) — minimal, `vscode` is external. */
const extensionCtx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
});

/** Webview-side — bundles mermaid + marked into a single IIFE so the
 *  panel works offline. Output goes into media/webview/ which is included
 *  in the .vsix (see .vscodeignore). */
const webviewCtx = await esbuild.context({
  entryPoints: ["src/webview/map.ts", "src/webview/board.ts", "src/webview/orb.ts"],
  bundle: true,
  outdir: "media/webview",
  platform: "browser",
  format: "iife",
  target: "es2022",
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
  // Mermaid pulls in d3 + dompurify + cytoscape + others. They're all
  // browser-safe; let esbuild traverse normally. board.ts is plain HTML5
  // drag/drop — no third-party imports — so its bundle is tiny.
});

if (watch) {
  await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
  console.log("esbuild watching for changes (extension + webview)…");
} else {
  await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
  await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
}
