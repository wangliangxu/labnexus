import { useEffect, useSyncExternalStore } from 'react';
import { GLOBAL_SETTINGS_CHANGED_EVENT, GLOBAL_SETTINGS_STORAGE_KEY, loadGlobalSettings } from '../services/globalSettings';
import { zhCN, type MessageKey } from './messages';
import type { Locale } from './locale';

export type { Locale } from './locale';
export type { MessageKey } from './messages';
type Parameters = Record<string, string | number>;

export function translate(locale: Locale, key: MessageKey, parameters: Parameters = {}): string {
  const message = locale === 'zh-CN' ? zhCN[key] : key;
  // A replacement callback preserves literal dollar signs and does not reprocess values.
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : placeholder);
}

export function getLocale(): Locale {
  return loadGlobalSettings().language;
}

export function t(key: MessageKey, parameters?: Parameters): string {
  return translate(getLocale(), key, parameters);
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === GLOBAL_SETTINGS_STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener(GLOBAL_SETTINGS_CHANGED_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  window.addEventListener('languagechange', onChange);
  return () => {
    window.removeEventListener(GLOBAL_SETTINGS_CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('languagechange', onChange);
  };
}

/** Subscribe at the app root and in memoized editors; changing language keeps UI state. */
export function useLocale(): Locale {
  const locale = useSyncExternalStore(subscribe, getLocale, () => 'en' as const);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return locale;
}

const statusMessages: Record<string, MessageKey> = {
  connecting: 'Connecting...', idle: 'Idle', busy: 'Busy', starting: 'Starting...', restarting: 'Restarting...',
  dead: 'Dead', error: 'Error', connected: 'Connected', disconnected: 'Disconnected',
  completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', canceled: 'Cancelled',
  running: 'Running', pending: 'Pending', reasoning: 'Reasoning', thought: 'Reasoning',
  answer: 'Answer', observation: 'Observation', tool_call: 'Tool call', tool_result: 'Tool result',
};

/** Translate recognized machine states only, retaining unknown diagnostic details. */
export function localizeStatus(status: string | undefined): string {
  if (!status) return '';
  const key = statusMessages[status.toLowerCase()];
  return key ? t(key) : status;
}
