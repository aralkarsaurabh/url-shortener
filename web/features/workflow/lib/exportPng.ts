import type { Layout } from "./layout";
import { MAX_PER_ROW, planRows, planSpots, wrapSmart } from "./exportGrid";
import { PATHS } from "./iconPaths";
import { downloadBlob, makeCanvas, paintDots, readFonts, readPalette, roundRect, toPngBlob } from "./canvasKit";
import type { NodeStatus } from "../model/types";

export { downloadBlob };

const WIDTH = 1600;
const SCALE = 2; // a 3200 px wide picture, sharp when LinkedIn shrinks it
const CARD_W = 250;
const CARD_H = 216;
const COL = 440; // distance between columns, so 190 px is left for the label between two cards
const ROW = 340;
const HEADER = 230;
const FOOTER = 110;
const PAD = 22;

export type ExportOptions = {
  title: string;
  subtitle: string;
  footer: string;
};

// Draws the whole workflow (not just what is on screen) into one picture.
export async function renderFlowPng(layout: Layout, options: ExportOptions): Promise<Blob> {
  await document.fonts.ready;
  const p = readPalette();
  const { sans: font, mono } = readFonts();

  const sizes = planRows(layout.nodes.length);
  const grid = planSpots(sizes);
  const height = HEADER + sizes.length * ROW + FOOTER;
  const gridLeft = (WIDTH - COL * MAX_PER_ROW) / 2;
  const left = gridLeft + (COL - CARD_W) / 2 - PAD; // the left edge of everything, frames included

  const { canvas, ctx } = makeCanvas(WIDTH, height, SCALE);
  paintDots(ctx, WIDTH, height, p);

  // Where every card sits (centre of the card)
  const spots = grid.map((g) => ({
    row: g.row,
    cx: gridLeft + COL * (g.col + 0.5),
    cy: HEADER + ROW * g.row + CARD_H / 2 + 40,
  }));
  const tone = (status: NodeStatus) => (status === "success" ? p.success : status === "error" ? p.danger : status === "running" ? p.accent : p.border);

  // Header
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = p.fg;
  ctx.font = `700 54px ${font}`;
  ctx.fillText(options.title, left, 100);
  ctx.fillStyle = p.muted;
  ctx.font = `400 27px ${font}`;
  ctx.fillText(options.subtitle, left, 148);

  // Exploded view frames, one for each row a group touches
  const indexOfX = new Map(layout.nodes.map((n, i) => [n.x, i]));
  for (const frame of layout.frames) {
    const from = indexOfX.get(frame.x1) ?? 0;
    const to = indexOfX.get(frame.x2) ?? from;
    for (let row = spots[from].row; row <= spots[to].row; row++) {
      const members = spots.slice(from, to + 1).filter((s) => s.row === row);
      if (members.length === 0) continue;
      const x1 = Math.min(...members.map((m) => m.cx)) - CARD_W / 2 - PAD;
      const x2 = Math.max(...members.map((m) => m.cx)) + CARD_W / 2 + PAD;
      const top = members[0].cy - CARD_H / 2 - 46;
      const bottom = members[0].cy + CARD_H / 2 + PAD;
      ctx.save();
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = p.border;
      ctx.fillStyle = "rgba(127,127,127,0.06)";
      roundRect(ctx, x1, top, x2 - x1, bottom - top, 26);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // The title goes top left, unless the line coming into this group from the row above is in the way.
      ctx.fillStyle = p.muted;
      ctx.font = `700 17px ${font}`;
      const label = frame.title.toUpperCase();
      const labelW = ctx.measureText(label).width;
      const arrivals = layout.edges
        .map((_, e) => ({ a: spots[e], b: spots[e + 1] }))
        .filter(({ a, b }) => a.row !== b.row && members.includes(b))
        .map(({ b }) => b.cx);
      const leftX = x1 + 56; // clear of the step number on the first card
      const blocked = arrivals.some((x) => x > leftX - 14 && x < leftX + labelW + 14);
      if (blocked) {
        ctx.textAlign = "right";
        ctx.fillText(label, x2 - 24, top + 30);
        ctx.textAlign = "left";
      } else {
        ctx.fillText(label, leftX, top + 30);
      }
    }
  }

  // Lines between the cards, and the label on each
  const chip = (text: string, x: number, y: number, color: string, align: "center" | "left" = "center") => {
    if (!text) return;
    ctx.font = `500 16px ${mono}`;
    const w = ctx.measureText(text).width + 24;
    const x0 = align === "center" ? x - w / 2 : x;
    ctx.fillStyle = p.node;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x0, y - 15, w, 30, 15);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color === p.border ? p.fg : color;
    ctx.textAlign = "center";
    ctx.fillText(text, x0 + w / 2, y + 5.5);
    ctx.textAlign = "left";
  };
  const head = (x: number, y: number, dir: "left" | "right" | "down", color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    if (dir === "down") {
      ctx.lineTo(x - 9, y - 15);
      ctx.lineTo(x + 9, y - 15);
    } else {
      const back = dir === "right" ? -15 : 15;
      ctx.lineTo(x + back, y - 9);
      ctx.lineTo(x + back, y + 9);
    }
    ctx.closePath();
    ctx.fill();
  };
  layout.edges.forEach((edge, i) => {
    const a = spots[i];
    const b = spots[i + 1];
    const idle = edge.status === "idle" || edge.status === "skipped";
    const color = idle ? p.border : tone(edge.status);
    const label = idle ? "" : edge.label;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.setLineDash(edge.status === "skipped" ? [9, 8] : []);
    ctx.beginPath();
    if (a.row === b.row) {
      const dir = b.cx > a.cx ? 1 : -1;
      const x1 = a.cx + dir * (CARD_W / 2 + 8);
      const x2 = b.cx - dir * (CARD_W / 2 + 8);
      ctx.moveTo(x1, a.cy);
      ctx.lineTo(x2 - dir * 10, b.cy);
      ctx.stroke();
      ctx.setLineDash([]);
      head(x2, b.cy, dir === 1 ? "right" : "left", color);
      chip(label, (x1 + x2) / 2, a.cy - 34, color);
    } else {
      const y1 = a.cy + CARD_H / 2 + 6;
      const y2 = b.cy - CARD_H / 2 - 46; // the top of the next card's frame or label area
      const midY = (y1 + y2) / 2;
      ctx.moveTo(a.cx, y1);
      if (a.cx !== b.cx) {
        ctx.lineTo(a.cx, midY);
        ctx.lineTo(b.cx, midY);
      }
      ctx.lineTo(b.cx, y2 + 24);
      ctx.stroke();
      ctx.setLineDash([]);
      head(b.cx, y2 + 32, "down", color);
      chip(label, a.cx + 16, midY, color, "left");
    }
    ctx.setLineDash([]);
  });

  // Cards
  layout.nodes.forEach((node, i) => {
    const { cx, cy } = spots[i];
    const x = cx - CARD_W / 2;
    const y = cy - CARD_H / 2;
    const color = tone(node.status);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.16)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = p.node;
    roundRect(ctx, x, y, CARD_W, CARD_H, 22);
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.setLineDash(node.status === "skipped" ? [9, 7] : []);
    roundRect(ctx, x, y, CARD_W, CARD_H, 22);
    ctx.stroke();
    ctx.setLineDash([]);

    // icon tile
    const tile = 72;
    ctx.fillStyle = node.status === "idle" || node.status === "skipped" ? "rgba(127,127,127,0.12)" : `${color}22`;
    roundRect(ctx, x + PAD, y + PAD, tile, tile, node.trigger ? 36 : 18);
    ctx.fill();
    ctx.save();
    ctx.translate(x + PAD + tile / 2 - 20, y + PAD + tile / 2 - 20);
    ctx.scale(40 / 24, 40 / 24);
    ctx.strokeStyle = node.status === "skipped" ? p.muted : p.fg;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const d of PATHS[node.icon]) ctx.stroke(new Path2D(d));
    ctx.restore();

    // status badge, top right inside the card
    if (node.status === "success" || node.status === "error") {
      const bx = x + CARD_W - PAD - 14;
      const by = y + PAD + 14;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(bx, by, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `700 19px ${font}`;
      ctx.textAlign = "center";
      ctx.fillText(node.status === "success" ? "✓" : "!", bx, by + 7);
      ctx.textAlign = "left";
    }

    // step number, pinned to the top left corner
    ctx.fillStyle = p.fg;
    ctx.beginPath();
    ctx.arc(x + 2, y + 2, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.bg;
    ctx.font = `700 18px ${font}`;
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), x + 2, y + 8.5);
    ctx.textAlign = "left";

    // title and summary
    const inner = CARD_W - PAD * 2;
    ctx.fillStyle = p.fg;
    ctx.font = `700 22px ${font}`;
    const titleLines = wrapSmart(node.title, (t) => ctx.measureText(t).width <= inner, 2);
    titleLines.forEach((line, n) => ctx.fillText(line, x + PAD, y + PAD + tile + 34 + n * 27));
    ctx.fillStyle = p.muted;
    ctx.font = `400 18px ${font}`;
    const summaryLines = wrapSmart(node.summary, (t) => ctx.measureText(t).width <= inner, 2);
    summaryLines.forEach((line, n) => ctx.fillText(line, x + PAD, y + PAD + tile + 34 + titleLines.length * 27 + 4 + n * 23));
  });

  // Footer
  ctx.fillStyle = p.muted;
  ctx.font = `400 21px ${font}`;
  ctx.fillText(options.footer, left, height - 48);

  return toPngBlob(canvas);
}
