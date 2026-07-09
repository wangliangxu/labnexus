import React, { useCallback, useMemo, useState } from 'react';
import { ChevronDown, TableOfContents } from 'lucide-react';
import {
  headingHasNestedChildren,
  resolveVisibleTocHeadings,
  type NotebookTocHeading,
} from './notebookToc';

interface NotebookTocPanelProps {
  notebookName?: string;
  headings: NotebookTocHeading[];
  activeHeadingId: string | null;
  onSelectHeading: (headingId: string) => void;
}

export const NotebookTocPanel: React.FC<NotebookTocPanelProps> = ({
  notebookName,
  headings,
  activeHeadingId,
  onSelectHeading,
}) => {
  const [collapsedHeadingIds, setCollapsedHeadingIds] = useState<Set<string>>(
    () => new Set()
  );
  const visibleHeadings = useMemo(
    () => resolveVisibleTocHeadings(headings, collapsedHeadingIds),
    [collapsedHeadingIds, headings]
  );

  const toggleHeading = useCallback((headingId: string) => {
    setCollapsedHeadingIds((current) => {
      const next = new Set(current);
      if (next.has(headingId)) {
        next.delete(headingId);
      } else {
        next.add(headingId);
      }
      return next;
    });
  }, []);

  return (
    <div className="nb-toc-panel">
      <div className="nb-toc-panel__header">
        <div className="nb-toc-panel__title-group">
          <h3 className="nb-toc-panel__title">Table of Contents</h3>
          {notebookName && (
            <div className="nb-toc-panel__subtitle" title={notebookName}>
              {notebookName}
            </div>
          )}
        </div>
        <TableOfContents size={15} className="nb-toc-panel__icon" />
      </div>

      {headings.length === 0 ? (
        <div className="nb-toc-empty">
          <TableOfContents size={26} />
          <span>No markdown headings</span>
        </div>
      ) : (
        <div className="nb-toc-tree" role="tree" aria-label="Notebook headings">
          {visibleHeadings.map((heading) => {
            const headingIndex = headings.findIndex((item) => item.id === heading.id);
            const isActive = heading.id === activeHeadingId;
            const hasChildren = headingHasNestedChildren(headings, headingIndex);
            const isCollapsed = collapsedHeadingIds.has(heading.id);

            return (
              <div
                key={heading.id}
                title={heading.text}
                role="treeitem"
                aria-current={isActive ? 'location' : undefined}
                aria-expanded={hasChildren ? !isCollapsed : undefined}
                aria-level={heading.level}
                className={`nb-toc-tree__item ${isActive ? 'is-active' : ''}`}
                style={{ '--toc-indent': `${(heading.level - 1) * 13}px` } as React.CSSProperties}
              >
                <span className="nb-toc-tree__guide" aria-hidden="true" />
                {hasChildren ? (
                  <button
                    type="button"
                    className={`nb-toc-tree__twisty ${isCollapsed ? 'is-collapsed' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleHeading(heading.id);
                    }}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${heading.text}`}
                  >
                    <ChevronDown size={13} />
                  </button>
                ) : (
                  <span className="nb-toc-tree__twisty" aria-hidden="true" />
                )}
                <button
                  type="button"
                  className="nb-toc-tree__label"
                  onClick={() => onSelectHeading(heading.id)}
                >
                  {heading.text}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
