import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Locate the .devspec/ root within the open workspace. Returns null if no
 * workspace contains a .devspec/devspec.yaml — the extension's views render
 * a welcome message in that case.
 */
export async function findWorkspaceRoot(): Promise<string | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;

  for (const folder of folders) {
    const root = folder.uri.fsPath;
    if (await fileExists(path.join(root, ".devspec", "devspec.yaml"))) {
      return root;
    }
    // Two levels deep — common monorepo layouts
    const entries = await safeReaddir(root);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(root, entry.name, ".devspec", "devspec.yaml");
      if (await fileExists(candidate)) {
        return path.join(root, entry.name);
      }
    }
  }
  return null;
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function safeReaddir(p: string): Promise<{ name: string; isDirectory: () => boolean }[]> {
  try {
    return await fs.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

export interface ChangeSummary {
  slug: string;
  title: string;
  doneStages: number;
  totalStages: number;
  inProgressStage: string | null;
  blockingCount: number;
  warningCount: number;
  archived: boolean;
  pendingDeltas: string[];
  nextTask: { text: string; line: number } | null;
}

export interface CapabilitySummary {
  name: string;
  status: "clean" | "dirty";
  dirtyIn: string[];
}

export interface WorkspaceSnapshot {
  root: string;
  phase: string;
  declaredPhase: boolean;
  backend: string;
  architecture: string;
  methodology: string;
  changes: ChangeSummary[];
  capabilities: CapabilitySummary[];
  cliAvailable: boolean;
  cliVersion?: string;
  cliError?: string;
}
