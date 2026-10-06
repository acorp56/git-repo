import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Top } from '@/components/ui';
import { LEGAL } from '@/lib/legal';

export function generateStaticParams() {
  return Object.keys(LEGAL).map((doc) => ({ doc }));
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const entry = LEGAL[doc];
  if (!entry) notFound();
  const [title, sections] = entry;
  return (
    <>
      <Top back="/settings" />
      <h1 className="page-title" style={{ fontSize: 30 }}>
        {title}
      </h1>
      <p className="notice" style={{ marginTop: 12 }}>
        Шаблон. Перед запуском текст должен проверить юрист.
      </p>
      <div className="seg" role="group" style={{ marginTop: 12 }}>
        {[
          ['terms', 'Соглашение'],
          ['privacy', 'Данные'],
          ['medical', 'Медицина'],
        ].map(([k, l]) => (
          <Link key={k} href={`/legal/${k}`} className="btn" aria-current={k === doc ? 'page' : undefined}>
            {l}
          </Link>
        ))}
      </div>
      <section className="section legal">
        {sections.map(([h, t], i) => (
          <div key={h}>
            <h3>
              {i + 1}. {h}
            </h3>
            <p>{t}</p>
          </div>
        ))}
      </section>
    </>
  );
}
