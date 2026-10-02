import { BLOOD_GROUP_LABEL, type BloodGroup } from '@pavhelp/core';

export const kg = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${String(v).replace('.', ',')} кг`);
export const group = (g: BloodGroup) => (g === 'unknown' ? 'группа неизвестна' : `группа ${BLOOD_GROUP_LABEL[g]}`);

export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export const fmtDate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
export const today = () => new Date().toLocaleDateString('sv-SE');
