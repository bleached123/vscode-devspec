/**
 * Orb webview (browser context). Renders the animated orb on a Canvas 2D
 * surface, runs the Web Speech API for the offline primary TTS path, and talks
 * to the extension host over postMessage. Bundled to media/webview/orb.js.
 */
import { derivePalette, type OrbPalette } from "../voice/theme.js";
import type { GazeVector } from "../voice/gaze.js";
import type { OrbState } from "../voice/state.js";

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

type HostMessage =
  | { type: "config"; enabled: boolean; muted: boolean }
  | { type: "state"; state: OrbState }
  | { type: "speak"; id: string; text: string; rate: number; voiceURI?: string }
  | { type: "nativePulse"; id: string; durationMs: number }
  | { type: "stop" }
  | { type: "themeChanged" }
  | { type: "gaze"; vector: GazeVector }
  | { type: "visible"; visible: boolean };

const canvas = document.getElementById("orb") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const synth = window.speechSynthesis;

let palette: OrbPalette = readPalette();
let state: OrbState = "idle";
let gaze: GazeVector = { x: 0, y: 0 };
let pulse = 0; // 0..1 speaking energy, decays each frame
let visible = true;
let muted = false;
let enabled = false;
let dpr = Math.min(window.devicePixelRatio || 1, 2);

// ---- theme ---------------------------------------------------------------

function readPalette(): OrbPalette {
  const cs = getComputedStyle(document.documentElement);
  const names = [
    "--vscode-editor-background",
    "--vscode-sideBar-background",
    "--vscode-editor-foreground",
    "--vscode-foreground",
    "--vscode-focusBorder",
    "--vscode-charts-blue",
    "--vscode-button-background",
    "--vscode-textLink-foreground",
  ];
  const vars: Record<string, string> = {};
  for (const n of names) vars[n] = cs.getPropertyValue(n);
  return derivePalette(vars);
}

// ---- speech (Web Speech primary) ----------------------------------------

function voicesAvailable(): boolean {
  try {
    return synth.getVoices().length > 0;
  } catch {
    return false;
  }
}

let activeUtterance: SpeechSynthesisUtterance | null = null;

