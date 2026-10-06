'use client';
import { areaLabel, BLOOD_GROUP_LABEL, BLOOD_GROUPS, cityAreas, CITIES, eligibility, parseKg, type BloodGroup, type Species } from '@pavhelp/core';
import { useState } from 'react';
import { EligibilityList, Field, Seg } from './ui';
import { today } from '@/lib/format';

export interface PetFormValue {
  species: Species;
  name: string;
  breed: string;
  birthDate: string;
  weightKg: string;
  bloodGroup: BloodGroup;
  city: string;
  district: string;
  outdoor: boolean;
  chronic: boolean;
  donorEnabled: boolean;
  sex: '' | 'm' | 'f';
  chip: string;
  housing: '' | 'flat' | 'house' | 'aviary';
  underTreatment: boolean;
  transfused: boolean;
  vacDate: string;
  rabDate: string;
  lastDonation: string;
}

export const emptyPet = (city: string, district?: string | null): PetFormValue => ({
  species: 'dog',
  name: '',
  breed: '',
  birthDate: '',
  weightKg: '',
  bloodGroup: 'unknown',
  city,
  district: district && district in cityAreas(city) ? district : (Object.keys(cityAreas(city))[0] ?? ''),
  outdoor: false,
  chronic: false,
  donorEnabled: true,
  sex: '',
  chip: '',
  housing: '',
  underTreatment: false,
  transfused: false,
  vacDate: '',
  rabDate: '',
  lastDonation: '',
});

const asDate = (s: string) => (s ? new Date(s + 'T00:00:00') : null);

