// Симптом-чекер: тревожные признаки и запасной вердикт на правилах.
// Перенесено из прототипа: RED, FALLBACK_Q, cleanResult, ruleResult.
// RED проверяется ДО вызова ИИ и сразу даёт вердикт «срочно» — эту защиту нельзя убирать.

export type CheckLevel = 'urgent' | 'today' | 'watch';

export interface RedFlag {
  pattern: RegExp;
  why: string;
  /** Возможна кровопотеря или анемия — предложить SOS-запрос. */
  bloodRisk: boolean;
}

export const RED_FLAGS: RedFlag[] = [
  { pattern: /бледн|бел(ые|ый) д[её]сн|серые д[её]сн|сини(е|й) д[её]сн|синюшн/i, why: 'Бледные или синие дёсны могут означать кровопотерю или нехватку кислорода.', bloodRisk: true },
  { pattern: /судорог|припад/i, why: 'Судороги требуют срочной помощи врача.', bloodRisk: false },
  { pattern: /задыха|не дыш|хрипит|дышит (с открытым ртом|ртом)|тяжело дыш/i, why: 'Затруднённое дыхание опасно для жизни.', bloodRisk: false },
  { pattern: /кровотеч|кровь (идёт|идет|не останавлив|течёт|течет)|сильно кровит/i, why: 'Сильное кровотечение: прижмите рану и везите в клинику.', bloodRisk: true },
  { pattern: /вздут|раздуло живот|рвёт (пеной|ничем)|позывы.*(безрезультат|ничего)/i, why: 'Вздутие живота с пустыми позывами к рвоте может быть заворотом желудка. Счёт идёт на часы.', bloodRisk: false },
  { pattern: /шоколад|ксилит|жвачк|виноград|изюм|крысин|антифриз|ибупрофен|парацетамол|таблетк|отрав|(^|[^а-яё])яд(а|у|ом|ы|ов|ами)?($|[^а-яё])/i, why: 'Возможное отравление. Звоните в клинику сейчас, не дожидаясь симптомов.', bloodRisk: true },
  { pattern: /без сознания|обморок|не вста[её]т|потерял(а)? сознание|не реагирует/i, why: 'Потеря сознания или неспособность встать требует срочной помощи.', bloodRisk: false },
  { pattern: /сбил|машин|дтп|упал(а)? с|выпал(а)? из окна|травм/i, why: 'После травмы возможны внутренние повреждения и кровопотеря, даже если снаружи всё в порядке.', bloodRisk: true },
  { pattern: /не (писает|мочится|может пописать)|тужится в лоток/i, why: 'Если питомец не может помочиться, это неотложное состояние, особенно у котов.', bloodRisk: false },
  { pattern: /перегрел|тепловой удар/i, why: 'Перегрев опасен: охладите питомца и везите в клинику.', bloodRisk: false },
  { pattern: /т[её]мная моча|моча (цвета|как) (кофе|пив|чая)|коричнев\S* моч/i, why: 'Тёмная моча после укуса клеща бывает при пироплазмозе. Нужен врач сегодня, может понадобиться переливание крови.', bloodRisk: true },
];

export const FALLBACK_QUESTIONS = [
  { q: 'Когда это началось?', options: ['Меньше часа назад', 'Сегодня', 'Несколько дней назад'] },
  { q: 'Ест и пьёт?', options: ['Как обычно', 'Меньше обычного', 'Совсем нет'] },
  { q: 'Насколько активен?', options: ['Как обычно', 'Вялый', 'Почти не встаёт'] },
];

export interface CheckResult {
  level: CheckLevel;
  title: string;
  why: string;
  do: string[];
  dont: string[];
  watchFor: string[];
  bloodRisk: boolean;
  /** Вердикт получен правилами, без ИИ. */
  rules: boolean;
}

const TITLES: Record<CheckLevel, string> = {
  urgent: 'Нужна срочная помощь',
  today: 'Покажите врачу сегодня',
  watch: 'Можно понаблюдать дома',
};

const strArr = (a: unknown, n: number): string[] =>
  Array.isArray(a)
    ? a.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, n).map((x) => x.trim())
    : [];

/** Валидация ответа модели: всё, что не прошло проверку, заменяется безопасными значениями. */
export function cleanResult(raw: unknown, rules = false): CheckResult {
  const j = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const level: CheckLevel = j.level === 'urgent' || j.level === 'today' || j.level === 'watch' ? j.level : 'today';
  return {
    level,
    title: typeof j.title === 'string' && j.title.trim() ? j.title.trim().slice(0, 90) : TITLES[level],
    why: typeof j.why === 'string' ? j.why.trim().slice(0, 400) : '',
    do: strArr(j.do, 4),
    dont: strArr(j.dont, 3),
    watchFor: strArr(j.watchFor, 3),
    bloodRisk: j.bloodRisk === true,
    rules,
  };
}

/** Тревожные признаки в тексте владельца. Если есть хоть один — вердикт «срочно» без ИИ. */
export function redFlagResult(text: string): CheckResult | null {
  const hits = RED_FLAGS.filter((f) => f.pattern.test(text));
  if (!hits.length) return null;
  return {
    level: 'urgent',
    title: TITLES.urgent,
    why: hits.map((h) => h.why).join(' '),
    do: ['Позвоните в круглосуточную клинику и выезжайте', 'Возьмите ветпаспорт', 'Если врач скажет, что нужна кровь, создайте SOS-запрос по дороге'],
    dont: ['Не давайте лекарства для людей', 'Не ждите, пока станет хуже'],
    watchFor: [],
    bloodRisk: hits.some((h) => h.bloodRisk),
    rules: true,
  };
}

/** Запасной вердикт по ответам на FALLBACK_QUESTIONS, если ИИ недоступен. */
export function ruleResult(answers: string[]): CheckResult {
  const a = answers.join(' ');
  const level: CheckLevel = /Почти не встаёт/.test(a)
    ? 'urgent'
    : /Совсем нет|Вялый|Несколько дней|Меньше обычного/.test(a)
      ? 'today'
      : 'watch';
  return {
    level,
    title: TITLES[level],
    why: {
      urgent: 'Питомец почти не встаёт. Это повод ехать в клинику без ожидания.',
      today: 'Вялость, отказ от еды или симптомы дольше суток лучше показать врачу в тот же день.',
      watch: 'Питомец ест и активен, признаков опасности по ответам нет.',
    }[level],
    do:
      level === 'watch'
        ? ['Следите за аппетитом, питьём и активностью', 'Запишите, что и когда происходило, это поможет врачу', 'Оцените состояние снова через 12–24 часа']
        : ['Позвоните в клинику и опишите симптомы', 'Возьмите ветпаспорт', 'Если есть рвота, сфотографируйте её для врача'],
    dont: ['Не давайте лекарства для людей', 'Не меняйте резко корм'],
    watchFor: ['Бледные дёсны или тяжёлое дыхание', 'Рвота или понос с кровью', 'Отказ от воды больше суток'],
    bloodRisk: false,
    rules: true,
  };
}
