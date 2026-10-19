import { t, useLocale, type Locale } from '../../i18n';
import React, { useState, useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Settings as SettingsIcon, X, Globe, Sparkles, Palette, Zap, Keyboard, Shield, Check, Plus, Cpu } from 'lucide-react';
import { ChatGptSettings } from './ChatGptSettings';
import { AiNetworkSettings, DEFAULT_AI_NETWORK } from './AiNetworkSettings';
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
  const [aiSection, setAiSection] = useState<'provider' | 'context' | 'reliability' | 'network' | 'mcp'>('provider');
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

  const useChatGpt = aiConfig?.remote.auth_mode === 'chatgpt';
  const remoteModel = (useChatGpt ? aiConfig?.remote.chatgpt_model : aiConfig?.remote.chat_model)?.trim().toLowerCase() || 'deepseek-flash';
  const isDeepSeekFlash = /deepseek.*flash/.test(remoteModel);
  const isSol = remoteModel.startsWith('gpt-6.1-sol');
  const isOpenAIReasoner = /^(gpt-[56]|o[134])/.test(remoteModel);
  const thinkingMode = aiConfig?.remote.thinking_mode || 'auto';
  const isRemoteThinking = isSol || thinkingMode === 'enabled' ||
    (thinkingMode === 'auto' && (isDeepSeekFlash || isOpenAIReasoner || /reasoner|r1/.test(remoteModel)));
  const apiFormat = aiConfig?.remote.api_format || 'responses';
  const applyRemotePreset = (preset: 'deepseek' | 'sol') => {
    if (!aiConfig) return;
    const baseUrl = preset === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1';
    let sameOrigin = false;
    try { sameOrigin = new URL(aiConfig.remote.base_url).origin === new URL(baseUrl).origin; } catch { /* Invalid old URL. */ }
    setAiConfig({
      ...aiConfig, provider: 'remote',
      remote: {
        ...aiConfig.remote, enabled: true, auth_mode: 'api_key', api_format: 'responses', base_url: baseUrl,
        api_key: sameOrigin ? aiConfig.remote.api_key : '',
        chat_model: preset === 'deepseek' ? 'deepseek-flash' : 'gpt-6.1-sol',
        reasoning_model: '', thinking_mode: 'auto',
        reasoning_effort: preset === 'deepseek' ? 'high' : 'medium',
        temperature: 1, top_p: 0.95,
        context_window_tokens: preset === 'deepseek' ? 1_048_576 : 1_050_000,
        max_output_tokens: 65_536, timeout_seconds: 300,
      },
    });
  };

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
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in" style={{ zIndex: 'var(--z-modal)' }}>
      <div className="bg-dark-surface border border-dark-border rounded-xl shadow-2xl max-w-4xl w-full flex flex-col animate-scale-up text-nb-text" style={{ maxHeight: '88vh' }}>
        {/* Header */}
        <div className="flex justify-between items-center border-b border-dark-border px-6 py-4 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-nb-text flex items-center gap-2">
              <SettingsIcon size={18} strokeWidth={1.8} className="text-brand-primary" />
              {t('Settings')}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('Close dialog')}
            className="text-nb-text-secondary hover:text-nb-text p-1.5 rounded-md hover:bg-dark-bg transition-colors"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        {/* Main Tabs */}
        <div className="flex border-b border-dark-border px-6 shrink-0 bg-dark-bg/50">
          <button
            onClick={() => setActiveTab('global')}
            className={`py-3 px-4 text-sm font-medium transition-colors border-b-2 inline-flex items-center gap-2 ${
              activeTab === 'global'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-nb-text-secondary hover:text-nb-text hover:border-dark-border'
            }`}
          >
            <Globe size={14} strokeWidth={1.8} />
            {t('Global Settings')}
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`py-3 px-4 text-sm font-medium transition-colors border-b-2 inline-flex items-center gap-2 ${
              activeTab === 'ai'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-nb-text-secondary hover:text-nb-text hover:border-dark-border'
            }`}
          >
            <Sparkles size={14} strokeWidth={1.8} />
            {t('AI Configuration')}
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 text-sm">
          {activeTab === 'global' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-nb-text-secondary uppercase tracking-wider border-b border-dark-border pb-1.5 flex items-center gap-1.5">
                  <Globe size={13} strokeWidth={1.8} />
                  {t('Language')}
                </h4>
                <label className="flex flex-col gap-1 max-w-sm">
                  <span className="text-nb-text font-medium">{t('Interface language')}</span>
                  <select
                    aria-label={t('Interface language')}
                    value={settings.language}
                    onChange={(event) => saveGlobalSettings({ ...settings, language: event.target.value as Locale })}
                    className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-nb-text focus:outline-none focus:border-brand-primary"
                  >
                    <option value="zh-CN" lang="zh-CN">中文（简体）</option>
                    <option value="en" lang="en">English</option>
                  </select>
                </label>
              </div>
              {/* Section: Themes */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-dark-border pb-1.5">
                  <h4 className="text-xs font-semibold text-nb-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                    <Palette size={13} strokeWidth={1.8} />
                    {t('Color Theme')}
                  </h4>
                  {globalSavedMessage && (
                    <span className="text-[11px] text-emerald-500 font-medium inline-flex items-center gap-1">
                      <Check size={12} strokeWidth={2.2} />
                      {t('Saved')}
                    </span>
                  )}
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
                          : 'bg-dark-bg border-dark-border/60 hover:bg-dark-surface hover:border-dark-border'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-4 h-4 rounded-full border border-dark-border shrink-0 shadow-sm"
                          style={{ backgroundColor: t.color }}
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-nb-text">{t.name}</span>
                          <span className="text-xs text-nb-text-secondary">{t.desc}</span>
                        </div>
                      </div>
                      {settings.theme === t.id && <Check size={15} strokeWidth={2.2} className="text-brand-primary shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Section: Jupyter Defaults */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-nb-text-secondary uppercase tracking-wider border-b border-dark-border pb-1.5 flex items-center gap-1.5">
                  <Zap size={13} strokeWidth={1.8} />
                  {t('Jupyter Defaults')}
                </h4>
                <div className="space-y-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-nb-text font-medium">{t('Default Kernel Name')}</span>
                    <input
                      type="text"
                      value={settings.defaultKernel}
                      onChange={(e) => saveGlobalSettings({ ...settings, defaultKernel: e.target.value })}
                      className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-nb-text font-mono focus:outline-none focus:border-brand-primary max-w-sm"
                      placeholder={t('e.g. python3')}
                    />
                  </label>
                </div>
              </div>

              {/* Section: Keyboard Shortcuts */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-nb-text-secondary uppercase tracking-wider border-b border-dark-border pb-1.5 flex items-center gap-1.5">
                  <Keyboard size={13} strokeWidth={1.8} />
                  {t('Keyboard Shortcuts')}
                </h4>
                <label className="flex flex-col gap-1 max-w-sm">
                  <span className="text-nb-text font-medium">{t('Run current cell')}</span>
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
                    className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-nb-text font-mono focus:outline-none focus:border-brand-primary cursor-text"
                    title={t('Focus this field and press the desired key combination')}
                  />
                  <span className="text-xs text-nb-text-secondary">{t('Click the field, then press a new key combination.')}</span>
                </label>
              </div>

              {/* Section: Default Proxy */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-nb-text-secondary uppercase tracking-wider border-b border-dark-border pb-1.5 flex items-center gap-1.5">
                  <Shield size={13} strokeWidth={1.8} />
                  {t('Default SOCKS5 Proxy')}
                </h4>
                <div className="grid grid-cols-2 gap-4 max-w-sm">
                  <label className="flex flex-col gap-1">
                    <span className="text-nb-text font-medium">{t('Host')}</span>
                    <input
                      type="text"
                      value={settings.defaultProxyHost}
                      onChange={(e) => saveGlobalSettings({ ...settings, defaultProxyHost: e.target.value })}
                      className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-nb-text font-mono focus:outline-none focus:border-brand-primary"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-nb-text font-medium">{t('Port')}</span>
                    <input
                      type="number"
                      value={settings.defaultProxyPort}
                      onChange={(e) => saveGlobalSettings({ ...settings, defaultProxyPort: Number(e.target.value) })}
                      className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-nb-text font-mono focus:outline-none focus:border-brand-primary"
                    />
                  </label>
                </div>
              </div>

              {/* Section: AI Agent Preferences */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-nb-text-secondary uppercase tracking-wider border-b border-dark-border pb-1.5 flex items-center gap-1.5">
                  <Sparkles size={13} strokeWidth={1.8} />
                  {t('AI Agent Preferences')}
                </h4>
                <label className="flex items-center justify-between p-3 rounded-lg bg-dark-bg border border-dark-border cursor-pointer max-w-md">
                  <div className="flex flex-col">
                    <span className="text-nb-text font-medium">{t('Auto-confirm Safe Tools')}</span>
                    <span className="text-xs text-nb-text-secondary">{t('Skip confirmation modal for read-only skills')}</span>
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
              <p className="text-xs text-nb-text-secondary mb-2">
                {t('Configure Hybrid LLM strategy: Remote API priority or Local Ollama / llama.cpp fallback.')}
              </p>

              {(aiError || !isTauri()) && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs p-3 rounded-lg">
                  {!isTauri() ? t('AI configuration is available when LabNexus runs as a desktop application.') : aiError}
                </div>
              )}

              {aiConfig ? (
                <>
                  <div className="grid grid-cols-5 gap-2 rounded-xl border border-dark-border bg-dark-bg/50 p-1.5">
                    {([
                      ['provider', t('Provider & Models')],
                      ['context', t('Context & Memory')],
                      ['reliability', t('Reliability')],
                      ['network', t('AI proxy')],
                      ['mcp', t('MCP Servers')],
                    ] as const).map(([id, label]) => (
                      <button key={id} type="button" onClick={() => setAiSection(id)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${aiSection === id ? 'bg-brand-primary text-white shadow' : 'text-nb-text-secondary hover:bg-dark-border hover:text-nb-text'}`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {aiSection === 'provider' && <>
                  {/* Strategy Tabs */}
                  <div className="flex border-b border-dark-border gap-4 mb-4">
                    <button
                      onClick={() => setAiStrategyTab('remote')}
                      className={`pb-2 text-sm font-medium transition-colors border-b-2 inline-flex items-center gap-1.5 ${
                        aiStrategyTab === 'remote'
                          ? 'border-brand-primary text-brand-primary'
                          : 'border-transparent text-nb-text-secondary hover:text-nb-text'
                      }`}
                    >
                      <Globe size={14} strokeWidth={1.8} />
                      {t('Remote API (OpenAI / DeepSeek)')}
                    </button>
                    <button
                      onClick={() => setAiStrategyTab('ollama')}
                      className={`pb-2 text-sm font-medium transition-colors border-b-2 inline-flex items-center gap-1.5 ${
                        aiStrategyTab === 'ollama'
                          ? 'border-brand-primary text-brand-primary'
                          : 'border-transparent text-nb-text-secondary hover:text-nb-text'
                      }`}
                    >
                      <Cpu size={14} strokeWidth={1.8} />
                      {t('Local Ollama / llama.cpp')}
                    </button>
                  </div>

                  {/* Tab Contents */}
                  <div className="space-y-4">
                    {aiStrategyTab === 'remote' ? (
                      <div className="space-y-4">
                        <label className="block space-y-1">
                          <span className="text-xs font-semibold text-nb-text-secondary">{t('Authentication')}</span>
                          <select value={useChatGpt ? 'chatgpt' : 'api_key'}
                            onChange={(event) => setAiConfig({ ...aiConfig, remote: { ...aiConfig.remote,
                              auth_mode: event.target.value as 'api_key' | 'chatgpt', thinking_mode: 'auto',
                            } })}
                            className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm">
                            <option value="api_key">{t('API key (DeepSeek Flash by default)')}</option>
                            <option value="chatgpt">{t('ChatGPT subscription')}</option>
                          </select>
                        </label>
                        {useChatGpt ? <ChatGptSettings value={aiConfig.remote} onChange={(remote) => setAiConfig({ ...aiConfig, remote })} /> : <>
                        <div className="rounded-lg border border-brand-primary/25 bg-brand-primary/10 p-3 space-y-2">
                          <span className="text-xs font-semibold text-nb-text">{t('Model presets')}</span>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => applyRemotePreset('deepseek')}
                              className="rounded-lg border border-brand-primary/30 px-3 py-1.5 text-xs text-brand-primary hover:bg-brand-primary/10">{t('DeepSeek V4.1 Flash (default)')}</button>
                            <button type="button" onClick={() => applyRemotePreset('sol')}
                              className="rounded-lg border border-brand-primary/30 px-3 py-1.5 text-xs text-brand-primary hover:bg-brand-primary/10">GPT-6.1 Sol</button>
                          </div>
                          <p className="text-xs leading-relaxed text-nb-text-secondary">
                            {t('Apply a preset to use Responses API with native reasoning and a 64K output budget. Enter the provider API key before saving.')}
                          </p>
                        </div>
                        <label className="block space-y-1">
                          <span className="text-xs font-semibold text-nb-text-secondary">{t('API format')}</span>
                          <select value={apiFormat}
                            onChange={(event) => setAiConfig({ ...aiConfig, remote: { ...aiConfig.remote, api_format: event.target.value as 'responses' | 'chat_completions' } })}
                            className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-nb-text">
                            <option value="responses">{t('Responses API (default)')}</option>
                            <option value="chat_completions" disabled={isSol}>{t('Chat Completions (legacy compatibility)')}</option>
                          </select>
                        </label>
                        <div>
                          <label className="block text-xs font-semibold text-nb-text-secondary mb-1">
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
                            className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-nb-text focus:outline-none focus:border-brand-primary"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-nb-text-secondary mb-1">
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
                            className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-nb-text focus:outline-none focus:border-brand-primary"
                          />
                        </div>

                        <label className="block space-y-1">
                          <span className="text-xs font-semibold text-nb-text-secondary">{t('Model')}</span>
                          <input type="text" value={aiConfig.remote.chat_model}
                            onChange={(event) => {
                              const model = event.target.value;
                              const sol = model.trim().toLowerCase().startsWith('gpt-6.1-sol');
                              setAiConfig({ ...aiConfig, remote: { ...aiConfig.remote, chat_model: model,
                                ...(sol ? { api_format: 'responses', thinking_mode: 'auto' } : {}),
                              } });
                            }}
                            placeholder="deepseek-flash"
                            className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-nb-text" />
                        </label>
                        <p className="text-xs text-nb-text-secondary">{t('One model handles conversation and reasoning. Available thinking settings depend on the model.')}</p>
                        {apiFormat === 'chat_completions' && !isDeepSeekFlash && !isSol && (
                          <details className="text-xs text-nb-text-secondary">
                            <summary className="cursor-pointer">{t('Legacy reasoning model (optional)')}</summary>
                            <input type="text" value={aiConfig.remote.reasoning_model}
                              onChange={(event) => setAiConfig({ ...aiConfig, remote: { ...aiConfig.remote, reasoning_model: event.target.value } })}
                              className="mt-2 w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-nb-text" />
                          </details>
                        )}
                        </>}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-nb-text-secondary mb-1">
                              {t('Thinking Mode')}
                            </label>
                            <select
                              value={isSol && thinkingMode === 'disabled' ? 'auto' : thinkingMode}
                              onChange={(e) =>
                                setAiConfig({
                                  ...aiConfig,
                                  remote: {
                                    ...aiConfig.remote,
                                    thinking_mode: e.target.value as 'auto' | 'enabled' | 'disabled',
                                  },
                                })
                              }
                              className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-nb-text focus:outline-none focus:border-brand-primary"
                            >
                              <option value="auto">{t('Auto (model default)')}</option>
                              <option value="enabled">{t('Enabled (Thinking)')}</option>
                              <option value="disabled" disabled={isSol}>{t('Disabled (Fast response)')}</option>
                            </select>
                            {isSol && <p className="mt-1 text-[11px] text-nb-text-secondary">{t('GPT-6.1 Sol always reasons. Select low effort for faster responses.')}</p>}
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-nb-text-secondary mb-1">
                              {t('Reasoning Effort')}
                            </label>
                            <select
                              value={isDeepSeekFlash && ['medium', 'xhigh'].includes(aiConfig.remote.reasoning_effort || '') ? 'high' : (aiConfig.remote.reasoning_effort || 'high')}
                              disabled={!isRemoteThinking}
                              onChange={(e) =>
                                setAiConfig({
                                  ...aiConfig,
                                  remote: {
                                    ...aiConfig.remote,
                                    reasoning_effort: e.target.value as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
                                  },
                                })
                              }
                              className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-nb-text focus:outline-none focus:border-brand-primary disabled:opacity-50"
                            >
                              <option value="low">{t('Low (Faster tool loops)')}</option>
                              {!isDeepSeekFlash && <option value="medium">{t('Medium (Balanced)')}</option>}
                              <option value="high">{t('High (Deep analysis)')}</option>
                              {!isDeepSeekFlash && <option value="xhigh">{t('Extra high (Extended reasoning)')}</option>}
                              <option value="max">{t('Max (Maximum CoT budget)')}</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-nb-text-secondary mb-1">
                              {t('Temperature (')}{aiConfig.remote.temperature})
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="2"
                              step="0.05"
                              value={aiConfig.remote.temperature}
                              disabled={useChatGpt || isRemoteThinking}
                              onChange={(e) =>
                                setAiConfig({
                                  ...aiConfig,
                                  remote: { ...aiConfig.remote, temperature: parseFloat(e.target.value) },
                                })
                              }
                              className="w-full accent-brand-primary disabled:opacity-40"
                            />
                            {isRemoteThinking && (
                              <span className="text-[11px] text-nb-text-secondary block mt-0.5">
                                {t('Omitted automatically when Thinking Mode is active.')}
                              </span>
                            )}
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-nb-text-secondary mb-1">
                              {t('Top P (')}{isDeepSeekFlash ? (isRemoteThinking ? Math.max(0.95, aiConfig.remote.top_p) : 1) : aiConfig.remote.top_p})
                            </label>
                            <input
                              type="range"
                              min={isDeepSeekFlash ? '0.95' : '0.01'}
                              max="1"
                              step="0.01"
                              disabled={useChatGpt || (isDeepSeekFlash && !isRemoteThinking) || (isOpenAIReasoner && isRemoteThinking)}
                              value={isDeepSeekFlash ? (isRemoteThinking ? Math.max(0.95, aiConfig.remote.top_p) : 1) : aiConfig.remote.top_p}
                              onChange={(e) =>
                                setAiConfig({
                                  ...aiConfig,
                                  remote: { ...aiConfig.remote, top_p: parseFloat(e.target.value) },
                                })
                              }
                              className="w-full accent-brand-primary disabled:opacity-40"
                            />
                            {isOpenAIReasoner && isRemoteThinking && <span className="text-[11px] text-nb-text-secondary block mt-0.5">
                              {t('Omitted automatically when Thinking Mode is active.')}
                            </span>}
                            {isDeepSeekFlash && <span className="text-[11px] text-nb-text-secondary block mt-0.5">
                              {t('Thinking: 0.95–1.00. Non-thinking: fixed at 1.00.')}
                            </span>}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-semibold text-nb-text-secondary mb-1">
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
                            className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-nb-text focus:outline-none focus:border-brand-primary"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-nb-text-secondary mb-1">
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
                            className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-nb-text focus:outline-none focus:border-brand-primary"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-nb-text-secondary mb-1">
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
                            <label className="block text-xs font-semibold text-nb-text-secondary mb-1">
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

                  {aiSection === 'network' && <AiNetworkSettings
                    value={aiConfig.network || DEFAULT_AI_NETWORK}
                    baseUrl={aiConfig.remote.base_url}
                    onChange={(network) => setAiConfig({ ...aiConfig, network })}
                  />}

                  {aiSection === 'context' && (
                  <div className="space-y-5 rounded-xl border border-dark-border bg-dark-bg/35 p-5">
                    <div>
                      <h4 className="text-sm font-semibold text-nb-text">{t('Context budget')}</h4>
                      <p className="mt-1 text-xs text-nb-text-secondary">{t('Configure the active model\'s input window and reserved response capacity.')}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                    <label className="space-y-1">
                      <span className="text-xs text-nb-text-secondary">{t('Context window (tokens)')}</span>
                      <input
                        type="number"
                        min="2048"
                        max={aiStrategyTab === 'remote' ? (isDeepSeekFlash ? 1_048_576 : isSol ? 1_050_000 : 2_000_000) : 2_000_000}
                        value={aiStrategyTab === 'remote' ? aiConfig.remote.context_window_tokens : aiConfig.ollama.context_window_tokens}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setAiConfig(aiStrategyTab === 'remote'
                            ? { ...aiConfig, remote: { ...aiConfig.remote, context_window_tokens: value } }
                            : { ...aiConfig, ollama: { ...aiConfig.ollama, context_window_tokens: value } });
                        }}
                        className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-xs text-nb-text"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-nb-text-secondary">{t('Maximum output (tokens)')}</span>
                      <input
                        type="number"
                        min="256"
                        max={aiStrategyTab === 'remote' ? (isDeepSeekFlash ? 393_216 : isSol ? 128_000 : undefined) : undefined}
                        value={aiStrategyTab === 'remote' ? aiConfig.remote.max_output_tokens : aiConfig.ollama.max_output_tokens}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setAiConfig(aiStrategyTab === 'remote'
                            ? { ...aiConfig, remote: { ...aiConfig.remote, max_output_tokens: value } }
                            : { ...aiConfig, ollama: { ...aiConfig.ollama, max_output_tokens: value } });
                        }}
                        className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-xs text-nb-text"
                      />
                    </label>
                    </div>
                    <div className="rounded-lg border border-brand-primary/25 bg-brand-primary/10 p-3 text-xs leading-relaxed text-nb-text-secondary">
                      {t('LabNexus reserves output and tool-schema tokens first, then keeps complete user/tool turns within the remaining budget.')}
                    </div>
                  </div>
                  )}

                  {aiSection === 'reliability' && (
                  <div className="space-y-4 rounded-xl border border-dark-border bg-dark-bg/35 p-5">
                    <h4 className="text-xs font-semibold text-nb-text-secondary uppercase tracking-wider">{t('Provider Resilience')}</h4>
                    <label className="flex items-center justify-between p-3 rounded-lg bg-dark-bg border border-dark-border">
                      <span className="text-xs text-nb-text">{t('Automatically switch to the other enabled provider on transient failures')}</span>
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
                        <span className="text-xs text-nb-text-secondary">{t('Maximum retries')}</span>
                        <input type="number" min="0" max="8" value={aiConfig.resilience.max_retries}
                          onChange={(event) => setAiConfig({ ...aiConfig, resilience: { ...aiConfig.resilience, max_retries: Number(event.target.value) } })}
                          className="w-full bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-xs text-nb-text" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-nb-text-secondary">{t('Retry base (ms)')}</span>
                        <input type="number" min="50" max="60000" value={aiConfig.resilience.retry_base_delay_ms}
                          onChange={(event) => setAiConfig({ ...aiConfig, resilience: { ...aiConfig.resilience, retry_base_delay_ms: Number(event.target.value) } })}
                          className="w-full bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-xs text-nb-text" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-nb-text-secondary">{t('Circuit failures')}</span>
                        <input type="number" min="1" max="20" value={aiConfig.resilience.circuit_breaker_threshold}
                          onChange={(event) => setAiConfig({ ...aiConfig, resilience: { ...aiConfig.resilience, circuit_breaker_threshold: Number(event.target.value) } })}
                          className="w-full bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-xs text-nb-text" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-nb-text-secondary">{t('Cooldown (seconds)')}</span>
                        <input type="number" min="1" max="3600" value={aiConfig.resilience.circuit_breaker_cooldown_seconds}
                          onChange={(event) => setAiConfig({ ...aiConfig, resilience: { ...aiConfig.resilience, circuit_breaker_cooldown_seconds: Number(event.target.value) } })}
                          className="w-full bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-xs text-nb-text" />
                      </label>
                    </div>
                  </div>
                  )}

                  {aiSection === 'mcp' && (
                  <div className="space-y-3 rounded-xl border border-dark-border bg-dark-bg/35 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-semibold text-nb-text-secondary uppercase tracking-wider">
                          {t('External MCP Servers')}
                        </h4>
                        <p className="text-xs text-nb-text-secondary mt-1">
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
                        className="px-3 py-1.5 rounded-lg text-xs border border-dark-border text-nb-text-secondary hover:border-brand-primary hover:text-nb-text inline-flex items-center gap-1"
                      >
                        <Plus size={12} strokeWidth={2} />
                        {t('Add Server')}
                      </button>
                    </div>

                    {mcpWarnings.length > 0 && (
                      <div className="bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs p-3 rounded-lg space-y-1">
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
                            className="flex-1 bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-sm text-nb-text"
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
                            <span className="text-xs text-nb-text-secondary">{t('Server ID')}</span>
                            <input
                              value={server.id}
                              onChange={(event) => setMcpConfig({
                                servers: mcpConfig.servers.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, id: event.target.value } : item),
                              })}
                              className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs font-mono text-nb-text"
                              placeholder="filesystem"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs text-nb-text-secondary">{t('Transport')}</span>
                            <select
                              value={server.transport}
                              onChange={(event) => setMcpConfig({
                                servers: mcpConfig.servers.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, transport: event.target.value as 'stdio' | 'streamable_http' }
                                    : item),
                              })}
                              className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs text-nb-text"
                            >
                              <option value="stdio">stdio</option>
                              <option value="streamable_http">{t('Streamable HTTP')}</option>
                            </select>
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs text-nb-text-secondary">{t('Timeout (seconds)')}</span>
                            <input
                              type="number"
                              min="1"
                              max="120"
                              value={server.timeout_seconds}
                              onChange={(event) => setMcpConfig({
                                servers: mcpConfig.servers.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, timeout_seconds: Number(event.target.value) } : item),
                              })}
                              className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs text-nb-text"
                            />
                          </label>
                        </div>
                        {server.transport === 'stdio' ? (
                          <>
                            <label className="block space-y-1">
                              <span className="text-xs text-nb-text-secondary">{t('Command')}</span>
                              <input
                                value={server.command}
                                onChange={(event) => setMcpConfig({
                                  servers: mcpConfig.servers.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, command: event.target.value } : item),
                                })}
                                className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs font-mono text-nb-text"
                                placeholder="npx or /absolute/path/to/server"
                              />
                            </label>
                            <label className="block space-y-1">
                              <span className="text-xs text-nb-text-secondary">{t('Arguments (one per line)')}</span>
                              <textarea
                                rows={Math.max(2, Math.min(5, server.args.length + 1))}
                                value={server.args.join('\n')}
                                onChange={(event) => setMcpConfig({
                                  servers: mcpConfig.servers.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, args: event.target.value.split('\n').filter((argument) => argument.length > 0) }
                                      : item),
                                })}
                                className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs font-mono text-nb-text resize-y"
                              />
                            </label>
                            <label className="block space-y-1">
                              <span className="text-xs text-nb-text-secondary">{t('Environment (NAME=VALUE, one per line)')}</span>
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
                                className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs font-mono text-nb-text resize-y"
                              />
                            </label>
                          </>
                        ) : (
                          <>
                            <label className="block space-y-1">
                              <span className="text-xs text-nb-text-secondary">{t('MCP Endpoint URL')}</span>
                              <input
                                value={server.url}
                                onChange={(event) => setMcpConfig({
                                  servers: mcpConfig.servers.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, url: event.target.value } : item),
                                })}
                                className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs font-mono text-nb-text"
                                placeholder="https://example.com/mcp"
                              />
                            </label>
                            <label className="block space-y-1">
                              <span className="text-xs text-nb-text-secondary">{t('HTTP Headers (NAME=VALUE, one per line)')}</span>
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
                                className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1.5 text-xs font-mono text-nb-text resize-y"
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
                    <span className={`text-xs ${aiSaved ? 'text-emerald-500' : 'text-nb-text-secondary'}`}>{aiSaved ? t('✓ Configuration saved') : t('Changes are validated before they are saved.')}</span>
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
                    <p className="text-sm font-semibold text-red-400">{t('AI configuration could not be loaded')}</p>
                    <p className="mt-1 text-xs text-nb-text-secondary">{t('Check the desktop runtime and try again.')}</p>
                    <button type="button" onClick={() => setAiReloadNonce((value) => value + 1)} className="mt-4 rounded-lg border border-dark-border px-4 py-2 text-xs font-semibold text-nb-text hover:bg-dark-border">{t('Retry')}</button>
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
