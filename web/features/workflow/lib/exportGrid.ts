export const MAX_PER_ROW = 3;

// A long workflow is wrapped into rows so the picture stays readable on a feed.
// The rows are as even as possible: 9 steps are 3 + 3 + 3, 7 are 3 + 2 + 2, never 3 + 3 + 1.
export function planRows(count: number): number[] {
  const rows = Math.max(1, Math.ceil(count / MAX_PER_ROW));
  const base = Math.floor(count / rows);
  const extra = count % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

export type Spot = { col: number; row: number };

// Rows run left to right, then right to left, and so on, so the line from one row to the next
// is a short drop straight down. The first step of a row sits in the column the last one ended in.
export function planSpots(sizes: number[]): Spot[] {
  const spots: Spot[] = [];
  let col = 0;
  sizes.forEach((size, row) => {
    const direction = row % 2 === 0 ? 1 : -1;
    for (let i = 0; i < size; i++) {
      const wanted = col + direction * i;
      spots.push({ row, col: Math.min(MAX_PER_ROW - 1, Math.max(0, wanted)) });
    }
    col = spots[spots.length - 1].col;
  });
  return spots;
}

// Splits `text` into at most `maxLines` lines that each fit `fits`, ending with ... if cut.
export function wrapText(text: string, fits: (line: string) => boolean, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = words[i];
    if (lines.length === maxLines - 1) {
      line = words.slice(i).join(" ");
      break;
    }
  }
  if (line) lines.push(line);
  const last = lines.length - 1;
  if (last >= 0 && !fits(lines[last])) {
    let cut = lines[last];
    while (cut.length > 1 && !fits(`${cut}…`)) cut = cut.slice(0, -1);
    lines[last] = `${cut}…`;
  }
  return lines.slice(0, maxLines);
}

// Breaks text at any character, for code and long URLs that have no spaces to break at.
export function wrapChars(text: string, fits: (line: string) => boolean): string[] {
  const out: string[] = [];
  for (const source of text.split("\n")) {
    let line = "";
    for (const ch of source) {
      if (line && !fits(line + ch)) {
        out.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

// Wraps at spaces, but a single long word such as a URL is broken at any character so it can still be read.
// At most `maxLines` lines come back, the last one ending with an ellipsis when something was cut.
export function wrapSmart(text: string, fits: (line: string) => boolean, maxLines: number): string[] {
  if (/\s/.test(text.trim())) return wrapText(text, fits, maxLines);
  const lines = wrapChars(text.trim(), fits);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}…`;
  return kept;
}
