import katex from 'katex';
import { Marked, type Tokens } from 'marked';
import markedCjkFriendly from 'marked-cjk-friendly';
import { sanitizeRichHtml } from '../../utils/sanitizeHtml';

function renderMath({ text, displayMode }: Tokens.Generic): string {
  // A notebook generated from a string literal can contain a tab in place of
  // the start of \text. Marked can expand that tab to spaces inside a list.
  const tex = text.replace(/([ \t]+)ext(?=\{)/g, '$1\\text').trim();
  return katex.renderToString(tex, { displayMode, throwOnError: false, trust: false });
}

const markdown = new Marked({ gfm: true, breaks: true }, markedCjkFriendly(), {
  extensions: [
    {
      name: 'displayMath',
      level: 'block',
      start(src) {
        const opener = /\n {0,3}\$\$[ \t]*(?=\n)/.exec(src);
        return opener ? opener.index + 1 : undefined;
      },
      tokenizer(src) {
        const match = /^ {0,3}\$\$[ \t]*\n([\s\S]*?)\n {0,3}\$\$[ \t]*(?:\n|$)/.exec(src);
        if (match) return { type: 'displayMath', raw: match[0], text: match[1], displayMode: true };
      },
      renderer: renderMath,
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start(src) {
        return src.indexOf('$');
      },
      tokenizer(src) {
        const displayMode = src.startsWith('$$');
        const match = displayMode
          ? /^\$\$((?:\\[^\n]|[^\\$\n])+)\$\$/.exec(src)
          : /^\$((?:\\[^\n]|[^\\$\n])+)\$(?!\d)/.exec(src);
        if (!match) return;
        const text = match[1];
        // Permit padding around TeX commands while keeping prose with prices literal.
        if (!displayMode && text !== text.trim() && !/(?:\\[a-z]|[ \t]ext\{)/i.test(text)) return;
        return { type: 'inlineMath', raw: match[0], text, displayMode };
      },
      renderer: renderMath,
    },
  ],
});

export function renderNotebookMarkdown(source: string): string {
  const html = markdown.parse(source, { async: false });
  return sanitizeRichHtml(html, { allowImages: true, allowSvg: true, allowMathMl: true });
}
