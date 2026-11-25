import katex from 'katex';
import { Marked, type Tokens } from 'marked';
import markedCjkFriendly from 'marked-cjk-friendly';
import { sanitizeRichHtml } from '../../utils/sanitizeHtml';

function renderMath({ text, displayMode }: Tokens.Generic): string {
  return katex.renderToString(text, { displayMode, throwOnError: false, trust: false });
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
        // A single dollar hugs the formula on both sides, so prices such as "$5 to $10" stay literal.
        const displayMode = src.startsWith('$$');
        const match = displayMode
          ? /^\$\$((?:\\[^\n]|[^\\$\n])+)\$\$/.exec(src)
          : /^\$(?!\s)((?:\\[^\n]|[^\\$\n])+)(?<!\s)\$(?!\d)/.exec(src);
        if (match) return { type: 'inlineMath', raw: match[0], text: match[1], displayMode };
      },
      renderer: renderMath,
    },
  ],
});

export function renderNotebookMarkdown(source: string): string {
  const html = markdown.parse(source, { async: false });
  return sanitizeRichHtml(html, { allowImages: true, allowSvg: true, allowMathMl: true });
}
