/**
 * WorkbenchTabs — Multi-tab navigation bar for IDE workspace.
 * Supports Notebooks, Terminals, and Settings tabs with dirty indicator and close actions.
 */

export type TabType = 'notebook' | 'terminal' | 'welcome' | 'settings';

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
    <div className="flex items-center justify-between w-full h-9 bg-zinc-900 border-b border-zinc-800 px-1 select-none overflow-x-auto no-scrollbar">
      {/* Tabs List */}
      <div className="flex items-center gap-1 h-full overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group relative flex items-center gap-2 px-3 h-7 rounded-t-md text-xs font-medium cursor-pointer transition-all border-b-2 shrink-0 max-w-[180px] ${
                isActive
                  ? 'bg-zinc-800 text-zinc-100 border-sky-500 shadow-sm'
                  : 'bg-transparent hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 border-transparent'
              }`}
              title={`${tab.title}${tab.isDirty ? ' (Unsaved changes)' : ''}`}
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
              <span className="truncate min-w-[40px]">{tab.title}</span>

              {/* Dirty Indicator / Close Button */}
              <div className="flex items-center shrink-0 ml-1">
                {tab.isDirty ? (
                  <span
                    className="w-2 h-2 rounded-full bg-amber-500 group-hover:hidden"
                    title="Unsaved changes"
                  />
                ) : null}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className={`p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors ${
                    tab.isDirty ? 'hidden group-hover:block' : 'opacity-60 group-hover:opacity-100'
                  }`}
                  title="Close Tab"
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
            className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-sky-400 rounded transition-colors text-xs flex items-center gap-1"
            title="Open Remote Terminal"
          >
            <span>+</span> <span className="text-[11px] font-mono">💻 Terminal</span>
          </button>
        )}
      </div>
    </div>
  );
}
