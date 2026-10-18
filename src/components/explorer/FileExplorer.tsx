import { t } from '../../i18n';
/**
 * FileExplorer — Remote file browser for Jupyter server with full CRUD support.
 */

import {
  useState,
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  FilePlus2,
  FolderPlus,
  BookPlus,
  RefreshCw,
  Pencil,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import type { ContentItem, ServerConnection } from '../../types/jupyter';
import {
  jupyterListContents,
  jupyterCreateContent,
  jupyterRenameContent,
  jupyterDeleteContent,
} from '../../services/tauriIpc';
import {
  getExplorerErrorRecovery,
  normalizeExplorerErrorMessage,
} from './fileExplorerErrors';
import { normalizeContentItems, type TreeNode } from './fileExplorerTree';
import './FileExplorer.css';

interface FileExplorerProps {
  activeServer: ServerConnection | null;
  tree: TreeNode[] | null;
  onTreeChange: Dispatch<SetStateAction<TreeNode[]>>;
  onFileOpen: (path: string, type: string) => void;
  onFileRenamed?: (oldPath: string, newPath: string) => void;
  onFileDeleted?: (deletedPath: string) => void;
  onReconnect?: () => Promise<void> | void;
  onRestartServer?: (restartUrl: string) => Promise<void> | void;
  onConnectionLost?: (message: string) => void;
  isReconnecting?: boolean;
}

interface PendingCreateState {
  parentDir: string;
  contentType: 'notebook' | 'file' | 'directory';
  name: string;
}

export function FileExplorer({
  activeServer,
  tree,
  onTreeChange: setTree,
  onFileOpen,
  onFileRenamed,
  onFileDeleted,
  onReconnect,
  onRestartServer,
  onConnectionLost,
  isReconnecting = false,
}: FileExplorerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDir, setSelectedDir] = useState<string>('');
  const [pendingCreate, setPendingCreate] = useState<PendingCreateState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>('');
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const errorRecovery = getExplorerErrorRecovery(error);
  const errorMessage = error ? normalizeExplorerErrorMessage(error) : null;

  const formatUnknownError = (e: unknown): string => {
    if (typeof e === 'string') return e;
    if (e instanceof Error) return e.message;
    if (typeof e === 'object' && e !== null) {
      if ('message' in e && typeof (e as { message: unknown }).message === 'string') {
        return (e as { message: string }).message;
      }
      return JSON.stringify(e);
    }
    return String(e || t('An unknown error occurred'));
  };

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!activeServer) return;
      try {
        setIsLoading(path === '');
        setError(null);
        const result = await jupyterListContents(path, activeServer.config.id);

        const items: TreeNode[] = Array.isArray(result.content)
          ? normalizeContentItems(result.content as ContentItem[])
          : [];

        if (path === '') {
          setTree(items);
        } else {
          setTree((prev) => updateTreeNode(prev, path, items));
        }
      } catch (e: unknown) {
        const msg = formatUnknownError(e);
        setError(msg);
        if (getExplorerErrorRecovery(msg).canReconnect) {
          onConnectionLost?.(normalizeExplorerErrorMessage(msg));
        }
      } finally {
        setIsLoading(false);
      }
    },
    [activeServer, onConnectionLost, setTree]
  );

  // The parent keeps one tree per connected server. Only fetch the root when
  // this connection does not already have a session tree to restore.
  useEffect(() => {
    if (activeServer?.status === 'connected' && tree === null) {
      void loadDirectory('');
    }
  }, [activeServer?.config.id, activeServer?.status, loadDirectory, tree]);

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
      setSelectedDir(node.path);
      if (node.isExpanded) {
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
        setTree((prev) =>
          prev.map((n) =>
            n.path === node.path
              ? { ...n, isLoading: true }
              : n.children
                ? { ...n, children: setNodeLoading(n.children, node.path) }
                : n
          )
        );
        void loadDirectory(node.path);
      }
    },
    [loadDirectory, setTree]
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

  const getParentDir = (itemPath: string): string => {
    const idx = itemPath.lastIndexOf('/');
    return idx === -1 ? '' : itemPath.slice(0, idx);
  };

  const startCreateItem = (
    contentType: 'notebook' | 'file' | 'directory',
    parentDir = selectedDir
  ) => {
    const defaultName =
      contentType === 'notebook'
        ? 'Untitled.ipynb'
        : contentType === 'file'
          ? 'untitled.py'
          : 'new-folder';
    setPendingCreate({
      parentDir,
      contentType,
      name: defaultName,
    });
    setRenamingPath(null);
    setDeletingPath(null);
  };

  const handleConfirmCreate = async () => {
    if (!activeServer || !pendingCreate || isMutating) return;
    let trimmedName = pendingCreate.name.trim().replace(/^\/+|\/+$/g, '');
    if (!trimmedName) return;

    if (
      pendingCreate.contentType === 'notebook' &&
      !trimmedName.toLowerCase().endsWith('.ipynb')
    ) {
      trimmedName = `${trimmedName}.ipynb`;
    }

    const fullPath = pendingCreate.parentDir
      ? `${pendingCreate.parentDir}/${trimmedName}`
      : trimmedName;

    setIsMutating(true);
    setError(null);
    try {
      const created = await jupyterCreateContent(
        fullPath,
        pendingCreate.contentType,
        activeServer.config.id
      );
      const targetParent = pendingCreate.parentDir;
      const createdType = pendingCreate.contentType;
      setPendingCreate(null);
      await loadDirectory(targetParent);
      if (createdType !== 'directory') {
        onFileOpen(created.path || fullPath, created.content_type || createdType);
      }
    } catch (e: unknown) {
      setError(formatUnknownError(e));
    } finally {
      setIsMutating(false);
    }
  };

  const handleStartRename = (node: TreeNode, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingPath(node.path);
    setRenameDraft(node.name);
    setPendingCreate(null);
    setDeletingPath(null);
  };

  const handleConfirmRename = async (node: TreeNode) => {
    if (!activeServer || isMutating) return;
    const nextName = renameDraft.trim().replace(/^\/+|\/+$/g, '');
    if (!nextName || nextName === node.name) {
      setRenamingPath(null);
      return;
    }
    const parentDir = getParentDir(node.path);
    const newPath = parentDir ? `${parentDir}/${nextName}` : nextName;

    setIsMutating(true);
    setError(null);
    try {
      const updated = await jupyterRenameContent(
        node.path,
        newPath,
        activeServer.config.id
      );
      setRenamingPath(null);
      await loadDirectory(parentDir);
      onFileRenamed?.(node.path, updated.path || newPath);
    } catch (e: unknown) {
      setError(formatUnknownError(e));
    } finally {
      setIsMutating(false);
    }
  };

  const handleConfirmDelete = async (node: TreeNode, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeServer || isMutating) return;
    const parentDir = getParentDir(node.path);
    setIsMutating(true);
    setError(null);
    try {
      await jupyterDeleteContent(node.path, activeServer.config.id);
      if (selectedDir === node.path) {
        setSelectedDir(parentDir);
      }
      setDeletingPath(null);
      await loadDirectory(parentDir);
      onFileDeleted?.(node.path);
    } catch (e: unknown) {
      setError(formatUnknownError(e));
    } finally {
      setIsMutating(false);
    }
  };

  const handleClick = (node: TreeNode) => {
    if (renamingPath === node.path || deletingPath === node.path) return;
    if (node.content_type === 'directory') {
      toggleDirectory(node);
    } else {
      setSelectedDir(getParentDir(node.path));
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
      case 'markdown':
        return '📝';
      case 'csv':
      case 'tsv':
        return '📊';
      case 'txt':
        return '📄';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
      case 'webp':
        return '🖼️';
      default:
        return '📄';
    }
  };

  const renderTree = (nodes: TreeNode[], depth = 0) => {
    return nodes.map((node) => {
      const isRenaming = renamingPath === node.path;
      const isConfirmingDelete = deletingPath === node.path;

      return (
        <div key={node.path}>
          <div
            className={`file-item ${node.content_type} ${
              selectedDir === node.path ? 'file-item--selected-dir' : ''
            }`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() => handleClick(node)}
            onDoubleClick={() => {
              if (node.content_type !== 'directory' && !isRenaming) {
                onFileOpen(node.path, node.content_type);
              }
            }}
          >
            <span className="file-item__icon">{getFileIcon(node)}</span>

            {isRenaming ? (
              <div
                className="file-item__inline-edit"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  className="file-item__input"
                  value={renameDraft}
                  autoFocus
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleConfirmRename(node);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setRenamingPath(null);
                    }
                  }}
                />
                <button
                  type="button"
                  className="file-item__action-btn"
                  title={t('Confirm')}
                  onClick={() => void handleConfirmRename(node)}
                >
                  <Check size={12} />
                </button>
                <button
                  type="button"
                  className="file-item__action-btn"
                  title={t('Cancel')}
                  onClick={() => setRenamingPath(null)}
                >
                  <X size={12} />
                </button>
              </div>
            ) : isConfirmingDelete ? (
              <div
                className="file-item__inline-edit"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="file-item__delete-prompt truncate">
                  {t('Delete')} "{node.name}"?
                </span>
                <button
                  type="button"
                  className="file-item__action-btn file-item__action-btn--danger"
                  title={t('Confirm Delete')}
                  onClick={(e) => void handleConfirmDelete(node, e)}
                >
                  <Check size={12} />
                </button>
                <button
                  type="button"
                  className="file-item__action-btn"
                  title={t('Cancel')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingPath(null);
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <>
                <span className="file-item__name truncate" title={node.path}>
                  {node.name}
                </span>
                {node.isLoading && (
                  <span className="file-item__spinner animate-spin">⟳</span>
                )}
                <div
                  className="file-item__actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  {node.content_type === 'directory' && (
                    <button
                      type="button"
                      className="file-item__action-btn"
                      title={t('New Notebook in Folder')}
                      onClick={() => startCreateItem('notebook', node.path)}
                    >
                      <BookPlus size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="file-item__action-btn"
                    title={t('Rename')}
                    onClick={(e) => handleStartRename(node, e)}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="file-item__action-btn file-item__action-btn--danger"
                    title={t('Delete')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingPath(node.path);
                      setRenamingPath(null);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </>
            )}
          </div>
          {node.isExpanded && node.children && (
            <div className="file-tree__children">
              {renderTree(node.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  if (!activeServer) {
    return (
      <div className="file-explorer">
        <div className="panel-header">
          <h3 className="panel-header__title">{t('Explorer')}</h3>
        </div>
        <div className="file-explorer__empty">
          <p>{t('No server connected')}</p>
          <p className="file-explorer__hint">
            {t('Connect to a Jupyter server to browse files')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="file-explorer">
      <div className="panel-header">
        <h3 className="panel-header__title">{t('Explorer')}</h3>
        <div className="panel-header__actions">
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={() => startCreateItem('notebook', selectedDir)}
            title={t('New Notebook')}
          >
            <BookPlus size={14} />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={() => startCreateItem('file', selectedDir)}
            title={t('New File')}
          >
            <FilePlus2 size={14} />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={() => startCreateItem('directory', selectedDir)}
            title={t('New Folder')}
          >
            <FolderPlus size={14} />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={() => {
              setSelectedDir('');
              void loadDirectory('');
            }}
            title={t('Refresh')}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div
        className="file-explorer__server"
        onClick={() => setSelectedDir('')}
        title={t('Click to target root directory')}
      >
        <span
          className={`status-dot ${
            errorRecovery.canReconnect ? 'error' : activeServer.status
          }`}
        />
        <span className="file-explorer__server-name truncate">
          {activeServer.config.name}
          {selectedDir ? ` / ${selectedDir}` : ''}
        </span>
      </div>

      {pendingCreate && (
        <div className="file-explorer__create-bar">
          <div className="file-explorer__create-meta">
            <span>
              {pendingCreate.contentType === 'notebook'
                ? t('New Notebook')
                : pendingCreate.contentType === 'file'
                  ? t('New File')
                  : t('New Folder')}
            </span>
            <span className="file-explorer__create-dir truncate">
              {pendingCreate.parentDir ? `/${pendingCreate.parentDir}` : '/'}
            </span>
          </div>
          <div className="file-explorer__create-controls">
            <input
              type="text"
              className="file-item__input"
              value={pendingCreate.name}
              autoFocus
              onChange={(e) =>
                setPendingCreate((prev) =>
                  prev ? { ...prev, name: e.target.value } : null
                )
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleConfirmCreate();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setPendingCreate(null);
                }
              }}
            />
            <button
              type="button"
              className="file-item__action-btn"
              title={t('Create')}
              disabled={isMutating}
              onClick={() => void handleConfirmCreate()}
            >
              <Check size={13} />
            </button>
            <button
              type="button"
              className="file-item__action-btn"
              title={t('Cancel')}
              onClick={() => setPendingCreate(null)}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

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
                {isReconnecting ? 'Reconnecting...' : t('Reconnect')}
              </button>
              {errorRecovery.restartUrl && onRestartServer && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={handleRestartServer}
                  disabled={isReconnecting}
                  type="button"
                >
                  {isReconnecting ? t('Restarting...') : t('Restart server')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="file-tree">
        {isLoading || tree === null ? (
          <div className="file-explorer__loading">
            <span className="animate-spin">⟳</span> {t('Loading...')}
          </div>
        ) : tree.length === 0 ? (
          <div className="file-explorer__empty">
            <p>{t('Empty directory')}</p>
          </div>
        ) : (
          renderTree(tree)
        )}
      </div>
    </div>
  );
}
