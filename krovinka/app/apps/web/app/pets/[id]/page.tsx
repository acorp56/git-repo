'use client';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { PetForm, type PetFormValue } from '@/components/pet-form';
import { Field, StateCard, Top, useRequireLogin } from '@/components/ui';
import { api, ApiError, type Clinic, type Pet } from '@/lib/api';
import { fmtDate, today } from '@/lib/format';
import { useSession } from '@/lib/session';

const MED_TITLES: Record<string, string> = {
  vac: 'Комплексная прививка',
  rab: 'Бешенство',
  tick: 'Обработка от клещей',
  worm: 'Обработка от глистов',
  check: 'Анализ крови (общий)',
};

export default function PetPage() {
  const { id } = useParams<{ id: string }>();
  const ready = useRequireLogin();
  const { reload } = useSession();
  const router = useRouter();
  const [pet, setPet] = useState<Pet | null>(null);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [med, setMed] = useState({ kind: 'vac', date: today() });
  const [donation, setDonation] = useState({ date: '', clinicId: '' });

  const load = useCallback(async () => {
    const pets = await api<Pet[]>('/pets');
    const p = pets.find((x) => x.id === id);
    if (!p) setError('Питомец не найден');
    setPet(p ?? null);
  }, [id]);

  useEffect(() => {
    if (!ready) return;
    load().catch((e: ApiError) => setError(e.message));
    api<Clinic[]>('/clinics').then(setClinics).catch(() => {});
  }, [ready, load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setNote('');
    setErrors({});
    try {
      await fn();
      await load();
      await reload();
      setNote(done);
    } catch (e) {
      setErrors((e as ApiError).fields);
      setNote((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <Top back="/profile" />;
  if (error) return (<><Top back="/profile" /><StateCard bad title="Не получилось" text={error} /></>);
  if (!pet) return (<><Top back="/profile" /><p className="muted">Загружаем…</p></>);

  const initial: PetFormValue = {
    species: pet.species,
    name: pet.name,
    breed: pet.breed,
    birthDate: pet.birthDate ?? '',
    weightKg: pet.weightKg === null ? '' : String(pet.weightKg).replace('.', ','),
    bloodGroup: pet.bloodGroup,
    district: pet.district,
    outdoor: pet.outdoor,
    chronic: pet.chronic,
    donorEnabled: pet.donorEnabled,
    vacDate: '',
    rabDate: '',
    lastDonation: pet.lastDonation ?? '',
  };
  const vaccinations = pet.med.filter((m) => m.kind === 'vac' || m.kind === 'rab') as { kind: 'vac' | 'rab'; date: string }[];

  return (
    <>
      <Top back="/profile" />
      <h1 className="page-title">{pet.name}</h1>
      {note && <p className="notice" role="status" style={{ marginBottom: 12 }}>{note}</p>}

      <section className="section">
        <h2>Медкарта</h2>
        <div className="card stack">
          {pet.med.length === 0 && <span className="muted small">Записей пока нет. Отметьте прививки — без них питомец не может быть донором.</span>}
          {pet.med.map((m) => (
            <div className="row between" key={m.id}>
              <span>
                {MED_TITLES[m.kind]}
                <br />
                <span className="small muted">{fmtDate(m.date)}</span>
              </span>
              <button className="link-btn" disabled={busy} onClick={() => run(() => api(`/pets/${pet.id}/med/${m.id}`, { method: 'DELETE' }), 'Запись удалена')}>
                Удалить
              </button>
            </div>
          ))}
        </div>
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api(`/pets/${pet.id}/med`, { body: med }), 'Запись добавлена, +5 капель');
          }}
        >
          <Field id="m-kind" label="Новая запись">
            <select id="m-kind" className="input" value={med.kind} onChange={(e) => setMed({ ...med, kind: e.target.value })}>
              {Object.entries(MED_TITLES).map(([k, t]) => (
                <option key={k} value={k}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field id="m-date" label="Дата" error={errors.date}>
            <input id="m-date" className="input" type="date" max={today()} value={med.date} onChange={(e) => setMed({ ...med, date: e.target.value })} />
          </Field>
          <button className="btn primary" disabled={busy}>
            Добавить
          </button>
        </form>
      </section>

      <section className="section">
        <h2>Сдача крови вне Кровинки</h2>
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => api(`/pets/${pet.id}/donations`, { body: { date: donation.date, clinicId: donation.clinicId || undefined } }),
              'Дату учли. Капли начислим, когда клиника подтвердит сдачу',
            );
          }}
        >
          <p className="small muted">Дата учитывается сразу, чтобы не присылать SOS раньше срока. Капли — после подтверждения клиникой.</p>
          <Field id="d-date" label="Дата сдачи">
            <input id="d-date" className="input" type="date" max={today()} value={donation.date} onChange={(e) => setDonation({ ...donation, date: e.target.value })} />
          </Field>
          <Field id="d-clinic" label="Клиника">
            <select id="d-clinic" className="input" value={donation.clinicId} onChange={(e) => setDonation({ ...donation, clinicId: e.target.value })}>
              <option value="">Другая</option>
              {clinics.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn" disabled={busy || !donation.date}>
            Отправить на подтверждение
          </button>
        </form>
      </section>

      <section className="section">
        <h2>Анкета</h2>
        <PetForm
          key={pet.id + pet.name + pet.donorEnabled}
          initial={initial}
          withMed={false}
          knownVaccinations={vaccinations}
          submitLabel="Сохранить изменения"
          busy={busy}
          errors={errors}
          onSubmit={(f) => run(() => api(`/pets/${pet.id}`, { method: 'PATCH', body: f }), 'Сохранено')}
        />
        <button
          className="link-btn"
          disabled={busy}
          onClick={async () => {
            if (!confirm(`Удалить ${pet.name} из профиля?`)) return;
            try {
              await api(`/pets/${pet.id}`, { method: 'DELETE' });
              await reload();
              router.push('/profile');
            } catch (e) {
              setNote((e as ApiError).message);
            }
          }}
        >
          Удалить питомца
        </button>
      </section>
    </>
  );
}
