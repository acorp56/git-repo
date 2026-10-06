// Общие действия с запросом, которые вызываются и из API, и из Telegram-бота.
import { groupCompatible } from '@pavhelp/core';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { HttpError } from '../app';
import { config } from '../config';
import { one, tx, type Db } from '../db';
import type { RequestRow } from './matching';
import type { Notifier } from './notify';
import { isPaused, medByPet, PET_COLS, petEligibility, type PetRow } from './pets';
import { award } from './xp';

export const requestLink = (id: string) => `${config.appUrl}/requests/${id}`;

export async function sysMsg(db: Db, requestId: string, text: string) {
  await db.query('INSERT INTO messages (request_id, author_id, text) VALUES ($1, NULL, $2)', [requestId, text]);
}

export async function notifyUser(pool: pg.Pool, notifier: Notifier, log: FastifyBaseLogger, userId: string, text: string, requestId: string) {
  const u = await one<{ telegram_chat_id: number | null }>(pool, 'SELECT telegram_chat_id FROM users WHERE id = $1', [userId]);
  try {
    await notifier.event(userId, u?.telegram_chat_id ?? null, text, requestLink(requestId));
  } catch (e) {
    log.warn({ err: e, userId }, 'уведомление не доставлено');
  }
}

export async function lockRequest(db: Db, id: string): Promise<RequestRow> {
  const r = await one<RequestRow>(db, 'SELECT * FROM requests WHERE id = $1 FOR UPDATE', [id]).catch(() => null);
  if (!r) throw new HttpError(404, 'Запрос не найден');
  return r;
}

/**
 * Отклик донора. Все проверки — на сервере: вид, группа, допуск, пауза.
 * Возвращает автора запроса, чтобы уведомить его после COMMIT.
 */
export async function respondToRequest(pool: pg.Pool, userId: string, requestId: string, petId: unknown, now: Date) {
  return tx(pool, async (c) => {
    const r = await lockRequest(c, requestId);
    if (r.status !== 'open' || r.hidden) throw new HttpError(409, r.status === 'donor_chosen' ? 'Донор уже выбран, спасибо!' : 'Запрос уже закрыт');
    if (r.author_id === userId) throw new HttpError(400, 'Нельзя откликнуться на свой запрос');
    const frozen = await one(c, 'SELECT 1 FROM users WHERE id = $1 AND frozen_at IS NOT NULL', [userId]);
    if (frozen) throw new HttpError(403, 'Аккаунт временно заморожен до проверки модератором');
    const p = await one<PetRow>(c, `SELECT ${PET_COLS} FROM pets WHERE id = $1 AND owner_id = $2 AND deceased_at IS NULL`, [petId, userId]).catch(
      () => null,
    );
    if (!p) throw new HttpError(404, 'Питомец не найден');
    if (p.species !== r.species) throw new HttpError(400, `Нужна ${r.species === 'dog' ? 'собака' : 'кошка'}`);
    if (!groupCompatible(r.species, r.blood_group, p.blood_group)) throw new HttpError(400, 'Группа крови не подходит');
    if (isPaused(p, now)) {
      throw new HttpError(409, `${p.name} на паузе. Снимите паузу, чтобы откликнуться`, undefined, { code: 'paused', petId: p.id });
    }
    const e = petEligibility(p, (await medByPet(c, [p.id])).get(p.id)!, now);
    if (!e.ready) throw new HttpError(400, `${p.name} пока не может сдать кровь: ${e.checks.find((x) => !x.ok)?.title.toLowerCase()}`);
    const ins = await c.query(
      `INSERT INTO responses (request_id, pet_id, donor_user_id, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (request_id, pet_id) DO UPDATE SET status = 'offered', created_at = $4
         WHERE responses.status = 'cancelled'
       RETURNING id`,
      [r.id, p.id, userId, now],
    );
    if (!ins.rowCount) throw new HttpError(409, 'Вы уже откликнулись');
    await award(c, userId, 'respond', r.id);
    await sysMsg(c, r.id, `${p.name} может приехать`);
    return { authorId: r.author_id, petName: p.name };
  });
}
