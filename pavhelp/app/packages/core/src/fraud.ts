// Защита от мошенников. Перенесено из прототипа: RISK, SELL, причины жалоб.

/** Просьбы о деньгах и данных карты в чате: такие сообщения помечаются предупреждением. */
export const RISK =
  /(\d[ -]?){16}|переве(ди|дите|сти)|перевод|предоплат|оплат|сбп|на карт|деньг|\d+\s*(₽|руб)|код из (смс|sms)|продам кровь|купл[юи] кровь|за кровь (заплач|плат)/i;

/** Слова о купле-продаже крови запрещены в описании SOS. Донорство бесплатное. */
export const SELL = /продам|продаю|куплю|покупк|за деньги|оплачу|заплачу|вознагражд/i;

export const isRisky = (t: string) => RISK.test(t);
export const mentionsSale = (t: string) => SELL.test(t);

/** Похоже на номер банковской карты: 16–19 цифр подряд, через пробелы или дефисы, проходит проверку Луна. */
export function containsCardNumber(t: string): boolean {
  for (const m of t.matchAll(/(?:\d[ -]?){15,18}\d/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 16 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}

function luhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export type ReportReason = 'money' | 'photo' | 'fake' | 'sell' | 'rude' | 'other';
export const REPORT_REASONS: [ReportReason, string][] = [
  ['money', 'Просят деньги или данные карты'],
  ['photo', 'Неподходящее фото'],
  ['fake', 'Похоже на фейковый запрос'],
  ['sell', 'Продажа или покупка крови'],
  ['rude', 'Грубость или угрозы'],
  ['other', 'Другое'],
];
export const isReportReason = (v: unknown): v is ReportReason => REPORT_REASONS.some(([k]) => k === v);

/** Сколько разных людей должны пожаловаться, чтобы аккаунт заморозился до проверки модератором. */
export const FREEZE_AFTER_REPORTS = 3;

/** Аккаунт считается новым первые 7 дней: плашка «новый аккаунт» и рассылка только 5 ближайшим до подтверждения клиникой. */
export const NEW_ACCOUNT_DAYS = 7;
export const NEW_ACCOUNT_NOTIFY_LIMIT = 5;
