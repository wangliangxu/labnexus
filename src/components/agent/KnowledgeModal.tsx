import { t } from '../../i18n';
import React, { useEffect, useState } from 'react';
import type { KnowledgeEntry } from '../../types/agent';
import {
  agentListKnowledge,
  agentSaveKnowledge,
  agentDeleteKnowledge,
} from '../../services/tauriIpc';
import './Agent.css';

interface KnowledgeModalProps {
  onClose: () => void;
}

export const KnowledgeModal: React.FC<KnowledgeModalProps> = ({ onClose }) => {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingEntry, setEditingEntry] = useState<Partial<KnowledgeEntry> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadEntries = () => {
    setLoading(true);
    setLoadError(null);
    agentListKnowledge()
      .then(setEntries)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEntries();
  }, []);

  const handleSave = async () => {
    if (!editingEntry?.title || !editingEntry?.content) return;
    const entry: KnowledgeEntry = {
      id: editingEntry.id || `k-${Date.now()}`,
      title: editingEntry.title,
      content: editingEntry.content,
      category: editingEntry.category || 'general',
      tags: editingEntry.tags || [],
      source: editingEntry.source || 'user',
      trust_level: editingEntry.trust_level || 'unverified',
      enabled: editingEntry.enabled ?? true,
      created_at: editingEntry.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await agentSaveKnowledge(entry);
    setEditingEntry(null);
    loadEntries();
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t('Delete this knowledge entry?'))) {
      await agentDeleteKnowledge(id);
      loadEntries();
    }
  };

  const filtered = entries.filter(
    (e) =>
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.content.toLowerCase().includes(search.toLowerCase()) ||
      e.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-2xl bg-dark-surface border border-dark-border rounded-2xl p-6 shadow-2xl animate-scale-up flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between pb-4 border-b border-dark-border">
          <div className="flex items-center gap-2">
            <span className="text-xl">📚</span>
            <h3 className="text-lg font-bold text-gray-100">
              {t('Domain Knowledge Base')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-100 px-2 py-1 text-sm rounded hover:bg-dark-border"
          >
            ✕
          </button>
        </div>

        {editingEntry ? (
          <div className="pt-4 flex flex-col gap-3 flex-1 overflow-y-auto">
            <h4 className="text-sm font-bold text-gray-100">
              {editingEntry.id ? t('Edit Entry') : t('New Knowledge Entry')}
            </h4>
            <div>
              <label className="text-xs text-gray-400 block mb-1">{t('Title')}</label>
              <input
                type="text"
                placeholder={t('e.g. Astropy FITS File Convention')}
                value={editingEntry.title || ''}
                onChange={(e) => setEditingEntry({ ...editingEntry, title: e.target.value })}
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-primary"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">{t('Category')}</label>
                <input
                  type="text"
                  placeholder="astronomy, genomics, python..."
                  value={editingEntry.category || ''}
                  onChange={(e) => setEditingEntry({ ...editingEntry, category: e.target.value })}
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-primary"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">{t('Tags (comma-separated)')}</label>
                <input
                  type="text"
                  placeholder="fits, astropy, headers"
                  value={editingEntry.tags?.join(', ') || ''}
                  onChange={(e) =>
                    setEditingEntry({
                      ...editingEntry,
                      tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                    })
                  }
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-primary"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={editingEntry.enabled ?? true}
                onChange={(e) => setEditingEntry({ ...editingEntry, enabled: e.target.checked })}
                className="accent-brand-primary"
              />
              {t('Use this entry for Agent retrieval')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">{t('Source')}</label>
                <input
                  type="text"
                  value={editingEntry.source || 'user'}
                  onChange={(e) => setEditingEntry({ ...editingEntry, source: e.target.value })}
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-primary"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">{t('Trust Level')}</label>
                <select
                  value={editingEntry.trust_level || 'unverified'}
                  onChange={(e) => setEditingEntry({ ...editingEntry, trust_level: e.target.value as KnowledgeEntry['trust_level'] })}
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-primary"
                >
                  <option value="unverified">{t('Unverified')}</option>
                  <option value="reviewed">{t('Reviewed')}</option>
                  <option value="verified">{t('Verified')}</option>
                </select>
              </div>
            </div>
            <div className="flex-1 flex flex-col">
              <label className="text-xs text-gray-400 block mb-1">{t('Content / Rule / Guidance')}</label>
              <textarea
                placeholder={t('Write detailed domain guidance, code snippets, or formulas...')}
                value={editingEntry.content || ''}
                onChange={(e) => setEditingEntry({ ...editingEntry, content: e.target.value })}
                className="w-full flex-1 min-h-[140px] bg-dark-bg border border-dark-border rounded-lg p-3 text-sm font-mono text-gray-200 focus:outline-none focus:border-brand-primary resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-dark-border mt-2">
              <button
                onClick={() => setEditingEntry(null)}
                className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-gray-100 rounded-lg hover:bg-dark-border"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={handleSave}
                className="px-5 py-2 text-xs font-bold text-white bg-brand-primary hover:bg-brand-primary/80 rounded-lg shadow-brand-primary/20"
              >
                {t('Save Entry')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pt-4 pb-2 flex items-center justify-between gap-3">
              <input
                type="text"
                placeholder={t('Search knowledge by keyword or tag...')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-primary"
              />
              <button
                onClick={() => setEditingEntry({ title: '', content: '', category: 'general', tags: [], source: 'user', trust_level: 'unverified', enabled: true })}
                className="px-4 py-2 text-xs font-bold text-white bg-brand-primary hover:bg-brand-primary/80 rounded-lg shrink-0 flex items-center gap-1 shadow-sm"
              >
                <span>+</span> {t('Add Knowledge')}</button>
            </div>

            <div className="flex-1 overflow-y-auto pt-2 flex flex-col gap-2">
              {loading ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  {t('Loading knowledge base...')}
                </div>
              ) : loadError ? (
                <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-4 text-sm text-red-300">
                  <p>{t('Unable to load the knowledge base.')}</p>
                  <details className="mt-2 text-xs text-red-200/70"><summary>{t('Technical details')}</summary><pre className="mt-2 whitespace-pre-wrap">{loadError}</pre></details>
                  <button type="button" onClick={loadEntries} className="mt-3 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold hover:bg-red-500/10">{t('Retry')}</button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-sm">
                  {t('No knowledge entries found. Click "+ Add Knowledge" to create domain guidelines.')}</div>
              ) : (
                filtered.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 rounded-xl border border-dark-border hover:bg-dark-border/40 transition-all flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-gray-100">{entry.title}</span>
                        <span className="text-[10px] uppercase font-bold bg-brand-primary/20 text-brand-primary px-2 py-0.5 rounded">
                          {entry.category}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {entry.trust_level} · {entry.source}
                        </span>
                        {!entry.enabled && (
                          <span className="text-[10px] text-amber-400">{t('disabled')}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEditingEntry(entry)}
                          className="text-xs text-gray-400 hover:text-gray-100 px-2 py-1 rounded hover:bg-dark-border"
                        >
                          {t('Edit')}
                        </button>
                        <button
                          onClick={() => handleDelete(entry.id)}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/20"
                        >
                          {t('Delete')}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-300 font-mono whitespace-pre-wrap max-h-20 overflow-y-auto bg-dark-bg/50 p-2 rounded border border-dark-border">
                      {entry.content}
                    </p>
                    {entry.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1">
                        {entry.tags.map((t, i) => (
                          <span
                            key={i}
                            className="text-[10px] bg-dark-bg px-2 py-0.5 rounded text-gray-400 border border-dark-border"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-dark-border mt-4">
              <button
                onClick={onClose}
                className="px-5 py-2 text-xs font-bold text-gray-300 hover:text-gray-100 bg-dark-border/50 hover:bg-dark-border rounded-lg"
              >
                {t('Close')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
