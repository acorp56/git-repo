'use client';
import {
  BLOOD_GROUP_LABEL,
  BLOOD_GROUPS,
  COMPONENT_LABEL,
  COMPONENTS,
  validateSos,
  type BloodGroup,
  type Component,
  type FieldErrors,
  type Species,
  type Urgency,
} from '@pavhelp/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BankBlock, useBanks } from '@/components/banks';
import { Field, Seg, StateCard, Top, useRequireLogin } from '@/components/ui';
import { api, ApiError, type Clinic, type Pet } from '@/lib/api';
import { useCity } from '@/lib/city';
import { useSession } from '@/lib/session';

const PENDING_KEY = 'pavhelp.pendingSos';

interface Form {
  species: Species;
  petName: string;
  weightKg: string;
  bloodGroup: BloodGroup;
  component: Component;
  volumeMl: string;
  clinicId: string;
  urgency: Urgency;
  reason: string;
  /** Свой питомец, которому нужна кровь. */
  patientPetId: string;
}

const empty: Form = {
  species: 'dog',
  petName: '',
  weightKg: '',
  bloodGroup: 'unknown',
  component: 'whole',
  volumeMl: '',
  clinicId: '',
  urgency: 'now',
  reason: '',
  patientPetId: '',
};

/** Ответ сервера про лимиты: что показать и какие кнопки дать. */
interface Blocked {
  title: string;
  text: string;
  code: string;
  requestId?: string;
}

const BLOCK_TITLES: Record<string, string> = {
  duplicate: 'Такой запрос уже открыт',
  active_limit: 'Уже два активных запроса',
  day_limit: 'Дневной лимит запросов',
  frozen: 'Аккаунт временно заморожен',
};

