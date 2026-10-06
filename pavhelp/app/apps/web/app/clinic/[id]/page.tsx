'use client';
// Кабинет клиники: запросы, сдачи вне Павхелпа, банк крови.
// В рабочей версии — отдельный веб-кабинет с ролями и входом по приглашению; здесь — минимальный экран для сотрудников.
import { BLOOD_GROUP_LABEL, BLOOD_GROUPS, COMPONENT_LABEL, COMPONENTS, SPECIES_LABEL, URGENCY_LABEL, type BloodGroup, type Component, type Species, type Urgency } from '@pavhelp/core';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Seg, StateCard, Top, useRequireLogin } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fmtDate, group } from '@/lib/format';

interface Cabinet {
  clinic: { id: string; name: string; city: string; address: string };
  requests: {
    id: string;
    petName: string;
    species: Species;
    weightKg: number;
    bloodGroup: BloodGroup;
    component: Component;
    volumeMl: number | null;
    urgency: Urgency;
    status: string;
    clinicStatus: 'pending' | 'confirmed' | 'rejected';
    createdAt: string;
  }[];
  donations: { id: string; date: string; petName: string; species: Species; bloodGroup: BloodGroup; chip: string | null }[];
  stock: { id: string; species: Species; bloodGroup: BloodGroup; component: Component; doses: number; doseMl: number; updatedAt: string }[];
}

type Tab = 'requests' | 'donations' | 'stock';

