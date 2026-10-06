import type { Atom, NodeStatus } from "../model/types";
import { makeCanvas, paintDots, readFonts, readPalette, roundRect, toPngBlob, type Palette } from "./canvasKit";
import { wrapChars, wrapText } from "./exportGrid";
import { PATHS } from "./iconPaths";

const WIDTH = 1200;
const SCALE = 2;
const OUTER = 60; // space around the white panel
const PAD = 56; // space inside it
const CONTENT_X = OUTER + PAD;
const CONTENT_W = WIDTH - CONTENT_X * 2;

const STATUS_TEXT: Record<NodeStatus, string> = {
  idle: "NOT RUN YET",
  running: "RUNNING",
  success: "RAN SUCCESSFULLY",
  error: "FAILED",
  skipped: "SKIPPED",
};

export type DetailExport = {
  workflow: string; // for example "Shorten a URL"
  stepLabel: string; // for example "Step 4 of 9"
  atoms: Atom[];
  footer: string;
};

// Draws one picture of what a step does and what it returned. Run twice: once on a scratch canvas
// to learn how tall the content is, then for real on a canvas of exactly that height.
function paint(ctx: CanvasRenderingContext2D, data: DetailExport, p: Palette, sans: string, mono: string, height: number | null): number {
  const tone = (s: NodeStatus) => (s === "success" ? p.success : s === "error" ? p.danger : s === "running" ? p.accent : p.muted);

  if (height !== null) {
    paintDots(ctx, WIDTH, height, p);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.14)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = p.node;
    roundRect(ctx, OUTER, OUTER, WIDTH - OUTER * 2, height - OUTER * 2, 30);
    ctx.fill();
    ctx.restore();
  }

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  let y = OUTER + PAD + 6;

  const paragraph = (text: string, font: string, color: string, lineHeight: number, maxLines = 60) => {
    ctx.font = font;
    ctx.fillStyle = color;
    for (const line of wrapText(text, (t) => ctx.measureText(t).width <= CONTENT_W, maxLines)) {
      ctx.fillText(line, CONTENT_X, y);
      y += lineHeight;
    }
  };

  data.atoms.forEach((atom, index) => {
    const color = tone(atom.status);

    if (index > 0) {
      y += 14;
      if (height !== null) {
        ctx.fillStyle = p.border;
        ctx.fillRect(CONTENT_X, y, CONTENT_W, 2);
      }
      y += 54;
    }

    // Top line: the icon, which step it is, and the status
    if (height !== null) {
      ctx.fillStyle = atom.status === "idle" || atom.status === "skipped" ? "rgba(127,127,127,0.12)" : `${color}22`;
      roundRect(ctx, CONTENT_X, y - 30, 60, 60, atom.trigger ? 30 : 16);
      ctx.fill();
      ctx.save();
      ctx.translate(CONTENT_X + 30 - 17, y - 17);
      ctx.scale(34 / 24, 34 / 24);
      ctx.strokeStyle = p.fg;
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const d of PATHS[atom.icon]) ctx.stroke(new Path2D(d));
      ctx.restore();
    }
    ctx.font = `700 18px ${sans}`;
    ctx.fillStyle = p.muted;
    const label = index === 0 ? `${data.stepLabel.toUpperCase()}  ·  ${data.workflow.toUpperCase()}` : `PART OF ${data.workflow.toUpperCase()}`;
    ctx.fillText(label, CONTENT_X + 80, y - 4);

    const status = STATUS_TEXT[atom.status];
    ctx.font = `700 16px ${sans}`;
    const pillW = ctx.measureText(status).width + 28;
    if (height !== null) {
      ctx.fillStyle = `${color}22`;
      roundRect(ctx, CONTENT_X + CONTENT_W - pillW, y - 24, pillW, 34, 17);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.fillText(status, CONTENT_X + CONTENT_W - pillW + 14, y - 1);
    y += 84;

    // Title and verdict
    paragraph(atom.title, `700 46px ${sans}`, p.fg, 56, 2);
    if (atom.verdict) {
      y += 6;
      paragraph(`${atom.verdict.ok ? "✓" : "✗"}  ${atom.verdict.text}`, `600 25px ${sans}`, atom.verdict.ok ? p.success : p.danger, 36);
    }
    y += 16;

    // The sections
    for (const section of atom.sections) {
      y += 18;
      ctx.font = `700 17px ${sans}`;
      ctx.fillStyle = p.muted;
      ctx.fillText(section.title.toUpperCase(), CONTENT_X, y);
      y += 30;

      if (section.text) {
        paragraph(section.text, `400 24px ${sans}`, p.fg, 36);
      }

      if (section.code) {
        ctx.font = `400 19px ${mono}`;
        const lines = wrapChars(section.code, (t) => ctx.measureText(t).width <= CONTENT_W - 44);
        const shown = lines.slice(0, 16);
        if (lines.length > shown.length) shown[shown.length - 1] = "…";
        const boxH = shown.length * 28 + 32;
        if (height !== null) {
          ctx.fillStyle = "rgba(127,127,127,0.10)";
          roundRect(ctx, CONTENT_X, y - 8, CONTENT_W, boxH, 14);
          ctx.fill();
        }
        ctx.fillStyle = p.fg;
        shown.forEach((line, n) => ctx.fillText(line, CONTENT_X + 22, y + 22 + n * 28));
        y += boxH + 8;
      }

      if (section.rows) {
        for (const [key, value] of section.rows) {
          ctx.font = `400 20px ${mono}`;
          const valueLines = wrapChars(value, (t) => ctx.measureText(t).width <= CONTENT_W * 0.58);
          ctx.font = `400 21px ${sans}`;
          const keyLines = wrapText(key, (t) => ctx.measureText(t).width <= CONTENT_W * 0.38, 3);
          const lines = Math.max(valueLines.length, keyLines.length, 1);
          ctx.fillStyle = p.muted;
          keyLines.forEach((line, n) => ctx.fillText(line, CONTENT_X, y + 10 + n * 28));
          ctx.font = `400 20px ${mono}`;
          ctx.fillStyle = p.fg;
          ctx.textAlign = "right";
          valueLines.forEach((line, n) => ctx.fillText(line, CONTENT_X + CONTENT_W, y + 10 + n * 28));
          ctx.textAlign = "left";
          if (height !== null) {
            ctx.fillStyle = p.border;
            ctx.globalAlpha = 0.5;
            ctx.fillRect(CONTENT_X, y + lines * 28 + 2, CONTENT_W, 1);
            ctx.globalAlpha = 1;
          }
          y += lines * 28 + 12;
        }
      }
    }
  });

  y += 40;
  ctx.font = `400 19px ${sans}`;
  ctx.fillStyle = p.muted;
  ctx.fillText(data.footer, CONTENT_X, y);
  return y + PAD + OUTER - 14;
}

export async function renderDetailPng(data: DetailExport): Promise<Blob> {
  await document.fonts.ready;
  const p = readPalette();
  const { sans, mono } = readFonts();

  const scratch = makeCanvas(WIDTH, 6000, 1);
  const height = Math.ceil(paint(scratch.ctx, data, p, sans, mono, null));

  const { canvas, ctx } = makeCanvas(WIDTH, height, SCALE);
  paint(ctx, data, p, sans, mono, height);
  return toPngBlob(canvas);
}
