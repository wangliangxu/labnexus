import React from 'react';
import { TableOfContents } from 'lucide-react';
import type { NotebookTocHeading } from './notebookToc';

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
  return (
    <div className="flex h-full min-h-0 flex-col bg-dark-surface text-sm text-gray-300">
      <div className="panel-header">
        <div className="min-w-0">
          <h3 className="panel-header__title">Table of Contents</h3>
          {notebookName && (
            <div className="mt-1 truncate text-[11px] text-gray-500" title={notebookName}>
              {notebookName}
            </div>
          )}
        </div>
        <TableOfContents size={16} className="shrink-0 text-gray-500" />
      </div>

      {headings.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-gray-500">
          <TableOfContents size={28} />
          <span>No markdown headings</span>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {headings.map((heading) => {
            const isActive = heading.id === activeHeadingId;
            return (
              <button
                key={heading.id}
                type="button"
                onClick={() => onSelectHeading(heading.id)}
                title={heading.text}
                className={`flex w-full items-center gap-2 rounded-sm border-l-2 py-1.5 pr-2 text-left text-xs transition-colors ${
                  isActive
                    ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
                    : 'border-transparent text-gray-400 hover:bg-dark-surface hover:text-gray-200'
                }`}
                style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    isActive ? 'bg-brand-primary' : 'bg-gray-600'
                  }`}
                />
                <span className="min-w-0 flex-1 truncate">{heading.text}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
