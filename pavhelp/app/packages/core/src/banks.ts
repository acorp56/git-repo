// Кровь в наличии: что из банков крови клиник подходит под запрос. Перенесено из прототипа (bankMatch).
import type { BloodGroup, Component, Species } from './domain';

export interface StockItem {
  species: Species;
  bloodGroup: BloodGroup;
  component: Component;
  doses: number;
}

/**
 * Подходит ли позиция банка. Кошкам — та же группа; собаке DEA 1.1− — только DEA 1.1−.
 * При неизвестной группе реципиента предлагаем то, что безопаснее (у собак — DEA 1.1−),
 * с пометкой «клиника проверит совместимость».
 */
export function stockMatch(
  need: { species: Species; bloodGroup: BloodGroup; component: Component },
  s: StockItem,
): { ok: boolean; check: boolean } {
  const no = { ok: false, check: false };
  if (s.species !== need.species || s.doses <= 0 || s.component !== need.component) return no;
  if (need.bloodGroup === 'unknown') {
    if (need.species === 'cat') return { ok: true, check: true };
    return s.bloodGroup === 'DEA1.1-' ? { ok: true, check: true } : no;
  }
  if (need.species === 'cat') return s.bloodGroup === need.bloodGroup ? { ok: true, check: false } : no;
  if (need.bloodGroup === 'DEA1.1-') return s.bloodGroup === 'DEA1.1-' ? { ok: true, check: false } : no;
  return { ok: true, check: false };
}
