import React, { useState, useEffect } from 'react';
import type { AiConfig } from '../../types/agent';
import { agentGetConfig, agentSaveConfig } from '../../services/tauriIpc';

interface AiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AiSettingsModal: React.FC<AiSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'remote' | 'ollama'>('remote');

  useEffect(() => {
    if (isOpen) {
      agentGetConfig()
        .then((cfg) => {
          setConfig(cfg);
          setActiveTab(cfg.provider);
        })
        .catch((e) => setError(String(e)));
    }
  }, [isOpen]);

  if (!isOpen || !config) return null;

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const updatedConfig: AiConfig = {
        ...config,
        provider: activeTab,
      };
      await agentSaveConfig(updatedConfig);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-dark-surface border border-dark-border rounded-xl shadow-2xl max-w-xl w-full p-6 space-y-6 animate-scale-up">
        <div className="flex justify-between items-center border-b border-dark-border pb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
              🤖 AI Engine & LLM Configuration
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              Configure Hybrid LLM strategy: Remote API priority or Local Ollama / llama.cpp fallback.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg px-2"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs p-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Strategy Tabs */}
        <div className="flex border-b border-dark-border gap-4">
          <button
            onClick={() => setActiveTab('remote')}
            className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'remote'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            🌐 Remote API (OpenAI / DeepSeek)
          </button>
          <button
            onClick={() => setActiveTab('ollama')}
            className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'ollama'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            🦙 Local Ollama / llama.cpp
          </button>
        </div>

        {/* Tab Contents */}
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {activeTab === 'remote' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  Base URL
                </label>
                <input
                  type="text"
                  value={config.remote.base_url}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      remote: { ...config.remote, base_url: e.target.value },
                    })
                  }
                  placeholder="https://api.deepseek.com or https://api.openai.com/v1"
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={config.remote.api_key}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      remote: { ...config.remote, api_key: e.target.value },
                    })
                  }
                  placeholder="sk-..."
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Chat Model
                  </label>
                  <input
                    type="text"
                    value={config.remote.chat_model}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        remote: { ...config.remote, chat_model: e.target.value },
                      })
                    }
                    placeholder="deepseek-chat or gpt-4o"
                    className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Reasoning Model
                  </label>
                  <input
                    type="text"
                    value={config.remote.reasoning_model}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        remote: { ...config.remote, reasoning_model: e.target.value },
                      })
                    }
                    placeholder="deepseek-reasoner or o1"
                    className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Temperature ({config.remote.temperature})
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={config.remote.temperature}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        remote: { ...config.remote, temperature: parseFloat(e.target.value) },
                      })
                    }
                    className="w-full accent-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Top P ({config.remote.top_p})
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={config.remote.top_p}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        remote: { ...config.remote, top_p: parseFloat(e.target.value) },
                      })
                    }
                    className="w-full accent-brand-primary"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  Ollama Base URL
                </label>
                <input
                  type="text"
                  value={config.ollama.base_url}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      ollama: { ...config.ollama, base_url: e.target.value },
                    })
                  }
                  placeholder="http://127.0.0.1:11434"
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">
                  Local Chat Model
                </label>
                <input
                  type="text"
                  value={config.ollama.chat_model}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      ollama: { ...config.ollama, chat_model: e.target.value },
                    })
                  }
                  placeholder="qwen2.5-coder:7b or llama3.1:8b"
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Temperature ({config.ollama.temperature})
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={config.ollama.temperature}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        ollama: { ...config.ollama, temperature: parseFloat(e.target.value) },
                      })
                    }
                    className="w-full accent-brand-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Top P ({config.ollama.top_p})
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={config.ollama.top_p}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        ollama: { ...config.ollama, top_p: parseFloat(e.target.value) },
                      })
                    }
                    className="w-full accent-brand-primary"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-dark-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-dark-bg hover:bg-dark-surface text-gray-300 border border-dark-border transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-brand-primary hover:bg-brand-primary/80 text-white shadow-lg shadow-brand-primary/20 transition-all disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
};