function speak(id: string, text: string, rate: number, voiceURI?: string): void {
  if (!voicesAvailable()) {
    // Hand back to the host's native fallback.
    vscode.postMessage({ type: "needFallback", id, text });
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  if (voiceURI) {
    const v = synth.getVoices().find((vc) => vc.voiceURI === voiceURI);
    if (v) u.voice = v;
  }
  u.onstart = () => setState("speaking");
  u.onboundary = () => {
    pulse = 1; // each word kicks the pulse; the render loop decays it
  };
  u.onend = () => {
    activeUtterance = null;
    vscode.postMessage({ type: "speakDone", id });
  };
  u.onerror = () => {
    activeUtterance = null;
    vscode.postMessage({ type: "speakDone", id });
  };
  activeUtterance = u;
  synth.speak(u);
}

/** Fallback animation: the host speaks natively; we just pulse for the duration. */
function nativePulse(id: string, durationMs: number): void {
  setState("speaking");
  const start = performance.now();
  const step = () => {
    const t = performance.now() - start;
    if (t >= durationMs) {
      vscode.postMessage({ type: "speakDone", id });
      return;
    }
    // Rhythmic pulse roughly at speaking cadence.
    pulse = Math.max(pulse, 0.5 + 0.5 * Math.abs(Math.sin(t / 180)));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function stopSpeech(): void {
  try {
    synth.cancel();
  } catch {
    /* ignore */
  }
  activeUtterance = null;
}

function setState(s: OrbState): void {
  state = s;
}

// ---- render loop ---------------------------------------------------------

function resize(): void {
  const w = canvas.clientWidth || 200;
  const h = canvas.clientHeight || 200;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}

/** Cheap dependency-free wobble (layered sines) standing in for noise. */
function wobble(angle: number, t: number, amp: number): number {
  return (
    amp *
    (Math.sin(angle * 3 + t * 1.1) * 0.5 +
      Math.sin(angle * 5 - t * 0.7) * 0.3 +
      Math.sin(angle * 8 + t * 1.7) * 0.2)
  );
}

function stateParams(s: OrbState): { speed: number; wob: number; brightness: number } {
  switch (s) {
    case "speaking":
      return { speed: 1.8, wob: 0.16, brightness: 1 };
    case "working":
      return { speed: 1.3, wob: 0.1, brightness: 0.85 };
    case "thinking":
      return { speed: 0.9, wob: 0.13, brightness: 0.8 };
    default:
      return { speed: 0.35, wob: 0.06, brightness: 0.7 }; // idle breathing
  }
}

let raf = 0;
function frame(now: number): void {
  raf = 0;
  const t = now / 1000;
  const { speed, wob, brightness } = stateParams(state);
  pulse *= 0.9; // decay the per-word kick

  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2 + gaze.x * W * 0.08;
  const cy = H / 2 + gaze.y * H * 0.08;
  const baseR = Math.min(W, H) * 0.3;
  const breathe = 1 + 0.04 * Math.sin(t * speed * 2);
  const energy = brightness + pulse * 0.35;

  ctx.clearRect(0, 0, W, H);

  // Outer glow.
  const glowR = baseR * (1.7 + pulse * 0.25);
  const glow = ctx.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, glowR);
  glow.addColorStop(0, withAlpha(palette.glow, 0.45 * energy));
  glow.addColorStop(1, withAlpha(palette.glow, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Undulating body.
  ctx.beginPath();
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = baseR * breathe * (1 + wobble(a, t * speed, wob + pulse * 0.12));
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const body = ctx.createRadialGradient(cx, cy, baseR * 0.1, cx, cy, baseR * 1.1);
  body.addColorStop(0, withAlpha(palette.core, 0.95 * energy));
  body.addColorStop(0.6, withAlpha(palette.glow, 0.7 * energy));
  body.addColorStop(1, withAlpha(palette.accent, 0.15));
  ctx.fillStyle = body;
  ctx.fill();

  // Bright core highlight, biased by gaze direction.
  const hx = cx + gaze.x * baseR * 0.4;
  const hy = cy + gaze.y * baseR * 0.4;
  const core = ctx.createRadialGradient(hx, hy, 0, hx, hy, baseR * 0.6);
  core.addColorStop(0, withAlpha(palette.core, 0.95 * energy));
  core.addColorStop(1, withAlpha(palette.core, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(hx, hy, baseR * 0.6, 0, Math.PI * 2);
  ctx.fill();

  schedule();
}

function schedule(): void {
  if (!visible) return; // pause when hidden (perf)
  if (!raf) raf = requestAnimationFrame(frame);
}

// ---- host messaging ------------------------------------------------------

window.addEventListener("message", (e: MessageEvent<HostMessage>) => {
  const m = e.data;
  switch (m.type) {
    case "config":
      enabled = m.enabled;
      muted = m.muted;
      break;
    case "state":
      setState(m.state);
      break;
    case "speak":
      if (enabled && !muted) speak(m.id, m.text, m.rate, m.voiceURI);
      else vscode.postMessage({ type: "speakDone", id: m.id });
      break;
    case "nativePulse":
      nativePulse(m.id, m.durationMs);
      break;
    case "stop":
      stopSpeech();
      break;
    case "themeChanged":
      palette = readPalette();
      break;
    case "gaze":
      gaze = m.vector;
      break;
    case "visible":
      visible = m.visible;
      if (visible) schedule();
      break;
  }
});

document.addEventListener("visibilitychange", () => {
  visible = document.visibilityState === "visible";
  if (visible) schedule();
});

window.addEventListener("resize", () => {
  resize();
  schedule();
});

if (synth) {
  synth.onvoiceschanged = () => vscode.postMessage({ type: "ready", voices: voicesAvailable() });
}

resize();
schedule();
vscode.postMessage({ type: "ready", voices: voicesAvailable() });

// ---- utils ---------------------------------------------------------------

function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  const a = Math.max(0, Math.min(1, alpha));
  // #rgb / #rrggbb
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  // rgb(...) / rgba(...)
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (rgb) {
    const parts = rgb[1]!.split(",").map((s) => s.trim());
    const [r, g, b] = parts;
    return `rgba(${r},${g},${b},${a})`;
  }
  return c; // named colour etc. — let the browser handle it (no alpha)
}
