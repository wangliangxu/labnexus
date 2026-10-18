import { t } from '../../i18n';
/**
 * WorkbenchTabs — Multi-tab navigation bar for IDE workspace.
 * Supports Notebooks, Terminals, and Settings tabs with dirty indicator and close actions.
 */

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
      className="flex items-center justify-between w-full h-9 px-1 select-none overflow-x-auto no-scrollbar"
      style={{
        background: 'var(--bg-sidebar)',
        borderBottom: '1px solid var(--border-default)',
      }}
    >
      {/* Tabs List */}
      <div className="flex items-center gap-1 h-full overflow-x-auto">
        {tabs.map((tab) => {
          const title = tab.type === 'terminal' && tab.data?.terminalName
            ? `${t('terminal:')} ${tab.data.terminalName}` : tab.title;
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className="group relative flex items-center gap-2 px-3 h-7 rounded-t-md text-xs font-medium cursor-pointer transition-all border-b-2 shrink-0 max-w-[180px]"
              style={{
                background: isActive ? 'var(--bg-card)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
                borderBottomColor: isActive ? 'var(--color-primary)' : 'transparent',
                boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
              title={`${title}${tab.isDirty ? t(' (Unsaved changes)') : ''}`}
            >
              {/* Tab Icon */}
              <span className="text-sm shrink-0">
                {tab.icon ||
                  (tab.type === 'notebook'
                    ? '📓'
                    : tab.type === 'terminal'
                    ? '💻'
                    : tab.type === 'settings'
                    ? '⚙️'
                    : '📄')}
              </span>

              {/* Title */}
              <span className="truncate min-w-[40px]">{title}</span>

              {/* Dirty Indicator / Close Button */}
              <div className="flex items-center shrink-0 ml-1">
                {tab.isDirty ? (
                  <span
                    className="w-2 h-2 rounded-full group-hover:hidden"
                    style={{ background: 'var(--color-warning)' }}
                    title={t('Unsaved changes')}
                  />
                ) : null}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className={`p-0.5 rounded transition-colors ${
                    tab.isDirty ? 'hidden group-hover:block' : 'opacity-60 group-hover:opacity-100'
                  }`}
                  style={{ color: 'var(--text-tertiary)' }}
                  title={t('Close Tab')}
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar actions on right */}
      <div className="flex items-center gap-1 px-2 shrink-0">
        {onNewTerminal && (
          <button
            onClick={onNewTerminal}
            className="p-1 rounded transition-colors text-xs flex items-center gap-1"
            style={{ color: 'var(--text-tertiary)' }}
            title={t('Open Remote Terminal')}
          >
            <span>+</span> <span className="text-[11px] font-mono">{t('💻 Terminal')}</span>
          </button>
        )}
      </div>
    </div>
  );
}
