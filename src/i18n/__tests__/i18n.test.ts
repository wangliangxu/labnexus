import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeLocale } from '../locale';
import { getLocale, localizeStatus, t, translate } from '../index';
import { zhCN } from '../messages';
import { GLOBAL_SETTINGS_CHANGED_EVENT, loadGlobalSettings, saveGlobalSettings } from '../../services/globalSettings';
import { NotebookToolbar } from '../../components/notebook/NotebookToolbar';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// Every localized template must preserve the source's named placeholders.
for (const [key, value] of Object.entries(zhCN)) {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
  assert(placeholders(key) === placeholders(value), `placeholder parity: ${key}`);
  assert(value.trim().length > 0, `nonempty translation: ${key}`);
}
assert(translate('en', 'Connect to Server') === 'Connect to Server', 'English source fallback');
assert(translate('zh-CN', 'Connect to Server') === '连接服务器', 'Chinese translation');
assert(translate('zh-CN', '{count} messages', { count: 0 }) === '0 条消息', 'zero count');
assert(translate('en', '{count} servers', { count: 2 }) === '2 servers', 'plural count');
assert(translate('en', 'Remove {name} context', { name: '$& {count}' }) === 'Remove $& {count} context', 'parameters are literal and never reprocessed');

const keys = ['localStorage', 'window', 'document', 'navigator', 'CustomEvent'] as const;
const descriptors = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
let stored: string | null = null;
let systemLanguage = 'zh-TW';
let event: { type: string; detail: { language: string } } | undefined;
try {
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } } },
    navigator: { configurable: true, value: { get languages() { return [systemLanguage]; } } },
    window: { configurable: true, value: { dispatchEvent: (value: typeof event) => { event = value; } } },
    document: { configurable: true, value: { documentElement: { dataset: {} } } },
    CustomEvent: { configurable: true, value: class { constructor(public type: string, public options: { detail: unknown }) {} get detail() { return this.options.detail; } } },
  });
  assert(normalizeLocale(undefined) === 'zh-CN', 'Chinese system variants default to simplified Chinese');
  assert(getLocale() === 'zh-CN', 'first launch follows system');
  systemLanguage = 'de-DE';
  assert(normalizeLocale('invalid') === 'en', 'unsupported system language falls back to English');
  assert(normalizeLocale('zh-CN') === 'zh-CN', 'explicit preference overrides system');
  stored = JSON.stringify({ theme: 'dark', defaultKernel: 'julia', defaultProxyPort: 9050 });
  const migrated = loadGlobalSettings();
  assert(migrated.language === 'en' && migrated.theme === 'dark' && migrated.defaultKernel === 'julia', 'old preferences migrate without loss');
  saveGlobalSettings({ ...migrated, language: 'zh-CN' });
  assert(JSON.parse(stored!).language === 'zh-CN' && getLocale() === 'zh-CN', 'language persists across loads');
  assert(event?.type === GLOBAL_SETTINGS_CHANGED_EVENT && event?.detail.language === 'zh-CN', 'language change notifies mounted UI');
  assert(t('No server connected') === '尚未连接服务器', 'translation uses saved preference');
  assert(localizeStatus('Completed') === '已完成' && localizeStatus('custom-backend-state') === 'custom-backend-state', 'recognized states translate while diagnostics remain intact');

  // Exercise the real toolbar, including translated labels, tooltips, and fixed protocol values.
  const noop = () => {};
  const renderToolbar = () => renderToStaticMarkup(createElement(NotebookToolbar, {
    notebookName: 'science.ipynb', kernelName: 'Python 3', status: 'idle', isDirty: true,
    isSaving: false, isConnecting: false, canRun: true, activeCellType: 'code',
    onSave: noop, onAddCode: noop, onAddMarkdown: noop, onRunSelected: noop, onRunAll: noop,
    onInterrupt: noop, onRestart: noop, onConnect: noop, onActiveCellTypeChange: noop,
  }));
  const chinese = renderToolbar();
  assert(chinese.includes('全部运行') && chinese.includes('保存 Notebook') && chinese.includes('空闲'), 'toolbar Chinese controls and statuses');
  assert(chinese.includes('value="code"') && chinese.includes('science.ipynb'), 'translation preserves protocol values and user filenames');
  saveGlobalSettings({ ...loadGlobalSettings(), language: 'en' });
  const english = renderToolbar();
  assert(english.includes('Run All') && english.includes('Save Notebook') && english.includes('Idle') && !english.includes('全部运行'), 'toolbar switches back to English');
  assert(loadGlobalSettings().defaultKernel === 'julia' && loadGlobalSettings().defaultProxyPort === 9050, 'language changes preserve unrelated preferences');
  stored = '{invalid';
  assert(getLocale() === 'en', 'corrupt storage falls back to system language');
} finally {
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