export default function Sos() {
  const ready = useRequireLogin();
  const { me, reload } = useSession();
  const router = useRouter();
  const [city] = useCity();
  const [phone, setPhone] = useState('');
  const [phoneErr, setPhoneErr] = useState('');
  const [clinics, setClinics] = useState<Clinic[] | null>(null);
  const [pets, setPets] = useState<Pet[]>([]);
  const [f, setF] = useState<Form>(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [queued, setQueued] = useState(false);
  const banks = useBanks({ city, species: f.species, bloodGroup: f.bloodGroup, component: f.component, clinicId: f.clinicId || undefined });

  useEffect(() => {
    api<Clinic[]>(`/clinics?city=${encodeURIComponent(city)}`)
      .then((cs) => {
        setClinics(cs);
        setF((f) => (f.clinicId && cs.some((c) => c.id === f.clinicId) ? f : { ...f, clinicId: cs[0]?.id ?? '' }));
      })
      .catch(() => setClinics([]));
  }, [city]);

  useEffect(() => {
    if (ready) api<Pet[]>('/pets').then((ps) => setPets(ps.filter((p) => !p.deceased))).catch(() => {});
  }, [ready]);

  const send = useCallback(
    async (form: Form) => {
      setBusy(true);
      setFailed('');
      try {
        const r = await api<{ id: string }>('/requests', { body: { ...form, patientPetId: form.patientPetId || null } });
        try {
          localStorage.removeItem(PENDING_KEY);
        } catch {}
        router.push(`/requests/${r.id}`);
      } catch (e) {
        const err = e as ApiError;
        const code = String(err.data.code ?? '');
        if (err.status === 0) {
          // Нет сети: сохраняем запрос и отправим, как только связь вернётся.
          try {
            localStorage.setItem(PENDING_KEY, JSON.stringify(form));
          } catch {}
          setQueued(true);
        } else if (code) {
          setBlocked({ code, title: BLOCK_TITLES[code] ?? 'Не получилось', text: err.message, requestId: err.data.requestId as string | undefined });
        } else if (err.status === 400) setErrors(err.fields as FieldErrors);
        else setFailed(err.message);
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  // Отправка запроса из очереди при появлении сети.
  useEffect(() => {
    let pending: Form | null = null;
    try {
      pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null');
    } catch {}
    if (pending) {
      setF({ ...empty, ...pending });
      setQueued(true);
    }
    const flush = () => {
      try {
        const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null');
        if (p) void send(p);
      } catch {}
    };
    window.addEventListener('online', flush);
    if (pending && navigator.onLine) flush();
    return () => window.removeEventListener('online', flush);
  }, [send]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((f) => ({ ...f, [k]: v, ...(k === 'species' ? { bloodGroup: 'unknown' as BloodGroup, patientPetId: '' } : {}) }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  // Кровь нужна своему питомцу: подставляем кличку, вес и группу из профиля.
  const pickPatient = (id: string) => {
    const p = pets.find((x) => x.id === id);
    setF((f) =>
      p
        ? {
            ...f,
            patientPetId: p.id,
            species: p.species,
            petName: p.name,
            weightKg: p.weightKg ? String(p.weightKg).replace('.', ',') : f.weightKg,
            bloodGroup: p.bloodGroup,
          }
        : { ...f, patientPetId: '' },
    );
  };
  const patient = pets.find((p) => p.id === f.patientPetId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateSos({ ...f });
    if (!v.ok) {
      setErrors(v.errors);
      document.getElementById(`f-${Object.keys(v.errors)[0]}`)?.focus();
      return;
    }
    void (async () => {
      // Телефон для связи сохраняем в профиль: его увидит только выбранный донор, если вы сами откроете номер.
      if (phone.trim()) {
        try {
          await api('/me', { method: 'PATCH', body: { phone } });
          setPhone('');
          void reload();
        } catch (e) {
          setPhoneErr((e as ApiError).fields.phone ?? (e as ApiError).message);
          document.getElementById('f-phone')?.focus();
          return;
        }
      }
      await send(f);
    })();
  };

  if (!ready) return <Top back="/" />;
  const clinic = clinics?.find((c) => c.id === f.clinicId);

  if (blocked) {
    return (
      <>
        <Top back="/" />
        <StateCard bad title={blocked.title} text={blocked.text}>
          {blocked.requestId && (
            <Link className="btn primary wide" href={`/requests/${blocked.requestId}`}>
              Открыть запрос
            </Link>
          )}
          {blocked.code === 'active_limit' && (
            <Link className="btn primary wide" href="/requests">
              Мои запросы
            </Link>
          )}
          {(blocked.code === 'day_limit' || blocked.code === 'frozen') && (
            <Link className="btn primary wide" href="/support?topic=limit">
              Написать в поддержку
            </Link>
          )}
          <Link className="btn wide" href="/aid#banks">
            Банки крови рядом
          </Link>
          <button className="btn wide" onClick={() => setBlocked(null)}>
            Назад к форме
          </button>
        </StateCard>
      </>
    );
  }

  if (failed) {
    return (
      <>
        <Top back="/" />
        <StateCard bad title="Не удалось отправить запрос" text={`${failed}. Мы сохранили всё, что вы ввели. А пока позвоните в клинику напрямую, там могут знать доноров.`}>
          <button className="btn primary wide" onClick={() => void send(f)} disabled={busy}>
            Отправить ещё раз
          </button>
          {clinic && (
            <a className="btn" href={`tel:${clinic.phone.replace(/[^+\d]/g, '')}`}>
              Позвонить: <span className="phone">{clinic.phone}</span>
            </a>
          )}
        </StateCard>
      </>
    );
  }

  if (clinics && clinics.length === 0) {
    return (
      <>
        <Top back="/" />
        <StateCard
          title={`В городе ${city} пока нет клиник`}
          text="Мы добавляем клиники по мере запуска. Пока позвоните в ближайшую круглосуточную клинику: у многих есть свои доноры. Если вы в другом городе, смените его."
        >
          <Link className="btn primary" href="/city">
            Сменить город
          </Link>
          <Link className="btn" href="/aid">
            Экстренная помощь
          </Link>
        </StateCard>
      </>
    );
  }

  const ownSameSpecies = pets.filter((p) => p.species === f.species);

  return (
    <>
      <Top back="/" />
      <h1 className="page-title">SOS-запрос</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Подходящие доноры рядом с клиникой получат уведомление в Telegram и смогут откликнуться. Донорство бесплатное.
      </p>
      {queued && <p className="notice" role="status">Нет соединения. Запрос сохранён и отправится автоматически, как только связь вернётся.</p>}

      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <span className="flabel">Кому нужна кровь</span>
          <Seg label="Вид" value={f.species} onChange={(v) => set('species', v)} options={[['dog', 'Собака'], ['cat', 'Кошка']]} />
        </div>
        {ownSameSpecies.length > 0 && (
          <Field id="f-patientPetId" label="Это ваш питомец из профиля?">
            <select id="f-patientPetId" className="input" value={f.patientPetId} onChange={(e) => pickPatient(e.target.value)}>
              <option value="">Нет, другой питомец</option>
              {ownSameSpecies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {patient && patient.lastDonation && (
              <span className="chip gold" style={{ alignSelf: 'flex-start' }}>
                Донор Павхелпа: {patient.name} сам(а) сдавал(а) кровь — ищем сразу в 20 км
              </span>
            )}
          </Field>
        )}
        <Field id="f-petName" label="Кличка" error={errors.petName}>
          <input id="f-petName" className="input" value={f.petName} onChange={(e) => set('petName', e.target.value)} aria-invalid={!!errors.petName} autoComplete="off" />
        </Field>
        <Field id="f-weightKg" label="Вес, кг" error={errors.weightKg}>
          <input id="f-weightKg" className="input" inputMode="decimal" value={f.weightKg} onChange={(e) => set('weightKg', e.target.value)} aria-invalid={!!errors.weightKg} />
        </Field>
        <div className="field">
          <span className="flabel">Группа крови</span>
          <Seg
            label="Группа крови"
            value={f.bloodGroup}
            onChange={(v) => set('bloodGroup', v)}
            options={BLOOD_GROUPS[f.species].map((g) => [g, BLOOD_GROUP_LABEL[g]] as [BloodGroup, string])}
          />
          {f.bloodGroup === 'unknown' && <span className="small muted" style={{ paddingInline: 4 }}>Не страшно: совместимость проверит клиника.</span>}
        </div>
        <div className="field">
          <span className="flabel">Что назначил врач</span>
          <Seg label="Компонент крови" value={f.component} onChange={(v) => set('component', v)} options={COMPONENTS.map((c) => [c, COMPONENT_LABEL[c]] as [Component, string])} />
          <span className="small muted" style={{ paddingInline: 4 }}>Донор всегда сдаёт цельную кровь, плазму и эритроцитную массу из неё готовит клиника.</span>
        </div>
        <Field id="f-volumeMl" label="Объём, мл (если врач назвал)" error={errors.volumeMl}>
          <input id="f-volumeMl" className="input" inputMode="numeric" value={f.volumeMl} onChange={(e) => set('volumeMl', e.target.value.replace(/\D/g, ''))} aria-invalid={!!errors.volumeMl} />
        </Field>
        <Field id="f-clinicId" label={`Клиника · ${city}`} error={errors.clinicId}>
          <select id="f-clinicId" className="input" value={f.clinicId} onChange={(e) => set('clinicId', e.target.value)}>
            {(clinics ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}, {c.address}
                {c.night ? ' · круглосуточно' : ''}
              </option>
            ))}
          </select>
        </Field>

        <BankBlock offers={banks} need={f} />

        <div className="field">
          <span className="flabel">Срочность</span>
          <Seg
            label="Срочность"
            value={f.urgency}
            onChange={(v) => set('urgency', v)}
            options={[
              ['now', 'Прямо сейчас'],
              ['today', 'Сегодня'],
              ['plan', 'Плановая'],
            ]}
          />
        </div>
        <Field id="f-reason" label="Что случилось (необязательно)" error={errors.reason}>
          <textarea id="f-reason" className="input" maxLength={300} value={f.reason} onChange={(e) => set('reason', e.target.value)} aria-invalid={!!errors.reason} />
        </Field>
        {me && !me.phone && (
          <Field id="f-phone" label="Ваш телефон для связи (необязательно)" error={phoneErr}>
            <input
              id="f-phone"
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+7 900 000-00-00"
              value={phone}
              aria-invalid={!!phoneErr}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneErr('');
              }}
            />
            <span className="small muted" style={{ paddingInline: 4 }}>
              Номер скрыт. Выбранный донор увидит его, только если вы сами нажмёте «Показать мой номер».
            </span>
          </Field>
        )}
        <p className="small muted">
          Можно держать не больше 2 активных запросов и отправить не больше 3 за сутки: так мы бережём доноров от лишних уведомлений.
        </p>
        <button className="btn red wide" type="submit" disabled={busy || queued}>
          {busy ? 'Отправляем…' : 'Отправить SOS'}
        </button>
      </form>
    </>
  );
}
