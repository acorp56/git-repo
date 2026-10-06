import crypto from 'node:crypto';
import {
  containsCardNumber,
  FREEZE_AFTER_REPORTS,
  groupCompatible,
  isCity,
  isReportReason,
  isRisky,
  NEW_ACCOUNT_DAYS,
  postTemplate,
  SOS_LIMIT,
  TRIP,
  TRIP_STEPS,
  validateSos,
} from '@pavhelp/core';
import type { FastifyInstance } from 'fastify';
import { HttpError, requireUser } from '../app';
import { config } from '../config';
import { many, one, tx, type Db } from '../db';
import { bankOffers } from '../services/banks';
import { planRenotify, planWave, sendAll, type RequestRow } from '../services/matching';
import { isPaused, medByPet, PET_COLS, petEligibility, type PetRow } from '../services/pets';
import { lockRequest, notifyUser, respondToRequest, sysMsg } from '../services/respond';
import { award } from '../services/xp';
import { CLINIC_COLS, clinicView, type ClinicRow } from './reference';

interface ResponseRow {
  id: string;
  request_id: string;
  pet_id: string;
  donor_user_id: string;
  status: 'offered' | 'chosen' | 'declined' | 'cancelled';
  donor_phone_shown: boolean;
  created_at: Date;
}

/** То, что видно всем, в том числе на публичной странице: без данных хозяина. */
const publicView = (r: RequestRow, clinic: ClinicRow, responders: number) => ({
  id: r.id,
  slug: r.slug,
  petName: r.pet_name,
  species: r.species,
  weightKg: r.weight_kg,
  bloodGroup: r.blood_group,
  component: r.component,
  volumeMl: r.volume_ml,
  urgency: r.urgency,
  reason: r.reason,
  status: r.status,
  /** «Донор Павхелпа»: питомец сам сдавал кровь. */
  priority: r.priority,
  /** «Клиника подтвердила» или «Клиника проверяет». */
  clinicStatus: r.clinic_status,
  createdAt: r.created_at,
  clinic: clinicView(clinic),
  responders,
});

