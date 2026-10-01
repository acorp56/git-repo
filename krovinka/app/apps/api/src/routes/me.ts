import { isDistrict, normalizeNotify } from '@krovinka/core';
import type { FastifyInstance } from 'fastify';
import { HttpError, requireUser } from '../app';
import { endSession } from '../auth/session';
import { many, one, tx } from '../db';
import { progress } from '../services/xp';

export async function meRoutes(app: FastifyInstance) {
  const { pool } = app.deps;

  app.get('/me', async (req) => {
    if (!req.user) return { user: null };
    const u = await one<{
      id: string;
      name: string;
      phone: string | null;
      district: string | null;
      notify: unknown;
      telegram_chat_id: number | null;
      pd_consent_at: Date | null;
    }>(pool, 'SELECT id, name, phone, district, notify, telegram_chat_id, pd_consent_at FROM users WHERE id = $1', [req.user.id]);
    const providers = await many<{ provider: string }>(pool, 'SELECT provider FROM auth_identities WHERE user_id = $1 ORDER BY created_at', [
      req.user.id,
    ]);
    const notify = normalizeNotify(u!.notify);
    return {
      user: {
        id: u!.id,
        name: u!.name,
        phone: u!.phone,
        district: u!.district,
        notify,
        telegramConnected: u!.telegram_chat_id !== null,
        needsConsent: !u!.pd_consent_at,
        providers: providers.map((p) => p.provider),
        // Предупреждение из настроек: если выключены оба канала, SOS не дойдёт.
        noChannels: !notify.telegram && !notify.push,
      },
      progress: await progress(pool, req.user.id),
    };
  });

  app.patch<{ Body: { name?: string; district?: string; notify?: unknown } }>('/me', async (req) => {
    const user = requireUser(req);
    const b = req.body ?? {};
    if (b.district !== undefined && !isDistrict(b.district)) throw new HttpError(400, 'Неизвестный район');
    await pool.query(
      `UPDATE users SET
         name = coalesce($2, name),
         district = coalesce($3, district),
         notify = coalesce($4, notify)
       WHERE id = $1`,
      [
        user.id,
        typeof b.name === 'string' ? b.name.trim().slice(0, 60) : null,
        b.district ?? null,
        b.notify !== undefined ? JSON.stringify(normalizeNotify(b.notify)) : null,
      ],
    );
    return { ok: true };
  });

  app.post('/me/consent', async (req) => {
    const user = requireUser(req);
    await pool.query('UPDATE users SET pd_consent_at = coalesce(pd_consent_at, now()) WHERE id = $1', [user.id]);
    return { ok: true };
  });

  // Отвязать способ входа. Последний отвязать нельзя.
  app.delete<{ Params: { provider: string } }>('/me/providers/:provider', async (req) => {
    const user = requireUser(req);
    await tx(pool, async (c) => {
      const rows = await many<{ provider: string }>(c, 'SELECT provider FROM auth_identities WHERE user_id = $1 FOR UPDATE', [user.id]);
      if (!rows.some((r) => r.provider === req.params.provider)) throw new HttpError(404, 'Этот способ входа не привязан');
      if (rows.length <= 1) throw new HttpError(400, 'Нельзя отвязать последний способ входа');
      await c.query('DELETE FROM auth_identities WHERE user_id = $1 AND provider = $2', [user.id, req.params.provider]);
      if (req.params.provider === 'telegram') await c.query('UPDATE users SET telegram_chat_id = NULL WHERE id = $1', [user.id]);
    });
    return { ok: true };
  });

  // Выгрузка своих данных (152-ФЗ).
  app.get('/me/export', async (req) => {
    const user = requireUser(req);
    const q = (sql: string) => many(pool, sql, [user.id]);
    return {
      user: await q('SELECT id, name, phone, district, notify, pd_consent_at, created_at FROM users WHERE id = $1'),
      providers: await q('SELECT provider, created_at FROM auth_identities WHERE user_id = $1'),
      pets: await q('SELECT * FROM pets WHERE owner_id = $1'),
      medRecords: await q('SELECT m.* FROM med_records m JOIN pets p ON p.id = m.pet_id WHERE p.owner_id = $1'),
      donations: await q('SELECT d.* FROM donations d JOIN pets p ON p.id = d.pet_id WHERE p.owner_id = $1'),
      requests: await q('SELECT * FROM requests WHERE author_id = $1'),
      responses: await q('SELECT * FROM responses WHERE donor_user_id = $1'),
      messages: await q('SELECT request_id, text, created_at FROM messages WHERE author_id = $1'),
      drops: await q('SELECT kind, ref, points, created_at FROM xp_events WHERE user_id = $1'),
    };
  });

  // Удаление аккаунта: персональные данные стираем, запросы и отклики остаются обезличенными.
  app.delete('/me', async (req, reply) => {
    const user = requireUser(req);
    await tx(pool, async (c) => {
      await c.query(`UPDATE requests SET status = 'closed', closed_at = now() WHERE author_id = $1 AND status <> 'closed'`, [user.id]);
      await c.query(`UPDATE responses SET status = 'cancelled' WHERE donor_user_id = $1 AND status IN ('offered', 'chosen')`, [user.id]);
      await c.query('DELETE FROM pets WHERE owner_id = $1', [user.id]);
      await c.query('DELETE FROM auth_identities WHERE user_id = $1', [user.id]);
      await c.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      await c.query(
        `UPDATE users SET name = 'Удалённый пользователь', phone = NULL, telegram_chat_id = NULL, district = NULL,
           notify = '{}', deleted_at = now() WHERE id = $1`,
        [user.id],
      );
    });
    await endSession(pool, req, reply);
    return { ok: true };
  });
}
