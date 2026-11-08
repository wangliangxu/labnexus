import DOMPurify from 'dompurify';
import { marked } from 'marked';

export interface SanitizeHtmlOptions {
  allowImages?: boolean;
  allowSvg?: boolean;
  allowStyles?: boolean;
}

function sanitizeCssText(css: string): string {
  return css
    .replace(/@import\b[^;]*;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/url\s*\(\s*['"]?\s*(javascript|vbscript|data\s*:\s*text\/html):[^)]*\)/gi, '');
}

function regexFallbackSanitize(html: string, options: SanitizeHtmlOptions): string {
  let out = html
    .replace(/<(script|iframe|object|embed|applet|meta|link|base|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|applet|meta|link|base|form)\b[^>]*\/?>/gi, '');

  if (!options.allowStyles) {
    out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  }
  if (!options.allowImages) {
    out = out.replace(/<img\b[^>]*\/?>/gi, '');
  }
  if (!options.allowSvg) {
    out = out.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '');
  }

  // Strip inline event handlers like onclick="..." or onerror=...
  out = out.replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Strip javascript:/vbscript:/data:text/html URLs
  out = out.replace(
    /\s+(href|src|xlink:href|action|formaction)\s*=\s*(?:"\s*(?:javascript|vbscript|data\s*:\s*text\/html):[^"]*"|'\s*(?:javascript|vbscript|data\s*:\s*text\/html):[^']*')/gi,
    ''
  );
  return out;
}

type PurifyInstance = ReturnType<typeof DOMPurify>;
let purifier: PurifyInstance | null = null;

function getPurifier(): PurifyInstance | null {
  if (purifier) return purifier;
  if (typeof window === 'undefined' || typeof window.document === 'undefined') return null;
  const instance = DOMPurify(window);
  if (!instance.isSupported) return null;
  instance.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style' && node.textContent) {
      node.textContent = sanitizeCssText(node.textContent);
    }
  });
  instance.addHook('afterSanitizeAttributes', (node) => {
    const element = node as Element;
    if (element.hasAttribute?.('style')) {
      element.setAttribute('style', sanitizeCssText(element.getAttribute('style') || ''));
    }
    if (element.tagName === 'A') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noreferrer noopener');
    }
  });
  purifier = instance;
  return purifier;
}

/**
 * Sanitize untrusted HTML or SVG strings before passing to `dangerouslySetInnerHTML`.
 * Uses DOMPurify in the browser; a conservative regex fallback is used only when no DOM exists
 * (for example in Node-based unit tests).
 */
export function sanitizeRichHtml(
  rawHtml: string,
  options: SanitizeHtmlOptions = {}
): string {
  const {
    allowImages = true,
    allowSvg = true,
    allowStyles = false,
  } = options;

  if (!rawHtml) return '';

  const instance = getPurifier();
  if (!instance) {
    return regexFallbackSanitize(rawHtml, { allowImages, allowSvg, allowStyles });
  }

  const forbidTags = ['form', 'foreignObject', 'base', 'meta', 'link'];
  if (!allowStyles) forbidTags.push('style');
  if (!allowImages) forbidTags.push('img');
  if (!allowSvg) forbidTags.push('svg');

  return instance.sanitize(rawHtml, {
    USE_PROFILES: allowSvg ? { html: true, svg: true, svgFilters: true } : { html: true },
    FORBID_TAGS: forbidTags,
    FORBID_ATTR: ['srcdoc'],
    ALLOW_DATA_ATTR: false,
  });
}

export function renderSanitizedMarkdown(
  content: string,
  options: SanitizeHtmlOptions = { allowImages: true, allowSvg: false, allowStyles: false }
): string {
  const raw = marked.parse(content, { breaks: true, gfm: true });
  if (typeof raw !== 'string') return '';
  return sanitizeRichHtml(raw, options);
}

export function sanitizeHtmlFragment(
  rawHtml: string,
  options?: SanitizeHtmlOptions
): string {
  return sanitizeRichHtml(rawHtml, options);
}

export function sanitizeSvgFragment(rawSvg: string): string {
  return sanitizeRichHtml(rawSvg, {
    allowImages: true,
    allowSvg: true,
    allowStyles: true,
  });
}
