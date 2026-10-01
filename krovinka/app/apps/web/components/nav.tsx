'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const Icon = {
  home: <path d="M2.6 11.2l9.4-7.4 9.4 7.4v9.3a1.2 1.2 0 0 1-1.2 1.2h-5.4v-6.2h-5.6v6.2H3.8a1.2 1.2 0 0 1-1.2-1.2z" fill="currentColor" />,
  list: (
    <g fill="currentColor">
      <rect x="7.5" y="4.6" width="14" height="2.8" rx="1.4" />
      <rect x="7.5" y="10.6" width="14" height="2.8" rx="1.4" />
      <rect x="7.5" y="16.6" width="14" height="2.8" rx="1.4" />
      <circle cx="3.5" cy="6" r="1.9" />
      <circle cx="3.5" cy="12" r="1.9" />
      <circle cx="3.5" cy="18" r="1.9" />
    </g>
  ),
  aid: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6V4h6v2" />
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <path d="M12 10v6M9 13h6" />
    </g>
  ),
  user: (
    <g fill="currentColor">
      <circle cx="12" cy="8" r="4.6" />
      <path d="M3.5 21c1.6-4.4 4.8-6.6 8.5-6.6s6.9 2.2 8.5 6.6z" />
    </g>
  ),
};

const TABS = [
  { href: '/', label: 'Главная', icon: Icon.home },
  { href: '/requests', label: 'Запросы', icon: Icon.list },
  { href: '/sos', label: 'SOS', fab: true },
  { href: '/aid', label: 'Помощь', icon: Icon.aid },
  { href: '/profile', label: 'Профиль', icon: Icon.user },
];

export function Nav() {
  const path = usePathname();
  if (path.startsWith('/r/')) return null; // публичная страница запроса — без навигации
  return (
    <nav className="nav" aria-label="Основная навигация">
      <ul>
        {TABS.map((t) => {
          const active = t.href === '/' ? path === '/' : path.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? 'page' : undefined} className={t.fab ? 'fab' : undefined}>
                {t.fab ? (
                  <span>SOS</span>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      {t.icon}
                    </svg>
                    {t.label}
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
