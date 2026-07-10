import React, { useState, useEffect } from 'react';
import type { AiConfig } from '../../types/agent';
import { agentGetConfig, agentSaveConfig } from '../../services/tauriIpc';
import {
  formatShortcut,
  loadGlobalSettings,
  saveGlobalSettings as persistGlobalSettings,
  shortcutFromKeyboardEvent,
  type GlobalSettings,
  type ThemeMode,
} from '../../services/globalSettings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'global' | 'ai';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'global',
}) => {
  const [activeTab, setActiveTab] = useState<'global' | 'ai'>(defaultTab);

  // Global Settings State
  const [settings, setSettings] = useState<GlobalSettings>(() => {
    return loadGlobalSettings();
  });
  const [globalSavedMessage, setGlobalSavedMessage] = useState<boolean>(false);

  // AI Settings State
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [isSavingAi, setIsSavingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiStrategyTab, setAiStrategyTab] = useState<'remote' | 'ollama'>('remote');

  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab);
      // Reload AI config when opened
      agentGetConfig()
        .then((cfg) => {
          setAiConfig(cfg);
          setAiStrategyTab(cfg.provider);
        })
        .catch((e) => setAiError(String(e)));
    }
  }, [isOpen, defaultTab]);

  useEffect(() => {
    // Apply theme to document root
    if (settings.theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'obsidian' : 'solarized');
    } else {
      document.documentElement.setAttribute('data-theme', settings.theme);
    }
  }, [settings.theme]);

  if (!isOpen) return null;

  // Global Settings Handlers
  const saveGlobalSettings = (newSettings: GlobalSettings) => {
    setSettings(newSettings);
    persistGlobalSettings(newSettings);
    setGlobalSavedMessage(true);
    setTimeout(() => setGlobalSavedMessage(false), 2000);
  };

  const themes: { id: ThemeMode; name: string; color: string; desc: string }[] = [
    { id: 'obsidian', name: 'Obsidian Dark', color: '#6366f1', desc: 'Sleek deep indigo dark theme (Default)' },
    { id: 'cyberpunk', name: 'Cyberpunk Neon', color: '#ec4899', desc: 'Vibrant pink & neon cyan high-contrast' },
    { id: 'nord', name: 'Nord Frost', color: '#88c0d0', desc: 'Arctic blue calm muted tones' },
    { id: 'solarized', name: 'Solarized Light', color: '#268bd2', desc: 'Warm cream light theme for daytime' },
    { id: 'system', name: 'System Auto', color: '#9ca3af', desc: 'Follow macOS system appearance' },
  ];

  // AI Settings Handlers
  const handleSaveAi = async () => {
    if (!aiConfig) return;
    setIsSavingAi(true);
    setAiError(null);
    try {
      const updatedConfig: AiConfig = {
        ...aiConfig,
        provider: aiStrategyTab,
      };
      await agentSaveConfig(updatedConfig);
      // Optional: show a saved message or close
      onClose();
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSavingAi(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-dark-surface border border-dark-border rounded-xl shadow-2xl max-w-2xl w-full flex flex-col animate-scale-up" style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex justify-between items-center border-b border-dark-border px-6 py-4 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
              ⚙️ Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg px-2"
          >
            ✕
          </button>
        </div>

        {/* Main Tabs */}
        <div className="flex border-b border-dark-border px-6 shrink-0 bg-dark-bg/50">
          <button
            onClick={() => setActiveTab('global')}
            className={`py-3 px-4 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'global'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
            }`}
          >
            🌍 Global Settings
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`py-3 px-4 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'ai'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
            }`}
          >
            🤖 AI Configuration
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 text-sm">
          {activeTab === 'global' && (
            <div className="space-y-6">
              {/* Section: Themes */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-dark-border pb-1">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    🎨 Color Theme
                  </h4>
                  {globalSavedMessage && <span className="text-[11px] text-emerald-400 font-medium">✓ Saved</span>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {themes.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => saveGlobalSettings({ ...settings, theme: t.id })}
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                        settings.theme === t.id
                          ? 'bg-brand-primary/10 border-brand-primary shadow-sm'
                          : 'bg-dark-bg border-transparent hover:bg-dark-surface hover:border-dark-border'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-4 h-4 rounded-full border border-white/20 shrink-0 shadow-sm"
                          style={{ backgroundColor: t.color }}
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-gray-200">{t.name}</span>
                          <span className="text-xs text-gray-500">{t.desc}</span>
                        </div>
                      </div>
                      {settings.theme === t.id && <span className="text-sm text-brand-primary font-bold">✓</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Section: Jupyter Defaults */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-dark-border pb-1">
                  ⚡ Jupyter Defaults
                </h4>
                <div className="space-y-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-gray-300 font-medium">Default Kernel Name</span>
                    <input
                      type="text"
                      value={settings.defaultKernel}
                      onChange={(e) => saveGlobalSettings({ ...settings, defaultKernel: e.target.value })}
                      className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-gray-200 font-mono focus:outline-none focus:border-brand-primary max-w-sm"
                      placeholder="e.g. python3"
                    />
                  </label>
                </div>
              </div>

              {/* Section: Default Proxy */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-dark-border pb-1">
                  ⌨ Keyboard Shortcuts
                </h4>
                <label className="flex flex-col gap-1 max-w-sm">
                  <span className="text-gray-300 font-medium">Run current cell</span>
                  <input
                    type="text"
                    readOnly
                    value={formatShortcut(settings.runCurrentCellShortcut)}
                    onKeyDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const shortcut = shortcutFromKeyboardEvent(event.nativeEvent);
                      if (shortcut) saveGlobalSettings({ ...settings, runCurrentCellShortcut: shortcut });
                    }}
                    className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-gray-200 font-mono focus:outline-none focus:border-brand-primary cursor-text"
                    title="Focus this field and press the desired key combination"
                  />
                  <span className="text-xs text-gray-500">Click the field, then press a new key combination.</span>
                </label>
              </div>

              {/* Section: Default Proxy */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-dark-border pb-1">
                  🛡️ Default SOCKS5 Proxy
                </h4>
                <div className="grid grid-cols-2 gap-4 max-w-sm">
                  <label className="flex flex-col gap-1">
                    <span className="text-gray-300 font-medium">Host</span>
                    <input
                      type="text"
                      value={settings.defaultProxyHost}
                      onChange={(e) => saveGlobalSettings({ ...settings, defaultProxyHost: e.target.value })}
                      className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-gray-200 font-mono focus:outline-none focus:border-brand-primary"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-gray-300 font-medium">Port</span>
                    <input
                      type="number"
                      value={settings.defaultProxyPort}
                      onChange={(e) => saveGlobalSettings({ ...settings, defaultProxyPort: Number(e.target.value) })}
                      className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-gray-200 font-mono focus:outline-none focus:border-brand-primary"
                    />
                  </label>
                </div>
              </div>

              {/* Section: AI Agent Preferences */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-dark-border pb-1">
                  🤖 AI Agent Preferences
                </h4>
                <label className="flex items-center justify-between p-3 rounded-lg bg-dark-bg border border-dark-border cursor-pointer max-w-md">
                  <div className="flex flex-col">
                    <span className="text-gray-200 font-medium">Auto-confirm Safe Tools</span>
                    <span className="text-xs text-gray-500">Skip confirmation modal for read-only skills</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.agentAutoConfirm}
                    onChange={(e) => saveGlobalSettings({ ...settings, agentAutoConfirm: e.target.checked })}
                    className="w-4 h-4 rounded border-dark-border bg-dark-surface text-brand-primary focus:ring-0 cursor-pointer"
                  />
                </label>
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-6">
              <p className="text-xs text-gray-400 mb-2">
                Configure Hybrid LLM strategy: Remote API priority or Local Ollama / llama.cpp fallback.
              </p>

              {aiError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs p-3 rounded-lg">
                  {aiError}
                </div>
              )}

              {aiConfig ? (
                <>
                  {/* Strategy Tabs */}
                  <div className="flex border-b border-dark-border gap-4 mb-4">
                    <button
                      onClick={() => setAiStrategyTab('remote')}
                      className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
                        aiStrategyTab === 'remote'
                          ? 'border-brand-primary text-brand-primary'
                          : 'border-transparent text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      🌐 Remote API (OpenAI / DeepSeek)
                    </button>
                    <button
                      onClick={() => setAiStrategyTab('ollama')}
                      className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
                        aiStrategyTab === 'ollama'
                          ? 'border-brand-primary text-brand-primary'
                          : 'border-transparent text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      🦙 Local Ollama / llama.cpp
                    </button>
                  </div>

                  {/* Tab Contents */}
                  <div className="space-y-4">
                    {aiStrategyTab === 'remote' ? (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-300 mb-1">
                            Base URL
                          </label>
                          <input
                            type="text"
                            value={aiConfig.remote.base_url}
                            onChange={(e) =>
                              setAiConfig({
                                ...aiConfig,
                                remote: { ...aiConfig.remote, base_url: e.target.value },
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
                            value={aiConfig.remote.api_key}
                            onChange={(e) =>
                              setAiConfig({
                                ...aiConfig,
                                remote: { ...aiConfig.remote, api_key: e.target.value },
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
                              value={aiConfig.remote.chat_model}
                              onChange={(e) =>
                                setAiConfig({
                                  ...aiConfig,
                                  remote: { ...aiConfig.remote, chat_model: e.target.value },
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
                              value={aiConfig.remote.reasoning_model}
                              onChange={(e) =>
                                setAiConfig({
                                  ...aiConfig,
                                  remote: { ...aiConfig.remote, reasoning_model: e.target.value },
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
                              Temperature ({aiConfig.remote.temperature})
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={aiConfig.remote.temperature}
                              onChange={(e) =>
                                setAiConfig({
                                  ...aiConfig,
                                  remote: { ...aiConfig.remote, temperature: parseFloat(e.target.value) },
                                })
                              }
                              className="w-full accent-brand-primary"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-gray-300 mb-1">
                              Top P ({aiConfig.remote.top_p})
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={aiConfig.remote.top_p}
                              onChange={(e) =>
                                setAiConfig({
                                  ...aiConfig,
                                  remote: { ...aiConfig.remote, top_p: parseFloat(e.target.value) },
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
                            value={aiConfig.ollama.base_url}
                            onChange={(e) =>
                              setAiConfig({
                                ...aiConfig,
                                ollama: { ...aiConfig.ollama, base_url: e.target.value },
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
                            value={aiConfig.ollama.chat_model}
                            onChange={(e) =>
                              setAiConfig({
                                ...aiConfig,
                                ollama: { ...aiConfig.ollama, chat_model: e.target.value },
                              })
                            }
                            placeholder="qwen2.5-coder:7b or llama3.1:8b"
                            className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-primary"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-300 mb-1">
                              Temperature ({aiConfig.ollama.temperature})
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={aiConfig.ollama.temperature}
                              onChange={(e) =>
                                setAiConfig({
                                  ...aiConfig,
                                  ollama: { ...aiConfig.ollama, temperature: parseFloat(e.target.value) },
                                })
                              }
                              className="w-full accent-brand-primary"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-gray-300 mb-1">
                              Top P ({aiConfig.ollama.top_p})
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={aiConfig.ollama.top_p}
                              onChange={(e) =>
                                setAiConfig({
                                  ...aiConfig,
                                  ollama: { ...aiConfig.ollama, top_p: parseFloat(e.target.value) },
                                })
                              }
                              className="w-full accent-brand-primary"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end pt-6 mt-4 border-t border-dark-border">
                    <button
                      onClick={handleSaveAi}
                      disabled={isSavingAi}
                      className="px-5 py-2 rounded-lg text-sm font-medium bg-brand-primary hover:bg-brand-primary/80 text-white shadow-lg shadow-brand-primary/20 transition-all disabled:opacity-50"
                    >
                      {isSavingAi ? 'Saving...' : 'Save AI Configuration'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-gray-500 animate-pulse">Loading AI config...</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
