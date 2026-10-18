export type Locale = 'zh-CN' | 'en';

/** Unknown and older saved preferences follow the operating system language. */
export function normalizeLocale(value: unknown): Locale {
  if (value === 'zh-CN' || value === 'en') return value;
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages?.length
    ? navigator.languages : [navigator.language];
  return languages[0]?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
