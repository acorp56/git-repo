import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyRequest } from 'fastify';
import type pg from 'pg';
import { loadSessionUser, type SessionUser } from './auth/session';
import { authRoutes } from './auth/routes';
import { config } from './config';
import { meRoutes } from './routes/me';
import { petRoutes } from './routes/pets';
import { referenceRoutes } from './routes/reference';
import { requestRoutes } from './routes/requests';
import { clinicRoutes } from './routes/clinic';
import { telegramRoutes } from './routes/telegram';
import type { Mailer, Notifier } from './services/notify';

type WithLog<T> = T | ((log: FastifyBaseLogger) => T);

export interface Deps {
  pool: pg.Pool;
  notifier: WithLog<Notifier>;
  mail: WithLog<Mailer>;
  /** Подмена текущего времени в тестах. */
  now?: () => Date;
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: { pool: pg.Pool; notifier: Notifier; mail: Mailer; now: () => Date };
  }
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public fields?: Record<string, string>,
    /** Машиночитаемые подробности для интерфейса: код ошибки, id существующего запроса и т. п. */
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Нужно войти');
  return req.user;
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? true, trustProxy: true });
  const resolve = <T extends object>(v: WithLog<T>): T => (typeof v === 'function' ? (v as (l: FastifyBaseLogger) => T)(app.log) : v);
  app.decorate('deps', {
    pool: deps.pool,
    notifier: resolve(deps.notifier),
    mail: resolve(deps.mail),
    now: deps.now ?? (() => new Date()),
  });
  app.decorateRequest('user', null);

  await app.register(cookie, { secret: config.cookieSecret });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.addHook('onRequest', async (req) => {
    req.user = await loadSessionUser(deps.pool, req);
  });

  // Изменяющие запросы принимаем только с Content-Type: application/json, даже без тела. Обычная форма с чужого
  // сайта так не отправится, а fetch с таким заголовком требует CORS (защита от CSRF вместе с SameSite=Lax).
  app.addHook('onRequest', async (req) => {
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      !String(req.headers['content-type'] ?? '').startsWith('application/json')
    ) {
      throw new HttpError(415, 'Ожидается application/json');
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; fields?: Record<string, string>; data?: Record<string, unknown> }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.status(status).send({
      error: status >= 500 ? 'Что-то пошло не так. Попробуйте ещё раз' : err.message,
      ...(err.fields ? { fields: err.fields } : {}),
      ...(err.data && status < 500 ? { data: err.data } : {}),
    });
  });

  app.get('/health', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meRoutes);
  await app.register(referenceRoutes);
  await app.register(petRoutes, { prefix: '/pets' });
  await app.register(requestRoutes);
  await app.register(clinicRoutes, { prefix: '/clinic' });
  await app.register(telegramRoutes, { prefix: '/telegram' });
  return app;
}
