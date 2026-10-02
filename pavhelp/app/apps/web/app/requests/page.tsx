'use client';
import { useEffect, useState } from 'react';
import { RequestCard, Seg, StateCard, Top } from '@/components/ui';
import { api, ApiError, type RequestSummary } from '@/lib/api';
import { useSession } from '@/lib/session';

type Scope = 'open' | 'mine' | 'helping';

export default function Requests() {
  const { me } = useSession();
  const [scope, setScope] = useState<Scope>('open');
  const [list, setList] = useState<RequestSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setList(null);
    setError('');
    api<RequestSummary[]>(`/requests?scope=${scope}`)
      .then(setList)
      .catch((e: ApiError) => setError(e.status === 401 ? 'Войдите, чтобы увидеть свои запросы' : e.message));
  }, [scope]);

  return (
    <>
      <Top />
      <h1 className="page-title">Запросы</h1>
      {me && (
        <Seg
          label="Какие запросы показать"
          value={scope}
          onChange={setScope}
          options={[
            ['open', 'Открытые'],
            ['mine', 'Мои'],
            ['helping', 'Я помогаю'],
          ]}
        />
      )}
      <div className="stack" style={{ marginTop: 16 }}>
        {error && <StateCard bad title="Не получилось" text={error} />}
        {list === null && !error && <p className="muted">Загружаем…</p>}
        {list?.length === 0 && (
          <StateCard
            title="Пока пусто"
            text={scope === 'open' ? 'Открытых запросов нет.' : scope === 'mine' ? 'Вы ещё не создавали запросов.' : 'Вы пока ни на что не откликались.'}
          />
        )}
        {list?.map((r) => <RequestCard key={r.id} r={r} />)}
      </div>
    </>
  );
}
