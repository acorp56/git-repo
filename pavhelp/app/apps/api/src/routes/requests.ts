import crypto from 'node:crypto';
import { groupCompatible, postTemplate, TRIP, TRIP_STEPS, validateSos } from '@pavhelp/core';
import type { FastifyInstance } from 'fastify';
import { HttpError, requireUser } from '../app';
import { config } from '../config';
import { many, one, tx, type Db } from '../db';
import { planWave, sendAll, type RequestRow } from '../services/matching';
import { medByPet, PET_COLS, petEligibility, type PetRow } from '../services/pets';
import { award } from '../services/xp';
import { CLINIC_COLS, clinicView, type ClinicRow } from './reference';

/** Не больше стольких SOS от одного пользователя в час: защита от спама и фейков. */
const SOS_PER_HOUR = 3;

interface ResponseRow {
  id: string;
  request_id: string;
  pet_id: string;
  donor_user_id: string;
  status: 'offered' | 'chosen' | 'declined' | 'cancelled';
  created_at: Date;
}

const publicView = (r: RequestRow, clinic: ClinicRow, responders: number) => ({
  id: r.id,
  slug: r.slug,
  petName: r.pet_name,
  species: r.species,
  weightKg: r.weight_kg,
  bloodGroup: r.blood_group,
  urgency: r.urgency,
  reason: r.reason,
  status: r.status,
  createdAt: r.created_at,
  clinic: clinicView(clinic),
  responders,
});

async function sysMsg(db: Db, requestId: string, text: string) {
  await db.query('INSERT INTO messages (request_id, author_id, text) VALUES ($1, NULL, $2)', [requestId, text]);
}