export default function ClinicPage() {
  const { id } = useParams<{ id: string }>();
  const ready = useRequireLogin();
  const [c, setC] = useState<Cabinet | null>(null);
  const [tab, setTab] = useState<Tab>('requests');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api<Cabinet>(`/clinic/${id}`)
      .then(setC)
      .catch((e: ApiError) => setError(e.message));
  }, [id]);
  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  async function run(path: string, body: unknown, done: string, method = 'POST') {
    setNote('');
    try {
      await api(`/clinic/${id}/${path}`, { method, body });
      setNote(done);
      load();
    } catch (e) {
      setNote((e as ApiError).message);
    }
  }

  if (!ready) return <Top back="/settings" />;
  if (error) return (<><Top back="/settings" /><StateCard bad title="Нет доступа" text={error} /></>);
  if (!c) return (<><Top back="/settings" /><p className="muted">Загружаем…</p></>);

  const pending = c.requests.filter((r) => r.clinicStatus === 'pending').length;
  return (
    <>
      <Top back="/settings" />
      <h1 className="page-title" style={{ fontSize: 30 }}>
        {c.clinic.name}
      </h1>
      <p className="muted small" style={{ marginBottom: 12 }}>
        Кабинет клиники · {c.clinic.city}, {c.clinic.address}
      </p>
      <Seg
        label="Раздел"
        value={tab}
        onChange={setTab}
        options={[
          ['requests', `Запросы${pending ? ` · ${pending}` : ''}`],
          ['donations', `Сдачи${c.donations.length ? ` · ${c.donations.length}` : ''}`],
          ['stock', 'Банк крови'],
        ]}
      />
      {note && <p className="notice" role="status" style={{ marginTop: 12 }}>{note}</p>}

      {tab === 'requests' && (
        <section className="section">
          <p className="small muted">«Питомец у нас» ставит отметку «Клиника подтвердила»: доноры доверяют таким запросам больше. «Не у нас» отправляет запрос модератору.</p>
          {c.requests.length === 0 && <StateCard title="Запросов нет" text="Здесь появятся SOS, в которых указана ваша клиника." />}
          {c.requests.map((r) => (
            <div className="card stack" key={r.id}>
              <div className="row between">
                <b>
                  {r.petName} <span className="lt">· {SPECIES_LABEL[r.species]}</span>
                </b>
                <span className={`chip ${r.clinicStatus === 'confirmed' ? 'ok' : r.clinicStatus === 'rejected' ? 'red' : 'warn'}`}>
                  {r.clinicStatus === 'confirmed' ? 'Подтверждён' : r.clinicStatus === 'rejected' ? 'Не у нас' : 'Ждёт проверки'}
                </span>
              </div>
              <span className="small muted">
                {URGENCY_LABEL[r.urgency]} · {r.weightKg} кг · {group(r.bloodGroup)} · {COMPONENT_LABEL[r.component]}
                {r.volumeMl ? `, ${r.volumeMl} мл` : ''}
              </span>
              {r.clinicStatus === 'pending' && (
                <div className="btns">
                  <button className="btn primary grow" onClick={() => run(`requests/${r.id}`, { ok: true }, 'Запрос подтверждён')}>
                    Питомец у нас
                  </button>
                  <button className="btn grow" onClick={() => confirm('Отправить запрос модератору?') && run(`requests/${r.id}`, { ok: false }, 'Запрос отправлен модератору')}>
                    Не у нас
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {tab === 'donations' && (
        <section className="section">
          <p className="small muted">Доноры, которые сдали кровь у вас без Павхелпа. Подтверждение начисляет донору капли и открывает бонусы.</p>
          {c.donations.length === 0 && <StateCard title="Нет сдач на проверке" text="Когда донор отметит сдачу в вашей клинике, она появится здесь." />}
          {c.donations.map((d) => (
            <div className="card stack" key={d.id}>
              <b>
                {d.petName} <span className="lt">· {SPECIES_LABEL[d.species]}, {BLOOD_GROUP_LABEL[d.bloodGroup]}</span>
              </b>
              <span className="small muted">
                {fmtDate(d.date)}
                {d.chip ? ` · чип ${d.chip}` : ''}
              </span>
              <div className="btns">
                <button className="btn primary grow" onClick={() => run(`donations/${d.id}`, { ok: true }, 'Сдача подтверждена')}>
                  Подтвердить
                </button>
                <button className="btn grow" onClick={() => run(`donations/${d.id}`, { ok: false }, 'Отмечено: сдачи не было')}>
                  Не было
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'stock' && <Stock c={c} run={run} />}
    </>
  );
}

function Stock({ c, run }: { c: Cabinet; run: (path: string, body: unknown, done: string, method?: string) => Promise<void> }) {
  const [n, setN] = useState<{ species: Species; bloodGroup: BloodGroup; component: Component; doses: string; doseMl: string }>({
    species: 'dog',
    bloodGroup: 'DEA1.1+',
    component: 'whole',
    doses: '1',
    doseMl: '450',
  });
  return (
    <section className="section">
      <p className="small muted">Изменения сразу видны хозяевам в форме SOS и в разделе «Банки крови».</p>
      {c.stock.map((s) => (
        <div className="card row between" key={s.id}>
          <span className="grow">
            <b>
              {COMPONENT_LABEL[s.component]}, {SPECIES_LABEL[s.species]} {BLOOD_GROUP_LABEL[s.bloodGroup]}
            </b>
            <br />
            <span className="small muted">
              доза {s.doseMl} мл · обновлено {new Date(s.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn" aria-label="Минус доза" disabled={s.doses <= 0} onClick={() => run(`stock/${s.id}`, { doses: s.doses - 1 }, 'Обновлено', 'PATCH')}>
              −
            </button>
            <b className="num" style={{ minWidth: 24, textAlign: 'center' }}>
              {s.doses}
            </b>
            <button className="btn" aria-label="Плюс доза" onClick={() => run(`stock/${s.id}`, { doses: s.doses + 1 }, 'Обновлено', 'PATCH')}>
              +
            </button>
          </span>
        </div>
      ))}
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run('stock', { ...n, doses: Number(n.doses), doseMl: Number(n.doseMl) }, 'Позиция добавлена');
        }}
      >
        <b>Добавить позицию</b>
        <Seg
          label="Вид"
          value={n.species}
          onChange={(v) => setN({ ...n, species: v, bloodGroup: v === 'dog' ? 'DEA1.1+' : 'A' })}
          options={[
            ['dog', 'Собака'],
            ['cat', 'Кошка'],
          ]}
        />
        <Seg
          label="Группа"
          value={n.bloodGroup}
          onChange={(v) => setN({ ...n, bloodGroup: v })}
          options={BLOOD_GROUPS[n.species].filter((g) => g !== 'unknown').map((g) => [g, BLOOD_GROUP_LABEL[g]] as [BloodGroup, string])}
        />
        <Seg label="Компонент" value={n.component} onChange={(v) => setN({ ...n, component: v })} options={COMPONENTS.map((x) => [x, COMPONENT_LABEL[x]] as [Component, string])} />
        <div className="row">
          <label className="grow field">
            <span className="flabel">Доз</span>
            <input className="input" inputMode="numeric" value={n.doses} onChange={(e) => setN({ ...n, doses: e.target.value.replace(/\D/g, '') })} />
          </label>
          <label className="grow field">
            <span className="flabel">Объём дозы, мл</span>
            <input className="input" inputMode="numeric" value={n.doseMl} onChange={(e) => setN({ ...n, doseMl: e.target.value.replace(/\D/g, '') })} />
          </label>
        </div>
        <button className="btn primary">Добавить</button>
      </form>
    </section>
  );
}
