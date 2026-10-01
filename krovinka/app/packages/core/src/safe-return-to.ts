/**
 * Адрес возврата после входа: только относительный путь внутри сайта.
 * Иначе ссылка вида ?returnTo=https://чужой-сайт уведёт пользователя на чужой сайт (открытый редирект).
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  // //evil.ru, /\evil.ru и /<таб>/evil.ru браузер считает ссылкой на другой хост
  if (value.startsWith('//') || /[\\\x00-\x1f]/.test(value)) return '/';
  return value;
}
