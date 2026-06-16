import * as vscode from "vscode";

/**
 * Single shared output channel. Everything the extension does logs here so
 * users have a clear surface to inspect when something isn't working.
 */
class Logger {
  private channel: vscode.OutputChannel | null = null;

  private ensure(): vscode.OutputChannel {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel("DevSpec");
    }
    return this.channel;
  }

  info(msg: string): void {
    this.ensure().appendLine(`[${ts()}] ${msg}`);
  }

  warn(msg: string): void {
    this.ensure().appendLine(`[${ts()}] WARN: ${msg}`);
  }

  error(msg: string, err?: unknown): void {
    const detail =
      err instanceof Error ? `\n  ${err.stack ?? err.message}` : err ? `\n  ${String(err)}` : "";
    this.ensure().appendLine(`[${ts()}] ERROR: ${msg}${detail}`);
  }

  show(): void {
    this.ensure().show(true);
  }

  dispose(): void {
    this.channel?.dispose();
  }
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export const log = new Logger();
