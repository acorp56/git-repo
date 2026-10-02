import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { one, type Db } from '../db';

export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export interface SessionUser {
  id: string;
  name: string;
}

export async function startSession(db: Db, reply: FastifyReply, userId: string): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha256(token), userId, expires]);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production,
    expires,
  });
}

export async function endSession(db: Db, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function loadSessionUser(db: Db, req: FastifyRequest): Promise<SessionUser | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  return one<SessionUser>(
    db,
    `SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.deleted_at IS NULL`,
    [sha256(token)],
  );
}

/**
 * Находит пользователя по способу входа или создаёт нового.
 * Если вход идёт из уже открытой сессии (кнопка «Привязать» в настройках), способ привязывается к ней.
 * Автоматически по email или телефону аккаунты не склеиваем: только после явного согласия пользователя.
 */
export async function upsertIdentity(
  db: Db,
  p: { provider: string; providerId: string; name: string; email?: string | null; phone?: string | null; telegramChatId?: number },
  currentUserId: string | null = null,
): Promise<{ id: string; created: boolean }> {
  const existing = await one<{ user_id: string }>(
    db,
    'SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_id = $2',
    [p.provider, p.providerId],
  );
  if (existing && currentUserId && existing.user_id !== currentUserId) {
    throw Object.assign(new Error('Этот способ входа уже привязан к другому аккаунту'), { statusCode: 409 });
  }
  let userId = existing?.user_id ?? currentUserId;
  const created = !userId;
  if (!userId) {
    // Email и телефон уникальны: если уже заняты другим аккаунтом, новому аккаунту их не записываем.
    const free = async (col: 'email' | 'phone', v: string | null | undefined) =>
      v && !(await one(db, `SELECT 1 FROM users WHERE ${col} = $1`, [v])) ? v : null;
    const u = await one<{ id: string }>(db, 'INSERT INTO users (name, email, phone) VALUES ($1, $2, $3) RETURNING id', [
      p.name.slice(0, 60),
      await free('email', p.email),
      await free('phone', p.phone),
    ]);
    userId = u!.id;
  }
  if (!existing) {
    await db.query('INSERT INTO auth_identities (user_id, provider, provider_id) VALUES ($1, $2, $3)', [userId, p.provider, p.providerId]);
  }
  if (p.telegramChatId) await db.query('UPDATE users SET telegram_chat_id = $2 WHERE id = $1', [userId, p.telegramChatId]);
  return { id: userId, created };
}

/** +7XXXXXXXXXX из «8 (921) 000-00-00», «+7 921…» и т. п. Только российские номера. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && (d.startsWith('8') || d.startsWith('7'))) d = d.slice(1);
  if (d.length !== 10 || !d.startsWith('9')) return null;
  return '+7' + d;
}
