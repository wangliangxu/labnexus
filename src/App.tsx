/**
 * LabNexus — Main application entry point.
 * Integrated with multi-tab workbench, remote terminals, dynamic theme system, and AI Agent.
 */

import { useState, useMemo, useRef, useCallback, useEffect, type SetStateAction } from 'react';
import { WorkbenchLayout, type PanelId } from './layouts/WorkbenchLayout';
import { ConnectionPanel } from './components/explorer/ConnectionPanel';
import { FileExplorer } from './components/explorer/FileExplorer';
import type { TreeNode } from './components/explorer/fileExplorerTree';
import { StatusBar } from './components/common/StatusBar';
import { WelcomeScreen } from './components/common/WelcomeScreen';
import { WorkbenchTabs, type TabItem } from './components/common/WorkbenchTabs';
import { NotebookEditor } from './components/notebook/NotebookEditor';
import { NotebookTocPanel } from './components/notebook/NotebookTocPanel';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { TerminalSelector } from './components/terminal/TerminalSelector';
import { SettingsModal } from './components/settings/SettingsModal';
import { AgentChatPanel } from './components/agent/AgentChatPanel';
import type { AgentChatContext } from './types/agent';
import type {
  NotebookTocHeading,
  NotebookTocScrollRequest,
  NotebookTocState,
} from './components/notebook/notebookToc';
import {
  readWorkspaceContextSnapshot,
  storeWorkspaceContextSnapshot,
} from './workspaceContextSnapshot';
import { useJupyter } from './hooks/useJupyter';
import { jupyterCreateTerminal } from './services/tauriIpc';
import { resolveServerSelectionViewMode, type ViewMode } from './appViewMode';
import {
  getJupyterConnectionErrorRecovery,
  normalizeJupyterConnectionErrorMessage,
} from './jupyterConnectionErrors';
import './index.css';
import './components/agent/Agent.css';

