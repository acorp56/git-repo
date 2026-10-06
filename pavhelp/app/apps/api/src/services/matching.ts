// Подбор доноров и рассылка SOS волнами.
// SQL отбирает кандидатов по виду, группе, весу, радиусу (PostGIS) и интервалу после сдачи,
// окончательный допуск проверяет eligibility() из @pavhelp/core — те же правила, что видит пользователь.
import {
  AGE_YEARS,
  BLOOD_GROUP_LABEL,
  compatibleDonorGroups,
  DONATION_GAP_DAYS,
  MIN_WEIGHT_KG,
  normalizeNotify,
  shouldNotifySos,
  SPECIES_LABEL,
  COMPONENT_LABEL,
  NEW_ACCOUNT_DAYS,
  NEW_ACCOUNT_NOTIFY_LIMIT,
  PRIORITY_WAVE_RADII_KM,
  URGENCY_LABEL,
  WAVE_RADII_KM,
  wavesFor,
  type BloodGroup,
  type Component,
  type Species,
  type Urgency,
} from '@pavhelp/core';
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
  component: Component;
  volume_ml: number | null;
  patient_pet_id: string | null;
  priority: boolean;
  clinic_status: 'pending' | 'confirmed' | 'rejected';
  hidden: boolean;
  chat_blocked: boolean;
  author_phone_shown: boolean;
  renewed_at: Date | null;
  stale_asked_at: Date | null;
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
     JOIN users u ON u.id = p.owner_id AND u.deleted_at IS NULL AND u.frozen_at IS NULL
     JOIN clinics c ON c.id = $1
     WHERE p.donor_enabled
       AND p.species = $2
       AND p.owner_id <> $3
       AND p.blood_group = ANY($4)
       AND p.weight_kg >= $5
       AND NOT p.chronic
       AND NOT p.under_treatment
       AND NOT p.transfused
       AND p.deceased_at IS NULL
       AND (p.paused_until IS NULL OR p.paused_until <= $12)
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
      now,
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
    ...(r.priority ? ['❤️ Донор Павхелпа: этот питомец сам сдавал кровь'] : []),
    r.blood_group !== 'unknown' ? `Группа ${BLOOD_GROUP_LABEL[r.blood_group]}` : 'Группа неизвестна, проверит клиника',
    ...(r.component !== 'whole' ? [`Нужна ${COMPONENT_LABEL[r.component].toLowerCase()} — вы сдаёте цельную кровь, клиника разделит`] : []),
    r.clinic_status === 'confirmed' ? '✓ Клиника подтвердила запрос' : 'Клиника проверяет запрос',
    `${clinicName}, ${km.toFixed(1).replace('.', ',')} км от вашего района`,
    `Срочность: ${URGENCY_LABEL[r.urgency]}`,
  ].join('\n');
}

/**
 * Следующая волна рассылки: радиус 10 → 20 → 50 км, для «Донора Павхелпа» 20 → 50 км.
 * В первой волне донор получает SOS, только если клиника в пределах его радиуса из настроек.
 * Запрос нового аккаунта до подтверждения клиникой уходит только 5 ближайшим донорам.
 * Работает внутри транзакции и возвращает сообщения: отправлять их нужно после COMMIT.
 * null — волн больше нет или запрос уже не открыт.
 */
