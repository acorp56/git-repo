import { cityAreas, cityByName, eligibility, type BloodGroup, type Eligibility, type LatLng, type Species } from '@pavhelp/core';
import { many, parseDate, type Db } from '../db';

export interface PetRow {
  id: string;
  owner_id: string;
  species: Species;
  name: string;
  breed: string;
  birth_date: string | null;
  weight_kg: number | null;
  blood_group: BloodGroup;
  city: string;
  district: string;
  outdoor: boolean;
  chronic: boolean;
  donor_enabled: boolean;
  photo_url: string | null;
  last_donation: string | null;
  sex: 'm' | 'f' | null;
  chip: string | null;
  housing: 'flat' | 'house' | 'aviary' | null;
  under_treatment: boolean;
  transfused: boolean;
  paused_until: Date | null;
  deceased_at: Date | null;
}

export interface MedRow {
  id: string;
  pet_id: string;
  kind: 'vac' | 'rab' | 'tick' | 'worm' | 'check';
  date: string;
  note: string;
}

export const PET_COLS =
  'id, owner_id, species, name, breed, birth_date, weight_kg, blood_group, city, district, outdoor, chronic, donor_enabled, photo_url, ' +
  'last_donation, sex, chip, housing, under_treatment, transfused, paused_until, deceased_at';

export const isPaused = (p: Pick<PetRow, 'paused_until'>, now: Date) => !!p.paused_until && p.paused_until > now;

export function petEligibility(p: PetRow, med: MedRow[], now: Date): Eligibility {
  return eligibility(
    {
      species: p.species,
      birthDate: parseDate(p.birth_date),
      weightKg: p.weight_kg,
      chronic: p.chronic,
      outdoor: p.outdoor,
      underTreatment: p.under_treatment,
      transfused: p.transfused,
      lastDonation: parseDate(p.last_donation),
      vaccinations: med
        .filter((m): m is MedRow & { kind: 'vac' | 'rab' } => m.kind === 'vac' || m.kind === 'rab')
        .map((m) => ({ kind: m.kind, date: parseDate(m.date)! })),
    },
    now,
  );
}

export async function medByPet(db: Db, petIds: string[]): Promise<Map<string, MedRow[]>> {
  const map = new Map<string, MedRow[]>(petIds.map((id) => [id, []]));
  if (!petIds.length) return map;
  const rows = await many<MedRow>(db, 'SELECT id, pet_id, kind, date, note FROM med_records WHERE pet_id = ANY($1) ORDER BY date DESC', [petIds]);
  for (const r of rows) map.get(r.pet_id)?.push(r);
  return map;
}

/**
 * Точка питомца на карте: центр района со стабильным сдвигом до ~1 км.
 * Точный адрес не храним: для поиска по радиусу хватает района.
 */
export function districtPoint(city: string, district: string, seed: string): LatLng {
  const c = cityAreas(city)[district] ?? cityByName(city)?.center;
  if (!c) throw new Error(`Неизвестный город: ${city}`);
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return [c[0] + ((h % 100) / 100) * 0.018 - 0.009, c[1] + (((h >> 7) % 100) / 100) * 0.03 - 0.015];
}

/** То, что видит владелец питомца. */
export function petView(p: PetRow, med: MedRow[], now: Date) {
  return {
    id: p.id,
    species: p.species,
    name: p.name,
    breed: p.breed,
    birthDate: p.birth_date,
    weightKg: p.weight_kg,
    bloodGroup: p.blood_group,
    city: p.city,
    district: p.district,
    sex: p.sex,
    chip: p.chip,
    housing: p.housing,
    underTreatment: p.under_treatment,
    transfused: p.transfused,
    pausedUntil: isPaused(p, now) ? p.paused_until : null,
    deceased: p.deceased_at !== null,
    outdoor: p.outdoor,
    chronic: p.chronic,
    donorEnabled: p.donor_enabled,
    photoUrl: p.photo_url,
    lastDonation: p.last_donation,
    med: med.map((m) => ({ id: m.id, kind: m.kind, date: m.date, note: m.note })),
    eligibility: petEligibility(p, med, now),
  };
}
