// Small drawing helpers shared by the picture exporters.
export type Palette = Record<"bg" | "dot" | "node" | "border" | "fg" | "muted" | "success" | "danger" | "accent", string>;

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string) => css.getPropertyValue(name).trim();
  return {
    bg: get("--canvas-bg"),
    dot: get("--canvas-dot"),
    node: get("--node-bg"),
    border: get("--node-border"),
    fg: get("--fg"),
    muted: get("--muted"),
    success: get("--success"),
    danger: get("--danger"),
    accent: get("--accent-strong"),
  };
}

export function readFonts() {
  const sans = getComputedStyle(document.body).fontFamily;
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim() || "monospace";
  return { sans, mono };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function paintDots(ctx: CanvasRenderingContext2D, width: number, height: number, p: Palette) {
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = p.dot;
  for (let x = 12; x < width; x += 24) for (let y = 12; y < height; y += 24) ctx.fillRect(x, y, 2, 2);
}

export function makeCanvas(width: number, height: number, scale: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the picture.");
  ctx.scale(scale, scale);
  return { canvas, ctx };
}

export function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not make the picture."))), "image/png");
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
