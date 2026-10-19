import { t } from '../../i18n';
/**
 * WorkbenchTabs — Multi-tab navigation bar for IDE workspace.
 * Supports Notebooks, Files, Terminals, and Settings tabs with dirty indicator and close actions.
 */

import {
  BookOpen,
  Terminal,
  Settings,
  FileCode,
  FileJson,
  FileText,
  Image,
  X,
  Plus,
} from 'lucide-react';

export type TabType = 'notebook' | 'file' | 'terminal' | 'welcome' | 'settings';

export interface TabItem {
  id: string;
  type: TabType;
  title: string;
  isDirty?: boolean;
  icon?: string;
  data?: any;
}

interface WorkbenchTabsProps {
  tabs: TabItem[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTerminal?: () => void;
}

function renderTabIcon(tab: TabItem) {
  if (tab.type === 'notebook') {
    return (
      <BookOpen
        size={13}
        strokeWidth={1.8}
        className="shrink-0"
        style={{ color: 'var(--color-primary)' }}
      />
    );
  }
  if (tab.type === 'terminal') {
    return (
      <Terminal
        size={13}
        strokeWidth={1.8}
        className="shrink-0"
        style={{ color: 'var(--color-success)' }}
      />
    );
  }
  if (tab.type === 'settings') {
    return <Settings size={13} strokeWidth={1.8} className="shrink-0" />;
  }

  const ext = tab.title.split('.').pop()?.toLowerCase();
  if (ext === 'py' || ext === 'pyi' || ext === 'sh' || ext === 'js' || ext === 'ts') {
    return (
      <FileCode
        size={13}
        strokeWidth={1.8}
        className="shrink-0"
        style={{ color: 'var(--color-primary)' }}
      />
    );
  }
  if (ext === 'json' || ext === 'geojson') {
    return (
      <FileJson
        size={13}
        strokeWidth={1.8}
        className="shrink-0"
        style={{ color: 'var(--color-warning)' }}
      />
    );
  }
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'svg' || ext === 'webp') {
    return <Image size={13} strokeWidth={1.8} className="shrink-0" />;
  }

  return <FileText size={13} strokeWidth={1.8} className="shrink-0" />;
}

export function WorkbenchTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTerminal,
}: WorkbenchTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <div
      className="flex items-center justify-between w-full h-[34px] px-1.5 select-none overflow-x-auto no-scrollbar shrink-0"
      style={{
        background: 'var(--bg-sidebar)',
        borderBottom: '1px solid var(--border-default)',
      }}
    >
      {/* Tabs List */}
      <div className="flex items-end gap-0.5 h-full overflow-x-auto">
        {tabs.map((tab) => {
          const title =
            tab.type === 'terminal' && tab.data?.terminalName
              ? `${t('terminal:')} ${tab.data.terminalName}`
              : tab.title;
          const isActive = tab.id === activeTabId;
          const fullPath = tab.data?.path ? ` (${tab.data.path})` : '';
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className="group relative flex items-center gap-1.5 px-2.5 h-[30px] rounded-t-[5px] text-xs font-medium cursor-pointer transition-all border-t-2 shrink-0 max-w-[200px]"
              style={{
                background: isActive ? 'var(--bg-editor)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                borderTopColor: isActive ? 'var(--color-primary)' : 'transparent',
                borderLeft: isActive ? '1px solid var(--border-subtle)' : '1px solid transparent',
                borderRight: isActive ? '1px solid var(--border-subtle)' : '1px solid transparent',
              }}
              title={`${title}${fullPath}${tab.isDirty ? t(' (Unsaved changes)') : ''}`}
            >
              {/* Tab Icon */}
              {renderTabIcon(tab)}

              {/* Title */}
              <span className="truncate min-w-[36px] leading-none">{title}</span>

              {/* Dirty Indicator / Close Button */}
              <div className="flex items-center justify-center w-4 h-4 shrink-0 ml-0.5">
                {tab.isDirty ? (
                  <span
                    className="w-2 h-2 rounded-full group-hover:hidden"
                    style={{ background: 'var(--color-warning)' }}
                    title={t('Unsaved changes')}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className={`inline-flex items-center justify-center w-4 h-4 rounded-xs transition-colors hover:bg-nb-btn-hover ${
                    tab.isDirty
                      ? 'hidden group-hover:inline-flex'
                      : 'opacity-55 group-hover:opacity-100'
                  }`}
                  style={{ color: 'var(--text-secondary)' }}
                  title={t('Close Tab')}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar actions on right */}
      <div className="flex items-center gap-1 px-1.5 shrink-0">
        {onNewTerminal && (
          <button
            type="button"
            onClick={onNewTerminal}
            className="px-2 py-1 rounded-sm transition-colors text-xs inline-flex items-center gap-1 hover:bg-nb-btn-hover cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
            title={t('Open Remote Terminal')}
          >
            <Plus size={12} strokeWidth={2} />
            <Terminal size={12} strokeWidth={1.8} />
            <span className="text-[11px] font-medium">{t('Terminal')}</span>
          </button>
        )}
      </div>
    </div>
  );
}
