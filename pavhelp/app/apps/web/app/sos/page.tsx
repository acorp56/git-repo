'use client';
import { BLOOD_GROUP_LABEL, BLOOD_GROUPS, validateSos, type BloodGroup, type FieldErrors, type Species, type Urgency } from '@pavhelp/core';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Field, Seg, StateCard, Top, useRequireLogin } from '@/components/ui';
import { api, ApiError, type Clinic } from '@/lib/api';
import { useSession } from '@/lib/session';

const PENDING_KEY = 'pavhelp.pendingSos';

interface Form {
  species: Species;
  petName: string;
  weightKg: string;
  bloodGroup: BloodGroup;
  clinicId: string;
  urgency: Urgency;
  reason: string;
}

const empty: Form = { species: 'dog', petName: '', weightKg: '', bloodGroup: 'unknown', clinicId: '', urgency: 'now', reason: '' };

export default function Sos() {
  const ready = useRequireLogin();
  const { me, reload } = useSession();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [phoneErr, setPhoneErr] = useState('');
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [f, setF] = useState<Form>(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    api<Clinic[]>('/clinics')
      .then((cs) => {
        setClinics(cs);
        setF((f) => (f.clinicId ? f : { ...f, clinicId: cs[0]?.id ?? '' }));
      })
      .catch(() => {});
  }, []);

  const send = useCallback(
    async (form: Form) => {
      setBusy(true);
      setFailed('');
      try {
        const r = await api<{ id: string }>('/requests', { body: form });
        try {
          localStorage.removeItem(PENDING_KEY);
        } catch {}
        router.push(`/requests/${r.id}`);
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 0) {
          // Нет сети: сохраняем запрос и отправим, как только связь вернётся.
          try {
            localStorage.setItem(PENDING_KEY, JSON.stringify(form));
          } catch {}
          setQueued(true);
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
      setF(pending);
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
    setF((f) => ({ ...f, [k]: v, ...(k === 'species' ? { bloodGroup: 'unknown' as BloodGroup } : {}) }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateSos({ ...f });
    if (!v.ok) {
      setErrors(v.errors);
      document.getElementById(`f-${Object.keys(v.errors)[0]}`)?.focus();
      return;
    }
    void (async () => {
      // Телефон для связи сохраняем в профиль: его увидит только выбранный донор.
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
  const clinic = clinics.find((c) => c.id === f.clinicId);

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

  return (
    <>
      <Top back="/" />
      <h1 className="page-title">SOS-запрос</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Подходящие доноры рядом с клиникой получат уведомление в Telegram и смогут откликнуться.
      </p>
      {queued && <p className="notice" role="status">Нет соединения. Запрос сохранён и отправится автоматически, как только связь вернётся.</p>}

      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <span className="flabel">Кому нужна кровь</span>
          <Seg label="Вид" value={f.species} onChange={(v) => set('species', v)} options={[['dog', 'Собака'], ['cat', 'Кошка']]} />
        </div>
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
        <Field id="f-clinicId" label="Клиника" error={errors.clinicId}>
          <select id="f-clinicId" className="input" value={f.clinicId} onChange={(e) => set('clinicId', e.target.value)}>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}, {c.address}
                {c.night ? ' · круглосуточно' : ''}
              </option>
            ))}
          </select>
        </Field>
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
        <Field id="f-reason" label="Что случилось (необязательно)">
          <textarea id="f-reason" className="input" maxLength={300} value={f.reason} onChange={(e) => set('reason', e.target.value)} />
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
              Увидит только донор, которого вы выберете. Без телефона связь — через чат запроса.
            </span>
          </Field>
        )}
        <button className="btn red wide" type="submit" disabled={busy || queued}>
          {busy ? 'Отправляем…' : 'Отправить SOS'}
        </button>
      </form>
    </>
  );
}