function App() {
  const {
    servers,
    activeServerId,
    isConnecting,
    error,
    connect,
    connectHub,
    disconnect,
    reconnect,
    forget,
    setActive,
    markServerError,
    restartHubServer,
  } = useJupyter();

  const [viewMode, setViewMode] = useState<ViewMode>('connect');
  const [activePanel, setActivePanel] = useState<PanelId>('explorer');
  const [explorerTrees, setExplorerTrees] = useState<Record<string, TreeNode[]>>({});
  const connectedServerIdsRef = useRef<Set<string>>(new Set());
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isAgentOpen, setIsAgentOpen] = useState<boolean>(false);
  const workspaceContextRef = useRef<AgentChatContext>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<'global' | 'ai'>('global');
  const [notebookToc, setNotebookToc] = useState<
    NotebookTocState & { tabId: string | null }
  >({
    tabId: null,
    headings: [],
    activeHeadingId: null,
  });
  const [tocScrollRequest, setTocScrollRequest] =
    useState<NotebookTocScrollRequest | null>(null);

  const activeServer = useMemo(
    () => servers.find((s) => s.config.id === activeServerId) ?? null,
    [servers, activeServerId]
  );
  const connectedServerIds = useMemo(
    () =>
      new Set(
        servers
          .filter((server) => server.status === 'connected')
          .map((server) => server.config.id)
      ),
    [servers]
  );
  connectedServerIdsRef.current = connectedServerIds;
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, tabs]
  );
  const appErrorRecovery = getJupyterConnectionErrorRecovery(error);
  const appErrorMessage = error
    ? normalizeJupyterConnectionErrorMessage(error)
    : null;

  const handleWorkspaceContextChange = useCallback((ctx: AgentChatContext) => {
    storeWorkspaceContextSnapshot(workspaceContextRef, ctx);
  }, []);

  const handleNotebookTocChange = useCallback(
    (tabId: string, state: NotebookTocState) => {
      setNotebookToc((current) => {
        if (
          current.tabId === tabId &&
          current.headings === state.headings &&
          current.activeHeadingId === state.activeHeadingId
        ) {
          return current;
        }

        return {
          tabId,
          headings: state.headings,
          activeHeadingId: state.activeHeadingId,
        };
      });
    },
    []
  );

  const handleTocHeadingSelect = useCallback(
    (headingId: string) => {
      if (!activeTabId) return;
      setTocScrollRequest({
        tabId: activeTabId,
        headingId,
        nonce: Date.now(),
      });
    },
    [activeTabId]
  );

  const getWorkspaceContext = useCallback(
    () => readWorkspaceContextSnapshot(workspaceContextRef),
    []
  );

  useEffect(() => {
    if (activeTab?.type === 'notebook') return;
    setNotebookToc({
      tabId: null,
      headings: [],
      activeHeadingId: null,
    });
  }, [activeTab?.type]);

  // Explorer panels are unmounted when another side panel is shown. Keep the
  // expanded tree for each live server at app level, and discard it once that
  // server is no longer connected.
  useEffect(() => {
    setExplorerTrees((current) => {
      const retained = Object.fromEntries(
        Object.entries(current).filter(([serverId]) => connectedServerIds.has(serverId))
      );
      return Object.keys(retained).length === Object.keys(current).length
        ? current
        : retained;
    });
  }, [connectedServerIds]);

  const handleExplorerTreeChange = useCallback(
    (serverId: string, update: SetStateAction<TreeNode[]>) => {
      setExplorerTrees((current) => {
        // Ignore a late directory response from a connection that was closed
        // while its request was still in flight.
        if (!connectedServerIdsRef.current.has(serverId)) return current;

        const currentTree = current[serverId] ?? [];
        const nextTree = typeof update === 'function' ? update(currentTree) : update;
        return { ...current, [serverId]: nextTree };
      });
    },
    []
  );

  // Auto-switch to explorer view after connection
  const handleConnect = async (config: Parameters<typeof connect>[0]) => {
    await connect(config);
    setViewMode('explore');
  };

  const handleConnectHub = async (config: Parameters<typeof connectHub>[0]) => {
    await connectHub(config);
    setViewMode('explore');
  };

  // Open notebook or file in a tab
  const handleFileOpen = (path: string, type: string) => {
    const title = path.split('/').pop() || path;
    const tabId = path;

    setTabs((prev) => {
      if (prev.some((t) => t.id === tabId)) return prev;
      return [
        ...prev,
        {
          id: tabId,
          type: type === 'notebook' || path.endsWith('.ipynb') ? 'notebook' : 'welcome',
          title,
          icon: type === 'notebook' || path.endsWith('.ipynb') ? '📓' : '📄',
          data: { path },
        },
      ];
    });
    setActiveTabId(tabId);
  };

  // Open terminal in a tab
  const handleOpenTerminal = (name: string) => {
    const tabId = `term-${name}`;
    setTabs((prev) => {
      if (prev.some((t) => t.id === tabId)) return prev;
      return [
        ...prev,
        {
          id: tabId,
          type: 'terminal',
          title: `terminal: ${name}`,
          icon: '💻',
          data: { terminalName: name },
        },
      ];
    });
    setActiveTabId(tabId);
  };

  // Create and open new terminal
  const handleNewTerminal = async () => {
    try {
      const newTerm = await jupyterCreateTerminal(activeServerId || undefined);
      handleOpenTerminal(newTerm.name);
    } catch (err) {
      console.error('Failed to create terminal:', err);
    }
  };

  // Close tab and switch focus
  const handleCloseTab = (id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const nextTabs = prev.filter((t) => t.id !== id);

      if (activeTabId === id) {
        if (nextTabs.length > 0) {
          const nextIdx = Math.min(idx, nextTabs.length - 1);
          setActiveTabId(nextTabs[nextIdx].id);
        } else {
          setActiveTabId(null);
        }
      }
      return nextTabs;
    });
  };

  // Handle activity bar panel clicks
  const handlePanelChange = (id: PanelId) => {
    if (id === 'agent') {
      setIsAgentOpen(!isAgentOpen);
      return;
    }
    if (id === 'settings') {
      setSettingsTab('global');
      setIsSettingsOpen(true);
      return;
    }
    setActivePanel(id);
  };

  // Build the side panel content based on activePanel and viewMode
  const renderPanelContent = () => {
    if (activePanel === 'toc') {
      const isNotebookTocCurrent =
        activeTab?.type === 'notebook' && notebookToc.tabId === activeTab.id;
      const headings: NotebookTocHeading[] = isNotebookTocCurrent
        ? notebookToc.headings
        : [];

      return (
        <NotebookTocPanel
          notebookName={activeTab?.type === 'notebook' ? activeTab.title : undefined}
          headings={headings}
          activeHeadingId={isNotebookTocCurrent ? notebookToc.activeHeadingId : null}
          onSelectHeading={handleTocHeadingSelect}
        />
      );
    }

    if (activePanel === 'terminal') {
      return (
        <TerminalSelector
          serverId={activeServerId || undefined}
          onSelectTerminal={handleOpenTerminal}
        />
      );
    }

    // Default to explorer panel
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* Server connection list */}
        {servers.length > 0 && (
          <div style={{ borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, maxHeight: '40%', overflowY: 'auto' }}>
            <div className="panel-header" style={{ padding: '8px 12px' }}>
              <h3 className="panel-header__title">Servers</h3>
              <button
                className="btn btn-icon btn-ghost"
                onClick={() => setViewMode('connect')}
                title="Add Server"
                style={{ fontSize: '16px' }}
              >
                +
              </button>
            </div>
            <div style={{ padding: '0 4px 8px' }}>
              {servers.map((server) => (
                <div
                  key={server.config.id}
                  className={`server-item ${server.config.id === activeServerId ? 'active' : ''}`}
                  onClick={() => {
                    if (server.status === 'connected') {
                      setViewMode((current) =>
                        resolveServerSelectionViewMode(current, server.status)
                      );
                      setActive(server.config.id);
                    } else if (!isConnecting) {
                      setViewMode((current) =>
                        resolveServerSelectionViewMode(current, server.status)
                      );
                      reconnect(server.config.id);
                    }
                  }}
                >
                  <span className={`status-dot ${server.status}`} />
                  <div className="server-item__info">
                    <div className="server-item__name truncate">
                      {server.config.name}
                    </div>
                    <div className="server-item__url truncate">
                      {server.config.base_url}
                    </div>
                  </div>
                  <div className="server-item__actions">
                    {(server.status === 'disconnected' || server.status === 'error') && (
                      <button
                        className="btn btn-icon btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewMode((current) =>
                            resolveServerSelectionViewMode(current, server.status)
                          );
                          reconnect(server.config.id);
                        }}
                        title="Reconnect"
                        disabled={isConnecting}
                        style={{ fontSize: '12px' }}
                      >
                        ↻
                      </button>
                    )}
                    <button
                      className="btn btn-icon btn-ghost btn-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (server.status === 'connected') {
                          disconnect(server.config.id);
                        } else {
                          forget(server.config.id);
                        }
                      }}
                      title={server.status === 'connected' ? 'Disconnect' : 'Forget'}
                      style={{ fontSize: '12px' }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* View content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {viewMode === 'connect' ? (
            <ConnectionPanel
              onConnect={handleConnect}
              onConnectHub={handleConnectHub}
              isConnecting={isConnecting}
            />
          ) : (
            <FileExplorer
              activeServer={activeServer}
              tree={
                activeServer && Object.prototype.hasOwnProperty.call(explorerTrees, activeServer.config.id)
                  ? explorerTrees[activeServer.config.id]
                  : null
              }
              onTreeChange={(update) => {
                if (activeServer) {
                  handleExplorerTreeChange(activeServer.config.id, update);
                }
              }}
              onFileOpen={handleFileOpen}
              onReconnect={
                activeServer ? () => reconnect(activeServer.config.id) : undefined
              }
              onRestartServer={
                activeServer
                  ? (restartUrl) =>
                      restartHubServer(activeServer.config.id, restartUrl)
                  : undefined
              }
              onConnectionLost={
                activeServer
                  ? (message) => markServerError(activeServer.config.id, message)
                  : undefined
              }
              isReconnecting={isConnecting}
            />
          )}
        </div>

        {/* Error display */}
        {error && (
          <div
            style={{
              padding: '8px 12px',
              fontSize: '12px',
              color: 'var(--color-error)',
              background: 'var(--color-error-subtle)',
              borderTop: '1px solid var(--border-subtle)',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <span>⚠️ {appErrorMessage}</span>
            {appErrorRecovery.restartUrl && activeServer && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() =>
                  restartHubServer(activeServer.config.id, appErrorRecovery.restartUrl!)
                }
                disabled={isConnecting}
                type="button"
              >
                {isConnecting ? 'Restarting...' : 'Restart server'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <WorkbenchLayout
        sidebar={null}
        panel={renderPanelContent()}
        activePanel={activePanel}
        onPanelChange={handlePanelChange}
        editor={
          <div className="app-editor-shell">
            <WorkbenchTabs
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onCloseTab={handleCloseTab}
              onNewTerminal={handleNewTerminal}
            />
            <div className="app-editor-content">
              {tabs.length === 0 ? (
                <WelcomeScreen />
              ) : (
                tabs.map((tab) => {
                  const isCurrent = tab.id === activeTabId;
                  return (
                    <div
                      key={tab.id}
                      className="app-editor-tab"
                      style={{ display: isCurrent ? 'flex' : 'none' }}
                    >
                      {tab.type === 'notebook' ? (
                        <NotebookEditor
                          path={tab.data.path}
                          serverId={activeServerId || undefined}
                          onClose={() => handleCloseTab(tab.id)}
                          onContextChange={handleWorkspaceContextChange}
                          tocOwnerId={isCurrent ? tab.id : undefined}
                          tocScrollRequest={isCurrent ? tocScrollRequest : null}
                          onTocChange={handleNotebookTocChange}
                        />
                      ) : tab.type === 'terminal' ? (
                        <TerminalPanel
                          serverId={activeServerId || undefined}
                          terminalName={tab.data.terminalName}
                          onClose={() => handleCloseTab(tab.id)}
                        />
                      ) : (
                        <div
                          className="flex-1 flex flex-col items-center justify-center gap-3 w-full h-full"
                          style={{ background: 'var(--bg-editor)', color: 'var(--text-secondary)' }}
                        >
                          <p className="text-sm font-medium">Text editor for {tab.title} coming soon</p>
                          <button
                            onClick={() => handleCloseTab(tab.id)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                            style={{
                              background: 'var(--bg-card)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border-default)',
                            }}
                          >
                            Close File
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        }
        statusBar={
          <StatusBar
            activeServer={activeServer}
            serverCount={servers.length}
            onToggleAgent={() => setIsAgentOpen(!isAgentOpen)}
            isAgentOpen={isAgentOpen}
          />
        }
      />
      <AgentChatPanel
        isOpen={isAgentOpen}
        onClose={() => setIsAgentOpen(false)}
        getWorkspaceContext={getWorkspaceContext}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        defaultTab={settingsTab}
      />
    </>
  );
}

export default App;
