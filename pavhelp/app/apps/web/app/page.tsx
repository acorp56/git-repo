'use client';
import { cityByName, drops } from '@pavhelp/core';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IosHint, RequestCard, StateCard, Top } from '@/components/ui';
import { api, ApiError, type RequestSummary } from '@/lib/api';
import { useCity } from '@/lib/city';
import { useSession } from '@/lib/session';

export default function Home() {
  const { me, progress } = useSession();
  const [open, setOpen] = useState<RequestSummary[] | null>(null);
  const [active, setActive] = useState<RequestSummary[]>([]);
  const [error, setError] = useState('');
  const [city] = useCity();
  const [stats, setStats] = useState<{ donors: number; clinics: number; goal: number } | null>(null);
  const cityIn = cityByName(city)?.in ?? city;

  useEffect(() => {
    setOpen(null);
    api<RequestSummary[]>(`/requests?scope=open&city=${encodeURIComponent(city)}`)
      .then(setOpen)
      .catch((e: ApiError) => setError(e.message));
    api<{ donors: number; clinics: number; goal: number }>(`/stats/city?city=${encodeURIComponent(city)}`)
      .then(setStats)
      .catch(() => {});
  }, [city]);

  useEffect(() => {
    if (!me) return;
    // Плашка «Активный SOS», пока идёт поездка: свои запросы и те, где я донор.
    Promise.all([api<RequestSummary[]>('/requests?scope=mine'), api<RequestSummary[]>('/requests?scope=helping')])
      .then(([a, b]) => setActive([...a, ...b].filter((r) => r.status !== 'closed')))
      .catch(() => {});
  }, [me]);

  return (
    <>
      <Top
        right={
          <Link href="/city" className="back" aria-label={`Город: ${city}. Сменить`}>
            📍 {city}
          </Link>
        }
      />
      {active
        .filter((r) => r.staleAsk)
        .map((r) => (
          <Link key={'s' + r.id} href={`/requests/${r.id}`} className="notice stack" style={{ marginBottom: 12, textDecoration: 'none' }}>
            <b>Запрос для {r.petName} открыт больше суток. Ещё ищете донора?</b>
            <span className="small">Если не ответить в течение 12 часов, закроем запрос сами, чтобы не тревожить доноров зря →</span>
          </Link>
        ))}
      {active.map((r) => (
        <Link key={r.id} href={`/requests/${r.id}`} className="banner" style={{ marginBottom: 12 }}>
          <span>
            <b>Активный SOS: {r.petName}</b>
            <br />
            <span className="small">{r.status === 'donor_chosen' ? 'Донор едет в клинику' : `Откликов: ${r.responders}`}</span>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      ))}

      <section className="hero">
        <h1>Питомцу срочно нужна кровь?</h1>
        <p>Опишите ситуацию — мы сразу оповестим подходящих доноров рядом с клиникой.</p>
        <Link href="/sos" className="btn wide">
          Создать SOS-запрос
        </Link>
      </section>

      {stats && stats.donors < stats.goal && (
        <div className="card stack" style={{ marginTop: 12 }}>
          <b>Павхелп {cityIn} только начинается</b>
          <div className="bar" aria-hidden="true">
            <i style={{ width: `${Math.max(4, Math.round((stats.donors / stats.goal) * 100))}%` }} />
          </div>
          <span className="small muted">
            Доноров: {stats.donors} из {stats.goal}. Когда их станет больше, SOS будут находить помощь быстрее.
            {stats.clinics === 0 && ' Клиник в справочнике пока нет: пока создать SOS здесь нельзя, но банки крови и районные чаты работают.'}
          </span>
          <div className="btns">
            <Link href="/pets/new" className="btn primary">
              Стать донором
            </Link>
            <button
              className="btn"
              onClick={async () => {
                const text = `Мой питомец может спасти жизнь другому. Присоединяйся к Павхелпу ${cityIn}: ${location.origin}`;
                try {
                  if (navigator.share) await navigator.share({ text });
                  else await navigator.clipboard.writeText(text);
                } catch {}
              }}
            >
              Позвать друзей
            </button>
          </div>
        </div>
      )}

      <IosHint />

      {me && progress && (
        <Link href="/profile" className="card stack" style={{ marginTop: 12, textDecoration: 'none' }}>
          <div className="row between">
            <b>{progress.level.name}</b>
            <span className="small muted num">{drops(progress.xp)}</span>
          </div>
          <div className="bar" aria-hidden="true">
            <i style={{ width: `${Math.round(progress.level.progress * 100)}%` }} />
          </div>
          {progress.level.next && (
            <span className="small muted">
              До уровня «{progress.level.next}» — {drops(progress.level.to! - progress.xp)}
            </span>
          )}
        </Link>
      )}

      {!me && (
        <div className="card stack" style={{ marginTop: 12 }}>
          <b>Станьте донором</b>
          <p className="small muted">Собаки от 25 кг и кошки от 4 кг, 1–8 лет, с прививками. Проверка займёт минуту.</p>
          <Link href="/login?returnTo=/pets/new" className="btn primary">
            Добавить питомца-донора
          </Link>
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Нужна помощь {cityIn}</h2>
          <Link href="/requests" className="small muted">
            Все
          </Link>
        </div>
        {error && <StateCard bad title="Не удалось загрузить запросы" text={error} />}
        {open === null && !error && <p className="muted">Загружаем…</p>}
        {open?.length === 0 && <StateCard title="Сейчас всё спокойно" text="Открытых запросов нет. Если появится SOS рядом, мы напишем." />}
        {open?.slice(0, 5).map((r) => <RequestCard key={r.id} r={r} />)}
      </section>
    </>
  );
}
