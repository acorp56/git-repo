import { describe, expect, it } from 'vitest';
import {
  compatibleDonorGroups,
  eligibility,
  groupCompatible,
  inQuietHours,
  level,
  redFlagResult,
  ruleResult,
  safeReturnTo,
  shouldNotifySos,
  DEFAULT_NOTIFY,
  validateSos,
  drops,
  type EligibilityInput,
} from './index';

const now = new Date(2026, 9, 1);
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

const goodDog: EligibilityInput = {
  species: 'dog',
  birthDate: new Date(2022, 0, 1),
  weightKg: 30,
  chronic: false,
  outdoor: false,
  lastDonation: null,
  vaccinations: [
    { kind: 'vac', date: daysAgo(100) },
    { kind: 'rab', date: daysAgo(100) },
  ],
};

describe('eligibility', () => {
  it('здоровая собака 4 лет, 30 кг, с прививками готова', () => {
    const e = eligibility(goodDog, now);
    expect(e.fit).toBe(true);
    expect(e.ready).toBe(true);
  });

  it('вес меньше 25 кг для собаки и 4 кг для кошки не подходит', () => {
    expect(eligibility({ ...goodDog, weightKg: 24.9 }, now).fit).toBe(false);
    expect(eligibility({ ...goodDog, species: 'cat', weightKg: 3.9 }, now).fit).toBe(false);
    expect(eligibility({ ...goodDog, species: 'cat', weightKg: 4 }, now).fit).toBe(true);
  });

  it('возраст 1–8 лет', () => {
    expect(eligibility({ ...goodDog, birthDate: daysAgo(200) }, now).fit).toBe(false);
    expect(eligibility({ ...goodDog, birthDate: new Date(2017, 0, 1) }, now).fit).toBe(false);
    expect(eligibility({ ...goodDog, birthDate: new Date(2018, 0, 1) }, now).fit).toBe(true);
  });

  it('без прививок или с просроченной не подходит', () => {
    expect(eligibility({ ...goodDog, vaccinations: [] }, now).fit).toBe(false);
    expect(eligibility({ ...goodDog, vaccinations: [{ kind: 'vac', date: daysAgo(10) }] }, now).fit).toBe(false);
    expect(
      eligibility({ ...goodDog, vaccinations: [{ kind: 'vac', date: daysAgo(10) }, { kind: 'rab', date: daysAgo(400) }] }, now).fit,
    ).toBe(false);
  });

  it('уличная кошка не подходит, собаке улица не мешает', () => {
    expect(eligibility({ ...goodDog, species: 'cat', weightKg: 5, outdoor: true }, now).fit).toBe(false);
    expect(eligibility({ ...goodDog, outdoor: true }, now).fit).toBe(true);
  });

  it('интервал после сдачи: 60 дней собаке, 90 кошке', () => {
    const dog = eligibility({ ...goodDog, lastDonation: daysAgo(50) }, now);
    expect(dog.fit).toBe(true);
    expect(dog.ready).toBe(false);
    expect(dog.daysLeft).toBe(10);
    expect(eligibility({ ...goodDog, lastDonation: daysAgo(60) }, now).ready).toBe(true);
    const cat = eligibility({ ...goodDog, species: 'cat', weightKg: 5, lastDonation: daysAgo(80) }, now);
    expect(cat.ready).toBe(false);
    expect(cat.daysLeft).toBe(10);
  });
});

describe('совместимость групп', () => {
  it('кошкам только та же группа', () => {
    expect(groupCompatible('cat', 'A', 'A')).toBe(true);
    expect(groupCompatible('cat', 'A', 'B')).toBe(false);
    expect(groupCompatible('cat', 'AB', 'A')).toBe(false);
  });
  it('собаке DEA 1.1− только от DEA 1.1−, DEA 1.1+ — от всех', () => {
    expect(groupCompatible('dog', 'DEA1.1-', 'DEA1.1+')).toBe(false);
    expect(groupCompatible('dog', 'DEA1.1-', 'DEA1.1-')).toBe(true);
    expect(compatibleDonorGroups('dog', 'DEA1.1+')).toEqual(['DEA1.1-', 'DEA1.1+', 'unknown']);
  });
  it('неизвестная группа реципиента — подходят все', () => {
    expect(compatibleDonorGroups('cat', 'unknown')).toEqual(['A', 'B', 'AB', 'unknown']);
  });
});

