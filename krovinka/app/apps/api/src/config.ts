const env = process.env;

export const config = {
  production: env.NODE_ENV === 'production',
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://krovinka:krovinka@localhost:5432/krovinka',
  appUrl: env.APP_URL ?? 'http://localhost:3000',
  cookieSecret: env.COOKIE_SECRET ?? 'dev-only-cookie-secret-change-me-please',
  yandex: {
    clientId: env.YANDEX_CLIENT_ID ?? '',
    clientSecret: env.YANDEX_CLIENT_SECRET ?? '',
    redirectUri: env.YANDEX_REDIRECT_URI ?? 'http://localhost:3000/api/auth/yandex/callback',
  },
  telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? '',
  smsProvider: env.SMS_PROVIDER ?? 'log',
  runWorker: env.RUN_WORKER === '1',
};

if (config.production && config.cookieSecret.startsWith('dev-only')) {
  throw new Error('COOKIE_SECRET не задан');
}
if (config.production && config.smsProvider === 'log') {
  throw new Error('SMS_PROVIDER=log нельзя использовать в продакшене: коды попадут в лог');
}
