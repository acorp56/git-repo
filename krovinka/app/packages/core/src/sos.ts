// SOS-запрос: валидация формы, текст для районных чатов, настройки уведомлений.
import { BLOOD_GROUP_LABEL, isBloodGroupFor, URGENCY, type BloodGroup, type Species, type Urgency } from './domain';
import { MIN_WEIGHT_KG } from './donor';

export interface SosInput {
  species: Species;
  petName: string;
  weightKg: number;
  bloodGroup: BloodGroup;
  clinicId: string;
  urgency: Urgency;
  reason: string;
}

export type FieldErrors = Partial<Record<keyof SosInput, string>>;

const WEIGHT_RANGE: Record<Species, [number, number]> = { dog: [1, 100], cat: [0.5, 15] };

/** Разбирает число с запятой или точкой: «4,5» → 4.5. */
export function parseKg(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function validateSos(raw: Record<string, unknown>): { ok: true; value: SosInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const species = raw.species === 'cat' ? 'cat' : raw.species === 'dog' ? 'dog' : null;
  if (!species) errors.species = 'Выберите: собака или кошка';

  const petName = typeof raw.petName === 'string' ? raw.petName.trim().slice(0, 40) : '';
  if (!petName) errors.petName = 'Укажите кличку, чтобы донор понимал, к кому едет';

  const w = parseKg(raw.weightKg);
  if (!w) errors.weightKg = 'Укажите примерный вес, от него зависит подбор донора';
  else if (species) {
    const [min, max] = WEIGHT_RANGE[species];
    if (w < min || w > max)
      errors.weightKg = `Проверьте вес: для ${species === 'dog' ? 'собаки' : 'кошки'} обычно от ${String(min).replace('.', ',')} до ${max} кг`;
  }

  const bloodGroup = typeof raw.bloodGroup === 'string' ? raw.bloodGroup : 'unknown';
  if (species && !isBloodGroupFor(species, bloodGroup)) errors.bloodGroup = 'Неизвестная группа крови';

  const clinicId = typeof raw.clinicId === 'string' ? raw.clinicId : '';
  if (!clinicId) errors.clinicId = 'Выберите клинику';

  const urgency = URGENCY.includes(raw.urgency as Urgency) ? (raw.urgency as Urgency) : null;
  if (!urgency) errors.urgency = 'Укажите срочность';

  const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 300) : '';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { species: species!, petName, weightKg: w!, bloodGroup: bloodGroup as BloodGroup, clinicId, urgency: urgency!, reason },
  };
}

/** Текст для районных чатов, без телефонов и ссылок. */
export function postTemplate(r: {
  urgency: Urgency;
  petName: string;
  species: Species;
  weightKg: number | null;
  bloodGroup: BloodGroup;
  clinicName: string;
  clinicAddress: string;
}): string {
  const dog = r.species === 'dog';
  return [
    `${r.urgency === 'now' ? 'Срочно нужен' : 'Нужен'} донор крови${r.petName ? ' для ' + r.petName : ''}.`,
    `${dog ? 'Собака' : 'Кошка'}${r.weightKg ? ', ' + String(r.weightKg).replace('.', ',') + ' кг' : ''}${
      r.bloodGroup !== 'unknown' ? ', группа ' + BLOOD_GROUP_LABEL[r.bloodGroup] : ''
    }.`,
    `Клиника: ${r.clinicName} (${r.clinicAddress}).`,
    `Подойдёт ${dog ? 'собака' : 'кошка'} от ${MIN_WEIGHT_KG[r.species]} кг, 1–8 лет, с действующими прививками.`,
  ].join(' ');
}

export interface NotifySettings {
  sos: boolean;
  /** Будить ночью. По умолчанию выключено. */
  night: boolean;
  /** Тихие часы, «ЧЧ:ММ» по Москве. */
  quietFrom: string;
  quietTo: string;
  /** Радиус первой волны, км: 5, 10 или 20. */
  radiusKm: 5 | 10 | 20;
  telegram: boolean;
  push: boolean;
}

export const DEFAULT_NOTIFY: NotifySettings = {
  sos: true,
  night: false,
  quietFrom: '23:00',
  quietTo: '08:00',
  radiusKm: 10,
  telegram: true,
  push: true,
};

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Попадает ли момент в тихие часы (интервал может переходить через полночь). Время — московское. */
export function inQuietHours(s: Pick<NotifySettings, 'quietFrom' | 'quietTo'>, at: Date): boolean {
  const msk = new Date(at.getTime() + 3 * 3_600_000);
  const now = msk.getUTCHours() * 60 + msk.getUTCMinutes();
  const from = minutes(s.quietFrom);
  const to = minutes(s.quietTo);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** Слать ли донору SOS сейчас. Ночью — только тем, кто разрешил будить. */
export function shouldNotifySos(s: NotifySettings, at: Date): boolean {
  if (!s.sos) return false;
  if (!s.telegram && !s.push) return false;
  return s.night || !inQuietHours(s, at);
}

export function normalizeNotify(raw: unknown): NotifySettings {
  const j = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const hhmm = (v: unknown, d: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    sos: bool(j.sos, DEFAULT_NOTIFY.sos),
    night: bool(j.night, DEFAULT_NOTIFY.night),
    quietFrom: hhmm(j.quietFrom, DEFAULT_NOTIFY.quietFrom),
    quietTo: hhmm(j.quietTo, DEFAULT_NOTIFY.quietTo),
    radiusKm: j.radiusKm === 5 || j.radiusKm === 10 || j.radiusKm === 20 ? j.radiusKm : DEFAULT_NOTIFY.radiusKm,
    telegram: bool(j.telegram, DEFAULT_NOTIFY.telegram),
    push: bool(j.push, DEFAULT_NOTIFY.push),
  };
}
