'use client';
import { GUIDES, type CheckResult } from '@krovinka/core';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Top } from '@/components/ui';
import { api, ApiError, type Clinic } from '@/lib/api';

type Q = { q: string; options: string[] };

const LEVEL_CLASS = { urgent: 'alarm', today: 'notice', watch: 'card' } as const;

export default function Aid() {
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [text, setText] = useState('');
  const [questions, setQuestions] = useState<Q[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Clinic[]>('/clinics').then((cs) => setClinics(cs.filter((c) => c.night))).catch(() => {});
  }, []);

  async function check(ans?: string[]) {
    setError('');
    try {
      const r = await api<{ result?: CheckResult; questions?: Q[] }>('/check', { body: { text, answers: ans } });
      if (r.result) {
        setResult(r.result);
        setQuestions(null);
      } else {
        setQuestions(r.questions!);
        setAnswers([]);
      }
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  const reset = () => {
    setResult(null);
    setQuestions(null);
    setText('');
  };

  return (
    <>
      <Top />
      <h1 className="page-title">Экстренно</h1>

      <section className="section">
        <h2>Круглосуточные клиники</h2>
        {clinics.map((c) => (
          <div className="card row between" key={c.id}>
            <span>
              <b>{c.name}</b>
              <br />
              <span className="small muted">{c.address}</span>
            </span>
            <a className="btn" href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}>
              Позвонить
            </a>
          </div>
        ))}
      </section>

      <section className="section">
        <h2>Насколько это срочно?</h2>
        <p className="small muted">Помогает оценить срочность, но не ставит диагноз. При сомнении звоните в клинику.</p>
        {!questions && !result && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void check();
            }}
          >
            <label htmlFor="sym" className="sr">
              Что происходит с питомцем
            </label>
            <textarea id="sym" className="input" placeholder="Например: собака вялая, не ест со вчерашнего дня" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn primary" disabled={!text.trim()}>
              Оценить
            </button>
          </form>
        )}
        {questions && (
          <div className="card stack">
            {questions.map((q, i) => (
              <div className="field" key={q.q}>
                <span className="flabel">{q.q}</span>
                <div className="seg">
                  {q.options.map((o) => (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={answers[i] === o}
                      onClick={() => setAnswers((a) => Object.assign([...a], { [i]: o }))}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button className="btn primary" disabled={questions.some((_, i) => !answers[i])} onClick={() => check(answers)}>
              Узнать результат
            </button>
          </div>
        )}
        {result && (
          <div className={`${LEVEL_CLASS[result.level]} stack`} role="status">
            <h2>{result.title}</h2>
            {result.why && <p>{result.why}</p>}
            {result.do.length > 0 && (
              <>
                <b>Что сделать сейчас</b>
                <ul>{result.do.map((d) => <li key={d}>{d}</li>)}</ul>
              </>
            )}
            {result.dont.length > 0 && (
              <>
                <b>Чего не делать</b>
                <ul>{result.dont.map((d) => <li key={d}>{d}</li>)}</ul>
              </>
            )}
            {result.watchFor.length > 0 && (
              <>
                <b>Сразу в клинику, если</b>
                <ul>{result.watchFor.map((d) => <li key={d}>{d}</li>)}</ul>
              </>
            )}
            {result.bloodRisk && (
              <Link className="btn red" href="/sos">
                Может понадобиться кровь — создать SOS
              </Link>
            )}
            <button className="btn" onClick={reset}>
              Проверить другое
            </button>
          </div>
        )}
        {error && <p className="alarm">{error}</p>}
      </section>

      <section className="section">
        <h2>Первая помощь</h2>
        {GUIDES.map((g) => (
          <details className="card guide" key={g.id}>
            <summary>{g.title}</summary>
            <p className="alarm" style={{ marginTop: 12 }}>
              {g.alarm}
            </p>
            <ol>
              {g.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {g.sos && (
              <Link className="btn red" href="/sos" style={{ marginTop: 12 }}>
                Создать SOS
              </Link>
            )}
          </details>
        ))}
      </section>
    </>
  );
}
