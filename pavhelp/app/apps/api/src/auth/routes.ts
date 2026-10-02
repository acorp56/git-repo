import crypto from 'node:crypto';
import { EMAIL_CODE, normalizeEmail, safeReturnTo } from '@pavhelp/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { HttpError } from '../app';
import { config } from '../config';
import { one, tx } from '../db';
import { endSession, normalizePhone, sha256, startSession, upsertIdentity } from './session';

const CODE_TTL_MS = EMAIL_CODE.ttlMin * 60_000;
const RESEND_MS = EMAIL_CODE.resendSec * 1000;
const MAX_ATTEMPTS = EMAIL_CODE.maxAttempts;

const codeHash = (email: string, code: string) => sha256(`${email}:${code}:${config.cookieSecret}`);

export async function authRoutes(app: FastifyInstance) {
  const { pool } = app.deps;

  async function finish(reply: FastifyReply, userId: string, consent: boolean) {
    if (consent) await pool.query('UPDATE users SET pd_consent_at = coalesce(pd_consent_at, now()) WHERE id = $1', [userId]);
    await startSession(pool, reply, userId);
  }

  // ---------- Одноразовый код на email ----------
  // Код из 6 цифр, действует 10 минут, до 5 попыток, повторная отправка через 60 секунд.

  app.post<{ Body: { email?: string } }>(
    '/email/start',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req) => {
      const email = normalizeEmail(req.body?.email);
      if (!email) throw new HttpError(400, 'Проверьте адрес: похоже, в нём ошибка', { email: 'Пример: name@mail.ru' });
      const prev = await one<{ sent_at: Date }>(pool, 'SELECT sent_at FROM email_codes WHERE email = $1', [email]);
      const wait = prev ? RESEND_MS - (Date.now() - prev.sent_at.getTime()) : 0;
      if (wait > 0) throw new HttpError(429, `Новый код можно запросить через ${Math.ceil(wait / 1000)} с`);

      const code = String(crypto.randomInt(0, 10 ** EMAIL_CODE.length)).padStart(EMAIL_CODE.length, '0');
      await pool.query(
        `INSERT INTO email_codes (email, code_hash, attempts, sent_at, expires_at) VALUES ($1, $2, 0, now(), $3)
         ON CONFLICT (email) DO UPDATE SET code_hash = $2, attempts = 0, sent_at = now(), expires_at = $3`,
        [email, codeHash(email, code), new Date(Date.now() + CODE_TTL_MS)],
      );
      await app.deps.mail.send({
        to: email,
        subject: `${code} — код для входа в Павхелп`,
        text: [
          `Ваш код для входа в Павхелп: ${code}`,
          '',
          `Код действует ${EMAIL_CODE.ttlMin} минут. Никому его не сообщайте.`,
          'Если вы не входили в Павхелп, просто проигнорируйте это письмо.',
        ].join('\n'),
      });
      return { ok: true, resendIn: EMAIL_CODE.resendSec };
    },
  );

  app.post<{ Body: { email?: string; code?: string; consent?: boolean; name?: string } }>(
    '/email/verify',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const email = normalizeEmail(req.body?.email);
      const code = String(req.body?.code ?? '').replace(/\s/g, '');
      if (!email) throw new HttpError(400, 'Неверный email');
      const row = await one<{ code_hash: string; attempts: number; expires_at: Date }>(
        pool,
        'UPDATE email_codes SET attempts = attempts + 1 WHERE email = $1 RETURNING code_hash, attempts, expires_at',
        [email],
      );
      if (!row || row.expires_at < new Date()) throw new HttpError(400, 'Код устарел. Запросите новый');
      if (row.attempts > MAX_ATTEMPTS) throw new HttpError(429, 'Слишком много попыток. Запросите новый код');
      const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(codeHash(email, code)));
      if (!ok) {
        const left = MAX_ATTEMPTS - row.attempts;
        throw new HttpError(400, left > 0 ? `Неверный код. Осталось попыток: ${left}` : 'Неверный код. Запросите новый', {
          code: 'Неверный код',
        });
      }
      await pool.query('DELETE FROM email_codes WHERE email = $1', [email]);

      const user = await tx(pool, async (c) => {
        // Кто подтвердил владение адресом, тот и владелец аккаунта с этим адресом.
        const byEmail = await one<{ id: string }>(c, 'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
        if (byEmail && req.user && byEmail.id !== req.user.id) {
          throw new HttpError(409, 'Этот email уже привязан к другому аккаунту');
        }
        if (byEmail && !req.user) {
          await c.query(
            `INSERT INTO auth_identities (user_id, provider, provider_id) VALUES ($1, 'email', $2) ON CONFLICT DO NOTHING`,
            [byEmail.id, email],
          );
          return { id: byEmail.id, created: false };
        }
        const u = await upsertIdentity(
          c,
          { provider: 'email', providerId: email, name: (req.body?.name ?? '').trim(), email },
          req.user?.id ?? null,
        );
        if (req.user && !byEmail) await c.query('UPDATE users SET email = $2 WHERE id = $1', [u.id, email]);
        return u;
      });
      await finish(reply, user.id, req.body?.consent === true);
      return { ok: true, created: user.created };
    },
  );

  // ---------- Яндекс ID ----------
  // Схема: /auth/yandex → oauth.yandex.ru/authorize → /auth/yandex/callback → токен → login.yandex.ru/info → сессия.

  const STATE_COOKIE = 'ya_state';

  app.get<{ Querystring: { returnTo?: string; consent?: string } }>('/yandex', async (req, reply) => {
    if (!config.yandex.clientId) throw new HttpError(503, 'Вход через Яндекс ID не настроен');
    const state = crypto.randomBytes(16).toString('hex'); // защита от CSRF
    reply.setCookie(STATE_COOKIE, JSON.stringify({ state, returnTo: safeReturnTo(req.query.returnTo), consent: req.query.consent === '1' }), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.production,
      signed: true,
      maxAge: 600,
    });
    const url = new URL('https://oauth.yandex.ru/authorize');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.yandex.clientId,
      redirect_uri: config.yandex.redirectUri,
      state,
      scope: 'login:info login:email login:avatar login:default_phone',
    }).toString();
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/yandex/callback', async (req, reply) => {
    const fail = (e: string) => reply.redirect(`${config.appUrl}/login?error=${e}`);
    const raw = req.unsignCookie(req.cookies[STATE_COOKIE] ?? '');
    reply.clearCookie(STATE_COOKIE, { path: '/' });
    if (req.query.error) return fail('yandex_denied'); // пользователь нажал «Отмена»
    let saved: { state: string; returnTo: string; consent: boolean } | null = null;
    try {
      saved = raw.valid && raw.value ? JSON.parse(raw.value) : null;
    } catch {}
    if (!req.query.code || !saved || req.query.state !== saved.state) return fail('bad_state');

    try {
      const tokenRes = await fetch('https://oauth.yandex.ru/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: req.query.code,
          client_id: config.yandex.clientId,
          client_secret: config.yandex.clientSecret,
        }),
      });
      if (!tokenRes.ok) throw new Error('token ' + tokenRes.status);
      const { access_token } = (await tokenRes.json()) as { access_token: string };
      const infoRes = await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: `OAuth ${access_token}` } });
      if (!infoRes.ok) throw new Error('info ' + infoRes.status);
      const y = (await infoRes.json()) as {
        id: string;
        first_name?: string;
        display_name?: string;
        login?: string;
        default_email?: string;
        default_phone?: { number?: string };
      };
      const user = await tx(pool, (c) =>
        upsertIdentity(
          c,
          {
            provider: 'yandex',
            providerId: y.id,
            name: y.first_name || y.display_name || y.login || '',
            email: normalizeEmail(y.default_email),
            phone: normalizePhone(y.default_phone?.number),
          },
          req.user?.id ?? null,
        ),
      );
      await finish(reply, user.id, saved.consent);
      return reply.redirect(config.appUrl + saved.returnTo);
    } catch (e) {
      req.log.error(e, 'Yandex ID login failed');
      return fail((e as { statusCode?: number }).statusCode === 409 ? 'already_linked' : 'yandex_unavailable');
    }
  });

  // ---------- Telegram Login Widget ----------

  app.post<{ Body: Record<string, string | number | boolean> }>('/telegram', async (req, reply) => {
    if (!config.telegramBotToken) throw new HttpError(503, 'Вход через Telegram не настроен');
    const { consent, ...data } = req.body ?? {};
    const tg = verifyTelegramLogin(data, config.telegramBotToken);
    if (!tg) throw new HttpError(401, 'Telegram не подтвердил вход. Попробуйте ещё раз');
    const user = await tx(pool, (c) =>
      upsertIdentity(
        c,
        { provider: 'telegram', providerId: String(tg.id), name: tg.first_name ?? '', telegramChatId: Number(tg.id) },
        req.user?.id ?? null,
      ),
    );
    await finish(reply, user.id, consent === true);
    return { ok: true, created: user.created };
  });

  app.post('/logout', async (req, reply) => {
    await endSession(pool, req, reply);
    return { ok: true };
  });
}

/** Проверка подписи данных Telegram Login Widget: https://core.telegram.org/widgets/login#checking-authorization */
export function verifyTelegramLogin(
  data: Record<string, unknown>,
  botToken: string,
  now = Date.now(),
): { id: number; first_name?: string } | null {
  const { hash, ...fields } = data;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(check).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;
  const authDate = Number(fields.auth_date);
  if (!authDate || now / 1000 - authDate > 86_400) return null;
  return { id: Number(fields.id), first_name: typeof fields.first_name === 'string' ? fields.first_name : undefined };
}
