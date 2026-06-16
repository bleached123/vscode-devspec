import { spawn, type ChildProcess } from "node:child_process";

/**
 * OS-native TTS fallback (design D5) used when the webview's Web Speech API has
 * no usable voices. Speaks entirely offline via the platform synthesizer:
 * Windows → PowerShell `System.Speech`, macOS → `say`, Linux → `spd-say`/`espeak`
 * (best effort). No boundary events here — the orchestrator drives a synthesized
 * pulse envelope for the orb instead.
 */

export interface NativeSpeakOptions {
  /** Web-Speech-style rate (1 = normal). */
  rate?: number;
  signal?: AbortSignal;
}

export function nativeTtsAvailable(): boolean {
  return process.platform === "win32" || process.platform === "darwin" || process.platform === "linux";
}

export function speakNative(text: string, opts: NativeSpeakOptions = {}): Promise<void> {
  const rate = opts.rate ?? 1;
  let child: ChildProcess;

  if (process.platform === "win32") {
    // Read the utterance from stdin to avoid any command-line escaping issues.
    const sapiRate = Math.round(clamp((rate - 1) * 10, -10, 10)); // 0.5..2 → -5..10
    const script =
      "Add-Type -AssemblyName System.Speech;" +
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
      `$s.Rate = ${sapiRate};` +
      "$t = [Console]::In.ReadToEnd();" +
      "$s.Speak($t);";
    child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
    });
  } else if (process.platform === "darwin") {
    const wpm = Math.round(clamp(180 * rate, 90, 360));
    child = spawn("say", ["-r", String(wpm)]);
  } else {
    // Linux: try spd-say (blocks with -w), fall back handled by the error path.
    const speed = Math.round(clamp((rate - 1) * 100, -100, 100));
    child = spawn("spd-say", ["-w", "-r", String(speed), "-e"]);
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => child.kill();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdin?.on("error", () => {
      /* ignore broken pipe on kill */
    });
    try {
      child.stdin?.end(text);
    } catch {
      /* ignore */
    }
    child.on("error", (err) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", () => {
      opts.signal?.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

/** Rough spoken-duration estimate (ms) for the orb's pulse envelope. */
export function estimateSpeechMs(text: string, rate = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wordsPerMs = (180 * rate) / 60000; // ~180 wpm at rate 1
  return Math.max(400, Math.round(words / Math.max(wordsPerMs, 0.0001)));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
