// Справочники предметной области. Перенесены из прототипа (DISTRICTS, DIST_C, URG, TRIP).

export type Species = 'dog' | 'cat';
export const SPECIES: Species[] = ['dog', 'cat'];
export const SPECIES_LABEL: Record<Species, string> = { dog: 'собака', cat: 'кошка' };

// Группы крови храним латиницей, подписи для интерфейса — в BLOOD_GROUP_LABEL.
export type DogGroup = 'DEA1.1-' | 'DEA1.1+';
export type CatGroup = 'A' | 'B' | 'AB';
export type BloodGroup = DogGroup | CatGroup | 'unknown';

export const BLOOD_GROUPS: Record<Species, BloodGroup[]> = {
  dog: ['DEA1.1-', 'DEA1.1+', 'unknown'],
  cat: ['A', 'B', 'AB', 'unknown'],
};
export const BLOOD_GROUP_LABEL: Record<BloodGroup, string> = {
  'DEA1.1-': 'DEA 1.1−',
  'DEA1.1+': 'DEA 1.1+',
  A: 'A',
  B: 'B',
  AB: 'AB',
  unknown: 'не знаю',
};

export function isBloodGroupFor(species: Species, group: string): group is BloodGroup {
  return (BLOOD_GROUPS[species] as string[]).includes(group);
}

export type Urgency = 'now' | 'today' | 'plan';
export const URGENCY: Urgency[] = ['now', 'today', 'plan'];
export const URGENCY_LABEL: Record<Urgency, string> = { now: 'Критично', today: 'Сегодня', plan: 'Плановая' };

export type RequestStatus = 'open' | 'donor_chosen' | 'closed';
export type ResponseStatus = 'offered' | 'chosen' | 'declined' | 'cancelled';

// Путь донора после выбора: индекс — trip_status в базе.
export const TRIP_STEPS = ['Выбран', 'Выехал', 'В пути', 'На месте', 'Кровь взяли'] as const;
export const TRIP = { chosen: 0, left: 1, onTheWay: 2, arrived: 3, done: 4 } as const;

export type LatLng = [lat: number, lng: number];

// Центры районов Петербурга. Точные координаты пользователя никому не показываем — только район.
export const DISTRICT_CENTER: Record<string, LatLng> = {
  'Адмиралтейский': [59.9155, 30.298],
  'Василеостровский': [59.942, 30.25],
  'Выборгский': [60.045, 30.33],
  'Калининский': [60.0, 30.39],
  'Кировский': [59.879, 30.261],
  'Красногвардейский': [59.97, 30.47],
  'Московский': [59.852, 30.32],
  'Невский': [59.895, 30.46],
  'Петроградский': [59.966, 30.31],
  'Приморский': [60.0, 30.25],
  'Фрунзенский': [59.87, 30.38],
  'Центральный': [59.933, 30.36],
};
export const DISTRICTS = Object.keys(DISTRICT_CENTER);

export function isDistrict(v: unknown): v is string {
  return typeof v === 'string' && v in DISTRICT_CENTER;
}

/** Расстояние по большой окружности, км. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r;
  const dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestDistrict(pt: LatLng): { name: string; km: number } {
  let best = DISTRICTS[0]!;
  let bestKm = Infinity;
  for (const [name, c] of Object.entries(DISTRICT_CENTER)) {
    const km = haversineKm(pt, c);
    if (km < bestKm) {
      bestKm = km;
      best = name;
    }
  }
  return { name: best, km: bestKm };
}

/** Радиусы волн рассылки SOS, км. Первая волна — 10 км, как в сценарии MVP. */
export const WAVE_RADII_KM = [10, 20, 40] as const;
