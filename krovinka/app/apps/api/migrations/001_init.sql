-- Кровинка: начальная схема. PostgreSQL 15+ с PostGIS.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL DEFAULT '',
  phone            text UNIQUE,                       -- +7XXXXXXXXXX, только подтверждённый
  district         text,
  notify           jsonb NOT NULL DEFAULT '{}',       -- NotifySettings из @krovinka/core
  telegram_chat_id bigint,
  pd_consent_at    timestamptz,                       -- согласие на обработку ПД (152-ФЗ)
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

-- Способы входа. Ключ — стабильный идентификатор провайдера.
CREATE TABLE auth_identities (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    text NOT NULL CHECK (provider IN ('phone', 'telegram', 'yandex', 'vk', 'sber', 'mts')),
  provider_id text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_id)
);
CREATE INDEX ON auth_identities (user_id);

-- В базе только хеш токена сессии: утечка таблицы не даёт войти.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sessions (user_id);

CREATE TABLE phone_codes (
  phone      text PRIMARY KEY,
  code_hash  text NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE clinics (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  address    text NOT NULL,
  district   text NOT NULL,
  location   geography(Point, 4326) NOT NULL,
  phone      text NOT NULL,
  night      boolean NOT NULL DEFAULT false,   -- круглосуточная
  blood_bank boolean NOT NULL DEFAULT false
);

CREATE TABLE pets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  species       text NOT NULL CHECK (species IN ('dog', 'cat')),
  name          text NOT NULL,
  breed         text NOT NULL DEFAULT '',
  birth_date    date,
  weight_kg     numeric(5, 2),
  blood_group   text NOT NULL DEFAULT 'unknown',
  district      text NOT NULL,
  -- Центр района со сдвигом: точный адрес не храним и никому не показываем.
  location      geography(Point, 4326) NOT NULL,
  outdoor       boolean NOT NULL DEFAULT false,  -- для кошек: гуляет на улице
  chronic       boolean NOT NULL DEFAULT false,
  donor_enabled boolean NOT NULL DEFAULT true,   -- «получать SOS»
  photo_url     text,
  last_donation date,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON pets (owner_id);
CREATE INDEX pets_location_idx ON pets USING gist (location);
CREATE INDEX ON pets (species, blood_group) WHERE donor_enabled;

CREATE TABLE med_records (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id     uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('vac', 'rab', 'tick', 'worm', 'check')),
  date       date NOT NULL,
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON med_records (pet_id);

CREATE TABLE requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,               -- публичная ссылка krovinka.pet/r/<slug>
  author_id     uuid NOT NULL REFERENCES users(id),
  pet_name      text NOT NULL,
  species       text NOT NULL CHECK (species IN ('dog', 'cat')),
  weight_kg     numeric(5, 2) NOT NULL,
  blood_group   text NOT NULL,
  clinic_id     text NOT NULL REFERENCES clinics(id),
  urgency       text NOT NULL CHECK (urgency IN ('now', 'today', 'plan')),
  reason        text NOT NULL DEFAULT '',
  post_text     text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'donor_chosen', 'closed')),
  wave          int NOT NULL DEFAULT 0,
  radius_km     int NOT NULL DEFAULT 0,
  last_wave_at  timestamptz,
  trip_status   smallint,                           -- индекс в TRIP_STEPS
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);
CREATE INDEX ON requests (status, created_at DESC);
CREATE INDEX ON requests (author_id);

CREATE TABLE responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  pet_id        uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  donor_user_id uuid NOT NULL REFERENCES users(id),
  status        text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'chosen', 'declined', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, pet_id)
);
-- В запросе может быть только один выбранный донор.
CREATE UNIQUE INDEX responses_one_chosen ON responses (request_id) WHERE status = 'chosen';

-- Кому и в какой волне отправлен SOS: повторно не шлём.
CREATE TABLE sos_notifications (
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  pet_id     uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wave       int NOT NULL,
  km         numeric(6, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, pet_id)
);

CREATE TABLE messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES users(id),             -- NULL — системное событие
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON messages (request_id, created_at);

-- Сдача крови. Капли донору — только после подтверждения хозяином или клиникой.
CREATE TABLE donations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id       uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  clinic_id    text REFERENCES clinics(id),
  date         date NOT NULL,
  request_id   uuid REFERENCES requests(id),
  confirmed_by text CHECK (confirmed_by IN ('owner', 'clinic')),
  confirmed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON donations (pet_id);

-- Журнал капель. UNIQUE (user_id, kind, ref) делает начисления идемпотентными.
CREATE TABLE xp_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  ref        text NOT NULL,
  points     int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, ref)
);
