// Интеграционные тесты на настоящей базе с PostGIS.
// База: TEST_DATABASE_URL (по умолчанию krovinka_test на localhost). Схема пересоздаётся перед запуском.
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { verifyTelegramLogin } from './auth/routes';
import { createPool } from './db';
import { migrate } from './migrate';
import { seedClinics } from './seed';
import { expandStaleWaves } from './services/matching';
import { LogSms, MemoryNotifier } from './services/notify';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://krovinka:krovinka@localhost:5432/krovinka_test';
let pool: pg.Pool;
let app: FastifyInstance;
const notifier = new MemoryNotifier();
const sms = new LogSms();
// Днём по Москве, чтобы не попадать в тихие часы.
let clock = new Date('2026-10-01T12:00:00+03:00');

beforeAll(async () => {
  pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool, () => {});
  await seedClinics(pool);
  app = await buildApp({ pool, notifier, sms, now: () => clock, logger: false });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

beforeEach(async () => {
  notifier.sent = [];
  await pool.query('TRUNCATE users, requests, phone_codes CASCADE');
});

type Agent = { cookie: string; id: string; call: (method: string, url: string, body?: unknown) => Promise<{ status: number; json: any }> };
let phoneSeq = 0;

async function login(name: string): Promise<Agent> {
  const phone = `+7999000${String(++phoneSeq).padStart(4, '0')}`;
  // Лимит СМС считается по IP: у каждого тестового пользователя свой адрес.
  const remoteAddress = `10.0.0.${phoneSeq}`;
  const start = await app.inject({ method: 'POST', url: '/auth/phone/start', payload: { phone }, remoteAddress });
  expect(start.statusCode).toBe(200);
  const code = sms.last!.text.match(/\d{4}/)![0];
  const res = await app.inject({ method: 'POST', url: '/auth/phone/verify', payload: { phone, code, consent: true, name }, remoteAddress });
  expect(res.statusCode).toBe(200);
  const cookie = `sid=${res.cookies.find((c) => c.name === 'sid')!.value}`;
  const call = async (method: string, u: string, body?: unknown) => {
    const r = await app.inject({ method: method as 'GET', url: u, headers: { cookie }, ...(method === 'GET' ? {} : { payload: (body ?? {}) as object }) });
    return { status: r.statusCode, json: r.json() };
  };
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

describe('вход по телефону', () => {
  it('ограничивает попытки кода и повторную отправку', async () => {
    const phone = '+79990009999';
    expect((await app.inject({ method: 'POST', url: '/auth/phone/start', payload: { phone } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/auth/phone/start', payload: { phone } })).statusCode).toBe(429);
    const code = sms.last!.text.match(/\d{4}/)![0];
    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/auth/phone/verify', payload: { phone, code: wrong } });
      expect(r.statusCode).toBe(400);
    }
    // Шестая попытка блокируется даже с верным кодом.
    const r = await app.inject({ method: 'POST', url: '/auth/phone/verify', payload: { phone, code } });
    expect(r.statusCode).toBe(429);
  });

  it('повторный вход по тому же номеру — тот же аккаунт', async () => {
    const a = await login('Анна');
    phoneSeq--;
    await pool.query('DELETE FROM phone_codes');
    const b = await login('Анна');
    expect(b.id).toBe(a.id);
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
    expect(mine.json.responses[0].phone).toMatch(/^\+7999/);
    expect(mine.json.status).toBe('donor_chosen');

    const d = await donor.call('GET', `/requests/${id}`);
    expect(d.json.role).toBe('donor');
    expect(d.json.author.phone).toMatch(/^\+7999/);
    expect(d.json.clinic.phone).toBeTruthy();

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
    // Московский район — около 13 км от Петроградской клиники c1, попадает только во вторую волну.
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

  it('валидация и лимиты SOS', async () => {
    const owner = await login('Екатерина');
    const bad = await owner.call('POST', '/requests', sos({ species: 'cat', weightKg: 30, petName: '' }));
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.json.fields).sort()).toEqual(['bloodGroup', 'petName', 'weightKg']);
    for (let i = 0; i < 3; i++) expect((await owner.call('POST', '/requests', sos())).status).toBe(201);
    expect((await owner.call('POST', '/requests', sos())).status).toBe(429);
    expect((await app.inject({ method: 'POST', url: '/requests', payload: sos() })).statusCode).toBe(401);
  });
});

describe('аккаунт', () => {
  it('нельзя отвязать последний способ входа; удаление стирает данные', async () => {
    const u = await login('Дмитрий');
    expect((await u.call('DELETE', '/me/providers/phone')).status).toBe(400);
    await u.call('POST', '/pets', dogDonor());
    expect((await u.call('GET', '/me/export')).json.pets).toHaveLength(1);
    expect((await u.call('DELETE', '/me')).status).toBe(200);
    expect((await u.call('GET', '/me')).json.user).toBeNull();
    const row = (await pool.query('SELECT phone, name FROM users WHERE id = $1', [u.id])).rows[0];
    expect(row).toEqual({ phone: null, name: 'Удалённый пользователь' });
  });
});
