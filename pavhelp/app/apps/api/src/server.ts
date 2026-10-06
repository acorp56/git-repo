import { buildApp } from './app';
import { config } from './config';
import { createPool } from './db';
import { migrate } from './migrate';
import { autoCloseStale, expandStaleWaves } from './services/matching';
import { LogMailer, MemoryNotifier, SmtpMailer, TelegramNotifier } from './services/notify';

const pool = createPool(config.databaseUrl);
await migrate(pool);

const app = await buildApp({
  pool,
  notifier: (log) => (config.telegramBotToken ? new TelegramNotifier(config.telegramBotToken, log) : new MemoryNotifier(log)),
  mail: (log) => (config.mail.provider === 'smtp' ? new SmtpMailer(config.mail.smtpUrl, config.mail.from) : new LogMailer(log)),
});

if (config.runWorker) {
  // Расширение радиуса рассылки, если донора долго не выбирают. В продакшене — отдельный процесс или очередь.
  setInterval(() => {
    expandStaleWaves(pool, app.deps.notifier, new Date()).catch((e) => app.log.error(e, 'волна рассылки не удалась'));
    // Через сутки спрашиваем «Ещё ищете донора?», через 12 часов без ответа закрываем запрос.
    autoCloseStale(pool, app.deps.notifier, new Date()).catch((e) => app.log.error(e, 'автозакрытие не удалось'));
  }, 60_000);
}

await app.listen({ port: config.port, host: '0.0.0.0' });
