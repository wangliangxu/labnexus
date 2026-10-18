import {
  sanitizeHtmlFragment,
  renderSanitizedMarkdown,
  sanitizeSvgFragment,
} from '../sanitizeHtml.ts';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const dirtyHtml =
  '<div><p onclick="alert(1)">Hello</p><script>window.evil=true</script><a href="javascript:alert(2)">Click</a></div>';
const cleanedHtml = sanitizeHtmlFragment(dirtyHtml);

assert(!cleanedHtml.includes('<script'), 'strips script tags');
assert(!cleanedHtml.includes('onclick'), 'strips inline event handlers');
assert(!cleanedHtml.includes('javascript:'), 'strips javascript: URLs');
assert(cleanedHtml.includes('Hello'), 'preserves safe text content');

const dirtyMd = '# Title\n\n<img src=x onerror="alert(1)" />\n\n[Bad](javascript:evil())';
const cleanedMd = renderSanitizedMarkdown(dirtyMd);
assert(!cleanedMd.includes('onerror'), 'markdown sanitizer removes onerror');
assert(!cleanedMd.includes('javascript:'), 'markdown sanitizer removes javascript: href');
assert(cleanedMd.includes('Title'), 'markdown sanitizer renders heading');

const dirtySvg =
  '<svg viewBox="0 0 10 10" onload="alert(1)"><circle cx="5" cy="5" r="4"/><script>evil()</script></svg>';
const cleanedSvg = sanitizeSvgFragment(dirtySvg);
assert(!cleanedSvg.includes('<script'), 'svg sanitizer removes script elements');
assert(!cleanedSvg.includes('onload'), 'svg sanitizer removes onload handler');
assert(cleanedSvg.includes('<circle'), 'svg sanitizer preserves circle element');
