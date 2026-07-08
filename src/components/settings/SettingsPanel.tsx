/**
 * SettingsPanel — Global settings center for LabNexus.
 * Controls Themes, Proxy defaults, and AI Agent preferences.
 */

import { useState, useEffect } from 'react';

export type ThemeMode = 'obsidian' | 'cyberpunk' | 'nord' | 'solarized' | 'system';

interface GlobalSettings {
  theme: ThemeMode;
  defaultKernel: string;
  defaultProxyHost: string;
  defaultProxyPort: number;
  agentAutoConfirm: boolean;
}

const DEFAULT_SETTINGS: GlobalSettings = {
  theme: 'obsidian',
  defaultKernel: 'python3',
  defaultProxyHost: '127.0.0.1',
  defaultProxyPort: 1080,
  agentAutoConfirm: false,
};

export function SettingsPanel() {
  const [settings, setSettings] = useState<GlobalSettings>(() => {
    const saved = localStorage.getItem('labnexus:settings');
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  });

  const [savedMessage, setSavedMessage] = useState<boolean>(false);

  useEffect(() => {
    // Apply theme to document root
    if (settings.theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'obsidian' : 'solarized');
    } else {
      document.documentElement.setAttribute('data-theme', settings.theme);
    }
  }, [settings.theme]);

  const saveSettings = (newSettings: GlobalSettings) => {
    setSettings(newSettings);
    localStorage.setItem('labnexus:settings', JSON.stringify(newSettings));
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 2000);
  };

  const themes: { id: ThemeMode; name: string; color: string; desc: string }[] = [
    { id: 'obsidian', name: 'Obsidian Dark', color: '#6366f1', desc: 'Sleek deep indigo dark theme (Default)' },
    { id: 'cyberpunk', name: 'Cyberpunk Neon', color: '#ec4899', desc: 'Vibrant pink & neon cyan high-contrast' },
    { id: 'nord', name: 'Nord Frost', color: '#88c0d0', desc: 'Arctic blue calm muted tones' },
    { id: 'solarized', name: 'Solarized Light', color: '#268bd2', desc: 'Warm cream light theme for daytime' },
    { id: 'system', name: 'System Auto', color: '#9ca3af', desc: 'Follow macOS system appearance' },
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-r border-zinc-800 text-zinc-200 select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-950/50">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Global Settings</h3>
        {savedMessage && <span className="text-[11px] text-emerald-400 font-medium">✓ Saved</span>}
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Section: Themes */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-800 pb-1">
            🎨 Color Theme
          </h4>
          <div className="grid grid-cols-1 gap-2">
            {themes.map((t) => (
              <div
                key={t.id}
                onClick={() => saveSettings({ ...settings, theme: t.id })}
                className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                  settings.theme === t.id
                    ? 'bg-zinc-800 border-sky-500 shadow-sm'
                    : 'bg-zinc-800/40 border-transparent hover:bg-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="w-4 h-4 rounded-full border border-white/20 shrink-0"
                    style={{ backgroundColor: t.color }}
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-zinc-200">{t.name}</span>
                    <span className="text-[10px] text-zinc-500">{t.desc}</span>
                  </div>
                </div>
                {settings.theme === t.id && <span className="text-xs text-sky-400 font-bold">✓</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Section: Jupyter Defaults */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-800 pb-1">
            ⚡ Jupyter Defaults
          </h4>
          <div className="space-y-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-zinc-300 font-medium">Default Kernel Name</span>
              <input
                type="text"
                value={settings.defaultKernel}
                onChange={(e) => saveSettings({ ...settings, defaultKernel: e.target.value })}
                className="px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 font-mono focus:outline-none focus:border-sky-500"
                placeholder="e.g. python3"
              />
            </label>
          </div>
        </div>

        {/* Section: Default Proxy */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-800 pb-1">
            🛡️ Default SOCKS5 Proxy
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-zinc-300 font-medium">Host</span>
              <input
                type="text"
                value={settings.defaultProxyHost}
                onChange={(e) => saveSettings({ ...settings, defaultProxyHost: e.target.value })}
                className="px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 font-mono focus:outline-none focus:border-sky-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-zinc-300 font-medium">Port</span>
              <input
                type="number"
                value={settings.defaultProxyPort}
                onChange={(e) => saveSettings({ ...settings, defaultProxyPort: Number(e.target.value) })}
                className="px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 font-mono focus:outline-none focus:border-sky-500"
              />
            </label>
          </div>
        </div>

        {/* Section: AI Agent Preferences */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-800 pb-1">
            🤖 AI Agent Preferences
          </h4>
          <label className="flex items-center justify-between p-2 rounded-lg bg-zinc-800/40 cursor-pointer text-xs">
            <div className="flex flex-col">
              <span className="text-zinc-200 font-medium">Auto-confirm Safe Tools</span>
              <span className="text-[10px] text-zinc-500">Skip confirmation modal for read-only skills</span>
            </div>
            <input
              type="checkbox"
              checked={settings.agentAutoConfirm}
              onChange={(e) => saveSettings({ ...settings, agentAutoConfirm: e.target.checked })}
              className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-sky-500 focus:ring-0 cursor-pointer"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
