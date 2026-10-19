import { t } from './i18n';
import { useLocale } from './i18n';
/**
 * LabNexus — Main application entry point.
 * Integrated with multi-tab workbench, remote terminals, dynamic theme system, and AI Agent.
 */

import { LocalJupyterPanel } from './components/explorer/LocalJupyterPanel';
import { LOCAL_JUPYTER_SERVER_ID } from './types/jupyter';
import { useState, useMemo, useRef, useCallback, useEffect, type SetStateAction } from 'react';
import {
  Plus,
  RefreshCw,
  X,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { WorkbenchLayout, type PanelId } from './layouts/WorkbenchLayout';
import { ConnectionPanel } from './components/explorer/ConnectionPanel';
import { FileExplorer } from './components/explorer/FileExplorer';
import type { TreeNode } from './components/explorer/fileExplorerTree';
import { StatusBar } from './components/common/StatusBar';
import { WelcomeScreen } from './components/common/WelcomeScreen';
import { WorkbenchTabs, type TabItem } from './components/common/WorkbenchTabs';
import { NotebookEditor } from './components/notebook/NotebookEditor';
import { FileEditor } from './components/editor/FileEditor';
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
  useLocale();
  const {
    servers,
    activeServerId,
    isConnecting,
    error,
    connect,
    connectHub,
    startLocal,
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
  const [agentWidth, setAgentWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('labnexus:agent-width'));
    return Number.isFinite(saved) && saved >= 400 ? saved : 500;
  });
  const [isAgentFullscreen, setIsAgentFullscreen] = useState(false);
  const workspaceContextRef = useRef<AgentChatContext>({});
  const [isServersCollapsed, setIsServersCollapsed] = useState<boolean>(false);
  const [statusBarTelemetry, setStatusBarTelemetry] = useState<{
    kernelStatus?: string;
    activeCellIndex?: number;
  }>({});
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
    setStatusBarTelemetry((prev) => {
      if (
        prev.kernelStatus === ctx.kernel_status &&
        prev.activeCellIndex === ctx.active_cell_index
      ) {
        return prev;
      }
      return {
        kernelStatus: ctx.kernel_status,
        activeCellIndex: ctx.active_cell_index,
      };
    });
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
    setStatusBarTelemetry({});
    workspaceContextRef.current = {
      server_id: activeTab?.data?.serverId || activeServerId || undefined,
    };
  }, [activeServerId, activeTab]);

  useEffect(() => {
    localStorage.setItem('labnexus:agent-width', String(agentWidth));
  }, [agentWidth]);

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

  const handleTabDirtyChange = useCallback((tabId: string, isDirty: boolean) => {
    setTabs((prev) => {
      const target = prev.find((t) => t.id === tabId);
      if (!target || Boolean(target.isDirty) === isDirty) return prev;
      return prev.map((t) => (t.id === tabId ? { ...t, isDirty } : t));
    });
  }, []);

  // Open notebook or file in a tab
  const handleFileOpen = (path: string, type: string) => {
    const title = path.split('/').pop() || path;
    const boundServerId = activeServerId || undefined;
    const tabId = boundServerId ? `${boundServerId}:${path}` : path;
    const isNotebook = type === 'notebook' || path.toLowerCase().endsWith('.ipynb');

    setTabs((prev) => {
      if (prev.some((t) => t.id === tabId)) return prev;
      return [
        ...prev,
        {
          id: tabId,
          type: isNotebook ? 'notebook' : 'file',
          title,
          isDirty: false,
          icon: isNotebook ? '📓' : '📄',
          data: { path, serverId: boundServerId },
        },
      ];
    });
    setActiveTabId(tabId);
  };

  const handleFileRenamed = useCallback(
    (oldPath: string, newPath: string) => {
      const boundServerId = activeServerId || undefined;
      const oldTabId = boundServerId ? `${boundServerId}:${oldPath}` : oldPath;
      const newTabId = boundServerId ? `${boundServerId}:${newPath}` : newPath;
      const newTitle = newPath.split('/').pop() || newPath;

      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === oldTabId
            ? {
                ...tab,
                id: newTabId,
                title: newTitle,
                data: { ...tab.data, path: newPath },
              }
            : tab
        )
      );
      setActiveTabId((prev) => (prev === oldTabId ? newTabId : prev));
    },
    [activeServerId]
  );

  const handleFileDeleted = useCallback(
    (deletedPath: string) => {
      const boundServerId = activeServerId || undefined;
      const targetTabId = boundServerId ? `${boundServerId}:${deletedPath}` : deletedPath;
      setTabs((prev) => {
        const idx = prev.findIndex(
          (t) =>
            t.id === targetTabId ||
            (t.data?.serverId === boundServerId &&
              typeof t.data?.path === 'string' &&
              (t.data.path === deletedPath || t.data.path.startsWith(`${deletedPath}/`)))
        );
        if (idx === -1) return prev;
        const nextTabs = prev.filter(
          (t) =>
            !(
              t.id === targetTabId ||
              (t.data?.serverId === boundServerId &&
                typeof t.data?.path === 'string' &&
                (t.data.path === deletedPath || t.data.path.startsWith(`${deletedPath}/`)))
            )
        );
        setActiveTabId((curr) => {
          if (!curr || nextTabs.some((t) => t.id === curr)) return curr;
          if (nextTabs.length === 0) return null;
          return nextTabs[Math.min(idx, nextTabs.length - 1)].id;
        });
        return nextTabs;
      });
    },
    [activeServerId]
  );

  // Open terminal in a tab
  const handleOpenTerminal = (name: string) => {
    const boundServerId = activeServerId || undefined;
    const tabId = boundServerId ? `${boundServerId}:term-${name}` : `term-${name}`;
    setTabs((prev) => {
      if (prev.some((t) => t.id === tabId)) return prev;
      return [
        ...prev,
        {
          id: tabId,
          type: 'terminal',
          title: `terminal: ${name}`,
          icon: '💻',
          data: { terminalName: name, serverId: boundServerId },
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
    const targetTab = tabs.find((tab) => tab.id === id);
    if (targetTab?.isDirty) {
      const confirmed = window.confirm(
        t('"{name}" has unsaved changes. Close without saving?', {
          name: targetTab.title,
        })
      );
      if (!confirmed) return;
    }

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
        <LocalJupyterPanel
          isConnecting={isConnecting}
          connected={servers.some(
            (server) =>
              server.config.id === LOCAL_JUPYTER_SERVER_ID &&
              server.status === 'connected'
          )}
          hasOtherConnectedServer={connectedServerIds.size > 0}
          onStart={async () => {
            if (await startLocal()) setViewMode('explore');
          }}
        />
        {/* Server connection list */}
        {servers.length > 0 && (
          <div style={{ borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, maxHeight: '38%', overflowY: 'auto' }}>
            <div
              className="panel-header"
              style={{ padding: '7px 12px', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setIsServersCollapsed((prev) => !prev)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {isServersCollapsed ? (
                  <ChevronRight size={13} style={{ color: 'var(--text-tertiary)' }} />
                ) : (
                  <ChevronDown size={13} style={{ color: 'var(--text-tertiary)' }} />
                )}
                <h3 className="panel-header__title">{t('Servers')}</h3>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '1px 5px',
                    borderRadius: '9999px',
                    background: 'var(--bg-hover)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {servers.length}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-icon btn-ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewMode('connect');
                }}
                title={t('Add Server')}
              >
                <Plus size={14} />
              </button>
            </div>
            {!isServersCollapsed && (
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
                          type="button"
                          className="btn btn-icon btn-ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewMode((current) =>
                              resolveServerSelectionViewMode(current, server.status)
                            );
                            reconnect(server.config.id);
                          }}
                          title={t('Reconnect')}
                          disabled={isConnecting}
                        >
                          <RefreshCw size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-icon btn-ghost btn-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (server.status === 'connected') {
                            disconnect(server.config.id);
                          } else {
                            forget(server.config.id);
                          }
                        }}
                        title={
                          server.status === 'connected'
                            ? server.config.id === LOCAL_JUPYTER_SERVER_ID
                              ? t('Stop local server')
                              : t('Disconnect')
                            : t('Forget')
                        }
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* View content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {viewMode === 'connect' ? (
            <ConnectionPanel
              onConnect={handleConnect}
              onConnectHub={handleConnectHub}
              onBack={activeServer ? () => setViewMode('explore') : undefined}
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
              onFileRenamed={handleFileRenamed}
              onFileDeleted={handleFileDeleted}
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
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle size={13} className="shrink-0" />
              <span>{appErrorMessage}</span>
            </span>
            {appErrorRecovery.restartUrl && activeServer && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() =>
                  restartHubServer(activeServer.config.id, appErrorRecovery.restartUrl!)
                }
                disabled={isConnecting}
                type="button"
              >
                {isConnecting ? t('Restarting...') : t('Restart server')}
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
        assistantOpen={isAgentOpen}
        assistantWidth={agentWidth}
        assistantFullscreen={isAgentFullscreen}
        assistant={isAgentOpen ? (
          <AgentChatPanel
            isOpen
            onClose={() => {
              setIsAgentOpen(false);
              setIsAgentFullscreen(false);
            }}
            getWorkspaceContext={getWorkspaceContext}
            width={agentWidth}
            onWidthChange={setAgentWidth}
            isFullscreen={isAgentFullscreen}
            onToggleFullscreen={() => setIsAgentFullscreen((value) => !value)}
          />
        ) : undefined}
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
                <WelcomeScreen
                  onConnectServer={() => {
                    setActivePanel('explorer');
                    setViewMode('connect');
                  }}
                  onOpenExplorer={() => {
                    setActivePanel('explorer');
                    if (activeServer) setViewMode('explore');
                  }}
                  onOpenAgent={() => setIsAgentOpen(true)}
                />
              ) : (
                tabs.map((tab) => {
                  const isCurrent = tab.id === activeTabId;
                  const tabServerId = tab.data?.serverId || activeServerId || undefined;
                  return (
                    <div
                      key={tab.id}
                      className="app-editor-tab"
                      style={{ display: isCurrent ? 'flex' : 'none' }}
                    >
                      {tab.type === 'notebook' ? (
                        <NotebookEditor
                          path={tab.data.path}
                          serverId={tabServerId}
                          isActiveTab={isCurrent}
                          onClose={() => handleCloseTab(tab.id)}
                          onDirtyChange={(dirty) => handleTabDirtyChange(tab.id, dirty)}
                          onContextChange={handleWorkspaceContextChange}
                          tocOwnerId={isCurrent ? tab.id : undefined}
                          tocScrollRequest={isCurrent ? tocScrollRequest : null}
                          onTocChange={handleNotebookTocChange}
                        />
                      ) : tab.type === 'terminal' ? (
                        <TerminalPanel
                          serverId={tabServerId}
                          terminalName={tab.data.terminalName}
                          onClose={() => handleCloseTab(tab.id)}
                        />
                      ) : (
                        <FileEditor
                          path={tab.data.path}
                          serverId={tabServerId}
                          isActiveTab={isCurrent}
                          onDirtyChange={(dirty) => handleTabDirtyChange(tab.id, dirty)}
                        />
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
            kernelStatus={statusBarTelemetry.kernelStatus}
            activeCellIndex={statusBarTelemetry.activeCellIndex}
          />
        }
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
