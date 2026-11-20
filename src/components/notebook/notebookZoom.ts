import { createContext } from 'react';

export const DEFAULT_NOTEBOOK_ZOOM = 100;
export const MIN_NOTEBOOK_ZOOM = 50;
export const MAX_NOTEBOOK_ZOOM = 200;
export const NOTEBOOK_ZOOM_STEP = 10;

export type NotebookZoomAction = 'in' | 'out' | 'reset';
export const NotebookZoomContext = createContext<{
  scale: number;
  onPinch: ((factor: number) => void) | null;
}>({ scale: 1, onPinch: null });

export function clampNotebookZoom(zoom: number): number {
  return Math.min(MAX_NOTEBOOK_ZOOM, Math.max(MIN_NOTEBOOK_ZOOM, zoom));
}

export function notebookZoomShortcut(event: KeyboardEvent): NotebookZoomAction | undefined {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.isComposing) return;
  if (event.key === '+' || event.key === '=') return 'in';
  if (event.shiftKey) return;
  if (event.key === '-') return 'out';
  if (event.key === '0') return 'reset';
}

export function listenForNotebookPinch(
  target: HTMLElement | Document,
  onScale: (factor: number) => void
): () => void {
  let gestureScale: number | undefined;

  const handleGestureStart = (event: Event) => {
    event.preventDefault();
    gestureScale = 1;
  };
  const handleGestureChange = (event: Event) => {
    const { scale } = event as Event & { scale?: number };
    if (gestureScale === undefined || typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return;
    event.preventDefault();
    onScale(scale / gestureScale);
    gestureScale = scale;
  };
  const handleGestureEnd = (event: Event) => {
    if (gestureScale === undefined) return;
    event.preventDefault();
    gestureScale = undefined;
  };
  const handleWheel = (event: WheelEvent) => {
    // Chromium and other webviews report trackpad pinch as Ctrl + wheel.
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (gestureScale !== undefined) return;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1;
    onScale(Math.exp(-event.deltaY * unit / 100));
  };

  const options = { capture: true, passive: false };
  target.addEventListener('gesturestart', handleGestureStart, options);
  target.addEventListener('gesturechange', handleGestureChange, options);
  target.addEventListener('gestureend', handleGestureEnd, options);
  target.addEventListener('wheel', handleWheel as EventListener, options);
  return () => {
    target.removeEventListener('gesturestart', handleGestureStart, options);
    target.removeEventListener('gesturechange', handleGestureChange, options);
    target.removeEventListener('gestureend', handleGestureEnd, options);
    target.removeEventListener('wheel', handleWheel as EventListener, options);
  };
}
