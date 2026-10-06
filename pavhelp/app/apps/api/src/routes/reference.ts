import { COMPONENTS, DEFAULT_CITY, GUIDES, isBloodGroupFor, isCity, redFlagResult, ruleResult, FALLBACK_QUESTIONS, type Component } from '@pavhelp/core';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../app';
import { many, one } from '../db';
import { bankOffers } from '../services/banks';

export interface ClinicRow {
  id: string;
  name: string;
  address: string;
  city: string;
  district: string;
  phone: string;
  night: boolean;
  blood_bank: boolean;
  lat: number;
  lng: number;
}

export const CLINIC_COLS =
  'id, name, address, city, district, phone, night, blood_bank, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng';

export const clinicView = (c: ClinicRow) => ({
  id: c.id,
  name: c.name,
  address: c.address,
  city: c.city,
  district: c.district,
  phone: c.phone,
  night: c.night,
  bloodBank: c.blood_bank,
  lat: c.lat,
  lng: c.lng,
});

export async function referenceRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { city?: string } }>('/clinics', async (req) => {
    const city = isCity(req.query.city) ? req.query.city : DEFAULT_CITY;
    const rows = await many<ClinicRow>(app.deps.pool, `SELECT ${CLINIC_COLS} FROM clinics WHERE city = $1 ORDER BY night DESC, name`, [city]);
    return rows.map(clinicView);
  });

  // Кровь в наличии в банках клиник города: для формы SOS и раздела «Экстренно».
  app.get<{ Querystring: { city?: string; species?: string; bloodGroup?: string; component?: string; clinicId?: string } }>(
    '/banks',
    async (req) => {
      const q = req.query;
      const species = q.species === 'cat' ? 'cat' : q.species === 'dog' ? 'dog' : null;
      if (!species) throw new HttpError(400, 'Укажите вид');
      const bloodGroup = q.bloodGroup && isBloodGroupFor(species, q.bloodGroup) ? q.bloodGroup : 'unknown';
      const component = COMPONENTS.includes(q.component as Component) ? (q.component as Component) : 'whole';
      return bankOffers(app.deps.pool, {
        species,
        bloodGroup,
        component,
        city: isCity(q.city) ? q.city : DEFAULT_CITY,
        nearClinicId: q.clinicId ?? null,
      });
    },
  );

  app.get('/guides', async () => GUIDES);

  // Счётчик доноров города: для карточки «Павхелп в N только начинается».
  app.get<{ Querystring: { city?: string } }>('/stats/city', async (req) => {
    const city = isCity(req.query.city) ? req.query.city : DEFAULT_CITY;
    const r = await one<{ donors: number; clinics: number }>(
      app.deps.pool,
      `SELECT (SELECT count(*)::int FROM pets p JOIN users u ON u.id = p.owner_id
                WHERE p.city = $1 AND p.donor_enabled AND p.deceased_at IS NULL AND u.deleted_at IS NULL) AS donors,
              (SELECT count(*)::int FROM clinics WHERE city = $1) AS clinics`,
      [city],
    );
    return { city, ...r!, goal: 50 };
  });

  /**
   * Симптом-чекер без ИИ: тревожные признаки → «срочно», иначе уточняющие вопросы и вердикт по правилам.
   * TODO: вызов YandexGPT или GigaChat через свой прокси (152-ФЗ) между этими шагами, с cleanResult() на ответ.
   */
  app.post<{ Body: { text?: string; answers?: string[] } }>('/check', async (req) => {
    const text = String(req.body?.text ?? '').slice(0, 1500);
    const red = redFlagResult(text);
    if (red) return { result: red };
    const answers = Array.isArray(req.body?.answers) ? req.body.answers.map(String) : null;
    if (!answers || answers.length < FALLBACK_QUESTIONS.length) return { questions: FALLBACK_QUESTIONS };
    return { result: ruleResult(answers) };
  });
}
