const env = process.env;

export const config = {
  production: env.NODE_ENV === 'production',
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://pavhelp:pavhelp@localhost:5432/pavhelp',
  appUrl: env.APP_URL ?? 'http://localhost:3000',
  cookieSecret: env.COOKIE_SECRET ?? 'dev-only-cookie-secret-change-me-please',
  yandex: {
    clientId: env.YANDEX_CLIENT_ID ?? '',
    clientSecret: env.YANDEX_CLIENT_SECRET ?? '',
    redirectUri: env.YANDEX_REDIRECT_URI ?? 'http://localhost:3000/api/auth/yandex/callback',
  },
  telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? '',
  // Имя бота без @ для deep link https://t.me/<бот>?start=<token>
  telegramBotUsername: env.TELEGRAM_BOT_USERNAME ?? 'pavhelp_bot',
  // Секрет webhook: Telegram присылает его в заголовке X-Telegram-Bot-Api-Secret-Token (setWebhook secret_token)
  telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? '',
  mail: {
    // log — письмо с кодом пишется в лог сервера (только для разработки); smtp — отправка через SMTP_URL
    provider: env.MAIL_PROVIDER ?? 'log',
    smtpUrl: env.SMTP_URL ?? '',
    from: env.MAIL_FROM ?? 'Павхелп <no-reply@pavhelp.ru>',
  },
  runWorker: env.RUN_WORKER === '1',
};

if (config.production && config.cookieSecret.startsWith('dev-only')) {
  throw new Error('COOKIE_SECRET не задан');
}
if (config.production && config.mail.provider === 'log') {
  throw new Error('MAIL_PROVIDER=log нельзя использовать в продакшене: коды попадут в лог');
}
if (config.mail.provider === 'smtp' && !config.mail.smtpUrl) {
  throw new Error('MAIL_PROVIDER=smtp требует SMTP_URL');
}
