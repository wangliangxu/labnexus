import type { Cell } from '../../types/jupyter';

export interface NotebookTocHeading {
  id: string;
  cellId: string;
  cellIndex: number;
  line: number;
  level: number;
  text: string;
}

export interface NotebookCursorPosition {
  cellIndex: number;
  line: number;
}

export interface NotebookTocState {
  headings: NotebookTocHeading[];
  activeHeadingId: string | null;
}

export interface NotebookTocScrollRequest {
  tabId: string;
  headingId: string;
  nonce: number;
}

const headingPattern = /^(#{1,6})(?:[ \t]+|$)(.*)$/;
const fencePattern = /^[ \t]*(`{3,}|~{3,})/;

function sourceToText(source: Cell['source']): string {
  return Array.isArray(source) ? source.join('') : source || '';
}

function stripClosingHashes(text: string): string {
  return text.replace(/[ \t]+#+[ \t]*$/, '').trim();
}

export function extractNotebookToc(cells: Cell[]): NotebookTocHeading[] {
  const headings: NotebookTocHeading[] = [];

  cells.forEach((cell, cellIndex) => {
    if (cell.cell_type !== 'markdown') return;

    const lines = sourceToText(cell.source).split(/\r?\n/);
    let fenceMarker: '`' | '~' | null = null;
    let fenceLength = 0;

    lines.forEach((line, lineIndex) => {
      const fenceMatch = line.match(fencePattern);
      if (fenceMatch) {
        const marker = fenceMatch[1][0] as '`' | '~';
        if (!fenceMarker) {
          fenceMarker = marker;
          fenceLength = fenceMatch[1].length;
          return;
        }
        if (marker === fenceMarker && fenceMatch[1].length >= fenceLength) {
          fenceMarker = null;
          fenceLength = 0;
          return;
        }
      }

      if (fenceMarker) return;

      const headingMatch = line.match(headingPattern);
      if (!headingMatch) return;

      const text = stripClosingHashes(headingMatch[2]);
      if (!text) return;

      const cellId = cell.id || `cell-${cellIndex}`;
      headings.push({
        id: `${cellId}:${lineIndex}`,
        cellId,
        cellIndex,
        line: lineIndex,
        level: headingMatch[1].length,
        text,
      });
    });
  });

  return headings;
}

export function resolveActiveTocHeadingId(
  headings: NotebookTocHeading[],
  cursor: NotebookCursorPosition
): string | null {
  let activeHeading: NotebookTocHeading | null = null;

  for (const heading of headings) {
    if (
      heading.cellIndex < cursor.cellIndex ||
      (heading.cellIndex === cursor.cellIndex && heading.line <= cursor.line)
    ) {
      activeHeading = heading;
      continue;
    }
    break;
  }

  return activeHeading?.id || null;
}