describe('уровни', () => {
  it('границы уровней', () => {
    expect(level(0).name).toBe('Новичок');
    expect(level(99).name).toBe('Новичок');
    expect(level(100).name).toBe('Помощник');
    expect(level(200).progress).toBeCloseTo(0.5);
    expect(level(5000)).toMatchObject({ name: 'Легенда Петербурга', to: null, progress: 1 });
  });
  it('склонение капель', () => {
    expect([1, 2, 5, 11, 21, 150].map(drops)).toEqual(['1 капля', '2 капли', '5 капель', '11 капель', '21 капля', '150 капель']);
  });
});

describe('симптом-чекер', () => {
  it('тревожные признаки дают «срочно» без ИИ', () => {
    const r = redFlagResult('Собаку сбила машина, дёсны бледные');
    expect(r?.level).toBe('urgent');
    expect(r?.bloodRisk).toBe(true);
    expect(redFlagResult('съел ксилит из жвачки')?.level).toBe('urgent');
    expect(redFlagResult('немного чихает')).toBeNull();
  });
  it('«яд» ловится как отдельное слово', () => {
    expect(redFlagResult('нашёл крысиный яд')?.level).toBe('urgent');
    expect(redFlagResult('ядро ореха')).toBeNull();
  });
  it('запасной вердикт по ответам', () => {
    expect(ruleResult(['Сегодня', 'Как обычно', 'Почти не встаёт']).level).toBe('urgent');
    expect(ruleResult(['Сегодня', 'Совсем нет', 'Как обычно']).level).toBe('today');
    expect(ruleResult(['Меньше часа назад', 'Как обычно', 'Как обычно']).level).toBe('watch');
  });
});

describe('SOS', () => {
  const base = { species: 'dog', petName: 'Джесси', weightKg: '28,5', bloodGroup: 'unknown', clinicId: 'c1', urgency: 'now' };
  it('принимает вес с запятой', () => {
    const r = validateSos(base);
    expect(r.ok && r.value.weightKg).toBe(28.5);
  });
  it('проверяет вес по виду и группу по виду', () => {
    expect(validateSos({ ...base, species: 'cat', weightKg: 30 }).ok).toBe(false);
    expect(validateSos({ ...base, bloodGroup: 'A' }).ok).toBe(false);
    expect(validateSos({ ...base, petName: ' ' }).ok).toBe(false);
  });
});

describe('уведомления', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h - 3, 0));
  it('тихие часы через полночь, по Москве', () => {
    expect(inQuietHours(DEFAULT_NOTIFY, at(23))).toBe(true);
    expect(inQuietHours(DEFAULT_NOTIFY, at(3))).toBe(true);
    expect(inQuietHours(DEFAULT_NOTIFY, at(8))).toBe(false);
    expect(inQuietHours(DEFAULT_NOTIFY, at(14))).toBe(false);
  });
  it('ночью SOS только тем, кто разрешил будить', () => {
    expect(shouldNotifySos(DEFAULT_NOTIFY, at(2))).toBe(false);
    expect(shouldNotifySos({ ...DEFAULT_NOTIFY, night: true }, at(2))).toBe(true);
    expect(shouldNotifySos({ ...DEFAULT_NOTIFY, telegram: false, push: false }, at(14))).toBe(false);
  });
});

describe('safeReturnTo', () => {
  it('пропускает только пути внутри сайта', () => {
    expect(safeReturnTo('/requests/1?x=1')).toBe('/requests/1?x=1');
    for (const bad of ['//evil.ru', '/\\evil.ru', '/\t/evil.ru', 'https://evil.ru', undefined, ['/a']]) {
      expect(safeReturnTo(bad)).toBe('/');
    }
  });
});
