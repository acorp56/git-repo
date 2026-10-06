// Добавить сотрудника клиники: npm run clinic:staff -- <email> <clinicId> <admin|vet>
// Пользователь должен хотя бы раз войти в Павхелп по этому email.
import { normalizeEmail } from '@pavhelp/core';
import { config } from './config';
import { createPool, one } from './db';

const [emailRaw, clinicId, role = 'vet'] = process.argv.slice(2);
const email = normalizeEmail(emailRaw);
if (!email || !clinicId || !['admin', 'vet'].includes(role)) {
  console.error('Использование: npm run clinic:staff -- <email> <clinicId> <admin|vet>');
  process.exit(1);
}
const pool = createPool(config.databaseUrl);
const user = await one<{ id: string }>(pool, 'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
const clinic = await one<{ name: string }>(pool, 'SELECT name FROM clinics WHERE id = $1', [clinicId]);
if (!user || !clinic) {
  console.error(!user ? `Пользователь ${email} не найден: пусть сначала войдёт в Павхелп` : `Клиника ${clinicId} не найдена`);
  process.exit(1);
}
await pool.query(
  'INSERT INTO clinic_staff (clinic_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (clinic_id, user_id) DO UPDATE SET role = $3',
  [clinicId, user.id, role],
);
console.log(`${email} — ${role} в «${clinic.name}»`);
await pool.end();
