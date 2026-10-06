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

// Компонент крови, который назначил врач. Донор всегда сдаёт цельную кровь.
export type Component = 'whole' | 'plasma' | 'rbc';
export const COMPONENTS: Component[] = ['whole', 'plasma', 'rbc'];
export const COMPONENT_LABEL: Record<Component, string> = { whole: 'Цельная кровь', plasma: 'Плазма', rbc: 'Эритроцитная масса' };

/**
 * Радиусы волн рассылки SOS, км. Первая волна — 10 км, последняя — 50 км («план Б» из прототипа).
 * Если кровь нужна питомцу, который сам сдавал кровь, первая волна сразу 20 км.
 */
export const WAVE_RADII_KM = [10, 20, 50] as const;
export const PRIORITY_WAVE_RADII_KM = [20, 50] as const;
export const wavesFor = (priority: boolean): readonly number[] => (priority ? PRIORITY_WAVE_RADII_KM : WAVE_RADII_KM);
