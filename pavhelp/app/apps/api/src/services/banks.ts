// Кровь в наличии в банках клиник. Правило совместимости — stockMatch() из @pavhelp/core.
import { stockMatch, type BloodGroup, type Component, type Species } from '@pavhelp/core';
import { many, type Db } from '../db';

export interface BankOffer {
  clinicId: string;
  clinicName: string;
  clinicPhone: string;
  address: string;
  bloodGroup: BloodGroup;
  component: Component;
  doses: number;
  doseMl: number;
  /** Группа реципиента неизвестна: клиника проверит совместимость перед переливанием. */
  check: boolean;
  km: number | null;
  updatedAt: Date;
}

/** Подходящие позиции банков крови в городе, ближайшие к клинике запроса (или просто по городу). */
export async function bankOffers(
  db: Db,
  need: { species: Species; bloodGroup: BloodGroup; component: Component; city: string; nearClinicId?: string | null },
): Promise<BankOffer[]> {
  const rows = await many<{
    clinic_id: string;
    name: string;
    phone: string;
    address: string;
    species: Species;
    blood_group: BloodGroup;
    component: Component;
    doses: number;
    dose_ml: number;
    updated_at: Date;
    km: number | null;
  }>(
    db,
    `SELECT s.clinic_id, c.name, c.phone, c.address, s.species, s.blood_group, s.component, s.doses, s.dose_ml, s.updated_at,
            CASE WHEN $3::text IS NULL THEN NULL ELSE ST_Distance(c.location, (SELECT location FROM clinics WHERE id = $3)) / 1000 END AS km
     FROM blood_stock s JOIN clinics c ON c.id = s.clinic_id
     WHERE c.city = $1 AND c.blood_bank AND s.species = $2 AND s.doses > 0
       AND (s.expires_on IS NULL OR s.expires_on >= current_date)`,
    [need.city, need.species, need.nearClinicId ?? null],
  );
  return rows
    .map((r) => ({ r, m: stockMatch(need, { species: r.species, bloodGroup: r.blood_group, component: r.component, doses: r.doses }) }))
    .filter(({ m }) => m.ok)
    .map(({ r, m }) => ({
      clinicId: r.clinic_id,
      clinicName: r.name,
      clinicPhone: r.phone,
      address: r.address,
      bloodGroup: r.blood_group,
      component: r.component,
      doses: r.doses,
      doseMl: r.dose_ml,
      check: m.check,
      km: r.km,
      updatedAt: r.updated_at,
    }))
    .sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
}
