import { GUIDES, redFlagResult, ruleResult, FALLBACK_QUESTIONS } from '@pavhelp/core';
import type { FastifyInstance } from 'fastify';
import { many } from '../db';

export interface ClinicRow {
  id: string;
  name: string;
  address: string;
  district: string;
  phone: string;
  night: boolean;
  blood_bank: boolean;
  lat: number;
  lng: number;
}

export const CLINIC_COLS =
  'id, name, address, district, phone, night, blood_bank, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng';

export const clinicView = (c: ClinicRow) => ({
  id: c.id,
  name: c.name,
  address: c.address,
  district: c.district,
  phone: c.phone,
  night: c.night,
  bloodBank: c.blood_bank,
  lat: c.lat,
  lng: c.lng,
});

export async function referenceRoutes(app: FastifyInstance) {
  app.get('/clinics', async () => {
    const rows = await many<ClinicRow>(app.deps.pool, `SELECT ${CLINIC_COLS} FROM clinics ORDER BY night DESC, name`);
    return rows.map(clinicView);
  });

  app.get('/guides', async () => GUIDES);

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
