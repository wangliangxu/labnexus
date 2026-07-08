/**
 * FileExplorer — Remote file browser for Jupyter server.
 */

import { useState, useCallback, useEffect } from 'react';
import type { ContentItem, ServerConnection } from '../../types/jupyter';
import { jupyterListContents } from '../../services/tauriIpc';
import {
  getExplorerErrorRecovery,
  normalizeExplorerErrorMessage,
} from './fileExplorerErrors';
import { normalizeContentItems, type TreeNode } from './fileExplorerTree';
import './FileExplorer.css';

interface FileExplorerProps {
  activeServer: ServerConnection | null;
  onFileOpen: (path: string, type: string) => void;
  onReconnect?: () => Promise<void> | void;
  onRestartServer?: (restartUrl: string) => Promise<void> | void;
  onConnectionLost?: (message: string) => void;
  isReconnecting?: boolean;
}

export function FileExplorer({
  activeServer,
  onFileOpen,
  onReconnect,
  onRestartServer,
  onConnectionLost,
  isReconnecting = false,
}: FileExplorerProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRecovery = getExplorerErrorRecovery(error);
  const errorMessage = error ? normalizeExplorerErrorMessage(error) : null;

  // Load root directory when server connects
  useEffect(() => {
    if (activeServer?.status === 'connected') {
      loadDirectory('');
    } else {
      setTree([]);
    }
  }, [activeServer?.config.id, activeServer?.status]);

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!activeServer) return;
      try {
        setIsLoading(path === '');
        setError(null);
        const result = await jupyterListContents(
          path,
          activeServer.config.id
        );

        // Parse the directory content
        const items: TreeNode[] = Array.isArray(result.content)
          ? normalizeContentItems(result.content as ContentItem[])
          : [];

        if (path === '') {
          setTree(items);
        } else {
          // Update the tree with loaded children
          setTree((prev) => updateTreeNode(prev, path, items));
        }
      } catch (e: unknown) {
        let msg = 'An unknown error occurred';
        if (typeof e === 'string') {
          msg = e;
        } else if (e instanceof Error) {
          msg = e.message;
        } else if (typeof e === 'object' && e !== null) {
          if ('message' in e && typeof (e as { message: unknown }).message === 'string') {
            msg = (e as { message: string }).message;
          } else {
            msg = JSON.stringify(e);
          }
        } else {
          msg = String(e);
        }
        setError(msg);
        if (getExplorerErrorRecovery(msg).canReconnect) {
          onConnectionLost?.(normalizeExplorerErrorMessage(msg));
        }
      } finally {
        setIsLoading(false);
      }
    },
    [activeServer, onConnectionLost]
  );

  const handleReconnect = useCallback(async () => {
    if (!onReconnect) return;

    setError(null);
    await onReconnect();
    await loadDirectory('');
  }, [loadDirectory, onReconnect]);

  const handleRestartServer = useCallback(async () => {
    if (!errorRecovery.restartUrl || !onRestartServer) return;

    setError(null);
    await onRestartServer(errorRecovery.restartUrl);
    await loadDirectory('');
  }, [errorRecovery.restartUrl, loadDirectory, onRestartServer]);

  const updateTreeNode = (
    nodes: TreeNode[],
    path: string,
    children: TreeNode[]
  ): TreeNode[] => {
    return nodes.map((node) => {
      if (node.path === path) {
        return { ...node, children, isExpanded: true, isLoading: false };
      }
      if (node.children) {
        return {
          ...node,
          children: updateTreeNode(node.children, path, children),
        };
      }
      return node;
    });
  };

  const toggleDirectory = useCallback(
    (node: TreeNode) => {
      if (node.isExpanded) {
        // Collapse
        setTree((prev) =>
          prev.map((n) =>
            n.path === node.path
              ? { ...n, isExpanded: false }
              : n.children
                ? { ...n, children: collapseNode(n.children, node.path) }
                : n
          )
        );
      } else {
        // Expand — load children
        setTree((prev) =>
          prev.map((n) =>
            n.path === node.path
              ? { ...n, isLoading: true }
              : n.children
                ? { ...n, children: setNodeLoading(n.children, node.path) }
                : n
          )
        );
        loadDirectory(node.path);
      }
    },
    [loadDirectory]
  );

  const collapseNode = (nodes: TreeNode[], path: string): TreeNode[] => {
    return nodes.map((n) =>
      n.path === path
        ? { ...n, isExpanded: false }
        : n.children
          ? { ...n, children: collapseNode(n.children, path) }
          : n
    );
  };

  const setNodeLoading = (nodes: TreeNode[], path: string): TreeNode[] => {
    return nodes.map((n) =>
      n.path === path
        ? { ...n, isLoading: true }
        : n.children
          ? { ...n, children: setNodeLoading(n.children, path) }
          : n
    );
  };

  const handleClick = (node: TreeNode) => {
    if (node.content_type === 'directory') {
      toggleDirectory(node);
    } else {
      onFileOpen(node.path, node.content_type);
    }
  };

  const getFileIcon = (node: TreeNode): string => {
    if (node.content_type === 'directory') {
      return node.isExpanded ? '📂' : '📁';
    }
    if (node.content_type === 'notebook') return '📓';
    const ext = node.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'py':
        return '🐍';
      case 'json':
        return '📋';
      case 'md':
        return '📝';
      case 'csv':
        return '📊';
      case 'txt':
        return '📄';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
        return '🖼️';
      default:
        return '📄';
    }
  };

  const renderTree = (nodes: TreeNode[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.path}>
        <div
          className={`file-item ${node.content_type}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => handleClick(node)}
          onDoubleClick={() => {
            if (node.content_type !== 'directory') {
              onFileOpen(node.path, node.content_type);
            }
          }}
        >
          <span className="file-item__icon">{getFileIcon(node)}</span>
          <span className="file-item__name truncate">{node.name}</span>
          {node.isLoading && (
            <span className="file-item__spinner animate-spin">⟳</span>
          )}
        </div>
        {node.isExpanded && node.children && (
          <div className="file-tree__children">
            {renderTree(node.children, depth + 1)}
          </div>
        )}
      </div>
    ));
  };

  if (!activeServer) {
    return (
      <div className="file-explorer">
        <div className="panel-header">
          <h3 className="panel-header__title">Explorer</h3>
        </div>
        <div className="file-explorer__empty">
          <p>No server connected</p>
          <p className="file-explorer__hint">
            Connect to a Jupyter server to browse files
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="file-explorer">
      <div className="panel-header">
        <h3 className="panel-header__title">Explorer</h3>
        <div className="panel-header__actions">
          <button
            className="btn btn-icon btn-ghost"
            onClick={() => loadDirectory('')}
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="file-explorer__server">
        <span
          className={`status-dot ${
            errorRecovery.canReconnect ? 'error' : activeServer.status
          }`}
        />
        <span className="file-explorer__server-name truncate">
          {activeServer.config.name}
        </span>
      </div>

      {error && (
        <div className="file-explorer__error">
          <span>⚠️ {errorMessage}</span>
          {errorRecovery.canReconnect && onReconnect && (
            <div className="file-explorer__error-actions">
              <button
                className="btn btn-sm btn-primary"
                onClick={handleReconnect}
                disabled={isReconnecting}
                type="button"
              >
                {isReconnecting ? 'Reconnecting...' : 'Reconnect'}
              </button>
              {errorRecovery.restartUrl && onRestartServer && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={handleRestartServer}
                  disabled={isReconnecting}
                  type="button"
                >
                  {isReconnecting ? 'Restarting...' : 'Restart server'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="file-tree">
        {isLoading ? (
          <div className="file-explorer__loading">
            <span className="animate-spin">⟳</span> Loading...
          </div>
        ) : tree.length === 0 ? (
          <div className="file-explorer__empty">
            <p>Empty directory</p>
          </div>
        ) : (
          renderTree(tree)
        )}
      </div>
    </div>
  );
}