export async function requestRoutes(app: FastifyInstance) {
  const { pool } = app.deps;
  const now = () => app.deps.now();
  const notify = (userId: string, text: string, requestId: string) => notifyUser(pool, app.deps.notifier, app.log, userId, text, requestId);
  const send = (msgs: Parameters<typeof sendAll>[1]) => sendAll(app.deps.notifier, msgs, app.log);

  async function getRequest(db: Db, id: string): Promise<RequestRow> {
    const r = await one<RequestRow>(db, 'SELECT * FROM requests WHERE id = $1', [id]).catch(() => null);
    if (!r) throw new HttpError(404, 'Запрос не найден');
    return r;
  }

  const clinicOf = async (id: string) => (await one<ClinicRow>(pool, `SELECT ${CLINIC_COLS} FROM clinics WHERE id = $1`, [id]))!;
  const respondersCount = async (id: string) =>
    (await one<{ n: number }>(pool, `SELECT count(*)::int AS n FROM responses WHERE request_id = $1 AND status IN ('offered', 'chosen')`, [id]))!.n;
  const chosenOf = (db: Db, requestId: string) =>
    one<ResponseRow>(db, `SELECT * FROM responses WHERE request_id = $1 AND status = 'chosen'`, [requestId]);

  // ---------- Лента и детали ----------

  app.get<{ Querystring: { scope?: string; city?: string } }>('/requests', async (req) => {
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
      // Открытые запросы города. Скрытые модерацией, от замороженных авторов и те, на которые я пожаловался, не показываем.
      rows = await many<RequestRow>(
        pool,
        `SELECT r.* FROM requests r
         JOIN clinics c ON c.id = r.clinic_id
         JOIN users a ON a.id = r.author_id
         WHERE r.status = 'open' AND NOT r.hidden AND a.frozen_at IS NULL
           AND ($1::text IS NULL OR c.city = $1)
           AND NOT EXISTS (SELECT 1 FROM reports p WHERE p.request_id = r.id AND p.reporter_id = $2)
         ORDER BY r.urgency = 'now' DESC, r.priority DESC, r.created_at DESC LIMIT 50`,
        [isCity(req.query.city) ? req.query.city : null, req.user?.id ?? null],
      );
    }
    return Promise.all(rows.map(async (r) => publicView(r, await clinicOf(r.clinic_id), await respondersCount(r.id))));
  });

  // Публичная страница запроса pavhelp.ru/r/<slug>: доступна без входа, без данных хозяина.
  app.get<{ Params: { slug: string } }>('/public/requests/:slug', async (req) => {
    const r = await one<RequestRow>(pool, 'SELECT * FROM requests WHERE slug = $1 AND NOT hidden', [req.params.slug]);
    if (!r) throw new HttpError(404, 'Запрос не найден');
    return { ...publicView(r, await clinicOf(r.clinic_id), await respondersCount(r.id)), postText: r.post_text };
  });

  app.get<{ Params: { id: string } }>('/requests/:id', async (req) => {
    const r = await getRequest(pool, req.params.id);
    const me = req.user;
    if (r.hidden && r.author_id !== me?.id) throw new HttpError(404, 'Запрос не найден');
    const clinic = await clinicOf(r.clinic_id);
    const author = (await one<{ name: string; phone: string | null; created_at: Date }>(pool, 'SELECT name, phone, created_at FROM users WHERE id = $1', [
      r.author_id,
    ]))!;
    const base = {
      ...publicView(r, clinic, await respondersCount(r.id)),
      postText: r.post_text,
      publicUrl: `${config.appUrl}/r/${r.slug}`,
      // Стаж автора и плашка «новый аккаунт»: помогает донорам отличить фейк.
      authorSince: author.created_at,
      authorNew: now().getTime() - author.created_at.getTime() < NEW_ACCOUNT_DAYS * 86_400_000,
    };
    if (!me) return { ...base, role: 'guest' as const };

    const reportedByMe = !!(await one(pool, 'SELECT 1 FROM reports WHERE request_id = $1 AND reporter_id = $2', [r.id, me.id]));
    const messages = () =>
      many<{ id: string; author_id: string | null; text: string; flagged: boolean; created_at: Date }>(
        pool,
        'SELECT id, author_id, text, flagged, created_at FROM messages WHERE request_id = $1 ORDER BY created_at',
        [r.id],
      ).then((ms) =>
        ms.map((m) => ({
          id: m.id,
          system: m.author_id === null,
          mine: m.author_id === me.id,
          text: m.text,
          // Похоже на просьбу о деньгах: показываем предупреждение у входящего сообщения.
          flagged: m.flagged && m.author_id !== me.id,
          at: m.created_at,
        })),
      );
    const trip = r.trip_status === null ? null : { step: r.trip_status, steps: TRIP_STEPS };
    const chat = { blocked: r.chat_blocked };

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
        canExpand: r.status === 'open' && r.radius_km < 50,
        // «Ещё ищете донора?» — после суток без выбора.
        staleAsk: r.status === 'open' && r.stale_asked_at !== null,
        hidden: r.hidden,
        trip,
        chat,
        myPhoneShown: r.author_phone_shown,
        myPhone: author.phone,
        banks: r.status === 'closed' ? [] : await bankOffers(pool, { species: r.species, bloodGroup: r.blood_group, component: r.component, city: clinic.city, nearClinicId: r.clinic_id }),
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
          // Номер собеседника виден, только если он сам его открыл.
          phone: x.status === 'chosen' && x.donor_phone_shown ? x.phone : null,
          phoneShown: x.status === 'chosen' && x.donor_phone_shown,
          at: x.created_at,
        })),
        messages: await messages(),
      };
    }

    const mine = await one<ResponseRow & { pet_name: string; phone: string | null }>(
      pool,
      `SELECT x.*, p.name AS pet_name, u.phone FROM responses x JOIN pets p ON p.id = x.pet_id JOIN users u ON u.id = x.donor_user_id
       WHERE x.request_id = $1 AND x.donor_user_id = $2 ORDER BY x.status = 'chosen' DESC, x.created_at DESC LIMIT 1`,
      [r.id, me.id],
    );
    if (mine && mine.status === 'chosen') {
      return {
        ...base,
        role: 'donor' as const,
        reportedByMe,
        myResponse: { id: mine.id, status: mine.status, petName: mine.pet_name },
        author: { name: author.name, phone: r.author_phone_shown ? author.phone : null, phoneShown: r.author_phone_shown },
        myPhoneShown: mine.donor_phone_shown,
        myPhone: mine.phone,
        trip,
        chat,
        messages: await messages(),
      };
    }

    // Кто может откликнуться: мои питомцы того же вида с проверкой допуска и совместимости.
    const pets = await many<PetRow>(pool, `SELECT ${PET_COLS} FROM pets WHERE owner_id = $1 AND species = $2 AND deceased_at IS NULL`, [
      me.id,
      r.species,
    ]);
    const med = await medByPet(
      pool,
      pets.map((p) => p.id),
    );
    return {
      ...base,
      role: mine && mine.status === 'offered' ? ('donor' as const) : ('viewer' as const),
      reportedByMe,
      myResponse: mine && mine.status === 'offered' ? { id: mine.id, status: mine.status, petName: mine.pet_name } : null,
      myPets: pets.map((p) => {
        const e = petEligibility(p, med.get(p.id)!, now());
        return {
          id: p.id,
          name: p.name,
          ready: e.ready && p.donor_enabled,
          paused: isPaused(p, now()),
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

    const { r, msgs } = await tx(pool, async (c) => {
      // Лимиты считаем под блокировкой пользователя: два одновременных запроса не обойдут их.
      const u = (await one<{ frozen_at: Date | null }>(c, 'SELECT frozen_at FROM users WHERE id = $1 FOR UPDATE', [user.id]))!;
      if (u.frozen_at) throw new HttpError(403, 'Аккаунт временно заморожен после жалоб. Напишите в поддержку', undefined, { code: 'frozen' });

      // Свой питомец, которому нужна кровь: если он сам сдавал кровь, запрос приоритетный.
      let patient: PetRow | null = null;
      if (v.value.patientPetId) {
        patient = await one<PetRow>(c, `SELECT ${PET_COLS} FROM pets WHERE id = $1 AND owner_id = $2`, [v.value.patientPetId, user.id]).catch(() => null);
        if (!patient || patient.species !== v.value.species) throw new HttpError(400, 'Проверьте поля', { patientPetId: 'Питомец не найден' });
      }
      const priority =
        !!patient && !!(await one(c, `SELECT 1 FROM donations WHERE pet_id = $1 AND confirmed_by IS NOT NULL`, [patient.id]));

      // Один активный запрос на питомца: дубли ловим по питомцу или кличке.
      const same = await one<{ id: string }>(
        c,
        `SELECT id FROM requests WHERE author_id = $1 AND status <> 'closed'
           AND (patient_pet_id = $2 OR lower(pet_name) = lower($3)) LIMIT 1`,
        [user.id, patient?.id ?? null, v.value.petName],
      );
      if (same) {
        throw new HttpError(409, `${v.value.petName}: запрос уже открыт, доноры его получили. Изменить его можно в текущем запросе`, undefined, {
          code: 'duplicate',
          requestId: same.id,
        });
      }
      const q = (await one<{ active: number; day: number }>(
        c,
        `SELECT count(*) FILTER (WHERE status <> 'closed')::int AS active,
                count(*) FILTER (WHERE created_at > $2::timestamptz - interval '1 day')::int AS day
         FROM requests WHERE author_id = $1`,
        [user.id, now()],
      ))!;
      if (q.active >= SOS_LIMIT.active) {
        throw new HttpError(429, 'Одновременно можно держать не больше двух SOS. Закройте запрос, который уже не нужен', undefined, { code: 'active_limit' });
      }
      if (q.day >= SOS_LIMIT.perDay) {
        throw new HttpError(
          429,
          `За сутки можно отправить ${SOS_LIMIT.perDay} SOS. Если ситуация срочная, позвоните в клинику. Поддержка снимет ограничение вручную`,
          undefined,
          { code: 'day_limit' },
        );
      }

      const post =
        typeof req.body?.postText === 'string' && req.body.postText.trim()
          ? req.body.postText.trim().slice(0, 600)
          : postTemplate({ ...v.value, clinicName: clinic.name, clinicAddress: clinic.address });
      const r = (await one<RequestRow>(
        c,
        `INSERT INTO requests (slug, author_id, pet_name, species, weight_kg, blood_group, clinic_id, urgency, reason, post_text,
           component, volume_ml, patient_pet_id, priority, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
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
          v.value.component,
          v.value.volumeMl,
          patient?.id ?? null,
          priority,
          now(),
        ],
      ))!;
      await sysMsg(c, r.id, 'Запрос создан. Донорство бесплатное: никому не переводите деньги');
      return { r, msgs: await planWave(c, r.id, now()) };
    });
    await send(msgs);
    reply.status(201);
    return { id: r.id, slug: r.slug, notified: msgs?.length ?? 0, priority: r.priority };
  });

  app.post<{ Params: { id: string }; Body: { responseId?: string } }>('/requests/:id/choose', async (req) => {
    const user = requireUser(req);
    const donorId = await tx(pool, async (c) => {
      const r = await lockRequest(c, req.params.id);
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
      await sysMsg(c, r.id, `Выбран донор: ${x.pet_name}. Номера телефонов скрыты, пока каждый сам не откроет свой`);
      return x.donor_user_id;
    });
    await notify(donorId, 'Вас выбрали донором! Откройте запрос: там адрес клиники и чат с хозяином', req.params.id);
    return { ok: true };
  });

  // «Донор не приедет»: снимаем донора и сразу запускаем следующую волну.
  app.post<{ Params: { id: string } }>('/requests/:id/drop-donor', async (req) => {
    const user = requireUser(req);
    const { donorId, msgs } = await tx(pool, async (c) => {
      const r = await lockRequest(c, req.params.id);
      if (r.author_id !== user.id) throw new HttpError(403, 'Только автор запроса может снять донора');
      if (r.status !== 'donor_chosen') throw new HttpError(409, 'Донор не выбран');
      const x = await one<ResponseRow>(c, `UPDATE responses SET status = 'declined' WHERE request_id = $1 AND status = 'chosen' RETURNING *`, [r.id]);
      await c.query(`UPDATE requests SET status = 'open', trip_status = NULL, author_phone_shown = false WHERE id = $1`, [r.id]);
      await sysMsg(c, r.id, 'Донор не приедет. Ищем дальше');
      return { donorId: x?.donor_user_id ?? null, msgs: await planWave(c, r.id, now()) };
    });
    await send(msgs);
    if (donorId) await notify(donorId, 'Хозяин отменил поездку. Спасибо, что откликнулись!', req.params.id);
    return { ok: true, notified: msgs?.length ?? 0 };
  });

  // «Искать в 50 км»: следующая волна сразу, не дожидаясь таймера. Часть «плана Б».
  app.post<{ Params: { id: string } }>('/requests/:id/expand', async (req) => {
    const user = requireUser(req);
    const msgs = await tx(pool, async (c) => {
      const r = await lockRequest(c, req.params.id);
      if (r.author_id !== user.id) throw new HttpError(403, 'Только автор запроса может расширить поиск');
      if (r.status !== 'open') throw new HttpError(409, 'Запрос не ищет донора');
      return planWave(c, r.id, now());
    });
    if (msgs === null) throw new HttpError(409, 'Поиск уже идёт в максимальном радиусе 50 км');
    await send(msgs);
    return { ok: true, notified: msgs.length };
  });

  // «Да, ещё ищем»: продлеваем запрос и повторно уведомляем доноров.
  app.post<{ Params: { id: string } }>('/requests/:id/renew', async (req) => {
    const user = requireUser(req);
    const msgs = await tx(pool, async (c) => {
      const r = await lockRequest(c, req.params.id);
      if (r.author_id !== user.id) throw new HttpError(403, 'Продлить запрос может только автор');
      if (r.status !== 'open') throw new HttpError(409, 'Запрос не ищет донора');
      await c.query('UPDATE requests SET renewed_at = $2, stale_asked_at = NULL WHERE id = $1', [r.id, now()]);
      await sysMsg(c, r.id, 'Хозяин продлил запрос: всё ещё ищем донора');
      return planRenotify(c, r, now());
    });
    await send(msgs);
    return { ok: true, notified: msgs.length };
  });

  // «Кровь взяли»: подтверждение сдачи хозяином. Закрывает запрос и начисляет донору капли.
  app.post<{ Params: { id: string } }>('/requests/:id/confirm', async (req) => {
    const user = requireUser(req);
    const donorId = await tx(pool, async (c) => {
      const r = await lockRequest(c, req.params.id);
      if (r.author_id !== user.id) throw new HttpError(403, 'Подтвердить сдачу может только автор запроса');
      if (r.status !== 'donor_chosen') throw new HttpError(409, 'Донор не выбран');
      const x = (await chosenOf(c, r.id))!;
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
    await notify(donorId, 'Хозяин подтвердил сдачу крови. Спасибо, вы спасли жизнь! +150 капель', req.params.id);
    return { ok: true };
  });

  // Закрыть без сдачи: донора нашли в другом месте или помощь больше не нужна.
  app.post<{ Params: { id: string } }>('/requests/:id/close', async (req) => {
    const user = requireUser(req);
    const donors = await tx(pool, async (c) => {
      const r = await lockRequest(c, req.params.id);
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
    for (const d of new Set(donors)) await notify(d, 'Помощь больше не нужна, запрос закрыт. Спасибо, что откликнулись!', req.params.id);
    return { ok: true };
  });

  // ---------- Донор ----------

  app.post<{ Params: { id: string }; Body: { petId?: string } }>('/requests/:id/respond', async (req) => {
    const user = requireUser(req);
    const { authorId } = await respondToRequest(pool, user.id, req.params.id, req.body?.petId, now());
    await notify(authorId, 'Донор откликнулся на ваш запрос. Откройте и выберите донора', req.params.id);
    return { ok: true };
  });

  // Отменить отклик до выбора или «Не смогу приехать» после выбора.
  app.post<{ Params: { id: string } }>('/requests/:id/withdraw', async (req) => {
    const user = requireUser(req);
    const { authorId, wasChosen, msgs } = await tx(pool, async (c) => {
      const r = await lockRequest(c, req.params.id);
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
      await c.query(`UPDATE requests SET status = 'open', trip_status = NULL, author_phone_shown = false WHERE id = $1`, [r.id]);
      await sysMsg(c, r.id, 'Донор не сможет приехать. Ищем дальше');
      return { authorId: r.author_id, wasChosen, msgs: await planWave(c, r.id, now()) };
    });
    await send(msgs);
    if (wasChosen) await notify(authorId, 'Донор не сможет приехать. Мы уже ищем другого', req.params.id);
    return { ok: true };
  });

  // «Я выехал(а)», «В пути», «Я на месте».
  app.post<{ Params: { id: string }; Body: { step?: number } }>('/requests/:id/trip', async (req) => {
    const user = requireUser(req);
    const step = Number(req.body?.step);
    if (![TRIP.left, TRIP.onTheWay, TRIP.arrived].includes(step as 1 | 2 | 3)) throw new HttpError(400, 'Неизвестный шаг');
    const authorId = await tx(pool, async (c) => {
      const r = await lockRequest(c, req.params.id);
      const chosen = await chosenOf(c, r.id);
      if (r.status !== 'donor_chosen' || chosen?.donor_user_id !== user.id) throw new HttpError(403, 'Вы не выбраны донором в этом запросе');
      if ((r.trip_status ?? 0) >= step) return null;
      await c.query('UPDATE requests SET trip_status = $2 WHERE id = $1', [r.id, step]);
      await sysMsg(c, r.id, ['', 'Донор выехал', 'Донор в пути', 'Донор на месте в клинике'][step]!);
      return r.author_id;
    });
    if (authorId) await notify(authorId, step === TRIP.arrived ? 'Донор на месте в клинике' : 'Донор выехал к вам', req.params.id);
    return { ok: true };
  });

  // ---------- Телефоны по согласию ----------
  // После выбора донора номера скрыты с обеих сторон. Каждый сам решает показать свой номер или скрыть обратно.

  app.post<{ Params: { id: string }; Body: { show?: boolean } }>('/requests/:id/phone', async (req) => {
    const user = requireUser(req);
    const show = req.body?.show === true;
    const res = await tx(pool, async (c) => {
      const r = await lockRequest(c, req.params.id);
      if (r.status !== 'donor_chosen') throw new HttpError(409, 'Номерами можно обменяться после выбора донора');
      const x = (await chosenOf(c, r.id))!;
      const me = (await one<{ phone: string | null }>(c, 'SELECT phone FROM users WHERE id = $1', [user.id]))!;
      if (show && !me.phone) throw new HttpError(400, 'Сначала укажите телефон в настройках', undefined, { code: 'no_phone' });
      if (r.author_id === user.id) {
        await c.query('UPDATE requests SET author_phone_shown = $2 WHERE id = $1', [r.id, show]);
        return { to: x.donor_user_id };
      }
      if (x.donor_user_id !== user.id) throw new HttpError(403, 'Номером можно поделиться только с участником запроса');
      await c.query('UPDATE responses SET donor_phone_shown = $2 WHERE id = $1', [x.id, show]);
      return { to: r.author_id };
    });
    if (show) await notify(res.to, 'Собеседник открыл свой номер телефона', req.params.id);
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
      // Номер карты в чат отправить нельзя: донорство бесплатное.
      if (containsCardNumber(text)) throw new HttpError(400, 'Номер карты отправить нельзя. Донорство бесплатное: никому не переводите деньги');
      const r = await getRequest(pool, req.params.id);
      const donor = await chosenOf(pool, r.id);
      const isAuthor = r.author_id === user.id;
      if (!isAuthor && donor?.donor_user_id !== user.id) throw new HttpError(403, 'Чат доступен автору запроса и выбранному донору');
      if (r.status === 'closed') throw new HttpError(409, 'Запрос закрыт');
      if (r.chat_blocked) throw new HttpError(409, 'Чат закрыт после жалобы. Модератор проверит переписку');
      await pool.query('INSERT INTO messages (request_id, author_id, text, flagged) VALUES ($1, $2, $3, $4)', [r.id, user.id, text, isRisky(text)]);
      const to = isAuthor ? donor?.donor_user_id : r.author_id;
      if (to) await notify(to, `Новое сообщение: ${text.slice(0, 100)}`, r.id);
      return { ok: true };
    },
  );

  // ---------- Жалобы ----------

  app.post<{ Params: { id: string }; Body: { reason?: string; messageId?: string; comment?: string } }>(
    '/requests/:id/report',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req) => {
      const user = requireUser(req);
      const reason = req.body?.reason;
      if (!isReportReason(reason)) throw new HttpError(400, 'Выберите причину жалобы');
      const result = await tx(pool, async (c) => {
        const r = await lockRequest(c, req.params.id);
        const donor = await chosenOf(c, r.id);
        const isAuthor = r.author_id === user.id;
        // На кого жалоба: автор жалуется на выбранного донора, остальные — на автора запроса.
        let target: string | null = isAuthor ? (donor?.donor_user_id ?? null) : r.author_id;
        if (req.body?.messageId) {
          const m = await one<{ author_id: string | null }>(c, 'SELECT author_id FROM messages WHERE id = $1 AND request_id = $2', [
            req.body.messageId,
            r.id,
          ]).catch(() => null);
          if (!m?.author_id || m.author_id === user.id) throw new HttpError(400, 'Сообщение не найдено');
          target = m.author_id;
        }
        if (!target || target === user.id) throw new HttpError(400, 'Жаловаться не на кого');
        await c.query(
          `INSERT INTO reports (reporter_id, target_user, request_id, message_id, reason, comment) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (reporter_id, request_id, reason) DO NOTHING`,
          [user.id, target, r.id, req.body?.messageId ?? null, reason, String(req.body?.comment ?? '').slice(0, 500)],
        );
        // Жалоба участника чата на деньги или продажу крови сразу закрывает чат.
        const participant = isAuthor || donor?.donor_user_id === user.id;
        if (participant && (reason === 'money' || reason === 'sell')) {
          await c.query('UPDATE requests SET chat_blocked = true WHERE id = $1', [r.id]);
          await sysMsg(c, r.id, 'Чат закрыт после жалобы на просьбу о деньгах. Модератор проверит переписку');
        }
        // Несколько жалоб от разных людей замораживают аккаунт до проверки модератором.
        const n = (await one<{ n: number }>(
          c,
          `SELECT count(DISTINCT reporter_id)::int AS n FROM reports WHERE target_user = $1 AND status <> 'rejected' AND reason <> 'photo'`,
          [target],
        ))!.n;
        if (n >= FREEZE_AFTER_REPORTS) {
          await c.query('UPDATE users SET frozen_at = coalesce(frozen_at, $2) WHERE id = $1', [target, now()]);
          await c.query(`UPDATE requests SET hidden = true WHERE author_id = $1 AND status <> 'closed'`, [target]);
        }
        return { chatClosed: participant && (reason === 'money' || reason === 'sell') };
      });
      return { ok: true, ...result };
    },
  );
}
