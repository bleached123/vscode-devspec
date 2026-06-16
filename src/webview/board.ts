/**
 * Webview-side entry for the DevSpec interactive kanban board.
 *
 * Columns are the six lifecycle stages plus a virtual "done" column. Each
 * change-card sits in the column matching its first-pending stage (or "done"
 * if every stage is `done`). Drag a card left to rewind, right to advance —
 * the host runs `devspec advance` / `devspec rewind` and posts back fresh
 * state.
 *
 * Pure HTML5 drag/drop, no third-party libs. ~5 KB bundled.
 */
export {}; // ensures this file is treated as a module (enables `declare global`)

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

interface ChangeCard {
  slug: string;
  title: string;
  doneStages: number;
  totalStages: number;
  inProgressStage: string | null;
  blockingCount: number;
  warningCount: number;
  archived: boolean;
}

interface BoardState {
  changes: ChangeCard[];
  phase: string;
  backend: string;
  architecture: string;
  workspaceRoot: string;
}

declare global {
  interface Window {
    __DEVSPEC_BOARD__: BoardState;
  }
}

const LIFECYCLE_STAGES = [
  "discovery",
  "proposal",
  "design",
  "contract",
  "alignment",
  "tasks",
] as const;

const COLUMNS = [...LIFECYCLE_STAGES, "done"] as const;
type Column = (typeof COLUMNS)[number];

const vscode = acquireVsCodeApi();
let state: BoardState = window.__DEVSPEC_BOARD__;

function bucketFor(c: ChangeCard): Column {
  if (c.doneStages >= c.totalStages) return "done";
  // Trust the snapshot's inProgressStage when present; fall back to a
  // proportional estimate from doneStages.
  if (c.inProgressStage && (LIFECYCLE_STAGES as readonly string[]).includes(c.inProgressStage)) {
    return c.inProgressStage as Column;
  }
  const idx = Math.min(c.doneStages, LIFECYCLE_STAGES.length - 1);
  return LIFECYCLE_STAGES[idx] ?? "discovery";
}

function driftBadge(c: ChangeCard): string {
  if (c.blockingCount > 0) return `<span class="badge block">🔴 ${c.blockingCount} block</span>`;
  if (c.warningCount > 0) return `<span class="badge warn">🟡 ${c.warningCount} warn</span>`;
  return `<span class="badge clean">🟢 clean</span>`;
}

function progressBar(c: ChangeCard): string {
  const pct = c.totalStages === 0 ? 0 : Math.round((c.doneStages / c.totalStages) * 100);
  return `<div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div><span class="progress-text">${c.doneStages}/${c.totalStages}</span>`;
}

function render(): void {
  const board = document.getElementById("board");
  if (!board) return;

  // Group changes by column
  const buckets = new Map<Column, ChangeCard[]>();
  for (const col of COLUMNS) buckets.set(col, []);
  for (const c of state.changes.filter((c) => !c.archived)) {
    const col = bucketFor(c);
    buckets.get(col)!.push(c);
  }

  const html = COLUMNS.map((col) => {
    const cards = buckets.get(col) ?? [];
    const colCls = col === "done" ? "column done-col" : "column";
    const headerColor = columnHeaderColor(col);
    const cardsHtml =
      cards.length === 0
        ? `<div class="empty-hint">drop here</div>`
        : cards.map((c) => renderCard(c)).join("");
    return /* html */ `
      <div class="${colCls}" data-column="${col}" style="border-top: 3px solid ${headerColor};">
        <div class="column-header">
          <span class="column-title">${escapeHtml(col)}</span>
          <span class="column-count">${cards.length}</span>
        </div>
        <div class="column-body" data-drop="${col}">${cardsHtml}</div>
      </div>
    `;
  }).join("");

  board.innerHTML = html;
  attachDragHandlers();
  updateMetadata();
}

function renderCard(c: ChangeCard): string {
  const severityCls = c.blockingCount > 0 ? "card-block" : c.warningCount > 0 ? "card-warn" : "card-clean";
  return /* html */ `
    <div class="card ${severityCls}" draggable="true" data-slug="${escapeHtml(c.slug)}" data-bucket="${escapeHtml(bucketFor(c))}">
      <div class="card-title">${escapeHtml(c.title)}</div>
      <div class="card-slug"><code>${escapeHtml(c.slug)}</code></div>
      <div class="card-meta">${progressBar(c)} ${driftBadge(c)}</div>
    </div>
  `;
}

function updateMetadata(): void {
  const meta = document.getElementById("meta");
  if (!meta) return;
  const total = state.changes.filter((c) => !c.archived).length;
  const blocking = state.changes.reduce((s, c) => s + c.blockingCount, 0);
  const warning = state.changes.reduce((s, c) => s + c.warningCount, 0);
  meta.textContent = `phase: ${state.phase} · backend: ${state.backend} · arch: ${state.architecture} · ${total} active · ${blocking} block · ${warning} warn`;
}

function attachDragHandlers(): void {
  document.querySelectorAll<HTMLElement>(".card[draggable=true]").forEach((card) => {
    card.addEventListener("dragstart", (ev) => {
      const e = ev as DragEvent;
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify({
        slug: card.dataset.slug,
        from: card.dataset.bucket,
      }));
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  });

  document.querySelectorAll<HTMLElement>(".column-body[data-drop]").forEach((dropZone) => {
    dropZone.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      const e = ev as DragEvent;
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", (ev) => {
      ev.preventDefault();
      dropZone.classList.remove("drag-over");
      const e = ev as DragEvent;
      const payload = e.dataTransfer?.getData("text/plain");
      if (!payload) return;
      const { slug, from } = JSON.parse(payload) as { slug?: string; from?: string };
      const to = dropZone.dataset.drop as Column | undefined;
      if (!slug || !from || !to) return;
      if (from === to) return; // no-op
      vscode.postMessage({ type: "move", slug, from, to });
    });
  });
}

function columnHeaderColor(col: Column): string {
  switch (col) {
    case "discovery":
      return "#8b949e";
    case "proposal":
      return "#1f6feb";
    case "design":
      return "#0969da";
    case "contract":
      return "#bf8700";
    case "alignment":
      return "#a371f7";
    case "tasks":
      return "#d29922";
    case "done":
      return "#3fb950";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.addEventListener("message", (ev: MessageEvent) => {
  const msg = ev.data as { type: string; state?: BoardState; message?: string };
  if (msg.type === "state" && msg.state) {
    state = msg.state;
    render();
  } else if (msg.type === "error" && msg.message) {
    const banner = document.getElementById("error-banner");
    if (banner) {
      banner.textContent = msg.message;
      banner.style.display = "block";
      setTimeout(() => {
        banner.style.display = "none";
      }, 5000);
    }
  }
});

document.getElementById("refresh-btn")?.addEventListener("click", () => {
  vscode.postMessage({ type: "refresh" });
});

render();
