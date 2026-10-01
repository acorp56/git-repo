'use client';
import { BLOOD_GROUP_LABEL, drops, plural, SPECIES_LABEL } from '@krovinka/core';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StateCard, Top, useRequireLogin } from '@/components/ui';
import { api, type Pet } from '@/lib/api';
import { kg } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function Profile() {
  const ready = useRequireLogin();
  const { me, progress, reload } = useSession();
  const [pets, setPets] = useState<Pet[] | null>(null);

  useEffect(() => {
    if (ready) api<Pet[]>('/pets').then(setPets).catch(() => setPets([]));
  }, [ready]);

  if (!ready || !me) return <Top />;

  return (
    <>
      <header className="top">
        <Link className="brand" href="/">
          <span className="drop" aria-hidden="true" />
          <b>кровинка</b>
        </Link>
        <Link className="back" href="/settings" aria-label="Настройки">
          ⚙ Настройки
        </Link>
      </header>
      <h1 className="page-title">{me.name || 'Профиль'}</h1>
      {me.needsConsent && (
        <div className="notice stack" style={{ marginTop: 12 }}>
          <span>Чтобы получать SOS и откликаться, нужно согласие на обработку персональных данных.</span>
          <button className="btn" onClick={() => api('/me/consent', { body: {} }).then(reload)}>
            Даю согласие
          </button>
        </div>
      )}
      {!me.telegramConnected && (
        <p className="notice" style={{ marginTop: 12 }}>
          Подключите Telegram в настройках: это основной канал SOS. Без него вы можете не узнать о запросе вовремя.
        </p>
      )}

      {progress && (
        <section className="section">
          <div className="card stack">
            <div className="row between">
              <b>{progress.level.name}</b>
              <span className="num">{drops(progress.xp)}</span>
            </div>
            <div className="bar" aria-hidden="true">
              <i style={{ width: `${Math.round(progress.level.progress * 100)}%` }} />
            </div>
            {progress.level.next && (
              <span className="small muted">
                До уровня «{progress.level.next}» — {drops(progress.level.to! - progress.xp)}
              </span>
            )}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Мои питомцы</h2>
          <Link className="small muted" href="/pets/new">
            + Добавить
          </Link>
        </div>
        {pets === null && <p className="muted">Загружаем…</p>}
        {pets?.length === 0 && (
          <StateCard title="Есть собака или кошка?" text="Добавьте питомца: проверим, может ли он стать донором, и напомним о прививках.">
            <Link className="btn primary" href="/pets/new">
              Добавить питомца
            </Link>
          </StateCard>
        )}
        {pets?.map((p) => {
          const e = p.eligibility;
          return (
            <div className="card stack" key={p.id}>
              <div className="row between">
                <b>
                  {p.name} <span className="lt">· {p.breed || SPECIES_LABEL[p.species]}</span>
                </b>
                {!p.donorEnabled ? (
                  <span className="chip">SOS выключены</span>
                ) : e.ready ? (
                  <span className="chip ok">Готов(а) помочь</span>
                ) : e.fit ? (
                  <span className="chip warn">
                    Через {e.daysLeft} {plural(e.daysLeft, 'день', 'дня', 'дней')}
                  </span>
                ) : (
                  <span className="chip">Не донор</span>
                )}
              </div>
              <div className="chips">
                <span className="chip">{kg(p.weightKg)}</span>
                <span className="chip">{BLOOD_GROUP_LABEL[p.bloodGroup]}</span>
                <span className="chip">{p.district}</span>
              </div>
              {!e.fit && <span className="small muted">Не подходит: {e.checks.filter((c) => !c.ok && c.key !== 'gap').map((c) => c.title.toLowerCase()).join(', ')}</span>}
              <Link className="btn" href={`/pets/${p.id}`}>
                Медкарта и настройки
              </Link>
            </div>
          );
        })}
      </section>

      {progress && (
        <section className="section">
          <h2>Награды</h2>
          <div className="badges">
            {progress.badges.map((b) => (
              <div key={b.id} className={`badge ${b.earned ? 'on' : ''}`}>
                <span className="b" aria-hidden="true">
                  {b.symbol}
                </span>
                <b>{b.title}</b>
                <span className="d">{b.description}</span>
                {!b.earned && b.goal > 1 && (
                  <span className="d num">
                    {b.value} из {b.goal}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
