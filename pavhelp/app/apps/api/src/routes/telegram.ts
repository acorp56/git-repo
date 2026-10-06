// Telegram-бот: привязка chat_id через deep link /start <token> и кнопки в SOS-сообщении.
// Webhook настраивается так: setWebhook url=https://<api>/telegram/webhook secret_token=<TELEGRAM_WEBHOOK_SECRET>.
import crypto from 'node:crypto';
import { groupCompatible } from '@pavhelp/core';
import type { FastifyInstance } from 'fastify';
import { HttpError, requireUser } from '../app';
import { sha256 } from '../auth/session';
import { config } from '../config';
import { many, one, tx } from '../db';
import type { RequestRow } from '../services/matching';
import { telegramApi } from '../services/notify';
import { isPaused, medByPet, PET_COLS, petEligibility, type PetRow } from '../services/pets';
import { notifyUser, requestLink, respondToRequest } from '../services/respond';

const LINK_TTL_MIN = 30;

interface TgUpdate {
  message?: { chat: { id: number; type: string }; text?: string };
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { chat: { id: number } } };
}

export async function telegramRoutes(app: FastifyInstance) {
  const { pool } = app.deps;
  const now = () => app.deps.now();
  const api = (method: string, body: object) =>
    config.telegramBotToken ? telegramApi(config.telegramBotToken, method, body).catch((e) => app.log.warn(e, 'Telegram API')) : Promise.resolve();
  const answer = (id: string, text: string, alert = false) => api('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert });
  const say = (chatId: number, text: string, keyboard?: object[][]) =>
    api('sendMessage', { chat_id: chatId, text, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) });

  // Ссылка «Подключить Telegram»: открывает бота, и тот привязывает чат к аккаунту.
  app.post('/link', async (req) => {
    const user = requireUser(req);
    const token = crypto.randomBytes(16).toString('base64url');
    await pool.query('INSERT INTO telegram_links (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      sha256(token),
      user.id,
      new Date(now().getTime() + LINK_TTL_MIN * 60_000),
    ]);
    return { url: `https://t.me/${config.telegramBotUsername}?start=${token}` };
  });

  app.post<{ Body: TgUpdate }>('/webhook', async (req) => {
    const secret = String(req.headers['x-telegram-bot-api-secret-token'] ?? '');
    if (
      !config.telegramWebhookSecret ||
      secret.length !== config.telegramWebhookSecret.length ||
      !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(config.telegramWebhookSecret))
    ) {
      throw new HttpError(401, 'Неверный секрет webhook');
    }
    const u = req.body ?? {};

    // /start <token> — привязка чата к аккаунту.
    const text = u.message?.text ?? '';
    if (u.message && u.message.chat.type === 'private' && text.startsWith('/start')) {
      const chatId = u.message.chat.id;
      const token = text.split(/\s+/)[1];
      if (!token) {
        await say(chatId, 'Это бот Павхелпа. Чтобы получать SOS, нажмите «Подключить Telegram» в настройках приложения.');
        return { ok: true };
      }
      const linked = await tx(pool, async (c) => {
        const row = await one<{ user_id: string }>(c, 'DELETE FROM telegram_links WHERE token_hash = $1 AND expires_at > $2 RETURNING user_id', [
          sha256(token),
          now(),
        ]);
        if (!row) return false;
        // Один чат — один аккаунт.
        await c.query('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = $1 AND id <> $2', [chatId, row.user_id]);
        await c.query('UPDATE users SET telegram_chat_id = $2 WHERE id = $1', [row.user_id, chatId]);
        return true;
      });
      await say(
        chatId,
        linked
          ? 'Готово! Сюда будут приходить SOS-запросы рядом с вами и сообщения из чатов запросов. Номера телефонов бот не раскрывает.'
          : 'Ссылка устарела. Откройте настройки Павхелпа и нажмите «Подключить Telegram» ещё раз.',
      );
      return { ok: true };
    }

    const cb = u.callback_query;
    if (!cb?.data) return { ok: true };
    const [action, requestId, petIdx] = cb.data.split(':');
    const user = await one<{ id: string }>(pool, 'SELECT id FROM users WHERE telegram_chat_id = $1 AND deleted_at IS NULL', [cb.from.id]);
    if (!user) {
      await answer(cb.id, 'Этот Telegram не привязан к аккаунту Павхелпа. Подключите его в настройках приложения.', true);
      return { ok: true };
    }

    if (action === 'skip') {
      await answer(cb.id, 'Хорошо, по этому запросу больше не беспокоим');
      return { ok: true };
    }
    if (action !== 'help' && action !== 'pet') return { ok: true };

    const r = await one<RequestRow>(pool, 'SELECT * FROM requests WHERE id = $1', [requestId]).catch(() => null);
    if (!r) {
      await answer(cb.id, 'Запрос не найден', true);
      return { ok: true };
    }
    // Питомцы, которые могут помочь прямо сейчас (порядок стабильный: индекс уходит в callback_data, там лимит 64 байта).
    const pets = await many<PetRow>(
      pool,
      `SELECT ${PET_COLS} FROM pets WHERE owner_id = $1 AND species = $2 AND donor_enabled AND deceased_at IS NULL ORDER BY created_at`,
      [user.id, r.species],
    );
    const med = await medByPet(
      pool,
      pets.map((p) => p.id),
    );
    const ready = pets.filter((p) => groupCompatible(r.species, r.blood_group, p.blood_group) && !isPaused(p, now()) && petEligibility(p, med.get(p.id)!, now()).ready);

    let pet: PetRow | undefined;
    if (action === 'pet') pet = ready[Number(petIdx)];
    else if (ready.length === 1) pet = ready[0];
    else if (ready.length > 1) {
      await answer(cb.id, 'Выберите питомца');
      await say(cb.from.id, 'Кто поедет сдавать кровь?', ready.slice(0, 8).map((p, i) => [{ text: p.name, callback_data: `pet:${r.id}:${i}` }]));
      return { ok: true };
    }
    if (!pet) {
      await answer(cb.id, 'Сейчас ни один ваш питомец не может откликнуться на этот запрос. Подробности — в приложении.', true);
      await say(cb.from.id, 'Почему питомец не может помочь, видно на странице запроса.', [[{ text: 'Открыть в Павхелпе', url: requestLink(r.id) }]]);
      return { ok: true };
    }
    try {
      const res = await respondToRequest(pool, user.id, r.id, pet.id, now());
      await answer(cb.id, `Спасибо! Хозяин получил отклик: ${res.petName} может приехать`);
      await notifyUser(pool, app.deps.notifier, app.log, res.authorId, 'Донор откликнулся на ваш запрос. Откройте и выберите донора', r.id);
    } catch (e) {
      await answer(cb.id, e instanceof HttpError ? e.message : 'Не получилось. Попробуйте в приложении', true);
    }
    return { ok: true };
  });
}
