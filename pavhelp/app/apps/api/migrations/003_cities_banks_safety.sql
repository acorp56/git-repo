-- Все города России, банки крови, компонент и приоритет SOS, телефоны по согласию,
-- защита от мошенников, автозакрытие, пауза донора, «Питомца не стало», кабинет клиники, Telegram-бот.

-- ---------- Города ----------
-- Справочник городов и районов — в @pavhelp/core (cities.ts). Здесь только название.
ALTER TABLE users   ADD COLUMN city text;
ALTER TABLE pets    ADD COLUMN city text NOT NULL DEFAULT 'Санкт-Петербург';
ALTER TABLE clinics ADD COLUMN city text NOT NULL DEFAULT 'Санкт-Петербург';
ALTER TABLE pets    ALTER COLUMN city DROP DEFAULT;
ALTER TABLE clinics ALTER COLUMN city DROP DEFAULT;
CREATE INDEX ON clinics (city);

-- Пользователь заморожен после нескольких жалоб, пока модератор не проверит.
ALTER TABLE users ADD COLUMN frozen_at timestamptz;

-- ---------- Анкета донора ----------
ALTER TABLE pets
  ADD COLUMN sex text CHECK (sex IN ('m', 'f')),
  ADD COLUMN chip text CHECK (chip ~ '^\d{15}$'),
  ADD COLUMN housing text CHECK (housing IN ('flat', 'house', 'aviary')),
  ADD COLUMN under_treatment boolean NOT NULL DEFAULT false,
  ADD COLUMN transfused boolean NOT NULL DEFAULT false,
  ADD COLUMN paused_until timestamptz,   -- пауза донора: SOS не приходят
  ADD COLUMN deceased_at timestamptz;    -- «Питомца не стало»: карточка в памяти, SOS и напоминания выключены

-- ---------- Банки крови клиник ----------
CREATE TABLE blood_stock (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   text NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  species     text NOT NULL CHECK (species IN ('dog', 'cat')),
  blood_group text NOT NULL,
  component   text NOT NULL CHECK (component IN ('whole', 'plasma', 'rbc')),
  doses       int NOT NULL CHECK (doses >= 0),
  dose_ml     int NOT NULL CHECK (dose_ml > 0),
  expires_on  date,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON blood_stock (clinic_id);

-- ---------- Кабинет клиники ----------
CREATE TABLE clinic_staff (
  clinic_id text NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('admin', 'vet')),
  PRIMARY KEY (clinic_id, user_id)
);

CREATE TABLE clinic_audit (
  id         bigserial PRIMARY KEY,
  clinic_id  text NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id),
  action     text NOT NULL,
  ref        text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- SOS ----------
ALTER TABLE requests
  ADD COLUMN component        text NOT NULL DEFAULT 'whole' CHECK (component IN ('whole', 'plasma', 'rbc')),
  ADD COLUMN volume_ml        int,
  ADD COLUMN patient_pet_id   uuid REFERENCES pets(id) ON DELETE SET NULL,
  ADD COLUMN priority         boolean NOT NULL DEFAULT false,  -- питомец сам сдавал кровь
  ADD COLUMN clinic_status    text NOT NULL DEFAULT 'pending' CHECK (clinic_status IN ('pending', 'confirmed', 'rejected')),
  ADD COLUMN hidden           boolean NOT NULL DEFAULT false,  -- скрыт модерацией
  ADD COLUMN chat_blocked     boolean NOT NULL DEFAULT false,  -- жалоба на деньги закрывает чат
  ADD COLUMN author_phone_shown boolean NOT NULL DEFAULT false,
  ADD COLUMN renewed_at       timestamptz,                     -- «Да, ещё ищем»
  ADD COLUMN stale_asked_at   timestamptz;                     -- спросили «Ещё ищете донора?»
CREATE UNIQUE INDEX requests_one_active_per_pet ON requests (patient_pet_id) WHERE status <> 'closed' AND patient_pet_id IS NOT NULL;

ALTER TABLE responses ADD COLUMN donor_phone_shown boolean NOT NULL DEFAULT false;

ALTER TABLE messages ADD COLUMN flagged boolean NOT NULL DEFAULT false;  -- похоже на просьбу о деньгах

-- ---------- Жалобы ----------
CREATE TABLE reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user uuid REFERENCES users(id) ON DELETE CASCADE,
  request_id  uuid REFERENCES requests(id) ON DELETE CASCADE,
  message_id  uuid REFERENCES messages(id) ON DELETE SET NULL,
  reason      text NOT NULL CHECK (reason IN ('money', 'photo', 'fake', 'sell', 'rude', 'other')),
  comment     text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, request_id, reason)
);
CREATE INDEX ON reports (target_user);

-- ---------- Telegram-бот ----------
-- Одноразовый токен для deep link https://t.me/<бот>?start=<token>: привязывает chat_id к аккаунту.
CREATE TABLE telegram_links (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
