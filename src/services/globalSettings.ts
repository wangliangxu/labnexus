export type ThemeMode = 'light' | 'dark';

export interface GlobalSettings {
  theme: ThemeMode;
  defaultKernel: string;
  defaultProxyHost: string;
  defaultProxyPort: number;
  agentAutoConfirm: boolean;
  runCurrentCellShortcut: string;
}

export const GLOBAL_SETTINGS_STORAGE_KEY = 'labnexus:settings';
export const GLOBAL_SETTINGS_CHANGED_EVENT = 'labnexus:settings-changed';

export const DEFAULT_SETTINGS: GlobalSettings = {
  theme: 'light',
  defaultKernel: 'python3',
  defaultProxyHost: '127.0.0.1',
  defaultProxyPort: 1080,
  agentAutoConfirm: false,
  runCurrentCellShortcut: 'Shift-Enter',
};

// Resolve previous releases' saved themes without discarding other preferences.
export function normalizeTheme(theme: unknown): ThemeMode {
  if (theme === 'dark' || theme === 'obsidian' || theme === 'cyberpunk' || theme === 'nord') return 'dark';
  if (theme === 'system' && typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
}

export function loadGlobalSettings(): GlobalSettings {
  try {
    const saved = localStorage.getItem(GLOBAL_SETTINGS_STORAGE_KEY);
    const settings = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };
    return { ...settings, theme: normalizeTheme(settings.theme) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveGlobalSettings(settings: GlobalSettings) {
  const normalized = { ...settings, theme: normalizeTheme(settings.theme) };
  localStorage.setItem(GLOBAL_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  applyTheme(normalized.theme);
  window.dispatchEvent(new CustomEvent(GLOBAL_SETTINGS_CHANGED_EVENT, { detail: normalized }));
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return null;
  const modifiers = [
    event.metaKey || event.ctrlKey ? 'Mod' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
  ].filter(Boolean);
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...modifiers, key].join('-');
}

export function keyboardEventMatchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  return shortcutFromKeyboardEvent(event) === shortcut;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function formatShortcut(shortcut: string): string {
  const mod = typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
  return shortcut.split('-').join('+').replace('Mod', mod);
}
