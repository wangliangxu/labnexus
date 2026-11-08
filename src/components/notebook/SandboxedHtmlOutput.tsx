import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { t } from '../../i18n';

/**
 * Renders untrusted notebook `text/html` output inside a sandboxed iframe.
 *
 * The sandbox grants only `allow-same-origin` (no `allow-scripts`), so nothing inside the frame
 * can execute JavaScript or reach the Tauri IPC bridge, while the parent can still read the
 * frame's document to size it and to mirror the workbench theme. Notebook-provided `<style>`
 * blocks stay confined to the frame instead of leaking into the workbench.
 */

const THEME_VARIABLES = [
  '--text-primary',
  '--text-secondary',
  '--text-link',
  '--bg-editor',
  '--bg-panel',
  '--bg-hover',
  '--border-subtle',
  '--border-default',
];

const FRAME_STYLES = `
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    color: var(--text-primary, #1f2328);
    font: 12px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    overflow-x: auto;
    overflow-y: hidden;
  }
  a { color: var(--text-link, #0969da); }
  img, svg { max-width: 100%; height: auto; }
  table { border-collapse: collapse; font-variant-numeric: tabular-nums; margin: 2px 0; }
  th, td { border: 1px solid var(--border-subtle, #d0d7de); padding: 3px 8px; text-align: right; }
  th { font-weight: 600; background: var(--bg-panel, #f6f8fa); }
  tbody tr:nth-child(odd) td { background: color-mix(in srgb, var(--bg-hover, #f6f8fa) 50%, transparent); }
  pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
`;

function applyTheme(frameDoc: Document) {
  const computed = getComputedStyle(document.documentElement);
  const root = frameDoc.documentElement;
  for (const name of THEME_VARIABLES) {
    const value = computed.getPropertyValue(name).trim();
    if (value) root.style.setProperty(name, value);
  }
  const theme = document.documentElement.getAttribute('data-theme');
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
}

export const SandboxedHtmlOutput: React.FC<{ html: string; className?: string }> = ({
  html,
  className,
}) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(24);

  const srcDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_STYLES}</style></head><body>${html}</body></html>`,
    [html]
  );

  const cleanupRef = useRef<(() => void) | null>(null);

  const handleLoad = useCallback(() => {
    cleanupRef.current?.();
    const frameDoc = frameRef.current?.contentDocument;
    if (!frameDoc) return;

    applyTheme(frameDoc);
    const measure = () => {
      const next = Math.ceil(frameDoc.documentElement.scrollHeight);
      setHeight((prev) => (prev === next ? prev : next));
    };
    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(frameDoc.body);

    const themeObserver = new MutationObserver(() => applyTheme(frameDoc));
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style'],
    });

    const handleClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute('href') || '';
      if (/^(https?:|mailto:)/i.test(href)) {
        openUrl(href).catch((error) => console.warn('Failed to open link:', error));
      }
    };
    frameDoc.addEventListener('click', handleClick);

    cleanupRef.current = () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      frameDoc.removeEventListener('click', handleClick);
    };
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  return (
    <iframe
      ref={frameRef}
      title={t('HTML output')}
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      onLoad={handleLoad}
      className={className}
      style={{ width: '100%', height, border: 0, display: 'block', background: 'transparent' }}
    />
  );
};