/** Анкета питомца с живой проверкой требований к донору — те же правила, что на сервере. */
export function PetForm({
  initial,
  withMed,
  knownVaccinations = [],
  submitLabel,
  busy,
  errors,
  onSubmit,
}: {
  initial: PetFormValue;
  withMed: boolean;
  /** Прививки из медкарты: для проверки требований при редактировании. */
  knownVaccinations?: { kind: 'vac' | 'rab'; date: string }[];
  submitLabel: string;
  busy: boolean;
  errors: Record<string, string>;
  onSubmit: (v: PetFormValue) => void;
}) {
  const [f, setF] = useState(initial);
  const set = <K extends keyof PetFormValue>(k: K, v: PetFormValue[K]) =>
    setF((f) => ({
      ...f,
      [k]: v,
      ...(k === 'species' ? { bloodGroup: 'unknown' as BloodGroup } : {}),
      // Районы у городов разные: при смене города берём первый район нового.
      ...(k === 'city' ? { district: Object.keys(cityAreas(v as string))[0] ?? '' } : {}),
    }));

  const e = eligibility({
    species: f.species,
    birthDate: asDate(f.birthDate),
    weightKg: parseKg(f.weightKg),
    chronic: f.chronic,
    outdoor: f.outdoor,
    underTreatment: f.underTreatment,
    transfused: f.transfused,
    lastDonation: asDate(f.lastDonation),
    vaccinations: withMed
      ? [
          ...(f.vacDate ? [{ kind: 'vac' as const, date: asDate(f.vacDate)! }] : []),
          ...(f.rabDate ? [{ kind: 'rab' as const, date: asDate(f.rabDate)! }] : []),
        ]
      : knownVaccinations.map((v) => ({ kind: v.kind, date: asDate(v.date)! })),
  });

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        onSubmit(f);
      }}
    >
      <Seg label="Вид" value={f.species} onChange={(v) => set('species', v)} options={[['dog', 'Собака'], ['cat', 'Кошка']]} />
      <Field id="p-name" label="Кличка" error={errors.name}>
        <input id="p-name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} />
      </Field>
      <Field id="p-breed" label="Порода">
        <input id="p-breed" className="input" value={f.breed} onChange={(e) => set('breed', e.target.value)} placeholder="Метис" />
      </Field>
      <Field id="p-birth" label="Дата рождения" error={errors.birthDate}>
        <input id="p-birth" className="input" type="date" max={today()} value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
      </Field>
      <Field id="p-weight" label="Вес, кг" error={errors.weightKg}>
        <input id="p-weight" className="input" inputMode="decimal" value={f.weightKg} onChange={(e) => set('weightKg', e.target.value)} />
      </Field>
      <div className="field">
        <span className="flabel">Группа крови</span>
        <Seg
          label="Группа крови"
          value={f.bloodGroup}
          onChange={(v) => set('bloodGroup', v)}
          options={BLOOD_GROUPS[f.species].map((g) => [g, BLOOD_GROUP_LABEL[g]] as [BloodGroup, string])}
        />
      </div>
      <Field id="p-city" label="Город" error={errors.city}>
        <select id="p-city" className="input" value={f.city} onChange={(e) => set('city', e.target.value)}>
          {CITIES.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="p-district" label="Район (точный адрес не нужен и никому не показывается)" error={errors.district}>
        <select id="p-district" className="input" value={f.district} onChange={(e) => set('district', e.target.value)}>
          {Object.keys(cityAreas(f.city)).map((d) => (
            <option key={d} value={d}>
              {areaLabel(f.city, d)}
            </option>
          ))}
        </select>
      </Field>
      <div className="field">
        <span className="flabel">Пол</span>
        <Seg label="Пол" value={f.sex} onChange={(v) => set('sex', v)} options={[['m', f.species === 'dog' ? 'Кобель' : 'Кот'], ['f', f.species === 'dog' ? 'Сука' : 'Кошка']]} />
      </div>
      <Field id="p-chip" label="Номер чипа (15 цифр, необязательно)" error={errors.chip}>
        <input id="p-chip" className="input" inputMode="numeric" maxLength={15} value={f.chip} onChange={(e) => set('chip', e.target.value.replace(/\D/g, ''))} />
      </Field>
      <div className="field">
        <span className="flabel">Где живёт</span>
        <Seg
          label="Условия содержания"
          value={f.housing}
          onChange={(v) => set('housing', v)}
          options={[
            ['flat', 'Квартира'],
            ['house', 'Дом'],
            ['aviary', 'Вольер'],
          ]}
        />
      </div>
      {withMed && (
        <>
          <Field id="p-vac" label="Последняя комплексная прививка">
            <input id="p-vac" className="input" type="date" max={today()} value={f.vacDate} onChange={(e) => set('vacDate', e.target.value)} />
          </Field>
          <Field id="p-rab" label="Последняя прививка от бешенства">
            <input id="p-rab" className="input" type="date" max={today()} value={f.rabDate} onChange={(e) => set('rabDate', e.target.value)} />
          </Field>
          <Field id="p-last" label="Последняя сдача крови, если была">
            <input id="p-last" className="input" type="date" max={today()} value={f.lastDonation} onChange={(e) => set('lastDonation', e.target.value)} />
          </Field>
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={!f.chronic} onChange={(e) => set('chronic', !e.target.checked)} />
        <span>Нет хронических болезней</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={!f.underTreatment} onChange={(e) => set('underTreatment', !e.target.checked)} />
        <span>Сейчас не лечится, лекарства не принимает</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={!f.transfused} onChange={(e) => set('transfused', !e.target.checked)} />
        <span>Никогда не получал(а) переливание крови</span>
      </label>
      {f.species === 'cat' && (
        <label className="check">
          <input type="checkbox" checked={!f.outdoor} onChange={(e) => set('outdoor', !e.target.checked)} />
          <span>Живёт дома, не гуляет на улице</span>
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={f.donorEnabled} onChange={(e) => set('donorEnabled', e.target.checked)} />
        <span>Получать SOS-запросы: готов(а) помогать</span>
      </label>

      {f.donorEnabled && (
        <div className="card stack" aria-live="polite">
          <b>{e.fit ? `${f.name || 'Питомец'} может стать донором` : 'Требования к донору'}</b>
          <EligibilityList e={e} />
        </div>
      )}
      <button className="btn primary wide" disabled={busy}>
        {busy ? 'Сохраняем…' : submitLabel}
      </button>
    </form>
  );
}
