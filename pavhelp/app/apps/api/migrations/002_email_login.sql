-- Вход по одноразовому коду на email вместо телефона и СМС.
-- Телефон остаётся необязательным полем «для связи»: его видит только выбранный донор или хозяин.

ALTER TABLE users ADD COLUMN email text UNIQUE;  -- в нижнем регистре, только подтверждённый

DROP TABLE phone_codes;
CREATE TABLE email_codes (
  email      text PRIMARY KEY,
  code_hash  text NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE auth_identities DROP CONSTRAINT auth_identities_provider_check;
DELETE FROM auth_identities WHERE provider = 'phone';
ALTER TABLE auth_identities ADD CONSTRAINT auth_identities_provider_check
  CHECK (provider IN ('email', 'telegram', 'yandex', 'vk', 'sber', 'mts'));
