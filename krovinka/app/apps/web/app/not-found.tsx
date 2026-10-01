import Link from 'next/link';
import { StateCard, Top } from '@/components/ui';

export default function NotFound() {
  return (
    <>
      <Top />
      <StateCard title="Страница не найдена" text="Возможно, запрос уже удалён или ссылка с ошибкой.">
        <Link className="btn primary" href="/">
          На главную
        </Link>
      </StateCard>
    </>
  );
}
