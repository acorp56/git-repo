// Кабинет клиники: подтверждение запросов и сдач, банк крови. Доступ — сотрудникам клиники (clinic_staff).
// Сотрудников добавляет администратор сервиса: npm run clinic:staff -- <email> <clinicId> <admin|vet>.
import { COMPONENTS, isBloodGroupFor, type Component } from '@pavhelp/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, requireUser } from '../app';
import { many, one, tx, type Db } from '../db';
import { notifyUser, sysMsg } from '../services/respond';
import { award } from '../services/xp';

export async function clinicRoutes(app: FastifyInstance) {
  const { pool } = app.deps;
  const now = () => app.deps.now();
  const notify = (userId: string, text: string, requestId: string) => notifyUser(pool, app.deps.notifier, app.log, userId, text, requestId);

  async function staff(req: FastifyRequest<{ Params: { clinicId: string } }>) {
    const user = requireUser(req);
    const s = await one<{ role: 'admin' | 'vet' }>(pool, 'SELECT role FROM clinic_staff WHERE clinic_id = $1 AND user_id = $2', [
      req.params.clinicId,
      user.id,
    ]);
    if (!s) throw new HttpError(403, 'Нет доступа к кабинету этой клиники');
    return { userId: user.id, role: s.role, clinicId: req.params.clinicId };
  }

  const audit = (db: Db, clinicId: string, userId: string, action: string, ref: string) =>
    db.query('INSERT INTO clinic_audit (clinic_id, user_id, action, ref) VALUES ($1, $2, $3, $4)', [clinicId, userId, action, ref]);

  app.get('/', async (req) => {
    const user = requireUser(req);
    return many(pool, 'SELECT c.id, c.name, c.city, s.role FROM clinic_staff s JOIN clinics c ON c.id = s.clinic_id WHERE s.user_id = $1', [user.id]);
  });

  app.get<{ Params: { clinicId: string } }>('/:clinicId', async (req) => {
    const { clinicId } = await staff(req);
    const clinic = await one(pool, 'SELECT id, name, city, address, phone FROM clinics WHERE id = $1', [clinicId]);
    const requests = await many(
      pool,
      `SELECT id, pet_name AS "petName", species, weight_kg AS "weightKg", blood_group AS "bloodGroup", component, volume_ml AS "volumeMl",
              urgency, status, clinic_status AS "clinicStatus", created_at AS "createdAt"
       FROM requests WHERE clinic_id = $1 AND (status <> 'closed' OR closed_at > $2::timestamptz - interval '7 days')
       ORDER BY clinic_status = 'pending' DESC, created_at DESC LIMIT 100`,
      [clinicId, now()],
    );
    const donations = await many(
      pool,
      `SELECT d.id, d.date, p.name AS "petName", p.species, p.blood_group AS "bloodGroup", p.chip
       FROM donations d JOIN pets p ON p.id = d.pet_id
       WHERE d.clinic_id = $1 AND d.confirmed_by IS NULL ORDER BY d.date DESC`,
      [clinicId],
    );
    const stock = await many(
      pool,
      `SELECT id, species, blood_group AS "bloodGroup", component, doses, dose_ml AS "doseMl", expires_on AS "expiresOn", updated_at AS "updatedAt"
       FROM blood_stock WHERE clinic_id = $1 ORDER BY species, component, blood_group`,
      [clinicId],
    );
    return { clinic, requests, donations, stock };
  });

  // «Питомец у нас» → отметка «Клиника подтвердила». «Не у нас» → запрос скрывается и уходит модератору.
  app.post<{ Params: { clinicId: string; requestId: string }; Body: { ok?: boolean } }>('/:clinicId/requests/:requestId', async (req) => {
    const s = await staff(req);
    const ok = req.body?.ok === true;
    const authorId = await tx(pool, async (c) => {
      const r = await one<{ author_id: string; clinic_id: string }>(c, 'SELECT author_id, clinic_id FROM requests WHERE id = $1 FOR UPDATE', [
        req.params.requestId,
      ]).catch(() => null);
      if (!r || r.clinic_id !== s.clinicId) throw new HttpError(404, 'Запрос не найден');
      await c.query('UPDATE requests SET clinic_status = $2, hidden = $3 WHERE id = $1', [req.params.requestId, ok ? 'confirmed' : 'rejected', !ok]);
      await sysMsg(c, req.params.requestId, ok ? 'Клиника подтвердила запрос' : 'Клиника не подтвердила, что питомец у неё. Запрос на проверке у модератора');
      await audit(c, s.clinicId, s.userId, ok ? 'request.confirm' : 'request.reject', req.params.requestId);
      return r.author_id;
    });
    await notify(authorId, ok ? 'Клиника подтвердила ваш запрос: доноры видят отметку' : 'Клиника не нашла питомца у себя. Модератор свяжется с вами', req.params.requestId);
    return { ok: true };
  });

  // Сдача вне Павхелпа: подтверждение даёт донору капли, «Не было» — отказ.
  app.post<{ Params: { clinicId: string; donationId: string }; Body: { ok?: boolean } }>('/:clinicId/donations/:donationId', async (req) => {
    const s = await staff(req);
    const ok = req.body?.ok === true;
    await tx(pool, async (c) => {
      const d = await one<{ pet_id: string; owner_id: string }>(
        c,
        `SELECT d.pet_id, p.owner_id FROM donations d JOIN pets p ON p.id = d.pet_id
         WHERE d.id = $1 AND d.clinic_id = $2 AND d.confirmed_by IS NULL FOR UPDATE OF d`,
        [req.params.donationId, s.clinicId],
      ).catch(() => null);
      if (!d) throw new HttpError(404, 'Сдача не найдена или уже обработана');
      if (ok) {
        await c.query(`UPDATE donations SET confirmed_by = 'clinic', confirmed_at = $2 WHERE id = $1`, [req.params.donationId, now()]);
        await award(c, d.owner_id, 'donation', req.params.donationId);
      } else {
        await c.query('DELETE FROM donations WHERE id = $1', [req.params.donationId]);
        await c.query('UPDATE pets SET last_donation = (SELECT max(date) FROM donations WHERE pet_id = $1) WHERE id = $1', [d.pet_id]);
      }
      await audit(c, s.clinicId, s.userId, ok ? 'donation.confirm' : 'donation.reject', req.params.donationId);
    });
    return { ok: true };
  });

  // ---------- Банк крови ----------

  app.post<{ Params: { clinicId: string }; Body: Record<string, unknown> }>('/:clinicId/stock', async (req) => {
    const s = await staff(req);
    const b = req.body ?? {};
    const species = b.species === 'cat' ? 'cat' : b.species === 'dog' ? 'dog' : null;
    if (!species || typeof b.bloodGroup !== 'string' || !isBloodGroupFor(species, b.bloodGroup) || b.bloodGroup === 'unknown') {
      throw new HttpError(400, 'Укажите вид и группу крови');
    }
    if (!COMPONENTS.includes(b.component as Component)) throw new HttpError(400, 'Укажите компонент');
    const doses = Number(b.doses);
    const doseMl = Number(b.doseMl);
    if (!Number.isInteger(doses) || doses < 0 || doses > 999 || !Number.isInteger(doseMl) || doseMl <= 0 || doseMl > 1000) {
      throw new HttpError(400, 'Проверьте число доз и объём дозы');
    }
    const row = await one<{ id: string }>(
      pool,
      `INSERT INTO blood_stock (clinic_id, species, blood_group, component, doses, dose_ml, expires_on) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [s.clinicId, species, b.bloodGroup, b.component, doses, doseMl, typeof b.expiresOn === 'string' && b.expiresOn ? b.expiresOn : null],
    );
    await audit(pool, s.clinicId, s.userId, 'stock.add', row!.id);
    return { ok: true, id: row!.id };
  });

  // ± по дозам. Изменения сразу видны в форме SOS.
  app.patch<{ Params: { clinicId: string; stockId: string }; Body: { doses?: number } }>('/:clinicId/stock/:stockId', async (req) => {
    const s = await staff(req);
    const doses = Number(req.body?.doses);
    if (!Number.isInteger(doses) || doses < 0 || doses > 999) throw new HttpError(400, 'Проверьте число доз');
    const r = await pool.query('UPDATE blood_stock SET doses = $3, updated_at = $4 WHERE id = $1 AND clinic_id = $2', [
      req.params.stockId,
      s.clinicId,
      doses,
      now(),
    ]).catch(() => ({ rowCount: 0 }));
    if (!r.rowCount) throw new HttpError(404, 'Позиция не найдена');
    await audit(pool, s.clinicId, s.userId, `stock.set:${doses}`, req.params.stockId);
    return { ok: true };
  });

  app.delete<{ Params: { clinicId: string; stockId: string } }>('/:clinicId/stock/:stockId', async (req) => {
    const s = await staff(req);
    await pool.query('DELETE FROM blood_stock WHERE id = $1 AND clinic_id = $2', [req.params.stockId, s.clinicId]).catch(() => null);
    await audit(pool, s.clinicId, s.userId, 'stock.delete', req.params.stockId);
    return { ok: true };
  });
}
