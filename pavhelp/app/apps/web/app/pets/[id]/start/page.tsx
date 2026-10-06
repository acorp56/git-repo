'use client';
// Первый запуск донора: уведомления, памятка «Как проходит сдача», группа крови.
// Прогресс шагов, которые не видны серверу (прочитал памятку, «узнаю при первой сдаче»), хранится в браузере.
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Top, useRequireLogin } from '@/components/ui';
import { api, ApiError, type Pet } from '@/lib/api';
import { useSession } from '@/lib/session';

const MEMO = [
  'Сдача бесплатная и занимает 20–40 минут вместе с осмотром.',
  'Врач осмотрит питомца и возьмёт анализ крови. Если что-то не так, сдачу перенесут, это нормально.',
  'Перед сдачей не кормите 6–8 часов, воду можно.',
  'Возьмите ветпаспорт с отметками о прививках.',
  'Кровь у собак обычно берут из вены на шее. Кошкам иногда нужен лёгкий наркоз, врач объяснит.',
  'После сдачи покормите, дайте отдохнуть, без активных игр до завтра.',
];

export default function DonorStart() {
  const { id } = useParams<{ id: string }>();
  const ready = useRequireLogin();
  const { me } = useSession();
  const [pet, setPet] = useState<Pet | null>(null);
  const [flags, setFlags] = useState<{ push?: boolean; memo?: boolean; group?: boolean }>({});
  const [note, setNote] = useState('');
  const key = `pavhelp.onb.${id}`;

  useEffect(() => {
    if (ready) api<Pet[]>('/pets').then((ps) => setPet(ps.find((p) => p.id === id) ?? null)).catch(() => {});
    try {
      setFlags(JSON.parse(localStorage.getItem(key) ?? '{}'));
    } catch {}
  }, [ready, id, key]);
  const mark = (k: 'push' | 'memo' | 'group') => {
    const next = { ...flags, [k]: true };
    setFlags(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };

  if (!ready || !pet || !me) return <Top back="/profile" />;
  const steps = [
    { k: 'notif', done: me.telegramConnected || !!flags.push, title: 'Получать SOS' },
    { k: 'memo', done: !!flags.memo, title: 'Как проходит сдача' },
    { k: 'group', done: pet.bloodGroup !== 'unknown' || !!flags.group, title: 'Группа крови' },
  ];
  const n = steps.filter((s) => s.done).length;

  return (
    <>
      <Top back="/profile" />
      <p className="eyebrow">{pet.name} в базе доноров</p>
      <h1 className="page-title">
        <span className="lt">Ещё</span> три шага
      </h1>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={n} style={{ marginTop: 14 }}>
        <i style={{ width: `${(n / 3) * 100}%` }} />
      </div>
      <p className="small muted">
        {n}/3 · после этого {pet.name} будет готов(а) к первому SOS
      </p>
      {note && <p className="notice">{note}</p>}

      <section className="section">
        <div className={`card stack ${steps[0]!.done ? 'done' : ''}`}>
          <b>{steps[0]!.done ? '✓ ' : '1. '}Получать SOS</b>
          <span className="small muted">
            {me.telegramConnected ? 'Telegram подключён' : 'Telegram надёжнее всего: сообщение придёт, даже если приложение закрыто'}
          </span>
          {!steps[0]!.done && (
            <div className="btns">
              <button
                className="btn tg"
                onClick={async () => {
                  try {
                    const { url } = await api<{ url: string }>('/telegram/link', { body: {} });
                    window.open(url, '_blank', 'noopener');
                    setNote('Откройте бота и нажмите «Старт»');
                  } catch (e) {
                    setNote((e as ApiError).message);
                  }
                }}
              >
                Подключить Telegram
              </button>
              <button className="btn" onClick={() => mark('push')}>
                Только push
              </button>
            </div>
          )}
        </div>
        <div className={`card stack ${steps[1]!.done ? 'done' : ''}`}>
          <b>{steps[1]!.done ? '✓ ' : '2. '}Как проходит сдача</b>
          <details className="guide" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && mark('memo')}>
            <summary className="small">Прочитать памятку</summary>
            <ol>
              {MEMO.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ol>
          </details>
        </div>
        <div className={`card stack ${steps[2]!.done ? 'done' : ''}`}>
          <b>{steps[2]!.done ? '✓ ' : '3. '}Группа крови</b>
          <span className="small muted">
            {pet.bloodGroup !== 'unknown'
              ? 'Группа указана'
              : 'Доноры с известной группой получают больше запросов. Экспресс-тест делают в клинике.'}
          </span>
          {!steps[2]!.done && (
            <div className="btns">
              <Link className="btn" href={`/pets/${pet.id}`}>
                Указать группу
              </Link>
              <button className="btn" onClick={() => mark('group')}>
                Узнаю при первой сдаче
              </button>
            </div>
          )}
        </div>
      </section>
      <section className="section">
        <Link className="btn primary wide" href="/profile">
          {n === 3 ? 'Готово' : 'Продолжить позже'}
        </Link>
      </section>
    </>
  );
}