export async function requestRoutes(app: FastifyInstance) {
  const { pool, notifier } = app.deps;
  const now = () => app.deps.now();
  const link = (id: string) => `${config.appUrl}/requests/${id}`;

  async function notifyUser(userId: string, text: string, requestId: string) {
    const u = await one<{ telegram_chat_id: number | null }>(pool, 'SELECT telegram_chat_id FROM users WHERE id = $1', [userId]);
    try {
      await notifier.event(userId, u?.telegram_chat_id ?? null, text, link(requestId));
    } catch (e) {
      app.log.warn({ err: e, userId }, 'уведомление не доставлено');
    }
  }

  async function getRequest(db: Db, id: string, lock = false): Promise<RequestRow> {
    const r = await one<RequestRow>(db, `SELECT * FROM requests WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]).catch(() => null);
    if (!r) throw new HttpError(404, 'Запрос не найден');
    return r;
  }

  const clinicOf = async (id: string) => (await one<ClinicRow>(pool, `SELECT ${CLINIC_COLS} FROM clinics WHERE id = $1`, [id]))!;
  const respondersCount = async (id: string) =>
    (await one<{ n: number }>(pool, `SELECT count(*)::int AS n FROM responses WHERE request_id = $1 AND status IN ('offered', 'chosen')`, [id]))!.n;

  // ---------- Лента и детали ----------

  app.get<{ Querystring: { scope?: string } }>('/requests', async (req) => {
    const scope = req.query.scope ?? 'open';
    let rows: RequestRow[];
    if (scope === 'mine') {
      const u = requireUser(req);
      rows = await many<RequestRow>(pool, `SELECT * FROM requests WHERE author_id = $1 ORDER BY status = 'closed', created_at DESC LIMIT 50`, [u.id]);
    } else if (scope === 'helping') {
      const u = requireUser(req);
      rows = await many<RequestRow>(
        pool,
        `SELECT r.* FROM requests r WHERE EXISTS
           (SELECT 1 FROM responses x WHERE x.request_id = r.id AND x.donor_user_id = $1 AND x.status IN ('offered', 'chosen'))
         ORDER BY r.created_at DESC LIMIT 50`,
        [u.id],
      );
    } else {
      rows = await many<RequestRow>(pool, `SELECT * FROM requests WHERE status = 'open' ORDER BY urgency = 'now' DESC, created_at DESC LIMIT 50`);
    }
    return Promise.all(rows.map(async (r) => publicView(r, await clinicOf(r.clinic_id), await respondersCount(r.id))));
  });

  // Публичная страница запроса pavhelp.ru/r/<slug>: доступна без входа, без личных данных.
  app.get<{ Params: { slug: string } }>('/public/requests/:slug', async (req) => {
    const r = await one<RequestRow>(pool, 'SELECT * FROM requests WHERE slug = $1', [req.params.slug]);
    if (!r) throw new HttpError(404, 'Запрос не найден');
    return { ...publicView(r, await clinicOf(r.clinic_id), await respondersCount(r.id)), postText: r.post_text };
  });

  app.get<{ Params: { id: string } }>('/requests/:id', async (req) => {
    const r = await getRequest(pool, req.params.id);
    const clinic = await clinicOf(r.clinic_id);
    const base = { ...publicView(r, clinic, await respondersCount(r.id)), postText: r.post_text, publicUrl: `${config.appUrl}/r/${r.slug}` };
    const me = req.user;
    if (!me) return { ...base, role: 'guest' as const };

    const messages = () =>
      many<{ id: string; author_id: string | null; text: string; created_at: Date }>(
        pool,
        'SELECT id, author_id, text, created_at FROM messages WHERE request_id = $1 ORDER BY created_at',
        [r.id],
      ).then((ms) => ms.map((m) => ({ id: m.id, system: m.author_id === null, mine: m.author_id === me.id, text: m.text, at: m.created_at })));
    const trip = r.trip_status === null ? null : { step: r.trip_status, steps: TRIP_STEPS };

    if (r.author_id === me.id) {
      const responses = await many<
        ResponseRow & { pet_name: string; breed: string; weight_kg: number; blood_group: string; district: string; owner_name: string; phone: string | null; km: number | null }
      >(
        pool,
        `SELECT x.*, p.name AS pet_name, p.breed, p.weight_kg, p.blood_group, p.district, u.name AS owner_name, u.phone,
                (SELECT km FROM sos_notifications n WHERE n.request_id = x.request_id AND n.pet_id = x.pet_id) AS km
         FROM responses x JOIN pets p ON p.id = x.pet_id JOIN users u ON u.id = x.donor_user_id
         WHERE x.request_id = $1 AND x.status IN ('offered', 'chosen') ORDER BY x.created_at`,
        [r.id],
      );
      return {
        ...base,
        role: 'author' as const,
        notified: (await one<{ n: number }>(pool, 'SELECT count(DISTINCT user_id)::int AS n FROM sos_notifications WHERE request_id = $1', [r.id]))!.n,
        wave: r.wave,
        radiusKm: r.radius_km,
        trip,
        responses: responses.map((x) => ({
          id: x.id,
          status: x.status,
          petName: x.pet_name,
          breed: x.breed,
          weightKg: x.weight_kg,
          bloodGroup: x.blood_group,
          district: x.district,
          km: x.km,
          ownerName: x.owner_name,
          // Телефон донора — только хозяину и только после выбора.
          phone: x.status === 'chosen' ? x.phone : null,
          at: x.created_at,
        })),
        messages: await messages(),
      };
    }

    const mine = await one<ResponseRow & { pet_name: string }>(
      pool,
      `SELECT x.*, p.name AS pet_name FROM responses x JOIN pets p ON p.id = x.pet_id
       WHERE x.request_id = $1 AND x.donor_user_id = $2 ORDER BY x.status = 'chosen' DESC, x.created_at DESC LIMIT 1`,
      [r.id, me.id],
    );
    if (mine && mine.status === 'chosen') {
      const author = await one<{ name: string; phone: string | null }>(pool, 'SELECT name, phone FROM users WHERE id = $1', [r.author_id]);
      return {
        ...base,
        role: 'donor' as const,
        myResponse: { id: mine.id, status: mine.status, petName: mine.pet_name },
        author: { name: author!.name, phone: author!.phone },
        trip,
        messages: await messages(),
      };
    }

    // Кто может откликнуться: мои питомцы того же вида с проверкой допуска и совместимости.
    const pets = await many<PetRow>(pool, `SELECT ${PET_COLS} FROM pets WHERE owner_id = $1 AND species = $2`, [me.id, r.species]);
    const med = await medByPet(
      pool,
      pets.map((p) => p.id),
    );
    return {
      ...base,
      role: mine && mine.status === 'offered' ? ('donor' as const) : ('viewer' as const),
      myResponse: mine && mine.status === 'offered' ? { id: mine.id, status: mine.status, petName: mine.pet_name } : null,
      myPets: pets.map((p) => {
        const e = petEligibility(p, med.get(p.id)!, now());
        return {
          id: p.id,
          name: p.name,
          ready: e.ready && p.donor_enabled,
          compatible: groupCompatible(r.species, r.blood_group, p.blood_group),
          daysLeft: e.daysLeft,
          firstProblem: e.checks.find((c) => !c.ok)?.title ?? null,
        };
      }),
    };
  });

  // ---------- Хозяин: создание и управление ----------

  app.post<{ Body: Record<string, unknown> }>('/requests', async (req, reply) => {
    const user = requireUser(req);
    const v = validateSos(req.body ?? {});
    if (!v.ok) throw new HttpError(400, 'Проверьте поля', v.errors as Record<string, string>);
    const clinic = await one<ClinicRow>(pool, `SELECT ${CLINIC_COLS} FROM clinics WHERE id = $1`, [v.value.clinicId]);
    if (!clinic) throw new HttpError(400, 'Проверьте поля', { clinicId: 'Неизвестная клиника' });
    const recent = (await one<{ n: number }>(
      pool,
      `SELECT count(*)::int AS n FROM requests WHERE author_id = $1 AND created_at > now() - interval '1 hour'`,
      [user.id],
    ))!.n;
    if (recent >= SOS_PER_HOUR) throw new HttpError(429, 'Слишком много запросов за час. Если это ошибка, напишите в поддержку');

    const { r, msgs } = await tx(pool, async (c) => {
      const post = typeof req.body?.postText === 'string' && req.body.postText.trim()
        ? req.body.postText.trim().slice(0, 600)
        : postTemplate({ ...v.value, clinicName: clinic.name, clinicAddress: clinic.address });
      const r = (await one<RequestRow>(
        c,
        `INSERT INTO requests (slug, author_id, pet_name, species, weight_kg, blood_group, clinic_id, urgency, reason, post_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          crypto.randomBytes(6).toString('base64url'),
          user.id,
          v.value.petName,
          v.value.species,
          v.value.weightKg,
          v.value.bloodGroup,
          v.value.clinicId,
          v.value.urgency,
          v.value.reason,
          post,
        ],
      ))!;
      await sysMsg(c, r.id, 'Запрос создан');
      return { r, msgs: await planWave(c, r.id, now()) };
    });
    await sendAll(notifier, msgs, app.log);
    reply.status(201);
    return { id: r.id, slug: r.slug, notified: msgs?.length ?? 0 };
  });

  app.post<{ Params: { id: string }; Body: { responseId?: string } }>('/requests/:id/choose', async (req) => {
    const user = requireUser(req);
    const donorId = await tx(pool, async (c) => {
      const r = await getRequest(c, req.params.id, true);
      if (r.author_id !== user.id) throw new HttpError(403, 'Выбрать донора может только автор запроса');
      if (r.status !== 'open') throw new HttpError(409, r.status === 'closed' ? 'Запрос уже закрыт' : 'Донор уже выбран');
      const x = await one<ResponseRow & { pet_name: string }>(
        c,
        `UPDATE responses x SET status = 'chosen' FROM pets p
         WHERE x.id = $1 AND x.request_id = $2 AND x.status = 'offered' AND p.id = x.pet_id
         RETURNING x.*, p.name AS pet_name`,
        [req.body?.responseId, r.id],
      ).catch(() => null);
      if (!x) throw new HttpError(404, 'Отклик не найден или отменён');
      await c.query(`UPDATE requests SET status = 'donor_chosen', trip_status = $2 WHERE id = $1`, [r.id, TRIP.chosen]);
      await sysMsg(c, r.id, `Выбран донор: ${x.pet_name}. Теперь доступны чат и телефоны, если они указаны`);
      return x.donor_user_id;
    });
    await notifyUser(donorId, 'Вас выбрали донором! Откройте запрос: там адрес клиники и чат с хозяином', req.params.id);
    return { ok: true };
  });

  // «Донор не приедет»: снимаем донора и сразу запускаем следующую волну.
  app.post<{ Params: { id: string } }>('/requests/:id/drop-donor', async (req) => {
    const user = requireUser(req);
    const { donorId, msgs } = await tx(pool, async (c) => {
      const r = await getRequest(c, req.params.id, true);
      if (r.author_id !== user.id) throw new HttpError(403, 'Только автор запроса может снять донора');
      if (r.status !== 'donor_chosen') throw new HttpError(409, 'Донор не выбран');
      const x = await one<ResponseRow>(c, `UPDATE responses SET status = 'declined' WHERE request_id = $1 AND status = 'chosen' RETURNING *`, [r.id]);
      await c.query(`UPDATE requests SET status = 'open', trip_status = NULL WHERE id = $1`, [r.id]);
      await sysMsg(c, r.id, 'Донор не приедет. Ищем дальше');
      return { donorId: x?.donor_user_id ?? null, msgs: await planWave(c, r.id, now()) };
    });
    await sendAll(notifier, msgs, app.log);
    if (donorId) await notifyUser(donorId, 'Хозяин отменил поездку. Спасибо, что откликнулись!', req.params.id);
    return { ok: true, notified: msgs?.length ?? 0 };
  });

  // «Кровь взяли»: подтверждение сдачи хозяином. Закрывает запрос и начисляет донору капли.
  app.post<{ Params: { id: string } }>('/requests/:id/confirm', async (req) => {
    const user = requireUser(req);
    const donorId = await tx(pool, async (c) => {
      const r = await getRequest(c, req.params.id, true);
      if (r.author_id !== user.id) throw new HttpError(403, 'Подтвердить сдачу может только автор запроса');
      if (r.status !== 'donor_chosen') throw new HttpError(409, 'Донор не выбран');
      const x = (await one<ResponseRow>(c, `SELECT * FROM responses WHERE request_id = $1 AND status = 'chosen'`, [r.id]))!;
      const d = (await one<{ id: string }>(
        c,
        `INSERT INTO donations (pet_id, clinic_id, date, request_id, confirmed_by, confirmed_at)
         VALUES ($1, $2, $3::timestamptz::date, $4, 'owner', $3) RETURNING id`,
        [x.pet_id, r.clinic_id, now(), r.id],
      ))!;
      await c.query('UPDATE pets SET last_donation = $2::timestamptz::date WHERE id = $1', [x.pet_id, now()]);
      await c.query(`UPDATE requests SET status = 'closed', trip_status = $2, closed_at = $3 WHERE id = $1`, [r.id, TRIP.done, now()]);
      await c.query(`UPDATE responses SET status = 'declined' WHERE request_id = $1 AND status = 'offered'`, [r.id]);
      await sysMsg(c, r.id, 'Кровь взяли. Спасибо донору!');
      await award(c, x.donor_user_id, 'donation', d.id);
      return x.donor_user_id;
    });
    await notifyUser(donorId, 'Хозяин подтвердил сдачу крови. Спасибо, вы спасли жизнь! +150 капель', req.params.id);
    return { ok: true };
  });

  // Закрыть без сдачи: донора нашли в другом месте или помощь больше не нужна.
  app.post<{ Params: { id: string } }>('/requests/:id/close', async (req) => {
    const user = requireUser(req);
    const donors = await tx(pool, async (c) => {
      const r = await getRequest(c, req.params.id, true);
      if (r.author_id !== user.id) throw new HttpError(403, 'Закрыть запрос может только автор');
      if (r.status === 'closed') return [];
      const xs = await many<ResponseRow>(
        c,
        `UPDATE responses SET status = 'declined' WHERE request_id = $1 AND status IN ('offered', 'chosen') RETURNING *`,
        [r.id],
      );
      await c.query(`UPDATE requests SET status = 'closed', closed_at = $2 WHERE id = $1`, [r.id, now()]);
      await sysMsg(c, r.id, 'Запрос закрыт');
      return xs.map((x) => x.donor_user_id);
    });
    for (const d of new Set(donors)) await notifyUser(d, 'Помощь больше не нужна, запрос закрыт. Спасибо, что откликнулись!', req.params.id);
    return { ok: true };
  });

  // ---------- Донор ----------

  app.post<{ Params: { id: string }; Body: { petId?: string } }>('/requests/:id/respond', async (req) => {
    const user = requireUser(req);
    const authorId = await tx(pool, async (c) => {
      const r = await getRequest(c, req.params.id, true);
      if (r.status !== 'open') throw new HttpError(409, r.status === 'closed' ? 'Запрос уже закрыт' : 'Донор уже выбран, спасибо!');
      if (r.author_id === user.id) throw new HttpError(400, 'Нельзя откликнуться на свой запрос');
      const p = await one<PetRow>(c, `SELECT ${PET_COLS} FROM pets WHERE id = $1 AND owner_id = $2`, [req.body?.petId, user.id]).catch(() => null);
      if (!p) throw new HttpError(404, 'Питомец не найден');
      if (p.species !== r.species) throw new HttpError(400, `Нужна ${r.species === 'dog' ? 'собака' : 'кошка'}`);
      if (!groupCompatible(r.species, r.blood_group, p.blood_group)) throw new HttpError(400, 'Группа крови не подходит');
      const e = petEligibility(p, (await medByPet(c, [p.id])).get(p.id)!, now());
      if (!e.ready) throw new HttpError(400, `${p.name} пока не может сдать кровь: ${e.checks.find((x) => !x.ok)?.title.toLowerCase()}`);
      const ins = await c.query(
        `INSERT INTO responses (request_id, pet_id, donor_user_id) VALUES ($1, $2, $3)
         ON CONFLICT (request_id, pet_id) DO UPDATE SET status = 'offered', created_at = now()
           WHERE responses.status = 'cancelled'
         RETURNING id`,
        [r.id, p.id, user.id],
      );
      if (!ins.rowCount) throw new HttpError(409, 'Вы уже откликнулись');
      await award(c, user.id, 'respond', r.id);
      await sysMsg(c, r.id, `${p.name} может приехать`);
      return r.author_id;
    });
    await notifyUser(authorId, 'Донор откликнулся на ваш запрос. Откройте и выберите донора', req.params.id);
    return { ok: true };
  });

  // Отменить отклик до выбора или «Не смогу приехать» после выбора.
  app.post<{ Params: { id: string } }>('/requests/:id/withdraw', async (req) => {
    const user = requireUser(req);
    const { authorId, wasChosen, msgs } = await tx(pool, async (c) => {
      const r = await getRequest(c, req.params.id, true);
      const x = await one<ResponseRow>(
        c,
        `SELECT * FROM responses WHERE request_id = $1 AND donor_user_id = $2 AND status IN ('offered', 'chosen')
         ORDER BY status = 'chosen' DESC LIMIT 1 FOR UPDATE`,
        [r.id, user.id],
      );
      if (!x) throw new HttpError(404, 'Активного отклика нет');
      await c.query(`UPDATE responses SET status = 'cancelled' WHERE id = $1`, [x.id]);
      const wasChosen = x.status === 'chosen';
      if (!wasChosen) return { authorId: r.author_id, wasChosen, msgs: null };
      await c.query(`UPDATE requests SET status = 'open', trip_status = NULL WHERE id = $1`, [r.id]);
      await sysMsg(c, r.id, 'Донор не сможет приехать. Ищем дальше');
      return { authorId: r.author_id, wasChosen, msgs: await planWave(c, r.id, now()) };
    });
    await sendAll(notifier, msgs, app.log);
    if (wasChosen) await notifyUser(authorId, 'Донор не сможет приехать. Мы уже ищем другого', req.params.id);
    return { ok: true };
  });

  // «Я выехал(а)», «В пути», «Я на месте».
  app.post<{ Params: { id: string }; Body: { step?: number } }>('/requests/:id/trip', async (req) => {
    const user = requireUser(req);
    const step = Number(req.body?.step);
    if (![TRIP.left, TRIP.onTheWay, TRIP.arrived].includes(step as 1 | 2 | 3)) throw new HttpError(400, 'Неизвестный шаг');
    const authorId = await tx(pool, async (c) => {
      const r = await getRequest(c, req.params.id, true);
      const chosen = await one(c, `SELECT 1 FROM responses WHERE request_id = $1 AND donor_user_id = $2 AND status = 'chosen'`, [r.id, user.id]);
      if (r.status !== 'donor_chosen' || !chosen) throw new HttpError(403, 'Вы не выбраны донором в этом запросе');
      if ((r.trip_status ?? 0) >= step) return null;
      await c.query('UPDATE requests SET trip_status = $2 WHERE id = $1', [r.id, step]);
      await sysMsg(c, r.id, ['', 'Донор выехал', 'Донор в пути', 'Донор на месте в клинике'][step]!);
      return r.author_id;
    });
    if (authorId) {
      await notifyUser(authorId, step === TRIP.arrived ? 'Донор на месте в клинике' : 'Донор выехал к вам', req.params.id);
    }
    return { ok: true };
  });

  // ---------- Чат запроса: автор и выбранный донор ----------

  app.post<{ Params: { id: string }; Body: { text?: string } }>(
    '/requests/:id/messages',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const user = requireUser(req);
      const text = String(req.body?.text ?? '').trim().slice(0, 1000);
      if (!text) throw new HttpError(400, 'Пустое сообщение');
      const r = await getRequest(pool, req.params.id);
      const donor = await one<{ donor_user_id: string }>(pool, `SELECT donor_user_id FROM responses WHERE request_id = $1 AND status = 'chosen'`, [r.id]);
      const isAuthor = r.author_id === user.id;
      if (!isAuthor && donor?.donor_user_id !== user.id) throw new HttpError(403, 'Чат доступен автору запроса и выбранному донору');
      if (r.status === 'closed') throw new HttpError(409, 'Запрос закрыт');
      await pool.query('INSERT INTO messages (request_id, author_id, text) VALUES ($1, $2, $3)', [r.id, user.id, text]);
      const to = isAuthor ? donor?.donor_user_id : r.author_id;
      if (to) await notifyUser(to, `Новое сообщение: ${text.slice(0, 100)}`, r.id);
      return { ok: true };
    },
  );
}
