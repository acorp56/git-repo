// Публичная страница запроса krovinka.pet/r/<slug>: открывается без входа, рендерится на сервере для превью в чатах.
import { SPECIES_LABEL, URGENCY_LABEL } from '@krovinka/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { group, kg } from '@/lib/format';
import type { RequestSummary } from '@/lib/api';

type Pub = RequestSummary & { postText: string };

async function load(slug: string): Promise<Pub | null> {
  const res = await fetch(`${process.env.API_URL ?? 'http://localhost:4000'}/public/requests/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  return res.ok ? res.json() : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const r = await load((await params).slug);
  return r ? { title: `Нужна кровь для ${r.petName} · Кровинка`, description: r.postText } : { title: 'Кровинка' };
}

export default async function PublicRequest({ params }: { params: Promise<{ slug: string }> }) {
  const r = await load((await params).slug);
  if (!r) notFound();
  return (
    <>
      <header className="top">
        <Link className="brand" href="/">
          <span className="drop" aria-hidden="true" />
          <b>кровинка</b>
        </Link>
      </header>
      <section className="hero">
        <h1>
          {r.status === 'open' ? 'Нужна кровь' : r.status === 'closed' ? 'Помощь уже не нужна' : 'Донор найден'} для {r.petName}
        </h1>
        <p>
          {SPECIES_LABEL[r.species]}, {kg(r.weightKg)}, {group(r.bloodGroup)} · {URGENCY_LABEL[r.urgency]}
        </p>
        {r.status === 'open' && (
          <Link className="btn wide" href={`/requests/${r.id}`}>
            Откликнуться
          </Link>
        )}
      </section>
      <div className="card stack" style={{ marginTop: 12 }}>
        <b>{r.clinic.name}</b>
        <span className="muted small">{r.clinic.address}</span>
        <p>{r.postText}</p>
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>
        Подойдёт {r.species === 'dog' ? 'собака от 25 кг' : 'кошка от 4 кг'}, 1–8 лет, с действующими прививками. Окончательно совместимость проверит клиника.
      </p>
    </>
  );
}
