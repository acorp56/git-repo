// Подбор доноров и рассылка SOS волнами.
// SQL отбирает кандидатов по виду, группе, весу, радиусу (PostGIS) и интервалу после сдачи,
// окончательный допуск проверяет eligibility() из @krovinka/core — те же правила, что видит пользователь.
import {
  AGE_YEARS,
  BLOOD_GROUP_LABEL,
  compatibleDonorGroups,
  DONATION_GAP_DAYS,
  MIN_WEIGHT_KG,
  normalizeNotify,
  shouldNotifySos,
  SPECIES_LABEL,
  URGENCY_LABEL,
  WAVE_RADII_KM,
  type BloodGroup,
  type Species,
  type Urgency,
} from '@krovinka/core';
import { config } from '../config';
import type pg from 'pg';
import { isoDate, many, one, tx, type Db } from '../db';
import type { Notifier, SosMessage } from './notify';
import { medByPet, PET_COLS, petEligibility, type PetRow } from './pets';

export interface RequestRow {
  id: string;
  slug: string;
  author_id: string;
  pet_name: string;
  species: Species;
  weight_kg: number;
  blood_group: BloodGroup;
  clinic_id: string;
  urgency: Urgency;
  reason: string;
  post_text: string;
  status: 'open' | 'donor_chosen' | 'closed';
  wave: number;
  radius_km: number;
  last_wave_at: Date | null;
  trip_status: number | null;
  created_at: Date;
  closed_at: Date | null;
}

export interface Candidate extends PetRow {
  km: number;
  notify: unknown;
  telegram_chat_id: number | null;
}

export async function findDonors(db: Db, r: RequestRow, radiusKm: number, now: Date): Promise<Candidate[]> {
  const gap = DONATION_GAP_DAYS[r.species];
  const cols = PET_COLS.split(', ')
    .map((c) => 'p.' + c)
    .join(', ');
  const rows = await many<Candidate>(
    db,
    `SELECT ${cols}, u.notify, u.telegram_chat_id,
            ST_Distance(p.location, c.location) / 1000 AS km
     FROM pets p
     JOIN users u ON u.id = p.owner_id AND u.deleted_at IS NULL
     JOIN clinics c ON c.id = $1
     WHERE p.donor_enabled
       AND p.species = $2
       AND p.owner_id <> $3
       AND p.blood_group = ANY($4)
       AND p.weight_kg >= $5
       AND NOT p.chronic
       AND (p.species = 'dog' OR NOT p.outdoor)
       AND (p.last_donation IS NULL OR p.last_donation <= $6::date - $7::int)
       AND p.birth_date BETWEEN $6::date - make_interval(years => $9) AND $6::date - make_interval(years => $8)
       AND ST_DWithin(p.location, c.location, $10 * 1000)
       AND NOT EXISTS (SELECT 1 FROM sos_notifications n WHERE n.request_id = $11 AND n.pet_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM responses x WHERE x.request_id = $11 AND x.pet_id = p.id)
     ORDER BY km`,
    [
      r.clinic_id,
      r.species,
      r.author_id,
      compatibleDonorGroups(r.species, r.blood_group),
      MIN_WEIGHT_KG[r.species],
      isoDate(now),
      gap,
      AGE_YEARS.min,
      AGE_YEARS.max + 1,
      radiusKm,
      r.id,
    ],
  );
  const med = await medByPet(
    db,
    rows.map((p) => p.id),
  );
  return rows.filter((p) => petEligibility(p, med.get(p.id)!, now).ready);
}

export function sosText(r: RequestRow, clinicName: string, km: number): string {
  return [
    `${r.urgency === 'now' ? '🆘 Срочно нужна кровь' : 'Нужна кровь'}: ${SPECIES_LABEL[r.species]} ${r.pet_name}, ${String(r.weight_kg).replace('.', ',')} кг`,
    r.blood_group !== 'unknown' ? `Группа ${BLOOD_GROUP_LABEL[r.blood_group]}` : 'Группа неизвестна, проверит клиника',
    `${clinicName}, ${km.toFixed(1).replace('.', ',')} км от вашего района`,
    `Срочность: ${URGENCY_LABEL[r.urgency]}`,
  ].join('\n');
}

