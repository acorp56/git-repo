// Справочник клиник из прототипа. Координаты — центры районов, телефоны — заглушки: перед запуском заменить на реальные.
import type pg from 'pg';
import { DISTRICT_CENTER } from '@krovinka/core';
import { config } from './config';
import { createPool } from './db';
import { migrate } from './migrate';

export const CLINICS = [
  { id: 'c1', name: 'Ветклиника «Северный ветер»', district: 'Петроградский', night: true, phone: '+7 812 000-11-01', bank: true },
  { id: 'c2', name: 'Ветцентр на Охте', district: 'Красногвардейский', night: true, phone: '+7 812 000-11-02', bank: true },
  { id: 'c4', name: 'Ветгоспиталь «Приморский»', district: 'Приморский', night: true, phone: '+7 812 000-11-04', bank: false },
  { id: 'c3', name: 'Клиника «Лапа и хвост»', district: 'Московский', night: false, phone: '+7 812 000-11-03', bank: false },
  { id: 'c5', name: 'Ветклиника на Васильевском', district: 'Василеостровский', night: false, phone: '+7 812 000-11-05', bank: false },
];

export async function seedClinics(pool: pg.Pool): Promise<void> {
  for (const c of CLINICS) {
    const [lat, lng] = DISTRICT_CENTER[c.district]!;
    await pool.query(
      `INSERT INTO clinics (id, name, address, district, location, phone, night, blood_bank)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET name = $2, address = $3, district = $4, location = excluded.location,
         phone = $7, night = $8, blood_bank = $9`,
      [c.id, c.name, `${c.district} р-н`, c.district, lat, lng, c.phone, c.night, c.bank],
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool(config.databaseUrl);
  await migrate(pool);
  await seedClinics(pool);
  console.log(`клиник: ${CLINICS.length}`);
  await pool.end();
}
