import { marked } from 'marked';

export interface SanitizeHtmlOptions {
  allowImages?: boolean;
  allowSvg?: boolean;
  allowStyles?: boolean;
}

const DANGEROUS_PROTOCOL_RE = /^\s*(javascript|vbscript|data\s*:\s*text\/html)\s*:/i;

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

/**
 * Sanitize untrusted HTML or SVG strings before passing to `dangerouslySetInnerHTML`.
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

  if (typeof DOMParser === 'undefined') {
    return regexFallbackSanitize(rawHtml, { allowImages, allowSvg, allowStyles });
  }

  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const blockedSelectors = [
    'script',
    'iframe',
    'object',
    'embed',
    'applet',
    'meta',
    'link',
    'base',
    'form',
  ];
  if (!allowStyles) blockedSelectors.push('style');
  if (!allowImages) blockedSelectors.push('img');
  if (!allowSvg) blockedSelectors.push('svg', 'foreignObject');
  else blockedSelectors.push('foreignObject');

  doc.querySelectorAll(blockedSelectors.join(', ')).forEach((node) => node.remove());

  doc.querySelectorAll('*').forEach((element) => {
    if (element.tagName.toLowerCase() === 'style' && allowStyles) {
      element.textContent = sanitizeCssText(element.textContent || '');
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (name.startsWith('on') || name === 'srcdoc') {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (
        (name === 'href' ||
          name === 'src' ||
          name === 'xlink:href' ||
          name === 'action' ||
          name === 'formaction') &&
        DANGEROUS_PROTOCOL_RE.test(value)
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === 'style') {
        const cleaned = sanitizeCssText(value);
        if (cleaned !== value) {
          element.setAttribute('style', cleaned);
        }
      }
    }

    if (element.tagName === 'A') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noreferrer noopener');
    }
  });

  return doc.body.innerHTML;
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