/**
 * Следующая волна рассылки: радиус 10 → 20 → 40 км.
 * В первой волне донор получает SOS, только если клиника в пределах его радиуса из настроек.
 * Работает внутри транзакции и возвращает сообщения: отправлять их нужно после COMMIT.
 * null — волн больше нет или запрос уже не открыт.
 */
export async function planWave(db: pg.PoolClient, requestId: string, now: Date): Promise<SosMessage[] | null> {
  const r = await one<RequestRow>(db, `SELECT * FROM requests WHERE id = $1 AND status = 'open' FOR UPDATE`, [requestId]);
  if (!r) return null;
  const radius = WAVE_RADII_KM[r.wave];
  if (radius === undefined) return null;
  const wave = r.wave + 1;
  const clinic = (await one<{ name: string }>(db, 'SELECT name FROM clinics WHERE id = $1', [r.clinic_id]))!;

  const out: SosMessage[] = [];
  const notifiedUsers = new Set<string>();
  for (const p of await findDonors(db, r, radius, now)) {
    const settings = normalizeNotify(p.notify);
    if (wave === 1 && p.km > settings.radiusKm) continue;
    if (!shouldNotifySos(settings, now)) continue;
    await db.query('INSERT INTO sos_notifications (request_id, pet_id, user_id, wave, km) VALUES ($1, $2, $3, $4, $5)', [
      r.id,
      p.id,
      p.owner_id,
      wave,
      p.km,
    ]);
    // Одному хозяину с несколькими подходящими питомцами — одно сообщение.
    if (notifiedUsers.has(p.owner_id)) continue;
    notifiedUsers.add(p.owner_id);
    out.push({
      userId: p.owner_id,
      telegramChatId: settings.telegram ? p.telegram_chat_id : null,
      requestId: r.id,
      text: sosText(r, clinic.name, p.km),
      url: `${config.appUrl}/requests/${r.id}`,
    });
  }
  await db.query('UPDATE requests SET wave = $2, radius_km = $3, last_wave_at = $4 WHERE id = $1', [r.id, wave, radius, now]);
  return out;
}

export async function sendAll(notifier: Notifier, msgs: SosMessage[] | null, log?: { warn: (o: object, m: string) => void }) {
  for (const m of msgs ?? []) {
    try {
      await notifier.sos(m);
    } catch (e) {
      log?.warn({ err: e, userId: m.userId }, 'SOS не доставлен');
    }
  }
}

/** Следующая волна в отдельной транзакции, рассылка после COMMIT. Возвращает число адресатов. */
export async function dispatchWave(pool: pg.Pool, notifier: Notifier, requestId: string, now: Date): Promise<number | null> {
  const msgs = await tx(pool, (c) => planWave(c, requestId, now));
  await sendAll(notifier, msgs);
  return msgs ? msgs.length : null;
}

/** Через сколько расширять радиус, если донора так и не выбрали. */
export const WAVE_AFTER_MIN: Record<Urgency, number> = { now: 10, today: 30, plan: 120 };

/** Фоновая задача: следующая волна для открытых запросов без выбранного донора. */
export async function expandStaleWaves(pool: pg.Pool, notifier: Notifier, now: Date): Promise<number> {
  const stale = await many<{ id: string }>(
    pool,
    `SELECT id FROM requests
     WHERE status = 'open' AND wave < $1
       AND last_wave_at < $2::timestamptz - make_interval(mins => CASE urgency WHEN 'now' THEN $3::int WHEN 'today' THEN $4::int ELSE $5::int END)`,
    [WAVE_RADII_KM.length, now, WAVE_AFTER_MIN.now, WAVE_AFTER_MIN.today, WAVE_AFTER_MIN.plan],
  );
  for (const s of stale) await dispatchWave(pool, notifier, s.id, now);
  return stale.length;
}
