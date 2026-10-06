import { Top } from '@/components/ui';

const STEPS = [
  'Откройте Павхелп в Safari: в других браузерах на iPhone эта кнопка не работает.',
  'Нажмите «Поделиться» — квадрат со стрелкой вверх внизу экрана.',
  'Прокрутите список и выберите «На экран „Домой“».',
  'Нажмите «Добавить». Иконка с каплей появится на экране «Домой».',
  'Откройте Павхелп с этой иконки и разрешите уведомления в настройках.',
];

export default function IosPage() {
  return (
    <>
      <Top back="/settings" />
      <h1 className="page-title">На экран «Домой»</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        iPhone показывает push-уведомления сайтов, только если сайт добавлен на экран «Домой». Без этого SOS придут только в Telegram.
      </p>
      <ol className="card stack" style={{ paddingLeft: 36 }}>
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </>
  );
}
