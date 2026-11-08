import { t, type Locale } from '../../i18n';
import React from 'react';
import { Globe, Palette, Keyboard, Check, Zap, Shield, Sparkles } from 'lucide-react';
import {
  formatShortcut,
  shortcutFromKeyboardEvent,
  type GlobalSettings,
  type ThemeMode,
} from '../../services/globalSettings';

interface GlobalSettingsTabProps {
  settings: GlobalSettings;
  saved: boolean;
  onSave: (settings: GlobalSettings) => void;
}

/** "Global settings" tab: language, theme and keyboard shortcuts. */
export const GlobalSettingsTab: React.FC<GlobalSettingsTabProps> = ({
  settings,
  saved: globalSavedMessage,
  onSave: saveGlobalSettings,
}) => {
  const themes: { id: ThemeMode; name: string; color: string; desc: string }[] = [
    { id: 'light', name: t('Light · JupyterLab Light'), color: '#ffffff', desc: t('White workspace, light gray panels and blue accents') },
    { id: 'dark', name: t('Dark · JupyterLab Dark'), color: '#212121', desc: t('Neutral dark gray workspace and blue accents') },
  ];

  return (
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
  );
};
