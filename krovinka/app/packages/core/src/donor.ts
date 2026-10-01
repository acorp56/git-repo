// Допуск донора и совместимость групп крови. Перенесено из прототипа: eligibility(), groupOk().
import type { BloodGroup, Species } from './domain';

const DAY = 86_400_000;

export const DONATION_GAP_DAYS: Record<Species, number> = { dog: 60, cat: 90 };
export const MIN_WEIGHT_KG: Record<Species, number> = { dog: 25, cat: 4 };
export const AGE_YEARS = { min: 1, max: 8 } as const;
export const VACCINE_VALID_DAYS = 365;

export type VaccineKind = 'vac' | 'rab';

export interface EligibilityInput {
  species: Species;
  birthDate: Date | null;
  weightKg: number | null;
  chronic: boolean;
  /** Только для кошек: гуляет ли на улице. */
  outdoor: boolean;
  lastDonation: Date | null;
  /** Отметки о прививках: комплексная (vac) и бешенство (rab). */
  vaccinations: { kind: VaccineKind; date: Date }[];
}

export interface EligibilityCheck {
  key: 'age' | 'weight' | 'vaccines' | 'health' | 'indoor' | 'gap';
  ok: boolean;
  title: string;
  detail: string;
}

export interface Eligibility {
  checks: EligibilityCheck[];
  /** Подходит в доноры в принципе (всё, кроме интервала после сдачи). */
  fit: boolean;
  /** Может сдать кровь прямо сейчас. */
  ready: boolean;
  /** Сколько дней осталось до готовности (0, если готов). */
  daysLeft: number;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.floor(n)) % 100;
  const m = a % 10;
  if (a > 10 && a < 20) return many;
  if (m > 1 && m < 5) return few;
  if (m === 1) return one;
  return many;
}

export function ageYears(birthDate: Date, now: Date): number {
  let years = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) years--;
  return years;
}

const daysBetween = (from: Date, to: Date) => Math.floor((startOfDay(to) - startOfDay(from)) / DAY);
const startOfDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

export function eligibility(p: EligibilityInput, now: Date = new Date()): Eligibility {
  const gap = DONATION_GAP_DAYS[p.species];
  const minW = MIN_WEIGHT_KG[p.species];
  const age = p.birthDate ? ageYears(p.birthDate, now) : null;
  const since = p.lastDonation ? daysBetween(p.lastDonation, now) : Infinity;

  // В прототипе при пустом списке прививок проверка проходила. Здесь нужны обе: комплексная и от бешенства.
  const vaccineOk = (kind: VaccineKind) =>
    p.vaccinations.some((v) => v.kind === kind && daysBetween(v.date, now) < VACCINE_VALID_DAYS && v.date <= now);
  const vacOk = vaccineOk('vac') && vaccineOk('rab');

  const checks: EligibilityCheck[] = [
    {
      key: 'age',
      ok: age !== null && age >= AGE_YEARS.min && age <= AGE_YEARS.max,
      title: `Возраст от ${AGE_YEARS.min} до ${AGE_YEARS.max} лет`,
      detail: age === null ? 'не указан' : age < 1 ? 'меньше года' : `${age} ${plural(age, 'год', 'года', 'лет')}`,
    },
    {
      key: 'weight',
      ok: p.weightKg !== null && p.weightKg >= minW,
      title: `Вес от ${minW} кг`,
      detail: p.weightKg ? `${String(p.weightKg).replace('.', ',')} кг` : 'не указан',
    },
    {
      key: 'vaccines',
      ok: vacOk,
      title: 'Прививки действуют',
      detail: vacOk ? 'комплекс и бешенство в порядке' : 'нужны комплексная прививка и от бешенства не старше года',
    },
    { key: 'health', ok: !p.chronic, title: 'Нет хронических болезней', detail: 'по словам владельца' },
  ];
  if (p.species === 'cat') {
    checks.push({
      key: 'indoor',
      ok: !p.outdoor,
      title: 'Живёт дома, не гуляет на улице',
      detail: p.outdoor ? 'уличные кошки чаще переносят инфекции' : 'домашняя',
    });
  }
  const left = Math.max(0, gap - since);
  checks.push({
    key: 'gap',
    ok: since >= gap,
    title: `Прошло ${gap} дней с прошлой сдачи`,
    detail: !p.lastDonation
      ? 'ещё не сдавал(а) кровь'
      : since >= gap
        ? 'можно сдавать'
        : `ещё ${left} ${plural(left, 'день', 'дня', 'дней')}`,
  });

  const fit = checks.filter((c) => c.key !== 'gap').every((c) => c.ok);
  return { checks, fit, ready: fit && since >= gap, daysLeft: Number.isFinite(since) ? left : 0 };
}

/**
 * Можно ли перелить кровь донора реципиенту.
 * Кошкам — только та же группа. Собаке DEA 1.1− — только от DEA 1.1−, собаке DEA 1.1+ подходят все.
 * Если группа реципиента неизвестна, подходят все: окончательно проверяет клиника.
 */
export function groupCompatible(species: Species, recipient: BloodGroup, donor: BloodGroup): boolean {
  if (recipient === 'unknown') return true;
  if (species === 'cat') return recipient === donor;
  if (recipient === 'DEA1.1-') return donor === 'DEA1.1-';
  return true;
}

/** Группы доноров, подходящие реципиенту. Нужно для фильтра в SQL. */
export function compatibleDonorGroups(species: Species, recipient: BloodGroup): BloodGroup[] {
  const all: BloodGroup[] = species === 'dog' ? ['DEA1.1-', 'DEA1.1+', 'unknown'] : ['A', 'B', 'AB', 'unknown'];
  return all.filter((g) => groupCompatible(species, recipient, g));
}

export function isRareGroup(species: Species, group: BloodGroup): boolean {
  return (species === 'dog' && group === 'DEA1.1-') || (species === 'cat' && group === 'B');
}
