import {
  extractNotebookToc,
  resolveActiveTocHeadingId,
  resolveVisibleTocHeadings,
} from '../notebookToc.ts';
import type { Cell } from '../../../types/jupyter';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function markdownCell(id: string, source: string): Cell {
  return {
    id,
    cell_type: 'markdown',
    source,
    outputs: [],
    execution_count: null,
    metadata: {},
  };
}

function codeCell(id: string, source: string): Cell {
  return {
    id,
    cell_type: 'code',
    source,
    outputs: [],
    execution_count: null,
    metadata: {},
  };
}

const cells = [
  markdownCell('intro', '# Intro\n\ntext\n\n## Setup\n'),
  codeCell('run', '# not a markdown heading'),
  markdownCell(
    'analysis',
    '```python\n# ignored\n```\n\n### Results\n#### Details\n'
  ),
  markdownCell('empty', 'plain text'),
];

const toc = extractNotebookToc(cells);

assert(toc.length === 4, 'extracts markdown headings only');
assert(toc[0].id === 'intro:0', 'heading id uses cell id and line number');
assert(toc[0].level === 1, 'extracts h1 level');
assert(toc[0].text === 'Intro', 'extracts heading text');
assert(toc[1].cellIndex === 0, 'tracks heading cell index');
assert(toc[1].line === 4, 'tracks heading line number');
assert(toc[2].text === 'Results', 'ignores headings inside fenced code blocks');
assert(toc[3].level === 4, 'preserves deeper heading levels');

assert(
  resolveActiveTocHeadingId(toc, { cellIndex: 0, line: 0 }) === 'intro:0',
  'cursor on h1 selects that heading'
);
assert(
  resolveActiveTocHeadingId(toc, { cellIndex: 0, line: 5 }) === 'intro:4',
  'cursor after h2 in same cell selects nearest preceding heading'
);
assert(
  resolveActiveTocHeadingId(toc, { cellIndex: 1, line: 0 }) === 'intro:4',
  'cursor in following code cell keeps previous heading active'
);
assert(
  resolveActiveTocHeadingId(toc, { cellIndex: 2, line: 4 }) === 'analysis:4',
  'cursor on deeper heading selects exact heading'
);
assert(
  resolveActiveTocHeadingId([], { cellIndex: 0, line: 0 }) === null,
  'empty toc has no active heading'
);

const visibleWithLeafCollapsed = resolveVisibleTocHeadings(
  toc,
  new Set(['analysis:5'])
);
assert(
  visibleWithLeafCollapsed.map((heading) => heading.text).join(',') ===
    'Intro,Setup,Results,Details',
  'collapsing a leaf heading keeps following headings visible'
);

const nestedToc = extractNotebookToc([
  markdownCell('chapter', '# Chapter\n## Section\n### Hidden\n## Next\n'),
]);
const collapsedNested = resolveVisibleTocHeadings(
  nestedToc,
  new Set(['chapter:1'])
);
assert(
  collapsedNested.map((heading) => heading.text).join(',') === 'Chapter,Section,Next',
  'collapsing a heading hides only deeper nested headings until the next sibling'
);
