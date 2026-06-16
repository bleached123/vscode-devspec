import * as vscode from "vscode";
import { TranscriptWatcher } from "./transcriptWatcher.js";
import { SessionStateMachine, type OrbState } from "./state.js";
import { SpeechQueue } from "./queue.js";
import { markdownToSpeech, isSpeakable } from "./speechText.js";
import { gazeVector, type FocusTarget } from "./gaze.js";
import { speakNative, estimateSpeechMs, nativeTtsAvailable } from "./nativeTts.js";
import type { Signal } from "./transcript.js";
import { findWorkspaceRoot } from "../workspace.js";
import { log } from "../log.js";

const MUTE_KEY = "devspec.voice.muted";

/**
 * Sidebar webview view (design D11) that hosts the orb and orchestrates the
 * whole voice pipeline: transcript watcher → state machine + speech queue →
 * webview (Web Speech) or native fallback, plus theme and gaze updates.
 */
export class OrbViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "devspec.orb";

  private view: vscode.WebviewView | null = null;
  private watcher: TranscriptWatcher | null = null;
  private readonly machine = new SessionStateMachine();
  private readonly queue = new SpeechQueue();
  private speakingId: string | null = null;
  private useNative = false;
  private nativeAbort: AbortController | null = null;
  private seq = 0;
  private lastPostedState: OrbState | null = null;
  private lastDiscussedFile: string | null = null;
  private stateTimer: ReturnType<typeof setInterval> | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    view.webview.html = this.html(view.webview);

    this.disposables.push(
      view.webview.onDidReceiveMessage((m) => this.onWebviewMessage(m)),
      view.onDidChangeVisibility(() =>
        this.post({ type: "visible", visible: view.visible })
      ),
      view.onDidDispose(() => this.disposeRuntime()),
      vscode.window.onDidChangeActiveColorTheme(() => this.post({ type: "themeChanged" })),
      vscode.window.onDidChangeTextEditorSelection((e) => this.updateGaze(e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((ed) => this.updateGaze(ed)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("devspec.voice")) this.pushConfig();
      })
    );

    this.pushConfig();
    this.updateGaze(vscode.window.activeTextEditor);
    void this.startWatching();

    // Drive state to the webview on a steady tick (covers idle/thinking decay).
    this.stateTimer = setInterval(() => this.pushState(), 500);
  }

  // ---- transcript → state + speech --------------------------------------

  private async startWatching(): Promise<void> {
    const root = await findWorkspaceRoot();
    if (!root) return; // no .devspec workspace — orb idles
    this.watcher = new TranscriptWatcher(root, {
      onSignals: (sigs) => this.onSignals(sigs),
    });
    try {
      await this.watcher.start();
    } catch (err) {
      log.warn(`orb transcript watcher failed: ${String(err)}`);
    }
  }

  private onSignals(signals: Signal[]): void {
    const now = Date.now();
    for (const sig of signals) {
      this.machine.applySignal(sig, now);
      if (sig.kind === "tool_use" && sig.filePath) this.lastDiscussedFile = sig.filePath;
      if (sig.kind === "text" && isSpeakable(sig.text)) {
        const spoken = markdownToSpeech(sig.text);
        this.queue.enqueue({ id: `u${++this.seq}`, text: spoken });
      }
    }
    this.pumpQueue();
    this.pushState();
  }

  private pumpQueue(): void {
    if (this.speakingId) return; // one utterance at a time (barge-in = queue, D10)
    if (!this.voiceEnabled() || this.muted()) {
      // Drop queued speech while disabled/muted — the orb still shows state.
      this.queue.clear();
      return;
    }
    const item = this.queue.next();
    if (!item) return;
    this.speakingId = item.id;
    this.machine.setSpeaking(true);
    this.pushState();

    if (this.useNative) {
      void this.speakViaNative(item.id, item.text);
    } else {
      this.post({
        type: "speak",
        id: item.id,
        text: item.text,
        rate: this.rate(),
        voiceURI: this.voiceURI(),
      });
    }
  }

  private async speakViaNative(id: string, text: string): Promise<void> {
    this.nativeAbort = new AbortController();
    this.post({ type: "nativePulse", id, durationMs: estimateSpeechMs(text, this.rate()) });
    try {
      await speakNative(text, { rate: this.rate(), signal: this.nativeAbort.signal });
    } catch (err) {
      log.warn(`native TTS failed: ${String(err)}`);
    } finally {
      this.onUtteranceDone(id);
    }
  }

  private onUtteranceDone(id: string): void {
    if (this.speakingId !== id) return;
    this.speakingId = null;
    this.machine.setSpeaking(false);
    this.pushState();
    this.pumpQueue();
  }

  // ---- webview messages --------------------------------------------------

  private onWebviewMessage(m: unknown): void {
    const msg = m as { type?: string; id?: string; voices?: boolean };
    switch (msg.type) {
      case "ready":
        // Decide the TTS path once: no Web Speech voices → host native fallback.
        this.useNative = !msg.voices && nativeTtsAvailable();
        if (!msg.voices && !this.useNative) {
          log.warn("orb: no Web Speech voices and no native fallback available");
        } else if (this.useNative) {
          this.notifyFallbackOnce();
        }
        this.post({ type: "visible", visible: this.view?.visible ?? true });
        break;
      case "speakDone":
        if (msg.id) this.onUtteranceDone(msg.id);
        break;
      case "needFallback":
        // Web Speech bailed mid-run — switch to native for this and future items.
        if (nativeTtsAvailable()) {
          this.useNative = true;
          this.notifyFallbackOnce();
          if (msg.id && this.speakingId === msg.id) {
            void this.speakViaNative(msg.id, (m as { text?: string }).text ?? "");
          }
        } else if (msg.id) {
          this.onUtteranceDone(msg.id);
        }
        break;
    }
  }

  private fallbackNotified = false;
  private notifyFallbackOnce(): void {
    if (this.fallbackNotified) return;
    this.fallbackNotified = true;
    void vscode.window.showInformationMessage(
      "DevSpec orb: using the OS speech synthesizer (the in-webview voice was unavailable)."
    );
  }

  // ---- public controls (commands) ---------------------------------------

  reveal(): void {
    void vscode.commands.executeCommand(`${OrbViewProvider.viewId}.focus`);
  }

  toggleMute(): void {
    const next = !this.muted();
    void this.context.globalState.update(MUTE_KEY, next);
    if (next) this.stop();
    this.pushConfig();
  }

  stop(): void {
    this.queue.clear();
    this.nativeAbort?.abort();
    this.post({ type: "stop" });
    if (this.speakingId) this.onUtteranceDone(this.speakingId);
  }

  skipToLatest(): void {
    const latest = this.queue.skipToLatest();
    this.nativeAbort?.abort();
    this.post({ type: "stop" });
    const prev = this.speakingId;
    this.speakingId = null;
    this.machine.setSpeaking(false);
    if (latest) this.queue.enqueue(latest);
    if (prev) this.pumpQueue();
    else this.pumpQueue();
  }

  // ---- gaze / theme / config --------------------------------------------

  private updateGaze(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      this.post({ type: "gaze", vector: gazeVector(null) });
      return;
    }
    const discussed =
      this.lastDiscussedFile &&
      samePath(editor.document.uri.fsPath, this.lastDiscussedFile);
    const focus: FocusTarget = {
      line: editor.selection.active.line,
      lineCount: Math.max(1, editor.document.lineCount),
      source: discussed ? "discussed" : "cursor",
    };
    this.post({ type: "gaze", vector: gazeVector(focus) });
  }

  private pushConfig(): void {
    this.post({ type: "config", enabled: this.voiceEnabled(), muted: this.muted() });
    if (this.muted() || !this.voiceEnabled()) this.queue.clear();
  }

  private pushState(): void {
    const s = this.machine.state(Date.now());
    if (s === this.lastPostedState) return;
    this.lastPostedState = s;
    this.post({ type: "state", state: s });
  }

  private cfg() {
    return vscode.workspace.getConfiguration("devspec");
  }
  private voiceEnabled(): boolean {
    return this.cfg().get<boolean>("voice.enabled", false);
  }
  private rate(): number {
    return this.cfg().get<number>("voice.rate", 1);
  }
  private voiceURI(): string | undefined {
    return this.cfg().get<string>("voice.voiceURI") || undefined;
  }
  private muted(): boolean {
    return this.context.globalState.get<boolean>(MUTE_KEY, false);
  }

  private post(msg: unknown): void {
    void this.view?.webview.postMessage(msg);
  }

  private disposeRuntime(): void {
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.stateTimer = null;
    this.watcher?.dispose();
    this.watcher = null;
    this.nativeAbort?.abort();
    for (const d of this.disposables.splice(0)) d.dispose();
    this.view = null;
  }

  dispose(): void {
    this.disposeRuntime();
  }

  // ---- html --------------------------------------------------------------

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const src = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview", "orb.js")
    );
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
  #orb { width: 100%; height: 100%; display: block; min-height: 180px; }
</style>
</head>
<body>
  <canvas id="orb"></canvas>
  <script nonce="${nonce}" src="${src}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)] ?? "A";
  return out;
}

function samePath(a: string, b: string): boolean {
  return a.replace(/[\\/]+/g, "/").toLowerCase() === b.replace(/[\\/]+/g, "/").toLowerCase();
}
