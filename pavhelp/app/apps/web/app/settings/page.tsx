'use client';
import { areaLabel, cityAreas, DEFAULT_CITY, type NotifySettings } from '@pavhelp/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Field, Seg, Top, useRequireLogin } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
const PROVIDERS: Record<string, string> = { telegram: 'Telegram', yandex: 'Яндекс ID', email: 'Email', vk: 'VK ID', sber: 'Сбер ID', mts: 'МТС ID' };

export default function Settings() {
  const ready = useRequireLogin();
  const { me, reload } = useSession();
  const router = useRouter();
  const [n, setN] = useState<NotifySettings | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (me) setN(me.notify);
  }, [me]);

  if (!ready || !me || !n) return <Top back="/profile" />;

  async function save(patch: object, done = 'Сохранено') {
    try {
      await api('/me', { method: 'PATCH', body: patch });
      await reload();
      setNote(done);
    } catch (e) {
      setNote((e as ApiError).message);
    }
  }
  const setNotify = (p: Partial<NotifySettings>) => {
    const next = { ...n!, ...p };
    setN(next);
    void save({ notify: next });
  };

  async function exportData() {
    const data = await api('/me/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'pavhelp-data.json' });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Top back="/profile" />
      <h1 className="page-title">Настройки</h1>
      {note && <p className="notice" role="status" style={{ marginBottom: 12 }}>{note}</p>}

      <section className="section">
        <h2>Профиль</h2>
        <Field id="s-name" label="Имя">
          <input id="s-name" className="input" defaultValue={me.name} onBlur={(e) => e.target.value !== me.name && save({ name: e.target.value })} />
        </Field>
        <ContactPhone current={me.phone} onSave={(phone) => save({ phone }, phone ? 'Телефон сохранён' : 'Телефон удалён')} />
        <div className="card row between">
          <span>
            <span className="small muted">Город</span>
            <br />
            {me.city ?? DEFAULT_CITY}
          </span>
          <Link className="btn" href="/city">
            Сменить
          </Link>
        </div>
        <Field id="s-district" label="Район">
          <select id="s-district" className="input" value={me.district ?? ''} onChange={(e) => save({ district: e.target.value })}>
            <option value="" disabled>
              Выберите район
            </option>
            {Object.keys(cityAreas(me.city ?? DEFAULT_CITY)).map((d) => (
              <option key={d} value={d}>
                {areaLabel(me.city ?? DEFAULT_CITY, d)}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="section">
        <h2>Уведомления о SOS</h2>
        <label className="check">
          <input type="checkbox" checked={n.sos} onChange={(e) => setNotify({ sos: e.target.checked })} />
          <span>Присылать SOS-запросы</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={n.night} onChange={(e) => setNotify({ night: e.target.checked })} />
          <span>
            Будить ночью
            <br />
            <span className="small muted">Срочные SOS в тихие часы. По умолчанию выключено.</span>
          </span>
        </label>
        {!n.night && (
          <div className="card row between">
            <span>Тихие часы</span>
            <span className="row" style={{ gap: 8 }}>
              <label className="sr" htmlFor="q-from">С</label>
              <select id="q-from" className="input" style={{ width: 'auto' }} value={n.quietFrom} onChange={(e) => setNotify({ quietFrom: e.target.value })}>
                {HOURS.map((h) => <option key={h}>{h}</option>)}
              </select>
              —
              <label className="sr" htmlFor="q-to">До</label>
              <select id="q-to" className="input" style={{ width: 'auto' }} value={n.quietTo} onChange={(e) => setNotify({ quietTo: e.target.value })}>
                {HOURS.map((h) => <option key={h}>{h}</option>)}
              </select>
            </span>
          </div>
        )}
        <div className="field">
          <span className="flabel">Радиус первой волны</span>
          <Seg
            label="Радиус первой волны"
            value={String(n.radiusKm) as '5' | '10' | '20'}
            onChange={(v) => setNotify({ radiusKm: Number(v) as 5 | 10 | 20 })}
            options={[['5', '5 км'], ['10', '10 км'], ['20', '20 км']]}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={n.telegram} onChange={(e) => setNotify({ telegram: e.target.checked })} />
          <span>Telegram {me.telegramConnected ? '' : '(не подключён)'}</span>
        </label>
        {!me.telegramConnected && (
          <button
            className="btn tg"
            onClick={async () => {
              try {
                const { url } = await api<{ url: string }>('/telegram/link', { body: {} });
                window.open(url, '_blank', 'noopener');
                setNote('Откройте бота и нажмите «Старт». Потом вернитесь сюда');
              } catch (e) {
                setNote((e as ApiError).message);
              }
            }}
          >
            Подключить Telegram
          </button>
        )}
        <label className="check">
          <input type="checkbox" checked={n.push} onChange={(e) => setNotify({ push: e.target.checked })} />
          <span>
            Push-уведомления
            <br />
            <span className="small muted">
              На iPhone работают, только если добавить Павхелп на экран «Домой». <Link href="/ios">Как это сделать</Link>
            </span>
          </span>
        </label>
        {me.noChannels && <p className="alarm">Оба канала выключены: SOS-запросы до вас не дойдут.</p>}
      </section>

      <section className="section">
        <h2>Способы входа</h2>
        <div className="card stack">
          {me.providers.map((p) => (
            <div className="row between" key={p}>
              <span>
                {PROVIDERS[p] ?? p}
                {p === 'email' && me.email && <span className="small muted"> · {me.email}</span>}
              </span>
              <button
                className="link-btn"
                disabled={me.providers.length <= 1}
                title={me.providers.length <= 1 ? 'Последний способ входа отвязать нельзя' : undefined}
                onClick={() => api(`/me/providers/${p}`, { method: 'DELETE' }).then(reload, (e: ApiError) => setNote(e.message))}
              >
                Отвязать
              </button>
            </div>
          ))}
          {!me.providers.includes('yandex') && (
            <a className="btn ya" href="/api/auth/yandex?returnTo=/settings">
              Привязать Яндекс ID
            </a>
          )}
        </div>
      </section>

      <Display />

      {me.clinics.length > 0 && (
        <section className="section">
          <h2>Кабинет клиники</h2>
          {me.clinics.map((c) => (
            <Link key={c.id} className="btn" href={`/clinic/${c.id}`}>
              {c.name}
            </Link>
          ))}
        </section>
      )}

      <section className="section">
        <h2>Документы и поддержка</h2>
        <Link className="btn" href="/legal/terms">Пользовательское соглашение</Link>
        <Link className="btn" href="/legal/privacy">Политика обработки персональных данных</Link>
        <Link className="btn" href="/legal/medical">Медицинский отказ</Link>
        <Link className="btn" href="/support">Поддержка</Link>
      </section>

      <section className="section">
        <h2>Данные</h2>
        <button className="btn" onClick={exportData}>
          Скачать мои данные
        </button>
        <button
          className="btn"
          onClick={async () => {
            await api('/auth/logout', { body: {} });
            await reload();
            router.push('/');
          }}
        >
          Выйти
        </button>
        <button
          className="btn red"
          onClick={async () => {
            if (!confirm('Удалить аккаунт? Питомцы, медкарты и капли будут удалены без возможности восстановления.')) return;
            await api('/me', { method: 'DELETE' });
            await reload();
            router.push('/');
          }}
        >
          Удалить аккаунт
        </button>
      </section>
    </>
  );
}

function ContactPhone({ current, onSave }: { current: string | null; onSave: (phone: string | null) => Promise<void> }) {
  const [v, setV] = useState(current ?? '');
  return (
    <form
      className="field"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(v.trim() || null);
      }}
    >
      <label htmlFor="s-phone">Телефон для связи (необязательно)</label>
      <div className="row">
        <input id="s-phone" className="input grow" type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 900 000-00-00" value={v} onChange={(e) => setV(e.target.value)} />
        <button className="btn">Сохранить</button>
      </div>
      <span className="small muted" style={{ paddingInline: 4 }}>
        Увидит только выбранный донор или хозяин, которому вы помогаете. Без телефона связь — через чат запроса.
      </span>
    </form>
  );
}

/** «Отображение»: крупный текст и меньше анимации. Хранится в браузере, применяется классами на <html>. */
function Display() {
  const [big, setBig] = useState(false);
  const [calm, setCalm] = useState(false);
  useEffect(() => {
    setBig(document.documentElement.classList.contains('a-big'));
    setCalm(document.documentElement.classList.contains('a-calm'));
  }, []);
  const toggle = (cls: string, on: boolean) => {
    document.documentElement.classList.toggle(cls, on);
    try {
      localStorage.setItem('pavhelp.' + cls, on ? '1' : '');
    } catch {}
  };
  return (
    <section className="section">
      <h2>Отображение</h2>
      <label className="check">
        <input type="checkbox" checked={big} onChange={(e) => (setBig(e.target.checked), toggle('a-big', e.target.checked))} />
        <span>Крупный текст</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={calm} onChange={(e) => (setCalm(e.target.checked), toggle('a-calm', e.target.checked))} />
        <span>Меньше анимации</span>
      </label>
    </section>
  );
}
