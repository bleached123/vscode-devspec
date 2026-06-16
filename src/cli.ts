import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { log } from "./log.js";

const execFileAsync = promisify(execFile);

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawn the devspec CLI. The path comes from the workspace setting
 * `devspec.cliPath` (defaults to "devspec" via PATH). Never throws — errors
 * surface in the returned exitCode + stderr so callers decide how to react.
 */
export async function runDevspec(
  args: string[],
  cwd: string,
  options: { timeoutMs?: number } = {}
): Promise<CliRunResult> {
  const cliPath =
    vscode.workspace.getConfiguration("devspec").get<string>("cliPath") || "devspec";
  log.info(`$ ${cliPath} ${args.join(" ")}  (cwd: ${cwd})`);
  try {
    const { stdout, stderr } = await execFileAsync(cliPath, args, {
      cwd,
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: 16 * 1024 * 1024,
      // Strip color so JSON parsing never trips over ANSI codes.
      // shell: true on Windows lets PATH resolve .cmd shims (npm-installed binaries).
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      shell: process.platform === "win32",
      windowsHide: true,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    log.warn(
      `devspec exited non-zero: code=${e.code} stderr=${(e.stderr ?? "").slice(0, 200)}`
    );
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(e.message ?? err),
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

export async function isCliAvailable(cwd: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  const r = await runDevspec(["--version"], cwd, { timeoutMs: 5000 });
  if (r.exitCode === 0) {
    return { ok: true, version: r.stdout.trim() };
  }
  return { ok: false, error: r.stderr.trim() || "devspec not found on PATH" };
}
