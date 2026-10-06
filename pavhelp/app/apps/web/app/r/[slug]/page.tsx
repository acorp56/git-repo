// Публичная страница запроса pavhelp.ru/r/<slug>: открывается без входа, рендерится на сервере для превью в чатах.
// Без нижнего меню и без данных хозяина.
import { COMPONENT_LABEL, MIN_WEIGHT_KG, SPECIES_LABEL, URGENCY_LABEL } from '@pavhelp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Brand } from '@/components/ui';
import type { RequestSummary } from '@/lib/api';
import { group, kg } from '@/lib/format';

type Pub = RequestSummary & { postText: string };

async function load(slug: string): Promise<Pub | null> {
  const res = await fetch(`${process.env.API_URL ?? 'http://localhost:4000'}/public/requests/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  return res.ok ? res.json() : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const r = await load((await params).slug);
  if (!r) return { title: 'Павхелп' };
  const title = `Нужна кровь для ${r.petName} · Павхелп`;
  const description = `${SPECIES_LABEL[r.species]}, ${kg(r.weightKg)}, ${group(r.bloodGroup)}. ${r.clinic.name}, ${r.clinic.city}`;
  // TODO: картинка превью (фото, кличка, группа), когда появится хранилище фото.
  return { title, description, openGraph: { title, description, type: 'website', locale: 'ru_RU', siteName: 'Павхелп' } };
}

export default async function PublicRequest({ params }: { params: Promise<{ slug: string }> }) {
  const r = await load((await params).slug);
  if (!r) notFound();
  const dog = r.species === 'dog';
  return (
    <>
      <header className="top">
        <Brand />
      </header>
      <section className="hero">
        <h1>
          {r.status === 'open' ? 'Нужна кровь' : r.status === 'closed' ? 'Помощь уже не нужна' : 'Донор найден'} для {r.petName}
        </h1>
        <p>
          {SPECIES_LABEL[r.species]}, {kg(r.weightKg)}, {group(r.bloodGroup)} · {URGENCY_LABEL[r.urgency]}
          {r.component !== 'whole' && ` · нужна ${COMPONENT_LABEL[r.component].toLowerCase()}`}
        </p>
        {r.status === 'open' && (
          <Link className="btn wide" href={`/login?returnTo=${encodeURIComponent(`/requests/${r.id}`)}`}>
            Мой питомец может помочь
          </Link>
        )}
      </section>
      <div className="chips" style={{ marginTop: 12 }}>
        {r.clinicStatus === 'confirmed' ? <span className="chip ok">✓ Клиника подтвердила</span> : <span className="chip warn">Клиника проверяет</span>}
        {r.priority && <span className="chip gold">Донор Павхелпа</span>}
      </div>
      <div className="card stack" style={{ marginTop: 12 }}>
        <b>{r.clinic.name}</b>
        <span className="muted small">
          {r.clinic.city}, {r.clinic.address}
        </span>
        <p>{r.postText}</p>
      </div>
      <section className="section">
        <h2>Ваш питомец может помочь, если</h2>
        <ul className="card stack" style={{ paddingLeft: 36 }}>
          <li>
            {dog ? 'собака' : 'кошка'} весом от {MIN_WEIGHT_KG[r.species]} кг, возраст 1–8 лет;
          </li>
          <li>действуют прививки: комплексная и от бешенства;</li>
          <li>нет хронических болезней, сейчас не лечится и никогда не получал(а) переливание;</li>
          {!dog && <li>кошка живёт дома и не гуляет на улице;</li>}
          <li>после прошлой сдачи прошло {dog ? '60' : '90'} дней.</li>
        </ul>
        <p className="small muted">Окончательно совместимость проверит клиника. Донорство бесплатное: никому не переводите деньги.</p>
      </section>
      <p className="small muted" style={{ marginTop: 16 }}>
        <Link href="/legal/terms">Соглашение</Link> · <Link href="/legal/privacy">Персональные данные</Link> · <Link href="/legal/medical">Медицинский отказ</Link>
      </p>
    </>
  );
}
