// Капли, уровни и награды. Всё считается на сервере: клиенту доверять нельзя, иначе капли легко накрутить.
import { BADGES, EARN, earnedBadges, isRareGroup, level, type BloodGroup, type EarnKind, type Species, type Stats } from '@pavhelp/core';
import { one, type Db } from '../db';

/** Начисление идемпотентно: одно событие (kind, ref) даёт капли один раз. */
export async function award(db: Db, userId: string, kind: EarnKind, ref: string, points: number = EARN[kind].points): Promise<boolean> {
  const r = await db.query(
    'INSERT INTO xp_events (user_id, kind, ref, points) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [userId, kind, ref, points],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function stats(db: Db, userId: string): Promise<Stats> {
  const s = await one<{
    donations: number;
    responds: number;
    fast: number;
    night: number;
    med: number;
    tg: boolean;
  }>(
    db,
    `SELECT
       (SELECT count(*)::int FROM donations d JOIN pets p ON p.id = d.pet_id
         WHERE p.owner_id = $1 AND d.confirmed_by IS NOT NULL) AS donations,
       (SELECT count(*)::int FROM responses WHERE donor_user_id = $1) AS responds,
       (SELECT count(*)::int FROM responses x JOIN requests r ON r.id = x.request_id
         WHERE x.donor_user_id = $1 AND x.created_at - r.created_at <= interval '10 minutes') AS fast,
       (SELECT count(*)::int FROM donations d JOIN pets p ON p.id = d.pet_id JOIN requests r ON r.id = d.request_id
         WHERE p.owner_id = $1 AND d.confirmed_by IS NOT NULL
           AND extract(hour FROM r.created_at AT TIME ZONE 'Europe/Moscow') NOT BETWEEN 8 AND 22) AS night,
       (SELECT count(*)::int FROM med_records m JOIN pets p ON p.id = m.pet_id WHERE p.owner_id = $1) AS med,
       (SELECT telegram_chat_id IS NOT NULL FROM users WHERE id = $1) AS tg`,
    [userId],
  );
  const pets = await db.query<{ species: Species; blood_group: BloodGroup }>(
    'SELECT species, blood_group FROM pets WHERE owner_id = $1',
    [userId],
  );
  return {
    donations: s!.donations,
    responds: s!.responds,
    fast: s!.fast,
    night: s!.night,
    medMarks: s!.med,
    tg: s!.tg ? 1 : 0,
    rare: pets.rows.some((p) => isRareGroup(p.species, p.blood_group)) ? 1 : 0,
    // TODO: репосты, приглашения и прочитанные инструкции — когда появится их учёт.
    shares: 0,
    invites: 0,
    guides: 0,
  };
}

/** Начисляет капли за новые награды и возвращает сводку прогресса. */
export async function progress(db: Db, userId: string) {
  const st = await stats(db, userId);
  const badges = earnedBadges(st);
  for (const b of badges) await award(db, userId, 'badge', b.id);
  const xp = (await one<{ xp: number }>(db, 'SELECT coalesce(sum(points), 0)::int AS xp FROM xp_events WHERE user_id = $1', [userId]))!.xp;
  const earned = new Set(badges.map((b) => b.id));
  return {
    xp,
    level: level(xp),
    stats: st,
    badges: BADGES.map((b) => ({ ...b, earned: earned.has(b.id), value: Math.min(st[b.stat], b.goal) })),
  };
}
