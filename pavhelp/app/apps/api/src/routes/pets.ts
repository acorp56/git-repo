import { isBloodGroupFor, isDistrict, parseKg, type Species } from '@pavhelp/core';
import type { FastifyInstance } from 'fastify';
import { HttpError, requireUser } from '../app';
import { isoDate, many, one, tx } from '../db';
import { districtPoint, medByPet, PET_COLS, petEligibility, petView, type PetRow } from '../services/pets';
import { award } from '../services/xp';

const MED_KINDS = ['vac', 'rab', 'tick', 'worm', 'check'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(v: unknown, now: Date): string | null {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  const d = new Date(v + 'T00:00:00');
  if (Number.isNaN(d.getTime()) || v > isoDate(now) || v < '1995-01-01') return null;
  return v;
}

interface PetInput {
  species: Species;
  name: string;
  breed: string;
  birthDate: string | null;
  weightKg: number | null;
  bloodGroup: string;
  district: string;
  outdoor: boolean;
  chronic: boolean;
  donorEnabled: boolean;
}

function parsePet(b: Record<string, unknown>, now: Date, base?: PetInput): PetInput {
  const fields: Record<string, string> = {};
  const pick = <K extends keyof PetInput>(k: K): unknown => (b[k] !== undefined ? b[k] : base?.[k]);

  const species = pick('species');
  if (species !== 'dog' && species !== 'cat') fields.species = 'Выберите: собака или кошка';
  const name = typeof pick('name') === 'string' ? (pick('name') as string).trim().slice(0, 40) : '';
  if (!name) fields.name = 'Укажите кличку';
  const birthRaw = pick('birthDate');
  const birthDate = birthRaw === null || birthRaw === '' || birthRaw === undefined ? null : validDate(birthRaw, now);
  if (birthRaw && !birthDate) fields.birthDate = 'Проверьте дату рождения';
  const weightRaw = pick('weightKg');
  const weightKg = weightRaw === null || weightRaw === '' || weightRaw === undefined ? null : parseKg(weightRaw);
  if (weightKg !== null && (weightKg <= 0 || weightKg > 120)) fields.weightKg = 'Проверьте вес';
  const bloodGroup = typeof pick('bloodGroup') === 'string' ? (pick('bloodGroup') as string) : 'unknown';
  if ((species === 'dog' || species === 'cat') && !isBloodGroupFor(species, bloodGroup)) fields.bloodGroup = 'Неизвестная группа крови';
  const district = pick('district');
  if (!isDistrict(district)) fields.district = 'Выберите район';

  if (Object.keys(fields).length) throw new HttpError(400, 'Проверьте поля', fields);
  return {
    species: species as Species,
    name,
    breed: typeof pick('breed') === 'string' ? (pick('breed') as string).trim().slice(0, 60) : '',
    birthDate,
    weightKg,
    bloodGroup,
    district: district as string,
    outdoor: pick('outdoor') === true,
    chronic: pick('chronic') === true,
    donorEnabled: pick('donorEnabled') !== false,
  };
}

export async function petRoutes(app: FastifyInstance) {
  const { pool } = app.deps;
  const now = () => app.deps.now();

  async function ownPet(userId: string, petId: string): Promise<PetRow> {
    const p = await one<PetRow>(pool, `SELECT ${PET_COLS} FROM pets WHERE id = $1 AND owner_id = $2`, [petId, userId]).catch(() => null);
    if (!p) throw new HttpError(404, 'Питомец не найден');
    return p;
  }

  async function view(p: PetRow) {
    const med = (await medByPet(pool, [p.id])).get(p.id)!;
    return petView(p, med, now());
  }

  app.get('/', async (req) => {
    const user = requireUser(req);
    const pets = await many<PetRow>(pool, `SELECT ${PET_COLS} FROM pets WHERE owner_id = $1 ORDER BY created_at`, [user.id]);
    const med = await medByPet(
      pool,
      pets.map((p) => p.id),
    );
    return pets.map((p) => petView(p, med.get(p.id)!, now()));
  });

  app.post<{ Body: Record<string, unknown> }>('/', async (req) => {
    const user = requireUser(req);
    const v = parsePet(req.body ?? {}, now());
    const vaccinations = Array.isArray(req.body?.med) ? (req.body.med as unknown[]) : [];
    const pet = await tx(pool, async (c) => {
      const id = (await one<{ id: string }>(c, 'SELECT gen_random_uuid() AS id'))!.id;
      const [lat, lng] = districtPoint(v.district, id);
      const p = (await one<PetRow>(
        c,
        `INSERT INTO pets (id, owner_id, species, name, breed, birth_date, weight_kg, blood_group, district, location, outdoor, chronic, donor_enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ST_SetSRID(ST_MakePoint($11, $10), 4326)::geography, $12, $13, $14)
         RETURNING ${PET_COLS}`,
        [id, user.id, v.species, v.name, v.breed, v.birthDate, v.weightKg, v.bloodGroup, v.district, lat, lng, v.outdoor, v.chronic, v.donorEnabled],
      ))!;
      // Прививки можно передать сразу с анкетой донора.
      for (const m of vaccinations) {
        const r = m as { kind?: string; date?: unknown };
        const date = validDate(r.date, now());
        if ((r.kind === 'vac' || r.kind === 'rab') && date) {
          await c.query('INSERT INTO med_records (pet_id, kind, date) VALUES ($1, $2, $3)', [p.id, r.kind, date]);
        }
      }
      const med = (await medByPet(c, [p.id])).get(p.id)!;
      if (p.donor_enabled && petEligibility(p, med, now()).fit) await award(c, user.id, 'newDonorPet', p.id);
      return p;
    });
    return view(pet);
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/:id', async (req) => {
    const user = requireUser(req);
    const cur = await ownPet(user.id, req.params.id);
    const base: PetInput = {
      species: cur.species,
      name: cur.name,
      breed: cur.breed,
      birthDate: cur.birth_date,
      weightKg: cur.weight_kg,
      bloodGroup: cur.blood_group,
      district: cur.district,
      outdoor: cur.outdoor,
      chronic: cur.chronic,
      donorEnabled: cur.donor_enabled,
    };
    const v = parsePet(req.body ?? {}, now(), base);
    const [lat, lng] = districtPoint(v.district, cur.id);
    const p = (await one<PetRow>(
      pool,
      `UPDATE pets SET species = $2, name = $3, breed = $4, birth_date = $5, weight_kg = $6, blood_group = $7, district = $8,
         location = ST_SetSRID(ST_MakePoint($10, $9), 4326)::geography, outdoor = $11, chronic = $12, donor_enabled = $13
       WHERE id = $1 RETURNING ${PET_COLS}`,
      [cur.id, v.species, v.name, v.breed, v.birthDate, v.weightKg, v.bloodGroup, v.district, lat, lng, v.outdoor, v.chronic, v.donorEnabled],
    ))!;
    return view(p);
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    const user = requireUser(req);
    const p = await ownPet(user.id, req.params.id);
    const busy = await one(pool, `SELECT 1 FROM responses WHERE pet_id = $1 AND status = 'chosen'`, [p.id]);
    if (busy) throw new HttpError(409, 'Питомец сейчас выбран донором. Сначала завершите или отмените поездку');
    await pool.query('DELETE FROM pets WHERE id = $1', [p.id]);
    return { ok: true };
  });

  // Медкарта: прививки, обработки, анализы.
  app.post<{ Params: { id: string }; Body: { kind?: string; date?: string; note?: string } }>('/:id/med', async (req) => {
    const user = requireUser(req);
    const p = await ownPet(user.id, req.params.id);
    const kind = req.body?.kind;
    const date = validDate(req.body?.date, now());
    if (!MED_KINDS.includes(kind as (typeof MED_KINDS)[number])) throw new HttpError(400, 'Неизвестный тип записи');
    if (!date) throw new HttpError(400, 'Проверьте дату', { date: 'Дата не может быть в будущем' });
    const rec = (await one<{ id: string }>(pool, 'INSERT INTO med_records (pet_id, kind, date, note) VALUES ($1, $2, $3, $4) RETURNING id', [
      p.id,
      kind,
      date,
      String(req.body?.note ?? '').slice(0, 300),
    ]))!;
    await award(pool, user.id, 'medMark', rec.id);
    return view(p);
  });

  app.delete<{ Params: { id: string; medId: string } }>('/:id/med/:medId', async (req) => {
    const user = requireUser(req);
    const p = await ownPet(user.id, req.params.id);
    await pool.query('DELETE FROM med_records WHERE id = $1 AND pet_id = $2', [req.params.medId, p.id]);
    return view(p);
  });

  /**
   * Сдача крови вне Павхелпа. Дата учитывается сразу, чтобы не присылать SOS раньше срока,
   * а капли начисляются только после подтверждения клиникой.
   */
  app.post<{ Params: { id: string }; Body: { date?: string; clinicId?: string } }>('/:id/donations', async (req) => {
    const user = requireUser(req);
    const p = await ownPet(user.id, req.params.id);
    const date = validDate(req.body?.date, now());
    if (!date) throw new HttpError(400, 'Проверьте дату', { date: 'Дата не может быть в будущем' });
    const clinicId = req.body?.clinicId ?? null;
    if (clinicId && !(await one(pool, 'SELECT 1 FROM clinics WHERE id = $1', [clinicId]))) throw new HttpError(400, 'Неизвестная клиника');
    await tx(pool, async (c) => {
      await c.query('INSERT INTO donations (pet_id, clinic_id, date) VALUES ($1, $2, $3)', [p.id, clinicId, date]);
      await c.query('UPDATE pets SET last_donation = greatest(coalesce(last_donation, $2::date), $2::date) WHERE id = $1', [p.id, date]);
    });
    const fresh = await ownPet(user.id, p.id);
    return { pet: await view(fresh), pendingConfirmation: true };
  });
}
