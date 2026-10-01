'use client';
import { SPECIES_LABEL, URGENCY_LABEL, plural } from '@krovinka/core';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { StateCard, Steps, Top } from '@/components/ui';
import { api, ApiError, type Message, type RequestDetail } from '@/lib/api';
import { ago, group, kg } from '@/lib/format';
import { useSession } from '@/lib/session';

const QUICK = {
  author: ['Мы уже в клинике', 'Спросите администратора', 'Спасибо, ждём!'],
  donor: ['Выехал, буду через 15 минут', 'Я на месте', 'Не могу найти вход, подскажите'],
};

const tel = (p: string) => `tel:${p.replace(/[^+\d]/g, '')}`;

export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  const { me, reload: reloadMe } = useSession();
  const [r, setR] = useState<RequestDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api<RequestDetail>(`/requests/${id}`)
      .then(setR)
      .catch((e: ApiError) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
    // Пока нет WebSocket, обновляем раз в 10 секунд: отклики и статусы поездки.
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load, me]);

  async function act(path: string, body?: unknown, done?: string) {
    setBusy(true);
    setNote('');
    try {
      await api(`/requests/${id}/${path}`, { body: body ?? {} });
      if (done) setNote(done);
      load();
      void reloadMe();
    } catch (e) {
      setNote((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return (<><Top back="/requests" /><StateCard bad title="Запрос не найден" text={error} /></>);
  if (!r) return (<><Top back="/requests" /><p className="muted">Загружаем…</p></>);

  const closed = r.status === 'closed';
  const share = async () => {
    const text = `${r.postText}\n${r.publicUrl}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setNote('Текст для чатов скопирован');
      }
    } catch {}
  };

  return (
    <>
      <Top back="/requests" />
      <h1 className="page-title">
        {r.petName} <span className="lt">· {SPECIES_LABEL[r.species]}</span>
      </h1>
      <div className="chips" style={{ marginBottom: 16 }}>
        <span className={`chip ${r.urgency === 'now' ? 'red' : r.urgency === 'today' ? 'warn' : ''}`}>{URGENCY_LABEL[r.urgency]}</span>
        <span className="chip">{kg(r.weightKg)}</span>
        <span className="chip">{group(r.bloodGroup)}</span>
        <span className="chip">{ago(r.createdAt)}</span>
        {closed && <span className="chip">Закрыт</span>}
      </div>
      {note && <p className="notice" role="status" style={{ marginBottom: 12 }}>{note}</p>}

      <div className="card stack">
        <b>{r.clinic.name}</b>
        <span className="muted small">
          {r.clinic.address}
          {r.clinic.night ? ' · круглосуточно' : ''}
        </span>
        {r.role !== 'guest' && <a className="phone" href={tel(r.clinic.phone)}>{r.clinic.phone}</a>}
        {r.reason && <p>{r.reason}</p>}
      </div>

      {r.trip && (
        <div className="card stack" style={{ marginTop: 12 }}>
          <b>{r.trip.step === 4 ? 'Сдача подтверждена' : r.role === 'author' ? 'Донор едет к вам' : 'Вы едете в клинику'}</b>
          <Steps step={r.trip.step} />
        </div>
      )}

      {r.role === 'guest' && (
        <div className="section">
          <Link className="btn primary wide" href={`/login?returnTo=/requests/${r.id}`}>
            Войти, чтобы откликнуться
          </Link>
        </div>
      )}

      {r.role === 'author' && <AuthorView r={r} busy={busy} act={act} />}
      {r.role === 'donor' && <DonorView r={r} busy={busy} act={act} />}
      {r.role === 'viewer' && <ViewerView r={r} busy={busy} act={act} />}

      {r.messages && (r.trip || r.role === 'author') && (
        <Chat messages={r.messages} quick={r.role === 'author' ? QUICK.author : QUICK.donor} disabled={closed || !r.trip} onSend={(text) => act('messages', { text })} />
      )}

      {!closed && (
        <div className="section">
          <button className="btn wide" onClick={share}>
            Поделиться запросом
          </button>
        </div>
      )}
    </>
  );
}

type ActFn = (path: string, body?: unknown, done?: string) => Promise<void>;

function AuthorView({ r, busy, act }: { r: RequestDetail; busy: boolean; act: ActFn }) {
  const chosen = r.responses?.find((x) => x.status === 'chosen');
  const offered = r.responses?.filter((x) => x.status === 'offered') ?? [];
  if (r.status === 'closed') {
    return (
      <div className="section">
        <StateCard title="Запрос закрыт" text={r.trip?.step === 4 ? 'Кровь взяли. Спасибо, что пользуетесь Кровинкой!' : 'Помощь больше не нужна.'} />
      </div>
    );
  }
  return (
    <section className="section">
      {chosen ? (
        <div className="card stack">
          <div className="row between">
            <b>
              {chosen.petName}
              {chosen.ownerName && ` · ${chosen.ownerName}`}
            </b>
            <span className="chip ok">Выбран</span>
          </div>
          {chosen.phone && <a className="phone" href={tel(chosen.phone)}>{chosen.phone}</a>}
          {(r.trip?.step ?? 0) >= 3 ? (
            <button className="btn red wide" disabled={busy} onClick={() => act('confirm', {}, 'Сдача подтверждена. Спасибо донору!')}>
              Кровь взяли, подтвердить сдачу
            </button>
          ) : (
            <p className="small muted">Когда донор будет на месте и кровь возьмут, здесь появится кнопка подтверждения.</p>
          )}
          <button className="btn" disabled={busy} onClick={() => confirm('Снять донора и искать другого?') && act('drop-donor', {}, 'Ищем другого донора')}>
            Донор не приедет
          </button>
        </div>
      ) : (
        <>
          <div className="section-head">
            <h2>Отклики</h2>
            <span className="small muted">
              Оповестили: {r.notified} · радиус {r.radiusKm} км
            </span>
          </div>
          {offered.length === 0 && (
            <StateCard
              title="Ждём откликов"
              text={
                r.notified
                  ? `Уведомили ${r.notified} ${plural(r.notified!, 'донора', 'доноров', 'доноров')}. Если никто не откликнется, расширим радиус автоматически. Поделитесь запросом в районных чатах.`
                  : 'Подходящих доноров рядом пока нет. Мы расширим радиус. Поделитесь запросом и позвоните в клинику: там могут знать доноров.'
              }
            />
          )}
          {offered.map((x) => (
            <div className="card stack" key={x.id}>
              <div className="row between">
                <b>
                  {x.petName} <span className="lt">· {x.breed || 'порода не указана'}</span>
                </b>
                {x.km !== null && <span className="small muted num">{x.km.toFixed(1).replace('.', ',')} км</span>}
              </div>
              <div className="chips">
                <span className="chip">{kg(x.weightKg)}</span>
                <span className="chip">{group(x.bloodGroup)}</span>
                <span className="chip">{x.district}</span>
              </div>
              <span className="small muted">{x.ownerName ? `Хозяин: ${x.ownerName}. ` : ''}Телефон откроется после выбора.</span>
              <button className="btn primary" disabled={busy} onClick={() => act('choose', { responseId: x.id }, 'Донор выбран. Телефоны открыты')}>
                Выбрать донора
              </button>
            </div>
          ))}
        </>
      )}
      <button className="link-btn" disabled={busy} onClick={() => confirm('Закрыть запрос? Доноры получат уведомление.') && act('close', {}, 'Запрос закрыт')}>
        Помощь больше не нужна — закрыть запрос
      </button>
    </section>
  );
}

function DonorView({ r, busy, act }: { r: RequestDetail; busy: boolean; act: ActFn }) {
  const chosen = r.myResponse?.status === 'chosen';
  if (r.status === 'closed') {
    return (
      <div className="section">
        <StateCard title="Запрос закрыт" text={r.trip?.step === 4 ? 'Хозяин подтвердил сдачу. Спасибо, вы спасли жизнь!' : 'Помощь больше не нужна. Спасибо, что откликнулись!'} />
      </div>
    );
  }
  if (!chosen) {
    return (
      <section className="section">
        <StateCard title={`${r.myResponse?.petName} откликнулся(ась)`} text="Хозяин выбирает донора. Мы сообщим в Telegram, если выберут вас." />
        <button className="btn" disabled={busy} onClick={() => act('withdraw', {}, 'Отклик отменён')}>
          Отменить отклик
        </button>
      </section>
    );
  }
  const step = r.trip?.step ?? 0;
  return (
    <section className="section">
      <div className="card stack">
        <b>Вас выбрали донором!</b>
        <span className="small muted">Хозяин{r.author?.name ? `: ${r.author.name}` : ''}</span>
        {r.author?.phone && <a className="phone" href={tel(r.author.phone)}>{r.author.phone}</a>}
        <a className="btn" href={`https://yandex.ru/maps/?text=${encodeURIComponent(r.clinic.name + ' ' + r.clinic.address + ' Санкт-Петербург')}`} target="_blank" rel="noreferrer">
          Маршрут в Яндекс Картах
        </a>
        {step < 1 && (
          <button className="btn primary" disabled={busy} onClick={() => act('trip', { step: 1 })}>
            Я выехал(а)
          </button>
        )}
        {step >= 1 && step < 3 && (
          <button className="btn primary" disabled={busy} onClick={() => act('trip', { step: 3 })}>
            Я на месте в клинике
          </button>
        )}
        {step >= 3 && <p className="small muted">Сдача засчитается, когда хозяин подтвердит, что кровь взяли.</p>}
        <button className="btn" disabled={busy} onClick={() => confirm('Сообщить хозяину, что не сможете приехать?') && act('withdraw', {}, 'Хозяин получит уведомление')}>
          Не смогу приехать
        </button>
      </div>
    </section>
  );
}

function ViewerView({ r, busy, act }: { r: RequestDetail; busy: boolean; act: ActFn }) {
  if (r.status !== 'open') {
    return (
      <div className="section">
        <StateCard title={r.status === 'closed' ? 'Запрос закрыт' : 'Донор уже выбран'} text="Спасибо, что готовы помочь! Мы напишем, если понадобится ваш питомец." />
      </div>
    );
  }
  const who = r.species === 'dog' ? 'собаки' : 'кошки';
  const pets = r.myPets ?? [];
  return (
    <section className="section">
      <h2>Можете помочь?</h2>
      {pets.length === 0 && (
        <StateCard title={`В профиле нет ${who}`} text="Добавьте питомца: проверка займёт минуту, и в следующий раз вы сможете откликнуться. А сейчас помогите репостом.">
          <Link className="btn primary" href="/pets/new">
            Добавить питомца-донора
          </Link>
        </StateCard>
      )}
      {pets.map((p) => (
        <div className="card stack" key={p.id}>
          <b>{p.name}</b>
          {!p.compatible ? (
            <span className="small muted">Группа крови не подходит этому питомцу.</span>
          ) : p.ready ? (
            <button className="btn red" disabled={busy} onClick={() => act('respond', { petId: p.id }, 'Спасибо! Хозяин получил ваш отклик')}>
              {p.name} может приехать
            </button>
          ) : (
            <span className="small muted">
              {p.firstProblem?.startsWith('Прошло') ? `Восстанавливается: ещё ${p.daysLeft} ${plural(p.daysLeft, 'день', 'дня', 'дней')}` : `Пока не может: ${p.firstProblem?.toLowerCase()}`}
            </span>
          )}
        </div>
      ))}
    </section>
  );
}

function Chat({ messages, quick, disabled, onSend }: { messages: Message[]; quick: string[]; disabled: boolean; onSend: (t: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const send = async (t: string) => {
    if (!t.trim()) return;
    await onSend(t.trim());
    setText('');
  };
  return (
    <section className="section">
      <h2>Чат</h2>
      <div className="card chat" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.system ? 'sys' : m.mine ? 'mine' : ''}`}>
            {m.text}
          </div>
        ))}
      </div>
      {!disabled && (
        <>
          <div className="btns">
            {quick.map((q) => (
              <button key={q} className="btn" style={{ padding: '9px 14px', fontSize: 14 }} onClick={() => send(q)}>
                {q}
              </button>
            ))}
          </div>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <label htmlFor="chat-input" className="sr">
              Сообщение
            </label>
            <input id="chat-input" className="input grow" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
            <button className="btn primary" type="submit">
              →
            </button>
          </form>
        </>
      )}
    </section>
  );
}