export async function planWave(db: pg.PoolClient, requestId: string, now: Date): Promise<SosMessage[] | null> {
  const r = await one<RequestRow>(db, `SELECT * FROM requests WHERE id = $1 AND status = 'open' AND NOT hidden FOR UPDATE`, [requestId]);
  if (!r) return null;
  const radius = wavesFor(r.priority)[r.wave];
  if (radius === undefined) return null;
  const wave = r.wave + 1;
  const clinic = (await one<{ name: string }>(db, 'SELECT name FROM clinics WHERE id = $1', [r.clinic_id]))!;

  let budget = Infinity;
  if (r.clinic_status !== 'confirmed') {
    const author = (await one<{ created_at: Date }>(db, 'SELECT created_at FROM users WHERE id = $1', [r.author_id]))!;
    if (now.getTime() - author.created_at.getTime() < NEW_ACCOUNT_DAYS * 86_400_000) {
      const sent = (await one<{ n: number }>(db, 'SELECT count(DISTINCT user_id)::int AS n FROM sos_notifications WHERE request_id = $1', [r.id]))!.n;
      budget = Math.max(0, NEW_ACCOUNT_NOTIFY_LIMIT - sent);
    }
  }

  const out: SosMessage[] = [];
  const notifiedUsers = new Set<string>();
  for (const p of await findDonors(db, r, radius, now)) {
    const settings = normalizeNotify(p.notify);
    if (wave === 1 && !r.priority && p.km > settings.radiusKm) continue;
    if (!shouldNotifySos(settings, now)) continue;
    const newUser = !notifiedUsers.has(p.owner_id);
    if (newUser && notifiedUsers.size >= budget) break;
    await db.query('INSERT INTO sos_notifications (request_id, pet_id, user_id, wave, km) VALUES ($1, $2, $3, $4, $5)', [
      r.id,
      p.id,
      p.owner_id,
      wave,
      p.km,
    ]);
    // Одному хозяину с несколькими подходящими питомцами — одно сообщение.
    if (!newUser) continue;
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

/** «Да, ещё ищем»: повторно уведомляем тех, кто уже получил SOS, но не откликнулся. */
export async function planRenotify(db: pg.PoolClient, r: RequestRow, now: Date): Promise<SosMessage[]> {
  const clinic = (await one<{ name: string }>(db, 'SELECT name FROM clinics WHERE id = $1', [r.clinic_id]))!;
  const rows = await many<{ user_id: string; km: number; notify: unknown; telegram_chat_id: number | null }>(
    db,
    `SELECT DISTINCT ON (n.user_id) n.user_id, n.km, u.notify, u.telegram_chat_id
     FROM sos_notifications n JOIN users u ON u.id = n.user_id AND u.deleted_at IS NULL AND u.frozen_at IS NULL
     WHERE n.request_id = $1
       AND NOT EXISTS (SELECT 1 FROM responses x WHERE x.request_id = $1 AND x.donor_user_id = n.user_id)
     ORDER BY n.user_id, n.km`,
    [r.id],
  );
  return rows
    .filter((u) => shouldNotifySos(normalizeNotify(u.notify), now))
    .map((u) => ({
      userId: u.user_id,
      telegramChatId: normalizeNotify(u.notify).telegram ? u.telegram_chat_id : null,
      requestId: r.id,
      text: 'Всё ещё ищем донора\n' + sosText(r, clinic.name, u.km),
      url: `${config.appUrl}/requests/${r.id}`,
    }));
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
     WHERE status = 'open' AND NOT hidden
       AND wave < CASE WHEN priority THEN $6::int ELSE $1::int END
       AND last_wave_at < $2::timestamptz - make_interval(mins => CASE urgency WHEN 'now' THEN $3::int WHEN 'today' THEN $4::int ELSE $5::int END)`,
    [WAVE_RADII_KM.length, now, WAVE_AFTER_MIN.now, WAVE_AFTER_MIN.today, WAVE_AFTER_MIN.plan, PRIORITY_WAVE_RADII_KM.length],
  );
  for (const s of stale) await dispatchWave(pool, notifier, s.id, now);
  return stale.length;
}

/** Через сутки без выбора донора спрашиваем «Ещё ищете?», через 12 часов без ответа закрываем запрос. */
export const STALE_ASK_HOURS = 24;
export const STALE_CLOSE_HOURS = 12;

export async function autoCloseStale(pool: pg.Pool, notifier: Notifier, now: Date): Promise<{ asked: number; closed: number }> {
  const ask = await many<{ id: string; author_id: string; pet_name: string }>(
    pool,
    `UPDATE requests SET stale_asked_at = $1
     WHERE status = 'open' AND stale_asked_at IS NULL
       AND coalesce(renewed_at, created_at) < $1::timestamptz - make_interval(hours => $2)
     RETURNING id, author_id, pet_name`,
    [now, STALE_ASK_HOURS],
  );
  for (const r of ask) {
    const u = await one<{ telegram_chat_id: number | null }>(pool, 'SELECT telegram_chat_id FROM users WHERE id = $1', [r.author_id]);
    await notifier
      .event(
        r.author_id,
        u?.telegram_chat_id ?? null,
        `Запрос для ${r.pet_name} открыт больше суток. Ещё ищете донора? Если не ответить за ${STALE_CLOSE_HOURS} часов, закроем его сами.`,
        `${config.appUrl}/requests/${r.id}`,
      )
      .catch(() => {});
  }
  const closed = await many<{ id: string }>(
    pool,
    `UPDATE requests SET status = 'closed', closed_at = $1
     WHERE status = 'open' AND stale_asked_at < $1::timestamptz - make_interval(hours => $2)
     RETURNING id`,
    [now, STALE_CLOSE_HOURS],
  );
  for (const c of closed) {
    await pool.query(`UPDATE responses SET status = 'declined' WHERE request_id = $1 AND status = 'offered'`, [c.id]);
    await pool.query(`INSERT INTO messages (request_id, author_id, text) VALUES ($1, NULL, 'Запрос закрыт автоматически: хозяин не ответил, ищет ли он ещё донора')`, [c.id]);
  }
  return { asked: ask.length, closed: closed.length };
}
