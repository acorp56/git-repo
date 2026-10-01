'use client';
import { DISTRICTS, type NotifySettings } from '@krovinka/core';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Field, Seg, Top, useRequireLogin } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
const PROVIDERS: Record<string, string> = { telegram: 'Telegram', yandex: 'Яндекс ID', phone: 'Телефон', vk: 'VK ID', sber: 'Сбер ID', mts: 'МТС ID' };

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
    const a = Object.assign(document.createElement('a'), { href: url, download: 'krovinka-data.json' });
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
        <Field id="s-district" label="Район">
          <select id="s-district" className="input" value={me.district ?? ''} onChange={(e) => save({ district: e.target.value })}>
            <option value="" disabled>
              Выберите район
            </option>
            {DISTRICTS.map((d) => (
              <option key={d}>{d}</option>
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
        <label className="check">
          <input type="checkbox" checked={n.push} onChange={(e) => setNotify({ push: e.target.checked })} />
          <span>
            Push-уведомления
            <br />
            <span className="small muted">На iPhone работают, только если добавить Кровинку на экран «Домой».</span>
          </span>
        </label>
        {me.noChannels && <p className="alarm">Оба канала выключены: SOS-запросы до вас не дойдут.</p>}
      </section>

      <section className="section">
        <h2>Способы входа</h2>
        <div className="card stack">
          {me.providers.map((p) => (
            <div className="row between" key={p}>
              <span>{PROVIDERS[p] ?? p}</span>
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
