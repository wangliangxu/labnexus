import { t, useLocale, type Locale } from '../../i18n';
import React, { useState, useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import type { AiConfig, ExternalMcpConfigFile } from '../../types/agent';
import {
  agentGetConfig,
  agentGetMcpConfig,
  agentSaveConfig,
  agentSaveMcpConfig,
} from '../../services/tauriIpc';
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
  const locale = useLocale();
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
  const [aiSection, setAiSection] = useState<'provider' | 'context' | 'reliability' | 'mcp'>('provider');
  const [aiReloadNonce, setAiReloadNonce] = useState(0);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [mcpConfig, setMcpConfig] = useState<ExternalMcpConfigFile>({ servers: [] });
  const [mcpWarnings, setMcpWarnings] = useState<string[]>([]);
  const [aiSaved, setAiSaved] = useState(false);

  useEffect(() => { setSettings(loadGlobalSettings()); }, [isOpen, locale]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab);
      setAiError(null);
      if (!isTauri()) {
        setAiConfig(null);
        setIsLoadingAi(false);
        setAiError(null);
        return;
      }
      setIsLoadingAi(true);
      Promise.all([agentGetConfig(), agentGetMcpConfig()])
        .then(([cfg, mcp]) => {
          setAiConfig(cfg);
          setAiStrategyTab(cfg.provider);
          setMcpConfig(mcp);
        })
        .catch((e) => {
          setAiConfig(null);
          setAiError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setIsLoadingAi(false));
    }
  }, [isOpen, defaultTab, aiReloadNonce]);

  if (!isOpen) return null;

  // Global Settings Handlers
  const saveGlobalSettings = (newSettings: GlobalSettings) => {
    setSettings(newSettings);
    persistGlobalSettings(newSettings);
    setGlobalSavedMessage(true);
    setTimeout(() => setGlobalSavedMessage(false), 2000);
  };

  const themes: { id: ThemeMode; name: string; color: string; desc: string }[] = [
    { id: 'light', name: t('Light · JupyterLab Light'), color: '#ffffff', desc: t('White workspace, light gray panels and blue accents') },
    { id: 'dark', name: t('Dark · JupyterLab Dark'), color: '#212121', desc: t('Neutral dark gray workspace and blue accents') },
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
      const warnings = await agentSaveMcpConfig(mcpConfig);
      setMcpWarnings(warnings);
      setAiConfig(updatedConfig);
      setAiSaved(true);
      window.setTimeout(() => setAiSaved(false), 2000);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSavingAi(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-dark-surface border border-dark-border rounded-xl shadow-2xl max-w-4xl w-full flex flex-col animate-scale-up" style={{ maxHeight: '88vh' }}>
        {/* Header */}
        <div className="flex justify-between items-center border-b border-dark-border px-6 py-4 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
              {t('⚙️ Settings')}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('Close dialog')}
            className="text-gray-400 hover:text-gray-100 text-lg px-2"
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
            {t('🌍 Global Settings')}
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`py-3 px-4 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'ai'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
            }`}
          >
            {t('🤖 AI Configuration')}
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 text-sm">
          {activeTab === 'global' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-dark-border pb-1">{t('Language')}</h4>
                <label className="flex flex-col gap-1 max-w-sm">
                  <span className="text-gray-300 font-medium">{t('Interface language')}</span>
                  <select
                    aria-label={t('Interface language')}
                    value={settings.language}
                    onChange={(event) => saveGlobalSettings({ ...settings, language: event.target.value as Locale })}
                    className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-gray-200 focus:outline-none focus:border-brand-primary"
                  >
                    <option value="zh-CN" lang="zh-CN">中文（简体）</option>
                    <option value="en" lang="en">English</option>
                  </select>
                </label>
              </div>
              {/* Section: Themes */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-dark-border pb-1">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {t('🎨 Color Theme')}
                  </h4>
                  {globalSavedMessage && <span className="text-[11px] text-emerald-400 font-medium">{t('✓ Saved')}</span>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {themes.map((t) => (
                    <button
                      type="button"
                      aria-pressed={settings.theme === t.id}
                      key={t.id}
                      onClick={() => saveGlobalSettings({ ...settings, theme: t.id })}
                      className={`flex items-center justify-between p-3 rounded-lg border text-left cursor-pointer transition-all ${
                        settings.theme === t.id
                          ? 'bg-brand-primary/10 border-brand-primary shadow-sm'
                          : 'bg-dark-bg border-transparent hover:bg-dark-surface hover:border-dark-border'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-4 h-4 rounded-full border border-dark-border shrink-0 shadow-sm"
                          style={{ backgroundColor: t.color }}
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-gray-200">{t.name}</span>
                          <span className="text-xs text-gray-500">{t.desc}</span>
                        </div>
                      </div>
                      {settings.theme === t.id && <span className="text-sm text-brand-primary font-bold">✓</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Section: Jupyter Defaults */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-dark-border pb-1">
                  {t('⚡ Jupyter Defaults')}
                </h4>
                <div className="space-y-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-gray-300 font-medium">{t('Default Kernel Name')}</span>
                    <input
                      type="text"
                      value={settings.defaultKernel}
                      onChange={(e) => saveGlobalSettings({ ...settings, defaultKernel: e.target.value })}
                      className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-gray-200 font-mono focus:outline-none focus:border-brand-primary max-w-sm"
                      placeholder={t('e.g. python3')}
                    />
                  </label>
                </div>
              </div>

              {/* Section: Default Proxy */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-dark-border pb-1">
                  {t('⌨ Keyboard Shortcuts')}
                </h4>
                <label className="flex flex-col gap-1 max-w-sm">
                  <span className="text-gray-300 font-medium">{t('Run current cell')}</span>
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
                    title={t('Focus this field and press the desired key combination')}
                  />
                  <span className="text-xs text-gray-500">{t('Click the field, then press a new key combination.')}</span>
                </label>
              </div>

              {/* Section: Default Proxy */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-dark-border pb-1">
                  {t('🛡️ Default SOCKS5 Proxy')}
                </h4>
                <div className="grid grid-cols-2 gap-4 max-w-sm">
                  <label className="flex flex-col gap-1">
                    <span className="text-gray-300 font-medium">{t('Host')}</span>
                    <input
                      type="text"
                      value={settings.defaultProxyHost}
                      onChange={(e) => saveGlobalSettings({ ...settings, defaultProxyHost: e.target.value })}
                      className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-gray-200 font-mono focus:outline-none focus:border-brand-primary"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-gray-300 font-medium">{t('Port')}</span>
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
                  {t('🤖 AI Agent Preferences')}
                </h4>
                <label className="flex items-center justify-between p-3 rounded-lg bg-dark-bg border border-dark-border cursor-pointer max-w-md">
                  <div className="flex flex-col">
                    <span className="text-gray-200 font-medium">{t('Auto-confirm Safe Tools')}</span>
                    <span className="text-xs text-gray-500">{t('Skip confirmation modal for read-only skills')}</span>
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
                {t('Configure Hybrid LLM strategy: Remote API priority or Local Ollama / llama.cpp fallback.')}
              </p>

              {(aiError || !isTauri()) && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs p-3 rounded-lg">
                  {!isTauri() ? t('AI configuration is available when LabNexus runs as a desktop application.') : aiError}
                </div>
              )}

              {aiConfig ? (
                <>
                  <div className="grid grid-cols-4 gap-2 rounded-xl border border-dark-border bg-dark-bg/50 p-1.5">
                    {([
                      ['provider', t('Provider & Models')],
                      ['context', t('Context & Memory')],
                      ['reliability', t('Reliability')],
                      ['mcp', t('MCP Servers')],
                    ] as const).map(([id, label]) => (
                      <button key={id} type="button" onClick={() => setAiSection(id)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${aiSection === id ? 'bg-brand-primary text-white shadow' : 'text-gray-400 hover:bg-dark-border hover:text-gray-200'}`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {aiSection === 'provider' && <>
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
                      {t('🌐 Remote API (OpenAI / DeepSeek)')}
                    </button>
                    <button
                      onClick={() => setAiStrategyTab('ollama')}
                      className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
                        aiStrategyTab === 'ollama'
                          ? 'border-brand-primary text-brand-primary'
                          : 'border-transparent text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {t('🦙 Local Ollama / llama.cpp')}
                    </button>
                  </div>

                  {/* Tab Contents */}
                  <div className="space-y-4">
                    {aiStrategyTab === 'remote' ? (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-300 mb-1">
                            {t('Base URL')}
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
                            {t('API Key')}
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
                              {t('Chat Model')}
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
                              {t('Reasoning Model')}
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
                              {t('Temperature (')}{aiConfig.remote.temperature})
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
                              {t('Top P (')}{aiConfig.remote.top_p})
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
                            {t('Ollama Base URL')}
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
                            {t('Local Chat Model')}
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
                              {t('Temperature (')}{aiConfig.ollama.temperature})
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
                              {t('Top P (')}{aiConfig.ollama.top_p})
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
                  </>}

                  {aiSection === 'context' && (
                  <div className="space-y-5 rounded-xl border border-dark-border bg-dark-bg/35 p-5">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-100">{t('Context budget')}</h4>
                      <p className="mt-1 text-xs text-gray-500">{t('Configure the active model\'s input window and reserved response capacity.')}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                    <label className="space-y-1">
                      <span className="text-xs text-gray-400">{t('Context window (tokens)')}</span>
                      <input
                        type="number"
                        min="2048"
                        value={aiStrategyTab === 'remote' ? aiConfig.remote.context_window_tokens : aiConfig.ollama.context_window_tokens}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setAiConfig(aiStrategyTab === 'remote'
                            ? { ...aiConfig, remote: { ...aiConfig.remote, context_window_tokens: value } }
                            : { ...aiConfig, ollama: { ...aiConfig.ollama, context_window_tokens: value } });
                        }}
                        className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-xs text-gray-200"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-gray-400">{t('Maximum output (tokens)')}</span>
                      <input
                        type="number"
                        min="256"
                        value={aiStrategyTab === 'remote' ? aiConfig.remote.max_output_tokens : aiConfig.ollama.max_output_tokens}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setAiConfig(aiStrategyTab === 'remote'
                            ? { ...aiConfig, remote: { ...aiConfig.remote, max_output_tokens: value } }
                            : { ...aiConfig, ollama: { ...aiConfig.ollama, max_output_tokens: value } });
                        }}
                        className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-xs text-gray-200"
                      />
                    </label>
                    </div>
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs leading-relaxed text-blue-200/80">
                      {t('LabNexus reserves output and tool-schema tokens first, then keeps complete user/tool turns within the remaining budget.')}
                    </div>
                  </div>
                  )}

                  {aiSection === 'reliability' && (
                  <div className="space-y-4 rounded-xl border border-dark-border bg-dark-bg/35 p-5">
                    <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">{t('Provider Resilience')}</h4>
                    <label className="flex items-center justify-between p-3 rounded-lg bg-dark-bg border border-dark-border">
                      <span className="text-xs text-gray-300">{t('Automatically switch to the other enabled provider on transient failures')}</span>
                      <input
                        type="checkbox"
                        checked={aiConfig.resilience.fallback_enabled}
                        onChange={(event) => setAiConfig({
                          ...aiConfig,
                          resilience: { ...aiConfig.resilience, fallback_enabled: event.target.checked },
                        })}
                        className="w-4 h-4 accent-brand-primary"
                      />
                    </label>
                    <div className="grid grid-cols-4 gap-3">
                      <label className="space-y-1">
                        <span className="text-xs text-gray-400">{t('Maximum retries')}</span>
                        <input type="number" min="0" max="8" value={aiConfig.resilience.max_retries}
                          onChange={(event) => setAiConfig({ ...aiConfig, resilience: { ...aiConfig.resilience, max_retries: Number(event.target.value) } })}
                          className="w-full bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-xs text-gray-200" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-gray-400">{t('Retry base (ms)')}</span>
                        <input type="number" min="50" max="60000" value={aiConfig.resilience.retry_base_delay_ms}
                          onChange={(event) => setAiConfig({ ...aiConfig, resilience: { ...aiConfig.resilience, retry_base_delay_ms: Number(event.target.value) } })}
                          className="w-full bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-xs text-gray-200" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-gray-400">{t('Circuit failures')}</span>
                        <input type="number" min="1" max="20" value={aiConfig.resilience.circuit_breaker_threshold}
                          onChange={(event) => setAiConfig({ ...aiConfig, resilience: { ...aiConfig.resilience, circuit_breaker_threshold: Number(event.target.value) } })}
                          className="w-full bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-xs text-gray-200" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-gray-400">{t('Cooldown (seconds)')}</span>
                        <input type="number" min="1" max="3600" value={aiConfig.resilience.circuit_breaker_cooldown_seconds}
                          onChange={(event) => setAiConfig({ ...aiConfig, resilience: { ...aiConfig.resilience, circuit_breaker_cooldown_seconds: Number(event.target.value) } })}
                          className="w-full bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-xs text-gray-200" />
                      </label>
                    </div>
                  </div>
                  )}

                  {aiSection === 'mcp' && (
                  <div className="space-y-3 rounded-xl border border-dark-border bg-dark-bg/35 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                          {t('External MCP Servers')}
                        </h4>
                        <p className="text-xs text-gray-500 mt-1">
                          {t('Enabled servers are connected and discovered on save. External tool calls always require one-time approval.')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const suffix = Date.now().toString(36);
                          setMcpConfig({
                            servers: [
                              ...mcpConfig.servers,
                              {
                                id: `server_${suffix}`,
                                name: t('New MCP Server'),
                                transport: 'stdio',
                                command: '',
                                args: [],
                                env: {},
                                url: '',
                                headers: {},
                                enabled: true,
                                timeout_seconds: 30,
                              },
                            ],
                          });
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs border border-dark-border text-gray-300 hover:border-brand-primary hover:text-gray-100"
                      >
                        {t('+ Add Server')}
                      </button>
                    </div>

                    {mcpWarnings.length > 0 && (
                      <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs p-3 rounded-lg space-y-1">
                        <div className="font-semibold">{t('Saved, but discovery reported:')}</div>
                        {mcpWarnings.map((warning) => <div key={warning}>{warning}</div>)}
                      </div>
                    )}

                    {mcpConfig.servers.map((server, index) => (
                      <div key={`${server.id}-${index}`} className="p-3 rounded-lg bg-dark-bg border border-dark-border space-y-3">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={server.enabled}
                            onChange={(event) => setMcpConfig({
                              servers: mcpConfig.servers.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, enabled: event.target.checked } : item),
                            })}
                            className="w-4 h-4 accent-brand-primary"
                            title={t('Enable server')}
                          />
                          <input
                            value={server.name}
                            onChange={(event) => setMcpConfig({
                              servers: mcpConfig.servers.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, name: event.target.value } : item),
                            })}
                            className="flex-1 bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-sm text-gray-200"
                            placeholder={t('Display name')}
                          />
                          <button
                            type="button"
                            onClick={() => setMcpConfig({ servers: mcpConfig.servers.filter((_, itemIndex) => itemIndex !== index) })}
                            className="text-xs text-red-400 hover:text-red-300 px-2"
                          >
                            {t('Remove')}
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <label className="space-y-1">
                            <span className="text-xs text-gray-400">{t('Server ID')}</span>
                            <input
                              value={server.id}
                              onChange={(event) => setMcpConfig({
                                servers: mcpConfig.servers.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, id: event.target.value } : item),
                              })}
                              className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs font-mono text-gray-200"
                              placeholder="filesystem"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs text-gray-400">{t('Transport')}</span>
                            <select
                              value={server.transport}
                              onChange={(event) => setMcpConfig({
                                servers: mcpConfig.servers.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, transport: event.target.value as 'stdio' | 'streamable_http' }
                                    : item),
                              })}
                              className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs text-gray-200"
                            >
                              <option value="stdio">stdio</option>
                              <option value="streamable_http">{t('Streamable HTTP')}</option>
                            </select>
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs text-gray-400">{t('Timeout (seconds)')}</span>
                            <input
                              type="number"
                              min="1"
                              max="120"
                              value={server.timeout_seconds}
                              onChange={(event) => setMcpConfig({
                                servers: mcpConfig.servers.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, timeout_seconds: Number(event.target.value) } : item),
                              })}
                              className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs text-gray-200"
                            />
                          </label>
                        </div>
                        {server.transport === 'stdio' ? (
                          <>
                            <label className="block space-y-1">
                              <span className="text-xs text-gray-400">{t('Command')}</span>
                              <input
                                value={server.command}
                                onChange={(event) => setMcpConfig({
                                  servers: mcpConfig.servers.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, command: event.target.value } : item),
                                })}
                                className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs font-mono text-gray-200"
                                placeholder="npx or /absolute/path/to/server"
                              />
                            </label>
                            <label className="block space-y-1">
                              <span className="text-xs text-gray-400">{t('Arguments (one per line)')}</span>
                              <textarea
                                rows={Math.max(2, Math.min(5, server.args.length + 1))}
                                value={server.args.join('\n')}
                                onChange={(event) => setMcpConfig({
                                  servers: mcpConfig.servers.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, args: event.target.value.split('\n').filter((argument) => argument.length > 0) }
                                      : item),
                                })}
                                className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs font-mono text-gray-200 resize-y"
                              />
                            </label>
                            <label className="block space-y-1">
                              <span className="text-xs text-gray-400">{t('Environment (NAME=VALUE, one per line)')}</span>
                              <textarea
                                rows={Math.max(2, Math.min(5, Object.keys(server.env).length + 1))}
                                value={Object.entries(server.env).map(([key, value]) => `${key}=${value}`).join('\n')}
                                onChange={(event) => {
                                  const env = Object.fromEntries(event.target.value.split('\n').flatMap((line) => {
                                    const separator = line.indexOf('=');
                                    return separator > 0 ? [[line.slice(0, separator).trim(), line.slice(separator + 1)]] : [];
                                  }));
                                  setMcpConfig({
                                    servers: mcpConfig.servers.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, env } : item),
                                  });
                                }}
                                className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs font-mono text-gray-200 resize-y"
                              />
                            </label>
                          </>
                        ) : (
                          <>
                            <label className="block space-y-1">
                              <span className="text-xs text-gray-400">{t('MCP Endpoint URL')}</span>
                              <input
                                value={server.url}
                                onChange={(event) => setMcpConfig({
                                  servers: mcpConfig.servers.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, url: event.target.value } : item),
                                })}
                                className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs font-mono text-gray-200"
                                placeholder="https://example.com/mcp"
                              />
                            </label>
                            <label className="block space-y-1">
                              <span className="text-xs text-gray-400">{t('HTTP Headers (NAME=VALUE, one per line)')}</span>
                              <textarea
                                rows={Math.max(2, Math.min(5, Object.keys(server.headers).length + 1))}
                                value={Object.entries(server.headers).map(([key, value]) => `${key}=${value}`).join('\n')}
                                onChange={(event) => {
                                  const headers = Object.fromEntries(event.target.value.split('\n').flatMap((line) => {
                                    const separator = line.indexOf('=');
                                    return separator > 0 ? [[line.slice(0, separator).trim(), line.slice(separator + 1)]] : [];
                                  }));
                                  setMcpConfig({
                                    servers: mcpConfig.servers.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, headers } : item),
                                  });
                                }}
                                className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs font-mono text-gray-200 resize-y"
                                placeholder="Authorization=Bearer ..."
                              />
                            </label>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  )}

                  <div className="sticky bottom-0 -mx-6 flex items-center justify-between border-t border-dark-border bg-dark-surface/95 px-6 pb-1 pt-4 backdrop-blur">
                    <span className={`text-xs ${aiSaved ? 'text-emerald-400' : 'text-gray-500'}`}>{aiSaved ? t('✓ Configuration saved') : t('Changes are validated before they are saved.')}</span>
                    <button
                      onClick={handleSaveAi}
                      disabled={isSavingAi}
                      className="px-5 py-2 rounded-lg text-sm font-medium bg-brand-primary hover:bg-brand-primary/80 text-white shadow-lg shadow-brand-primary/20 transition-all disabled:opacity-50"
                    >
                      {isSavingAi ? t('Saving...') : t('Save AI Configuration')}
                    </button>
                  </div>
                </>
              ) : (
                isLoadingAi ? (
                  <div className="space-y-3 animate-pulse"><div className="h-10 rounded-lg bg-dark-border/50" /><div className="h-32 rounded-xl bg-dark-border/30" /></div>
                ) : (
                  <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-6 text-center">
                    <p className="text-sm font-semibold text-red-300">{t('AI configuration could not be loaded')}</p>
                    <p className="mt-1 text-xs text-gray-500">{t('Check the desktop runtime and try again.')}</p>
                    <button type="button" onClick={() => setAiReloadNonce((value) => value + 1)} className="mt-4 rounded-lg border border-dark-border px-4 py-2 text-xs font-semibold text-gray-200 hover:bg-dark-border">{t('Retry')}</button>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
