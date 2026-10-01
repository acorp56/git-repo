'use client';
import { SPECIES_LABEL, TRIP_STEPS, URGENCY_LABEL, type Eligibility } from '@krovinka/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import type { RequestSummary } from '@/lib/api';
import { ago, group, kg } from '@/lib/format';
import { useSession } from '@/lib/session';

export function Top({ back }: { back?: string }) {
  return (
    <header className="top">
      {back ? (
        <Link className="back" href={back}>
          ← Назад
        </Link>
      ) : (
        <Link className="brand" href="/">
          <span className="drop" aria-hidden="true" />
          <b>кровинка</b>
        </Link>
      )}
    </header>
  );
}

export function RequestCard({ r }: { r: RequestSummary }) {
  return (
    <Link href={`/requests/${r.id}`} className={`req ${r.urgency === 'now' && r.status === 'open' ? 'urgent' : ''}`}>
      <div className="row between">
        <h3>
          {r.petName} <span className="lt">· {SPECIES_LABEL[r.species]}</span>
        </h3>
        <span className="small muted">{ago(r.createdAt)}</span>
      </div>
      <div className="chips">
        <span className={`chip ${r.urgency === 'now' ? 'red' : r.urgency === 'today' ? 'warn' : ''}`}>{URGENCY_LABEL[r.urgency]}</span>
        <span className="chip">{kg(r.weightKg)}</span>
        <span className="chip">{group(r.bloodGroup)}</span>
        {r.status === 'donor_chosen' && <span className="chip ok">Донор едет</span>}
        {r.status === 'closed' && <span className="chip">Закрыт</span>}
      </div>
      <p className="small muted">
        {r.clinic.name}, {r.clinic.address}
        {r.responders > 0 && ` · откликов: ${r.responders}`}
      </p>
    </Link>
  );
}

export function Field({ label, error, children, id }: { label: string; error?: string; children: ReactNode; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <span className="ferr" id={`${id}-err`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button type="button" key={v} aria-pressed={v === value} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function EligibilityList({ e }: { e: Eligibility }) {
  return (
    <div className="elig">
      <ul>
        {e.checks.map((c) => (
          <li key={c.key}>
            <span className={`mark ${c.ok ? 'ok' : 'no'}`} aria-label={c.ok ? 'выполнено' : 'не выполнено'}>
              {c.ok ? '✓' : '!'}
            </span>
            <span>
              {c.title}
              <br />
              <span className="small muted">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Steps({ step }: { step: number }) {
  return (
    <ol className="steps" aria-label="Статус поездки донора">
      {TRIP_STEPS.map((t, i) => (
        <li key={t} className={i < step ? 'done' : i === step ? 'cur' : ''}>
          <i aria-hidden="true" />
          {t}
        </li>
      ))}
    </ol>
  );
}

export function StateCard({ title, text, bad, children }: { title: string; text: string; bad?: boolean; children?: ReactNode }) {
  return (
    <div className={`state ${bad ? 'bad' : ''}`}>
      <h2>{title}</h2>
      <p className="muted">{text}</p>
      {children}
    </div>
  );
}

/** Перенаправляет на вход, если пользователь не вошёл. */
export function useRequireLogin(): boolean {
  const { me, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !me) router.replace(`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
  }, [loading, me, router]);
  return !loading && !!me;
}
