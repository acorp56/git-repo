'use client';
// «Кровь в наличии»: подходящие позиции банков крови клиник.
import { BLOOD_GROUP_LABEL, COMPONENT_LABEL, plural, type BloodGroup, type Component, type Species } from '@pavhelp/core';
import { useEffect, useState } from 'react';
import { api, type BankOffer } from '@/lib/api';
import { ago } from '@/lib/format';

const tel = (p: string) => `tel:${p.replace(/[^+\d]/g, '')}`;

export function useBanks(q: { city: string; species: Species; bloodGroup: BloodGroup; component: Component; clinicId?: string }) {
  const [offers, setOffers] = useState<BankOffer[] | null>(null);
  const key = `${q.city}|${q.species}|${q.bloodGroup}|${q.component}|${q.clinicId ?? ''}`;
  useEffect(() => {
    const p = new URLSearchParams({ city: q.city, species: q.species, bloodGroup: q.bloodGroup, component: q.component });
    if (q.clinicId) p.set('clinicId', q.clinicId);
    api<BankOffer[]>(`/banks?${p}`)
      .then(setOffers)
      .catch(() => setOffers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return offers;
}

export function BankBlock({ offers, need }: { offers: BankOffer[] | null; need: { species: Species; bloodGroup: BloodGroup; component: Component } }) {
  if (offers === null) return null;
  if (!offers.length) {
    return (
      <div className="bank none">
        <div className="row between">
          <b>Кровь в наличии</b>
          <span className="small muted">банки клиник</span>
        </div>
        <span className="small">
          В банках крови клиник рядом нет подходящего: {COMPONENT_LABEL[need.component].toLowerCase()}, {need.species === 'dog' ? 'собака' : 'кошка'}
          {need.bloodGroup !== 'unknown' ? `, ${BLOOD_GROUP_LABEL[need.bloodGroup]}` : ''}. Ищем донора.
        </span>
      </div>
    );
  }
  return (
    <div className="bank">
      <div className="row between">
        <b>Кровь в наличии</b>
        <span className="chip ok">
          {offers.length} {plural(offers.length, 'вариант', 'варианта', 'вариантов')}
        </span>
      </div>
      <span className="small">Готовая кровь быстрее донора. Позвоните и попросите отложить дозу, а запрос донорам всё равно отправьте: банк могут исчерпать.</span>
      {offers.slice(0, 3).map((o) => (
        <div className="bank-row" key={o.clinicId + o.bloodGroup + o.component}>
          <div className="grow stack" style={{ gap: 2 }}>
            <b>{o.clinicName}</b>
            <span className="small muted">
              {COMPONENT_LABEL[o.component]}, {BLOOD_GROUP_LABEL[o.bloodGroup]} · {o.doses} {plural(o.doses, 'доза', 'дозы', 'доз')} по {o.doseMl} мл
              {o.km !== null && ` · ${o.km.toFixed(1).replace('.', ',')} км`}
            </span>
            {o.check && <span className="small muted">Группу вашего питомца клиника проверит перед переливанием</span>}
            <span className="small muted">обновлено {ago(o.updatedAt)}</span>
          </div>
          <a className="btn" href={tel(o.clinicPhone)}>
            Позвонить
          </a>
        </div>
      ))}
    </div>
  );
}
