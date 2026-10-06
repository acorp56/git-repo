'use client';
// Поддержка: FAQ и обращение. Пока helpdesk нет, обращение уходит письмом.
// TODO: helpdesk с ответом в Telegram и списком обращений со статусом.
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Seg, Top } from '@/components/ui';
import { useSession } from '@/lib/session';

const FAQ: [string, string][] = [
  ['Это правда бесплатно?', 'Да. Павхелп ничего не берёт ни с хозяев, ни с доноров. За кровь не платят и не просят денег. Если просят, это мошенники: нажмите «Пожаловаться».'],
  ['Не приходят SOS', 'Проверьте в настройках, что включены SOS и хотя бы один канал: Telegram или push. На iPhone push работает, только если Павхелп добавлен на экран «Домой». Ещё SOS не приходят, если питомец на паузе или не подходит по требованиям.'],
  ['Почему питомец «не подходит»?', 'В карточке питомца видно, какое условие не выполнено: возраст, вес, прививки, лечение или интервал после прошлой сдачи.'],
  ['Сдача не засчиталась', 'Сдачу подтверждает клиника или хозяин, которому вы помогли. Обычно это занимает до суток. Если прошло больше, напишите нам.'],
  ['Как удалить аккаунт?', 'Настройки → Данные → Удалить аккаунт. Профиль, питомцы и переписка удалятся.'],
];

const TOPICS: [string, string][] = [
  ['q', 'Вопрос'],
  ['bug', 'Ошибка'],
  ['report', 'Жалоба'],
  ['limit', 'Снять лимит SOS'],
];

function Support() {
  const params = useSearchParams();
  const { me } = useSession();
  const [topic, setTopic] = useState(params.get('topic') ?? 'q');
  const [text, setText] = useState('');
  const subject = `Павхелп: ${TOPICS.find(([k]) => k === topic)?.[1] ?? 'Вопрос'}`;
  const body = `${text}\n\n—\nАккаунт: ${me?.email ?? me?.id ?? 'не вошёл'}`;
  return (
    <>
      <Top back="/settings" />
      <h1 className="page-title">Поддержка</h1>
      <p className="muted">Обычно отвечаем в течение 15 минут с 8:00 до 23:00. По срочным SOS — круглосуточно.</p>
      <section className="section">
        <h2>Частые вопросы</h2>
        {FAQ.map(([q, a]) => (
          <details className="card guide" key={q}>
            <summary>{q}</summary>
            <p style={{ marginTop: 10 }}>{a}</p>
          </details>
        ))}
      </section>
      <section className="section">
        <h2>Написать нам</h2>
        <div className="card stack">
          <Seg label="Тема" value={topic} onChange={setTopic} options={TOPICS} />
          <label htmlFor="sup-text" className="flabel">
            Сообщение
          </label>
          <textarea
            id="sup-text"
            className="input"
            placeholder="Опишите, что случилось. Если это про конкретный запрос, укажите кличку питомца"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <a className="btn primary" href={`mailto:help@pavhelp.ru?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
            Отправить письмом
          </a>
          <span className="small muted">Можно написать и напрямую: @pavhelp_support в Telegram, help@pavhelp.ru</span>
        </div>
      </section>
    </>
  );
}

export default function SupportPage() {
  return (
    <Suspense>
      <Support />
    </Suspense>
  );
}
