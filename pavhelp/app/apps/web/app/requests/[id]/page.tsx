'use client';
import { COMPONENT_LABEL, REPORT_REASONS, SPECIES_LABEL, URGENCY_LABEL, plural, type ReportReason } from '@pavhelp/core';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BankBlock } from '@/components/banks';
import { StateCard, Steps, Top } from '@/components/ui';
import { api, ApiError, type Message, type RequestDetail } from '@/lib/api';
import { ago, group, kg } from '@/lib/format';
import { useSession } from '@/lib/session';

const QUICK = {
  author: ['Мы уже в клинике', 'Спросите администратора', 'Спасибо, ждём!'],
  donor: ['Выехал, буду через 15 минут', 'Я на месте', 'Не могу найти вход, подскажите'],
};

const tel = (p: string) => `tel:${p.replace(/[^+\d]/g, '')}`;

/** Стаж на Павхелпе: «с марта 2026». */
const since = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  const { me, reload: reloadMe } = useSession();
  const [r, setR] = useState<RequestDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [report, setReport] = useState<{ messageId?: string } | null>(null);

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

  async function act(path: string, body?: unknown, done?: string): Promise<ApiError | null> {
    setBusy(true);
    setNote('');
    try {
      await api(`/requests/${id}/${path}`, { body: body ?? {} });
      if (done) setNote(done);
      load();
      void reloadMe();
      return null;
    } catch (e) {
      setNote((e as ApiError).message);
      return e as ApiError;
    } finally {
      setBusy(false);
    }
  }

  if (error) return (<><Top back="/requests" /><StateCard bad title="Запрос не найден" text={error} /></>);
  if (!r) return (<><Top back="/requests" /><p className="muted">Загружаем…</p></>);

  const closed = r.status === 'closed';
  const share = async () => {
    const text = `${r.postText}\nОткликнуться: ${r.publicUrl}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setNote('Текст со ссылкой скопирован');
      }
    } catch {}
  };

  return (
    <>
      <Top back="/requests" />
      <h1 className="page-title">
        {r.petName} <span className="lt">· {SPECIES_LABEL[r.species]}</span>
      </h1>
      <div className="chips" style={{ marginBottom: 12 }}>
        <span className={`chip ${r.urgency === 'now' ? 'red' : r.urgency === 'today' ? 'warn' : ''}`}>{URGENCY_LABEL[r.urgency]}</span>
        <span className="chip">{kg(r.weightKg)}</span>
        <span className="chip">{group(r.bloodGroup)}</span>
        <span className="chip">
          {COMPONENT_LABEL[r.component]}
          {r.volumeMl ? `, ${r.volumeMl} мл` : ''}
        </span>
        {r.priority && <span className="chip gold">Донор Павхелпа</span>}
        <span className="chip">{ago(r.createdAt)}</span>
        {closed && <span className="chip">Закрыт</span>}
      </div>
      <div className="chips" style={{ marginBottom: 16 }}>
        {r.clinicStatus === 'confirmed' ? (
          <span className="chip ok">✓ Клиника подтвердила</span>
        ) : r.clinicStatus === 'rejected' ? (
          <span className="chip red">Клиника не подтвердила</span>
        ) : (
          <span className="chip warn">Клиника проверяет</span>
        )}
        {r.authorNew && <span className="chip warn">новый аккаунт</span>}
        <span className="chip">автор на Павхелпе с {since(r.authorSince)}</span>
      </div>
      {note && <p className="notice" role="status" style={{ marginBottom: 12 }}>{note}</p>}
      {r.hidden && <p className="alarm">Запрос скрыт и проверяется модератором. Доноры его сейчас не видят.</p>}

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

      {r.trip && !closed && r.status === 'donor_chosen' && <PhoneBlock r={r} busy={busy} act={act} />}

      {r.messages && (r.trip || r.role === 'author') && (
        <Chat
          messages={r.messages}
          quick={r.role === 'author' ? QUICK.author : QUICK.donor}
          disabled={closed || !r.trip || !!r.chat?.blocked}
          blocked={!!r.chat?.blocked}
          onSend={(text) => act('messages', { text })}
          onReport={(messageId) => setReport({ messageId })}
        />
      )}

      {!closed && (
        <div className="section">
          <button className="btn wide" onClick={share}>
            Поделиться запросом
          </button>
        </div>
      )}

      {r.role !== 'guest' && r.role !== 'author' && !r.reportedByMe && (
        <button className="link-btn" style={{ marginTop: 16 }} onClick={() => setReport({})}>
          ⚑ Пожаловаться на запрос
        </button>
      )}
      {r.role === 'author' && r.trip && (
        <button className="link-btn" style={{ marginTop: 16 }} onClick={() => setReport({})}>
          ⚑ Пожаловаться на донора
        </button>
      )}

      {report && (
        <ReportSheet
          onClose={() => setReport(null)}
          onSend={async (reason) => {
            const err = await act('report', { reason, messageId: report.messageId }, '');
            if (!err) {
              setReport(null);
              setNote(
                reason === 'money' || reason === 'sell'
                  ? 'Спасибо. Не переводите деньги: модератор проверит аккаунт'
                  : r.role === 'viewer'
                    ? 'Спасибо, жалоба отправлена. Запрос скрыт из вашей ленты'
                    : 'Спасибо, жалоба отправлена. Модератор проверит',
              );
            }
          }}
        />
      )}
    </>
  );
}

type ActFn = (path: string, body?: unknown, done?: string) => Promise<ApiError | null>;

function AuthorView({ r, busy, act }: { r: RequestDetail; busy: boolean; act: ActFn }) {
  const chosen = r.responses?.find((x) => x.status === 'chosen');
  const offered = r.responses?.filter((x) => x.status === 'offered') ?? [];
  if (r.status === 'closed') {
    return (
      <div className="section">
        <StateCard title="Запрос закрыт" text={r.trip?.step === 4 ? 'Кровь взяли. Спасибо, что пользуетесь Павхелпом!' : 'Помощь больше не нужна.'} />
      </div>
    );
  }
  return (
    <section className="section">
      {r.staleAsk && (
        <div className="notice stack" role="alert">
          <b>Запрос открыт больше суток. Ещё ищете донора?</b>
          <span className="small">Если не ответить в течение 12 часов, закроем запрос сами, чтобы не тревожить доноров зря.</span>
          <div className="btns">
            <button className="btn primary grow" disabled={busy} onClick={() => act('renew', {}, 'Продлили запрос и снова уведомили доноров')}>
              Да, ещё ищем
            </button>
            <button className="btn grow" disabled={busy} onClick={() => act('close', {}, 'Запрос закрыт')}>
              Нет, закрыть
            </button>
          </div>
        </div>
      )}

      {chosen ? (
        <div className="card stack">
          <div className="row between">
            <b>
              {chosen.petName}
              {chosen.ownerName && ` · ${chosen.ownerName}`}
            </b>
            <span className="chip ok">Выбран</span>
          </div>
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
          {offered.length === 0 && r.notified === 0 && (
            <div className="planb stack">
              <b>Рядом пока нет подходящих доноров</b>
              <span className="small">Запрос всё равно открыт. Дальше работаем так:</span>
              <ol>
                <li>Кровь из банка клиники, если она есть ниже.</li>
                <li>Звонок в клинику: у многих есть свои доноры и сотрудники с собаками.</li>
                <li>Текст для районных чатов и соцсетей — кнопка «Поделиться запросом».</li>
                <li>Если откликов нет, поиск расширится сам. Можно сразу искать в 50 км.</li>
              </ol>
              {r.canExpand && (
                <button className="btn primary" disabled={busy} onClick={() => act('expand', {}, 'Расширили поиск')}>
                  Искать в 50 км
                </button>
              )}
            </div>
          )}
          {offered.length === 0 && !!r.notified && (
            <StateCard
              title="Ждём откликов"
              text={`Уведомили ${r.notified} ${plural(r.notified!, 'донора', 'доноров', 'доноров')}. Если никто не откликнется, расширим радиус автоматически. Поделитесь запросом в районных чатах.`}
            >
              {r.canExpand && (
                <button className="btn" disabled={busy} onClick={() => act('expand', {}, 'Расширили поиск')}>
                  Расширить поиск сейчас
                </button>
              )}
            </StateCard>
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
              <span className="small muted">{x.ownerName ? `Хозяин: ${x.ownerName}. ` : ''}После выбора откроется чат.</span>
              <button className="btn primary" disabled={busy} onClick={() => act('choose', { responseId: x.id }, 'Донор выбран. Договоритесь о встрече в чате')}>
                Выбрать донора
              </button>
            </div>
          ))}
          {r.banks && <BankBlock offers={r.banks} need={r} />}
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
        <a className="btn" href={`https://yandex.ru/maps/?text=${encodeURIComponent(r.clinic.name + ' ' + r.clinic.address + ' ' + r.clinic.city)}`} target="_blank" rel="noreferrer">
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
  const [paused, setPaused] = useState<string | null>(null);
  if (r.status !== 'open') {
    return (
      <div className="section">
        <StateCard title={r.status === 'closed' ? 'Запрос закрыт' : 'Донор уже выбран'} text="Спасибо, что готовы помочь! Мы напишем, если понадобится ваш питомец." />
      </div>
    );
  }
  const who = r.species === 'dog' ? 'собаки' : 'кошки';
  const pets = r.myPets ?? [];
  const respond = async (petId: string) => {
    const err = await act('respond', { petId }, 'Спасибо! Хозяин получил ваш отклик');
    if (err?.data.code === 'paused') setPaused(petId);
    else if (!err) setPaused(null);
  };
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
          ) : p.paused || paused === p.id ? (
            <>
              <span className="small muted">{p.name} на паузе: SOS не приходят. Снять паузу и откликнуться?</span>
              <button
                className="btn red"
                disabled={busy}
                onClick={async () => {
                  await api(`/pets/${p.id}/pause`, { body: { days: 0 } });
                  await respond(p.id);
                }}
              >
                Снять паузу и откликнуться
              </button>
            </>
          ) : p.ready ? (
            <button className="btn red" disabled={busy} onClick={() => respond(p.id)}>
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

/** Номера по согласию: свой номер каждый открывает сам, номер собеседника виден, только если он открыл свой. */
function PhoneBlock({ r, busy, act }: { r: RequestDetail; busy: boolean; act: ActFn }) {
  const chosen = r.responses?.find((x) => x.status === 'chosen');
  const their = r.role === 'author' ? chosen?.phone : r.author?.phone;
  const theirName = r.role === 'author' ? chosen?.ownerName || 'донор' : r.author?.name || 'хозяин';
  return (
    <section className="section">
      <div className="card stack">
        <div className="row between">
          <div className="grow">
            <div className="small muted">Телефон · {theirName}</div>
            {their ? (
              <a className="phone" href={tel(their)}>
                {their}
              </a>
            ) : (
              <span className="small muted">{r.myPhoneShown ? `Ждём, когда ${theirName} откроет свой номер` : 'Скрыт. Пока общайтесь в чате'}</span>
            )}
          </div>
          {!their && <span aria-hidden="true">🔒</span>}
        </div>
        {r.myPhoneShown ? (
          <div className="row between">
            <span className="small muted">Ваш номер виден собеседнику</span>
            <button className="link-btn" disabled={busy} onClick={() => act('phone', { show: false }, 'Номер скрыт')}>
              Скрыть
            </button>
          </div>
        ) : r.myPhone ? (
          <button className="btn" disabled={busy} onClick={() => act('phone', { show: true }, 'Собеседник видит ваш номер')}>
            Показать мой номер
          </button>
        ) : (
          <Link className="btn" href="/settings">
            Указать телефон в настройках
          </Link>
        )}
      </div>
    </section>
  );
}

function ReportSheet({ onClose, onSend }: { onClose: () => void; onSend: (r: ReportReason) => void }) {
  return (
    <>
      <div className="sheet-bg" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="rep-title">
        <h2 id="rep-title">Пожаловаться</h2>
        <p className="small muted">Модератор проверит в течение часа. Жалоба на деньги сразу закрывает чат.</p>
        {REPORT_REASONS.map(([k, t]) => (
          <button key={k} className="btn wide" onClick={() => onSend(k)}>
            {t}
          </button>
        ))}
        <button className="link-btn" onClick={onClose}>
          Отмена
        </button>
      </div>
    </>
  );
}

function Chat({
  messages,
  quick,
  disabled,
  blocked,
  onSend,
  onReport,
}: {
  messages: Message[];
  quick: string[];
  disabled: boolean;
  blocked: boolean;
  onSend: (t: string) => Promise<unknown>;
  onReport: (messageId: string) => void;
}) {
  const [text, setText] = useState('');
  const send = async (t: string) => {
    if (!t.trim()) return;
    const err = await onSend(t.trim());
    if (!err) setText('');
  };
  return (
    <section className="section">
      <h2>Чат</h2>
      <p className="notice small">📌 Донорство бесплатное. Никому не переводите деньги и не сообщайте данные карты и коды из СМС.</p>
      <div className="card chat" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.system ? 'sys' : m.mine ? 'mine' : ''} ${m.flagged ? 'risky' : ''}`}>
            {m.text}
            {m.flagged && (
              <span className="risk-note">
                ⚠ Похоже на просьбу о деньгах. Не переводите.{' '}
                <button className="link-btn" onClick={() => onReport(m.id)}>
                  Пожаловаться
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      {blocked && <p className="alarm">Чат закрыт после жалобы. Модератор проверит переписку.</p>}
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
