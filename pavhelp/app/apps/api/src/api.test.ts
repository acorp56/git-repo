// Интеграционные тесты на настоящей базе с PostGIS.
// База: TEST_DATABASE_URL (по умолчанию pavhelp_test на localhost). Схема пересоздаётся перед запуском.
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { verifyTelegramLogin } from './auth/routes';
import { createPool } from './db';
import { migrate } from './migrate';
import { seedClinics } from './seed';
import { autoCloseStale, expandStaleWaves } from './services/matching';
import { LogMailer, MemoryNotifier } from './services/notify';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://pavhelp:pavhelp@localhost:5432/pavhelp_test';
let pool: pg.Pool;
let app: FastifyInstance;
const notifier = new MemoryNotifier();
const mail = new LogMailer();
// Днём по Москве, чтобы не попадать в тихие часы.
let clock = new Date('2026-10-01T12:00:00+03:00');

beforeAll(async () => {
  pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool, () => {});
  await seedClinics(pool);
  app = await buildApp({ pool, notifier, mail, now: () => clock, logger: false });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

beforeEach(async () => {
  notifier.sent = [];
  await pool.query('TRUNCATE users, requests, email_codes CASCADE');
});

type Agent = { cookie: string; id: string; call: (method: string, url: string, body?: unknown) => Promise<{ status: number; json: any }> };
let seq = 0;
const codeFromMail = () => mail.last!.text.match(/\d{6}/)![0];

/** Вход по коду на email. Телефон для связи указывается отдельно, если передан. */
async function login(name: string, opts: { phone?: string | null } = {}): Promise<Agent> {
  const n = ++seq;
  const email = `user${n}@mail.ru`;
  // Лимит писем считается по IP: у каждого тестового пользователя свой адрес.
  const remoteAddress = `10.0.${n >> 8}.${n & 255}`;
  const start = await app.inject({ method: 'POST', url: '/auth/email/start', payload: { email }, remoteAddress });
  expect(start.statusCode).toBe(200);
  const res = await app.inject({
    method: 'POST',
    url: '/auth/email/verify',
    payload: { email, code: codeFromMail(), consent: true, name },
    remoteAddress,
  });
  expect(res.statusCode).toBe(200);
  const cookie = `sid=${res.cookies.find((c) => c.name === 'sid')!.value}`;
  const call = async (method: string, u: string, body?: unknown) => {
    const r = await app.inject({
      method: method as 'GET',
      url: u,
      headers: { cookie },
      remoteAddress,
      ...(method === 'GET' ? {} : { payload: (body ?? {}) as object }),
    });
    return { status: r.statusCode, json: r.json() };
  };
  const phone = opts.phone === undefined ? `+7999000${String(n).padStart(4, '0')}` : opts.phone;
  if (phone) expect((await call('PATCH', '/me', { phone })).status).toBe(200);
  const me = await call('GET', '/me');
  return { cookie, id: me.json.user.id, call };
}

const vaccinated = [
  { kind: 'vac', date: '2026-06-01' },
  { kind: 'rab', date: '2026-06-01' },
];
const dogDonor = (o: object = {}) => ({
  species: 'dog',
  name: 'Арчи',
  breed: 'Немецкая овчарка',
  birthDate: '2022-03-01',
  weightKg: 38,
  bloodGroup: 'DEA1.1-',
  city: 'Санкт-Петербург',
  district: 'Петроградский',
  med: vaccinated,
  ...o,
});
const sos = (o: object = {}) => ({
  species: 'dog',
  petName: 'Джесси',
  weightKg: '28',
  bloodGroup: 'DEA1.1-',
  clinicId: 'c1',
  urgency: 'now',
  reason: 'Сбила машина',
  ...o,
});

describe('вход по email', () => {
  it('код из 6 цифр, 5 попыток и повторная отправка через 60 секунд', async () => {
    const email = 'anna@mail.ru';
    expect((await app.inject({ method: 'POST', url: '/auth/email/start', payload: { email: 'anna@mail' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/auth/email/start', payload: { email } })).statusCode).toBe(200);
    expect(mail.last!.to).toBe(email);
    expect((await app.inject({ method: 'POST', url: '/auth/email/start', payload: { email } })).statusCode).toBe(429);
    const code = codeFromMail();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/auth/email/verify', payload: { email, code: wrong } });
      expect(r.statusCode).toBe(400);
    }
    // Шестая попытка блокируется даже с верным кодом.
    const r = await app.inject({ method: 'POST', url: '/auth/email/verify', payload: { email, code } });
    expect(r.statusCode).toBe(429);
  });

  it('код действует 10 минут', async () => {
    const email = 'late@mail.ru';
    await app.inject({ method: 'POST', url: '/auth/email/start', payload: { email } });
    await pool.query(`UPDATE email_codes SET expires_at = now() - interval '1 second'`);
    const r = await app.inject({ method: 'POST', url: '/auth/email/verify', payload: { email, code: codeFromMail() } });
    expect(r.statusCode).toBe(400);
  });

  it('повторный вход с тем же адресом в другом регистре — тот же аккаунт', async () => {
    const a = await login('Анна');
    await pool.query('DELETE FROM email_codes');
    await app.inject({ method: 'POST', url: '/auth/email/start', payload: { email: `USER${seq}@Mail.ru` }, remoteAddress: '10.0.1.1' });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/email/verify',
      payload: { email: `user${seq}@mail.ru`, code: codeFromMail() },
      remoteAddress: '10.0.1.1',
    });
    expect(res.statusCode).toBe(200);
    expect((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(1);
    expect(a.id).toBeTruthy();
  });

  it('телефон для связи необязателен и проверяется', async () => {
    const u = await login('Олег', { phone: null });
    expect((await u.call('GET', '/me')).json.user).toMatchObject({ phone: null, email: expect.stringMatching(/@mail\.ru$/) });
    expect((await u.call('PATCH', '/me', { phone: '123' })).status).toBe(400);
    expect((await u.call('PATCH', '/me', { phone: '8 (921) 000-00-01' })).status).toBe(200);
    expect((await u.call('GET', '/me')).json.user.phone).toBe('+79210000001');
    const other = await login('Ира', { phone: null });
    expect((await other.call('PATCH', '/me', { phone: '+79210000001' })).status).toBe(409);
  });

  it('изменяющие запросы без JSON отклоняются (CSRF)', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/logout', headers: { 'content-type': 'text/plain' }, payload: 'x' });
    expect(r.statusCode).toBe(415);
  });
});

describe('Telegram Login Widget', () => {
  it('проверяет подпись и срок', () => {
    const token = '123:abc';
    const data: Record<string, string> = { id: '42', first_name: 'Анна', auth_date: String(Math.floor(Date.now() / 1000)) };
    const check = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('\n');
    const hash = crypto.createHmac('sha256', crypto.createHash('sha256').update(token).digest()).update(check).digest('hex');
    expect(verifyTelegramLogin({ ...data, hash }, token)?.id).toBe(42);
    expect(verifyTelegramLogin({ ...data, first_name: 'Ева', hash }, token)).toBeNull();
    expect(verifyTelegramLogin({ ...data, hash }, token, Date.now() + 2 * 86_400_000)).toBeNull();
  });
});

describe('SOS: от запроса до сдачи крови', () => {
  it('полный путь', async () => {
    const owner = await login('Анна');
    const donor = await login('Игорь');
    const other = await login('Ольга');

    // Питомец-донор: допуск считается на сервере.
    const pet = await donor.call('POST', '/pets', dogDonor());
    expect(pet.status).toBe(200);
    expect(pet.json.eligibility.ready).toBe(true);
    // DEA 1.1+ не подходит собаке DEA 1.1−, а щенок не подходит по возрасту.
    await other.call('POST', '/pets', dogDonor({ name: 'Бетти', bloodGroup: 'DEA1.1+' }));
    await other.call('POST', '/pets', dogDonor({ name: 'Малыш', birthDate: '2026-03-01' }));

    const created = await owner.call('POST', '/requests', sos());
    expect(created.status).toBe(201);
    expect(created.json.notified).toBe(1);
    expect(notifier.sent.map((m) => m.userId)).toEqual([donor.id]);
    const id = created.json.id;

    // Донор видит своего питомца готовым и откликается.
    const seen = await donor.call('GET', `/requests/${id}`);
    expect(seen.json.role).toBe('viewer');
    expect(seen.json.myPets[0]).toMatchObject({ name: 'Арчи', ready: true, compatible: true });
    expect((await donor.call('POST', `/requests/${id}/respond`, { petId: pet.json.id })).status).toBe(200);
    expect((await donor.call('POST', `/requests/${id}/respond`, { petId: pet.json.id })).status).toBe(409);

    // Хозяин видит отклик без телефона, выбирает — телефон открывается.
    let mine = await owner.call('GET', `/requests/${id}`);
    expect(mine.json.role).toBe('author');
    expect(mine.json.responses[0]).toMatchObject({ petName: 'Арчи', phone: null, district: 'Петроградский' });
    expect((await other.call('POST', `/requests/${id}/choose`, { responseId: mine.json.responses[0].id })).status).toBe(403);
    expect((await owner.call('POST', `/requests/${id}/choose`, { responseId: mine.json.responses[0].id })).status).toBe(200);
    mine = await owner.call('GET', `/requests/${id}`);
    expect(mine.json.status).toBe('donor_chosen');
    // Номера скрыты с обеих сторон, пока каждый сам не откроет свой.
    expect(mine.json.responses[0].phone).toBeNull();
    let d = await donor.call('GET', `/requests/${id}`);
    expect(d.json.role).toBe('donor');
    expect(d.json.author.phone).toBeNull();
    expect((await donor.call('POST', `/requests/${id}/phone`, { show: true })).status).toBe(200);
    expect((await owner.call('GET', `/requests/${id}`)).json.responses[0].phone).toMatch(/^\+7999/);
    expect((await donor.call('GET', `/requests/${id}`)).json.author.phone).toBeNull();
    await owner.call('POST', `/requests/${id}/phone`, { show: true });
    d = await donor.call('GET', `/requests/${id}`);
    expect(d.json.author.phone).toMatch(/^\+7999/);
    expect(d.json.clinic.phone).toBeTruthy();
    // Можно скрыть обратно.
    await donor.call('POST', `/requests/${id}/phone`, { show: false });
    expect((await owner.call('GET', `/requests/${id}`)).json.responses[0].phone).toBeNull();
    expect((await other.call('POST', `/requests/${id}/phone`, { show: true })).status).toBe(403);

    // Посторонний не видит чат и не пишет в него.
    expect((await other.call('POST', `/requests/${id}/messages`, { text: 'привет' })).status).toBe(403);
    expect((await donor.call('POST', `/requests/${id}/messages`, { text: 'Выехал, буду через 15 минут' })).status).toBe(200);

    // Путь донора и подтверждение сдачи хозяином.
    expect((await donor.call('POST', `/requests/${id}/trip`, { step: 1 })).status).toBe(200);
    expect((await donor.call('POST', `/requests/${id}/trip`, { step: 3 })).status).toBe(200);
    expect((await donor.call('POST', `/requests/${id}/confirm`)).status).toBe(403);
    expect((await owner.call('POST', `/requests/${id}/confirm`)).status).toBe(200);
    const closed = await owner.call('GET', `/requests/${id}`);
    expect(closed.json).toMatchObject({ status: 'closed', trip: { step: 4 } });
    expect(closed.json.messages.some((m: { text: string; mine: boolean }) => m.text.startsWith('Выехал') && !m.mine)).toBe(true);

    // Капли: новый донор 50 + отклик 20 + сдача 150 + награды «Первая капля», «Редкая кровь»
    // и «Быстрее скорой» (отклик за 10 минут) по 30.
    const me = await donor.call('GET', '/me');
    expect(me.json.progress.xp).toBe(50 + 20 + 150 + 30 * 3);
    expect(me.json.progress.level.name).toBe('Донор');
    // Повторный запрос /me не начисляет награды заново.
    expect((await donor.call('GET', '/me')).json.progress.xp).toBe(310);

    // После сдачи донор 60 дней не получает SOS.
    const again = await owner.call('POST', '/requests', sos({ petName: 'Рекс' }));
    expect(again.json.notified).toBe(0);
    const pets = await donor.call('GET', '/pets');
    expect(pets.json[0].eligibility).toMatchObject({ ready: false, daysLeft: 60 });

    // Публичная страница без входа и без личных данных.
    const pub = await app.inject({ method: 'GET', url: `/public/requests/${created.json.slug}` });
    expect(pub.statusCode).toBe(200);
    expect(JSON.stringify(pub.json())).not.toMatch(/\+7999/);
  });

  it('«Донор не приедет» снимает донора и запускает следующую волну', async () => {
    const owner = await login('Мария');
    const near = await login('Павел');
    const far = await login('Роман');
    const p1 = await near.call('POST', '/pets', dogDonor({ name: 'Жуля', bloodGroup: 'DEA1.1+' }));
    // Московский район — около 13 км от Петроградской клиники c1, попадает только во вторую волну (20 км).
    await far.call('POST', '/pets', dogDonor({ name: 'Гром', bloodGroup: 'DEA1.1+', district: 'Московский' }));

    const { json } = await owner.call('POST', '/requests', sos({ bloodGroup: 'DEA1.1+', petName: 'Лорд' }));
    expect(notifier.sent.map((m) => m.userId)).toEqual([near.id]);
    await near.call('POST', `/requests/${json.id}/respond`, { petId: p1.json.id });
    const rid = (await owner.call('GET', `/requests/${json.id}`)).json.responses[0].id;
    await owner.call('POST', `/requests/${json.id}/choose`, { responseId: rid });

    notifier.sent = [];
    const drop = await owner.call('POST', `/requests/${json.id}/drop-donor`);
    expect(drop.json.notified).toBe(1);
    expect(notifier.sent.map((m) => m.userId)).toContain(far.id);
    const r = await owner.call('GET', `/requests/${json.id}`);
    expect(r.json).toMatchObject({ status: 'open', wave: 2, radiusKm: 20, trip: null, responses: [] });
  });

  it('ночью SOS только тем, кто разрешил будить; фоновая волна расширяет радиус', async () => {
    const owner = await login('Олег');
    const sleepy = await login('Светлана');
    const owl = await login('Роман');
    await sleepy.call('POST', '/pets', dogDonor({ name: 'Ирма', species: 'cat', weightKg: 5, bloodGroup: 'B' }));
    await owl.call('POST', '/pets', dogDonor({ name: 'Чара', species: 'cat', weightKg: 4.3, bloodGroup: 'B' }));
    await owl.call('PATCH', '/me', { notify: { night: true } });

    clock = new Date('2026-10-02T03:00:00+03:00');
    const { json } = await owner.call('POST', '/requests', sos({ species: 'cat', weightKg: 4, bloodGroup: 'B', petName: 'Барсик' }));
    expect(notifier.sent.map((m) => m.userId)).toEqual([owl.id]);

    clock = new Date('2026-10-02T03:11:00+03:00');
    expect(await expandStaleWaves(pool, notifier, clock)).toBeGreaterThanOrEqual(1);
    expect((await owner.call('GET', `/requests/${json.id}`)).json.wave).toBe(2);
    clock = new Date('2026-10-01T12:00:00+03:00');
  });

  it('валидация SOS: вес по виду, группа по виду, запрет продажи крови', async () => {
    const owner = await login('Екатерина');
    const bad = await owner.call('POST', '/requests', sos({ species: 'cat', weightKg: 30, petName: '' }));
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.json.fields).sort()).toEqual(['bloodGroup', 'petName', 'weightKg']);
    const sell = await owner.call('POST', '/requests', sos({ reason: 'Куплю кровь, заплачу хорошо' }));
    expect(sell.json.fields.reason).toMatch(/бесплатное/);
    expect((await app.inject({ method: 'POST', url: '/requests', payload: sos() })).statusCode).toBe(401);
  });

  it('лимиты SOS: один запрос на питомца, 2 активных, 3 за сутки', async () => {
    const owner = await login('Екатерина');
    expect((await owner.call('POST', '/requests', sos({ petName: 'Джесси' }))).status).toBe(201);
    const dup = await owner.call('POST', '/requests', sos({ petName: 'джесси' }));
    expect(dup.status).toBe(409);
    expect(dup.json.data.code).toBe('duplicate');
    const second = await owner.call('POST', '/requests', sos({ petName: 'Рекс' }));
    expect(second.status).toBe(201);
    const third = await owner.call('POST', '/requests', sos({ petName: 'Бим' }));
    expect(third.json.data.code).toBe('active_limit');
    await owner.call('POST', `/requests/${second.json.id}/close`);
    expect((await owner.call('POST', '/requests', sos({ petName: 'Бим' }))).status).toBe(201);
    const fourth = await owner.call('POST', `/requests`, sos({ petName: 'Тузик' }));
    expect(fourth.json.data.code).toBe('active_limit');
    const all = await owner.call('GET', '/requests?scope=mine');
    for (const r of all.json) await owner.call('POST', `/requests/${r.id}/close`);
    const day = await owner.call('POST', '/requests', sos({ petName: 'Тузик' }));
    expect(day.json.data.code).toBe('day_limit');
  });

  it('приоритет: питомец, который сам сдавал кровь, — первая волна сразу 20 км', async () => {
    const owner = await login('Мария');
    const far = await login('Роман');
    const hero = (await owner.call('POST', '/pets', dogDonor({ name: 'Джесси', bloodGroup: 'DEA1.1+' }))).json;
    await pool.query(`INSERT INTO donations (pet_id, date, confirmed_by) VALUES ($1, '2026-01-10', 'owner')`, [hero.id]);
    await far.call('POST', '/pets', dogDonor({ name: 'Гром', bloodGroup: 'DEA1.1+', district: 'Московский' }));
    const res = await owner.call('POST', '/requests', sos({ petName: 'Джесси', bloodGroup: 'DEA1.1+', patientPetId: hero.id }));
    expect(res.json.priority).toBe(true);
    expect(notifier.sent.map((m) => m.userId)).toEqual([far.id]);
    expect(notifier.sent[0]!.text).toMatch(/Донор Павхелпа/);
  });

  it('новый аккаунт до подтверждения клиникой уведомляет только 5 ближайших доноров', async () => {
    const owner = await login('Новичок');
    const donors = [];
    for (let i = 0; i < 7; i++) {
      const u = await login(`Донор ${i}`);
      await u.call('POST', '/pets', dogDonor({ name: `Пёс ${i}`, bloodGroup: 'DEA1.1+' }));
      donors.push(u);
    }
    const res = await owner.call('POST', '/requests', sos({ bloodGroup: 'DEA1.1+' }));
    expect(res.json.notified).toBe(5);
    const r = await owner.call('GET', `/requests/${res.json.id}`);
    expect(r.json).toMatchObject({ authorNew: true, clinicStatus: 'pending' });
  });

  it('банки крови: подходящий компонент и группа в городе', async () => {
    const spb = encodeURIComponent('Санкт-Петербург');
    const plasma = await app.inject({ method: 'GET', url: `/banks?city=${spb}&species=dog&bloodGroup=DEA1.1%2B&component=plasma&clinicId=c1` });
    expect(plasma.json().map((b: { clinicId: string }) => b.clinicId).sort()).toEqual(['c1', 'c3']);
    // Собаке DEA 1.1− — только DEA 1.1−.
    const neg = await app.inject({ method: 'GET', url: `/banks?city=${spb}&species=dog&bloodGroup=DEA1.1-&component=whole` });
    expect(neg.json()).toHaveLength(1);
    expect(neg.json()[0]).toMatchObject({ clinicId: 'c2', bloodGroup: 'DEA1.1-', check: false });
    // Неизвестная группа кошки: подходит всё, клиника проверит совместимость.
    const cat = await app.inject({ method: 'GET', url: `/banks?city=${spb}&species=cat&component=whole` });
    expect(cat.json().every((b: { check: boolean }) => b.check)).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/banks?city=${encodeURIComponent('Казань')}&species=cat` })).json()).toEqual([]);
  });
});

describe('защита от мошенников', () => {
  async function chosenPair() {
    const owner = await login('Анна');
    const donor = await login('Игорь');
    const pet = (await donor.call('POST', '/pets', dogDonor())).json;
    const { json } = await owner.call('POST', '/requests', sos());
    await donor.call('POST', `/requests/${json.id}/respond`, { petId: pet.id });
    const rid = (await owner.call('GET', `/requests/${json.id}`)).json.responses[0].id;
    await owner.call('POST', `/requests/${json.id}/choose`, { responseId: rid });
    return { owner, donor, id: json.id as string };
  }

  it('номер карты в чат не уходит, просьбы о деньгах помечаются', async () => {
    const { owner, donor, id } = await chosenPair();
    expect((await owner.call('POST', `/requests/${id}/messages`, { text: 'карта 4111 1111 1111 1111' })).status).toBe(400);
    await owner.call('POST', `/requests/${id}/messages`, { text: 'Нужна предоплата за такси, переведите 500 руб' });
    const msgs = (await donor.call('GET', `/requests/${id}`)).json.messages;
    expect(msgs.at(-1)).toMatchObject({ flagged: true, mine: false });
  });

  it('жалоба на деньги закрывает чат, 3 жалобы замораживают аккаунт', async () => {
    const { owner, donor, id } = await chosenPair();
    expect((await donor.call('POST', `/requests/${id}/report`, { reason: 'money' })).json.chatClosed).toBe(true);
    expect((await owner.call('POST', `/requests/${id}/messages`, { text: 'ну что?' })).status).toBe(409);

    const scammer = await login('Мошенник');
    const fake = (await scammer.call('POST', '/requests', sos({ petName: 'Шарик' }))).json.id;
    for (const name of ['А', 'Б', 'В']) {
      const u = await login(name);
      expect((await u.call('POST', `/requests/${fake}/report`, { reason: 'fake' })).status).toBe(200);
      // Запрос сразу пропадает из ленты пожаловавшегося.
      expect((await u.call('GET', '/requests')).json.map((r: { id: string }) => r.id)).not.toContain(fake);
    }
    expect((await scammer.call('GET', `/requests/${fake}`)).json.hidden).toBe(true);
    expect((await scammer.call('POST', '/requests', sos({ petName: 'Барбос' }))).json.data.code).toBe('frozen');
  });
});

describe('донор: пауза и память', () => {
  it('на паузе SOS не приходят, отклик предлагает снять паузу', async () => {
    const owner = await login('Анна');
    const donor = await login('Игорь');
    const pet = (await donor.call('POST', '/pets', dogDonor())).json;
    expect((await donor.call('POST', `/pets/${pet.id}/pause`, { days: 7 })).json.pausedUntil).toBeTruthy();
    const { json } = await owner.call('POST', '/requests', sos());
    expect(json.notified).toBe(0);
    const res = await donor.call('POST', `/requests/${json.id}/respond`, { petId: pet.id });
    expect(res.json.data).toMatchObject({ code: 'paused', petId: pet.id });
    await donor.call('POST', `/pets/${pet.id}/pause`, { days: 0 });
    expect((await donor.call('POST', `/requests/${json.id}/respond`, { petId: pet.id })).status).toBe(200);
  });

  it('«Питомца не стало»: SOS и отклики выключаются, карточка остаётся', async () => {
    const owner = await login('Анна');
    const donor = await login('Игорь');
    const pet = (await donor.call('POST', '/pets', dogDonor())).json;
    const m = await donor.call('POST', `/pets/${pet.id}/memorial`);
    expect(m.json).toMatchObject({ deceased: true, donorEnabled: false });
    expect((await owner.call('POST', '/requests', sos())).json.notified).toBe(0);
    expect((await donor.call('PATCH', `/pets/${pet.id}`, { name: 'X' })).status).toBe(409);
    expect((await donor.call('GET', '/pets')).json).toHaveLength(1);
  });

  it('новые требования анкеты: лечение и переливание', async () => {
    const donor = await login('Игорь');
    const p = (await donor.call('POST', '/pets', dogDonor({ underTreatment: true, transfused: true, sex: 'm', chip: '643094100000001', housing: 'house' }))).json;
    expect(p.eligibility.fit).toBe(false);
    expect(p.eligibility.checks.filter((c: { ok: boolean }) => !c.ok).map((c: { key: string }) => c.key)).toEqual(['treatment', 'transfusion']);
    expect((await donor.call('POST', '/pets', dogDonor({ chip: '123' }))).json.fields.chip).toBeTruthy();
    expect((await donor.call('POST', '/pets', dogDonor({ city: 'Казань', district: 'Петроградский' }))).json.fields.district).toBeTruthy();
    expect((await donor.call('POST', '/pets', dogDonor({ city: 'Казань', district: 'Север' }))).status).toBe(200);
  });
});

describe('автозакрытие', () => {
  it('через сутки спрашиваем, через 12 часов без ответа закрываем; «Да, ещё ищем» продлевает', async () => {
    const owner = await login('Анна');
    const a = (await owner.call('POST', '/requests', sos({ petName: 'Джесси' }))).json.id;
    const b = (await owner.call('POST', '/requests', sos({ petName: 'Рекс' }))).json.id;
    const t1 = new Date(clock.getTime() + 25 * 3_600_000);
    expect(await autoCloseStale(pool, notifier, t1)).toEqual({ asked: 2, closed: 0 });
    expect((await owner.call('GET', `/requests/${a}`)).json.staleAsk).toBe(true);
    clock = t1;
    expect((await owner.call('POST', `/requests/${a}/renew`)).status).toBe(200);
    clock = new Date('2026-10-01T12:00:00+03:00');
    const t2 = new Date(t1.getTime() + 13 * 3_600_000);
    expect(await autoCloseStale(pool, notifier, t2)).toEqual({ asked: 0, closed: 1 });
    expect((await owner.call('GET', `/requests/${a}`)).json.status).toBe('open');
    expect((await owner.call('GET', `/requests/${b}`)).json.status).toBe('closed');
  });
});

describe('кабинет клиники', () => {
  it('подтверждает запрос и сдачу вне Павхелпа, меняет банк крови', async () => {
    const vet = await login('Врач');
    await pool.query(`INSERT INTO clinic_staff (clinic_id, user_id, role) VALUES ('c1', $1, 'vet')`, [vet.id]);
    const owner = await login('Анна');
    const donor = await login('Игорь');
    const { json } = await owner.call('POST', '/requests', sos());
    expect((await donor.call('POST', '/clinic/c1/requests/' + json.id, { ok: true })).status).toBe(403);
    expect((await vet.call('POST', '/clinic/c1/requests/' + json.id, { ok: true })).status).toBe(200);
    expect((await owner.call('GET', `/requests/${json.id}`)).json.clinicStatus).toBe('confirmed');

    const pet = (await donor.call('POST', '/pets', dogDonor())).json;
    // Без клиники дата учитывается, но подтверждать некому.
    expect((await donor.call('POST', `/pets/${pet.id}/donations`, { date: '2026-09-01' })).json.pendingConfirmation).toBe(false);
    await donor.call('POST', `/pets/${pet.id}/donations`, { date: '2026-09-20', clinicId: 'c1' });
    const cab = (await vet.call('GET', '/clinic/c1')).json;
    expect(cab.donations).toHaveLength(1);
    const before = (await donor.call('GET', '/me')).json.progress.xp;
    await vet.call('POST', `/clinic/c1/donations/${cab.donations[0].id}`, { ok: true });
    expect((await donor.call('GET', '/me')).json.progress.xp).toBeGreaterThanOrEqual(before + 150);

    const item = cab.stock.find((s: { component: string; bloodGroup: string }) => s.component === 'plasma');
    await vet.call('PATCH', `/clinic/c1/stock/${item.id}`, { doses: 0 });
    const plasma = await app.inject({
      method: 'GET',
      url: `/banks?city=${encodeURIComponent('Санкт-Петербург')}&species=dog&bloodGroup=DEA1.1%2B&component=plasma`,
    });
    expect(plasma.json().map((b: { clinicId: string }) => b.clinicId)).toEqual(['c3']);
    await vet.call('PATCH', `/clinic/c1/stock/${item.id}`, { doses: 4 });
  });
});

describe('Telegram-бот', () => {
  it('без секрета webhook не принимает обновления', async () => {
    const r = await app.inject({ method: 'POST', url: '/telegram/webhook', payload: {} });
    expect(r.statusCode).toBe(401);
  });
});

describe('аккаунт', () => {
  it('нельзя отвязать последний способ входа; удаление стирает данные', async () => {
    const u = await login('Дмитрий');
    expect((await u.call('DELETE', '/me/providers/email')).status).toBe(400);
    await u.call('POST', '/pets', dogDonor());
    expect((await u.call('GET', '/me/export')).json.pets).toHaveLength(1);
    expect((await u.call('DELETE', '/me')).status).toBe(200);
    expect((await u.call('GET', '/me')).json.user).toBeNull();
    const row = (await pool.query('SELECT phone, name FROM users WHERE id = $1', [u.id])).rows[0];
    expect(row).toEqual({ phone: null, name: 'Удалённый пользователь' });
    expect((await pool.query('SELECT email FROM users WHERE id = $1', [u.id])).rows[0].email).toBeNull();
  });
});
