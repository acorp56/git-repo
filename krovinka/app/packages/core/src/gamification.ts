// Уровни, капли и награды. Перенесено из прототипа: LEVELS, EARN, BADGES, CHALLENGES.
// Считается только на сервере: клиент получает готовые цифры.

export const LEVELS: [minXp: number, name: string][] = [
  [0, 'Новичок'],
  [100, 'Помощник'],
  [300, 'Донор'],
  [700, 'Постоянный донор'],
  [1500, 'Почётный донор'],
  [3000, 'Легенда Петербурга'],
];

export const EARN = {
  donation: { points: 150, title: 'Сдача крови' },
  respond: { points: 20, title: 'Отклик на SOS' },
  invite: { points: 50, title: 'Приглашённый донор' },
  newDonorPet: { points: 50, title: 'Новый питомец-донор' },
  challenge: { points: 20, title: 'Выполненное задание недели' },
  badge: { points: 30, title: 'Новая награда' },
  share: { points: 10, title: 'Поделиться запросом' },
  medMark: { points: 5, title: 'Отметка в медкарте' },
  guide: { points: 5, title: 'Прочитанная инструкция' },
} as const;
export type EarnKind = keyof typeof EARN;

export interface Level {
  index: number;
  name: string;
  from: number;
  to: number | null;
  next: string | null;
  /** Прогресс до следующего уровня, 0..1. */
  progress: number;
}

export function level(xp: number): Level {
  let i = 0;
  LEVELS.forEach(([min], k) => {
    if (xp >= min) i = k;
  });
  const [from, name] = LEVELS[i]!;
  const nx = LEVELS[i + 1];
  return {
    index: i,
    name,
    from,
    to: nx ? nx[0] : null,
    next: nx ? nx[1] : null,
    progress: nx ? (xp - from) / (nx[0] - from) : 1,
  };
}

export interface Stats {
  donations: number;
  fast: number;
  night: number;
  rare: number;
  responds: number;
  shares: number;
  invites: number;
  medMarks: number;
  guides: number;
  tg: number;
}

export interface Badge {
  id: string;
  symbol: string;
  title: string;
  description: string;
  goal: number;
  stat: keyof Stats;
}

export const BADGES: Badge[] = [
  { id: 'first', symbol: '1', title: 'Первая капля', description: 'Сдать кровь первый раз', goal: 1, stat: 'donations' },
  { id: 'three', symbol: '3', title: 'Три жизни', description: 'Сдать кровь 3 раза', goal: 3, stat: 'donations' },
  { id: 'ten', symbol: '10', title: 'Десятка', description: 'Сдать кровь 10 раз', goal: 10, stat: 'donations' },
  { id: 'fast', symbol: '10′', title: 'Быстрее скорой', description: 'Откликнуться на SOS за 10 минут', goal: 1, stat: 'fast' },
  { id: 'night', symbol: '24/7', title: 'Ночной герой', description: 'Помочь ночью', goal: 1, stat: 'night' },
  { id: 'rare', symbol: 'RH', title: 'Редкая кровь', description: 'Группа DEA 1.1− или B у кошки', goal: 1, stat: 'rare' },
  { id: 'resp', symbol: 'SOS', title: 'Всегда рядом', description: 'Откликнуться на 5 запросов', goal: 5, stat: 'responds' },
  { id: 'voice', symbol: '↗', title: 'Голос района', description: 'Поделиться 5 запросами', goal: 5, stat: 'shares' },
  { id: 'mentor', symbol: '+3', title: 'Наставник', description: 'Привести 3 новых доноров', goal: 3, stat: 'invites' },
  { id: 'care', symbol: '✓', title: 'Всё по графику', description: 'Отметить 5 процедур в медкарте', goal: 5, stat: 'medMarks' },
  { id: 'aid', symbol: '+', title: 'Первая помощь', description: 'Прочитать 3 инструкции', goal: 3, stat: 'guides' },
  { id: 'tg', symbol: 'TG', title: 'На связи', description: 'Подключить Telegram', goal: 1, stat: 'tg' },
];

export function earnedBadges(stats: Stats): Badge[] {
  return BADGES.filter((b) => stats[b.stat] >= b.goal);
}

export const CHALLENGES = [
  { id: 'wkShares', title: 'Поделитесь 2 запросами о помощи', goal: 2, points: 30 },
  { id: 'wkMed', title: 'Отметьте процедуру в медкарте', goal: 1, points: 20 },
  { id: 'wkGuide', title: 'Прочитайте инструкцию первой помощи', goal: 1, points: 20 },
] as const;

export function drops(n: number): string {
  const a = Math.abs(n) % 100;
  const m = a % 10;
  const w = a > 10 && a < 20 ? 'капель' : m === 1 ? 'капля' : m > 1 && m < 5 ? 'капли' : 'капель';
  return `${n} ${w}`;
}
