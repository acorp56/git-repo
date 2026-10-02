// Email для входа по одноразовому коду. Перенесено из прототипа (bindForms, шаг email).

/** Адрес в нижнем регистре или null, если он явно с ошибкой. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return null;
  return v;
}

const TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.ru': 'gmail.com',
  'yandex.ri': 'yandex.ru',
  'yandx.ru': 'yandex.ru',
  'mail.ri': 'mail.ru',
  'maill.ru': 'mail.ru',
};

/** Подсказка при опечатке в домене: «name@gmial.com» → «name@gmail.com». */
export function emailTypo(email: string): string | null {
  const [user, domain] = email.split('@');
  const fix = domain ? TYPOS[domain] : undefined;
  return fix ? `${user}@${fix}` : null;
}

export const EMAIL_CODE = { length: 6, ttlMin: 10, maxAttempts: 5, resendSec: 60 } as const;
