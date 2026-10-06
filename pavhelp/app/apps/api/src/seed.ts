// Демо-справочник клиник и банков крови из прототипа. Перед запуском заменить на реальные клиники каждого города:
// координаты — центры районов, телефоны — заглушки.
import type pg from 'pg';
import { cityAreas, cityByName, type BloodGroup, type Component, type Species } from '@pavhelp/core';
import { config } from './config';
import { createPool } from './db';
import { migrate } from './migrate';

type Stock = [Species, BloodGroup, Component, doses: number, doseMl: number];

const TEMPLATE: { n: string; name: string; area: number; night: boolean; bank: boolean; stock: Stock[] }[] = [
  {
    n: '01',
    name: 'Ветклиника «Северный ветер»',
    area: 8,
    night: true,
    bank: true,
    stock: [
      ['dog', 'DEA1.1+', 'whole', 3, 450],
      ['dog', 'DEA1.1+', 'plasma', 4, 200],
      ['dog', 'DEA1.1-', 'rbc', 1, 250],
      ['cat', 'A', 'whole', 2, 50],
    ],
  },
  {
    n: '02',
    name: 'Ветцентр «Айболит 24»',
    area: 5,
    night: true,
    bank: true,
    stock: [
      ['dog', 'DEA1.1-', 'whole', 1, 450],
      ['dog', 'DEA1.1+', 'rbc', 2, 250],
      ['cat', 'A', 'plasma', 2, 30],
      ['cat', 'B', 'whole', 1, 50],
    ],
  },
  { n: '04', name: 'Ветгоспиталь «Доктор Вет»', area: 9, night: true, bank: false, stock: [] },
  { n: '03', name: 'Клиника «Лапа и хвост»', area: 6, night: false, bank: true, stock: [['dog', 'DEA1.1+', 'plasma', 3, 200]] },
  { n: '05', name: 'Ветклиника «Зоовет»', area: 1, night: false, bank: false, stock: [] },
];

/** Демо-клиники заведены в Петербурге и Москве. В остальных городах клиник пока нет. */
export const DEMO_CITIES: [prefix: string, city: string][] = [
  ['c', 'Санкт-Петербург'],
  ['m', 'Москва'],
];

export async function seedClinics(pool: pg.Pool): Promise<void> {
  for (const [prefix, cityName] of DEMO_CITIES) {
    const city = cityByName(cityName)!;
    const areas = Object.entries(cityAreas(cityName));
    for (const t of TEMPLATE) {
      const id = prefix + Number(t.n);
      const [area, [lat, lng]] = areas[t.area % areas.length]!;
      await pool.query(
        `INSERT INTO clinics (id, name, address, city, district, location, phone, night, blood_bank)
         VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET name = $2, address = $3, city = $4, district = $5, location = excluded.location,
           phone = $8, night = $9, blood_bank = $10`,
        [id, t.name, cityName === 'Москва' ? area : `${area} р-н`, cityName, area, lat, lng, `+7 ${city.phoneCode} 000-11-${t.n}`, t.night, t.bank],
      );
      await pool.query('DELETE FROM blood_stock WHERE clinic_id = $1', [id]);
      for (const [species, group, component, doses, ml] of t.stock) {
        await pool.query(
          'INSERT INTO blood_stock (clinic_id, species, blood_group, component, doses, dose_ml) VALUES ($1, $2, $3, $4, $5, $6)',
          [id, species, group, component, doses, ml],
        );
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool(config.databaseUrl);
  await migrate(pool);
  await seedClinics(pool);
  console.log(`клиник: ${TEMPLATE.length * DEMO_CITIES.length}`);
  await pool.end();
}
