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

  const loadEntries = () => {
    setLoading(true);
    agentListKnowledge()
      .then(setEntries)
      .catch((err) => console.error('Failed to load knowledge:', err))
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
      created_at: editingEntry.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await agentSaveKnowledge(entry);
    setEditingEntry(null);
    loadEntries();
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Delete this knowledge entry?')) {
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
            <h3 className="text-lg font-bold text-white">
              Domain Knowledge Base
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white px-2 py-1 text-sm rounded hover:bg-dark-border"
          >
            ✕
          </button>
        </div>

        {editingEntry ? (
          <div className="pt-4 flex flex-col gap-3 flex-1 overflow-y-auto">
            <h4 className="text-sm font-bold text-white">
              {editingEntry.id ? 'Edit Entry' : 'New Knowledge Entry'}
            </h4>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Title</label>
              <input
                type="text"
                placeholder="e.g. Astropy FITS File Convention"
                value={editingEntry.title || ''}
                onChange={(e) => setEditingEntry({ ...editingEntry, title: e.target.value })}
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-primary"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Category</label>
                <input
                  type="text"
                  placeholder="astronomy, genomics, python..."
                  value={editingEntry.category || ''}
                  onChange={(e) => setEditingEntry({ ...editingEntry, category: e.target.value })}
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-primary"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Tags (comma-separated)</label>
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
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-primary"
                />
              </div>
            </div>
            <div className="flex-1 flex flex-col">
              <label className="text-xs text-gray-400 block mb-1">Content / Rule / Guidance</label>
              <textarea
                placeholder="Write detailed domain guidance, code snippets, or formulas..."
                value={editingEntry.content || ''}
                onChange={(e) => setEditingEntry({ ...editingEntry, content: e.target.value })}
                className="w-full flex-1 min-h-[140px] bg-dark-bg border border-dark-border rounded-lg p-3 text-sm font-mono text-gray-200 focus:outline-none focus:border-brand-primary resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-dark-border mt-2">
              <button
                onClick={() => setEditingEntry(null)}
                className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-white rounded-lg hover:bg-dark-border"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-5 py-2 text-xs font-bold text-white bg-brand-primary hover:bg-brand-primary/80 rounded-lg shadow-brand-primary/20"
              >
                Save Entry
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pt-4 pb-2 flex items-center justify-between gap-3">
              <input
                type="text"
                placeholder="Search knowledge by keyword or tag..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-primary"
              />
              <button
                onClick={() => setEditingEntry({ title: '', content: '', category: 'general', tags: [] })}
                className="px-4 py-2 text-xs font-bold text-white bg-brand-primary hover:bg-brand-primary/80 rounded-lg shrink-0 flex items-center gap-1 shadow-sm"
              >
                <span>+</span> Add Knowledge
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pt-2 flex flex-col gap-2">
              {loading ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Loading knowledge base...
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-sm">
                  No knowledge entries found. Click "+ Add Knowledge" to create domain guidelines.
                </div>
              ) : (
                filtered.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 rounded-xl border border-dark-border hover:bg-dark-border/40 transition-all flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">{entry.title}</span>
                        <span className="text-[10px] uppercase font-bold bg-brand-primary/20 text-brand-primary px-2 py-0.5 rounded">
                          {entry.category}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEditingEntry(entry)}
                          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-dark-border"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(entry.id)}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/20"
                        >
                          Delete
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
                className="px-5 py-2 text-xs font-bold text-gray-300 hover:text-white bg-dark-border/50 hover:bg-dark-border rounded-lg"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
