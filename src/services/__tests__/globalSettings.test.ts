import { loadGlobalSettings, normalizeTheme, saveGlobalSettings, GLOBAL_SETTINGS_STORAGE_KEY, GLOBAL_SETTINGS_CHANGED_EVENT } from '../globalSettings';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

for (const theme of ['obsidian', 'cyberpunk', 'nord', 'dark']) {
  assert(normalizeTheme(theme) === 'dark', `${theme} preserves dark appearance`);
}
for (const theme of ['solarized', 'light', undefined, null, 'invalid']) {
  assert(normalizeTheme(theme) === 'light', `${theme} resolves to light`);
}

const descriptors = Object.fromEntries(['localStorage', 'window', 'document', 'CustomEvent'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let stored: string | null = null;
let systemDark = true;
let dispatched: CustomEvent | undefined;
const dataset = { theme: '' };
try {
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: {
      getItem: () => stored,
      setItem: (key: string, value: string) => { assert(key === GLOBAL_SETTINGS_STORAGE_KEY, 'writes settings key'); stored = value; },
    } },
    window: { configurable: true, value: {
      matchMedia: () => ({ matches: systemDark }),
      dispatchEvent: (event: CustomEvent) => { dispatched = event; },
    } },
    document: { configurable: true, value: { documentElement: { dataset } } },
    CustomEvent: { configurable: true, value: class {
      constructor(public type: string, public options: { detail: unknown }) {}
      get detail() { return this.options.detail; }
    } },
  });
  assert(normalizeTheme('system') === 'dark', 'legacy system preference resolves dark');
  systemDark = false;
  assert(normalizeTheme('system') === 'light', 'legacy system preference resolves light');
  stored = JSON.stringify({ theme: 'solarized', defaultKernel: 'julia', defaultProxyPort: 9050 });
  const settings = loadGlobalSettings();
  assert(settings.theme === 'light', 'loads old light setting');
  assert(settings.defaultKernel === 'julia' && settings.defaultProxyPort === 9050, 'migration retains preferences');
  saveGlobalSettings({ ...settings, theme: 'dark' });
  assert(dataset.theme === 'dark', 'save immediately applies theme');
  assert(JSON.parse(stored!).theme === 'dark', 'save persists selected theme');
  assert(dispatched?.type === GLOBAL_SETTINGS_CHANGED_EVENT && dispatched?.detail.theme === 'dark', 'save notifies listeners');
  assert(loadGlobalSettings().theme === 'dark', 'reloading retains dark theme');
  stored = '{broken';
  assert(loadGlobalSettings().theme === 'light', 'invalid storage falls back safely');
} finally {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
