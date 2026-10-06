"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasView } from "../model/types";

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;

// Pan by dragging the empty canvas, zoom with the wheel around the pointer.
export function useCanvasView(initial: CanvasView) {
  const [view, setView] = useState<CanvasView>(initial);
  const [panning, setPanning] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((v) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * Math.exp(-event.deltaY * 0.0015)));
        const ratio = scale / v.scale;
        return { scale, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-no-pan]")) return;
    drag.current = { x: event.clientX, y: event.clientY };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = { x: event.clientX, y: event.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }, []);

  const endPan = useCallback(() => {
    drag.current = null;
    setPanning(false);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setView((v) => ({ ...v, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor)) }));
  }, []);

  const reset = useCallback(() => setView(initial), [initial]);

  // Zoom and move so everything between minX and maxX (world units) is in view.
  const fit = useCallback((minX: number, maxX: number) => {
    const el = surface.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const span = maxX - minX + 260;
    const scale = Math.min(1, Math.max(MIN_SCALE, (width - 80) / span));
    setView({ scale, x: width / 2 - ((minX + maxX) / 2) * scale, y: height * 0.45 });
  }, []);

  return {
    view,
    panning,
    surface,
    zoomBy,
    reset,
    fit,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endPan, onPointerCancel: endPan },
  };
}
