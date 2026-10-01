import { buildApp } from './app';
import { config } from './config';
import { createPool } from './db';
import { migrate } from './migrate';
import { expandStaleWaves } from './services/matching';
import { LogSms, MemoryNotifier, TelegramNotifier } from './services/notify';

const pool = createPool(config.databaseUrl);
await migrate(pool);

const app = await buildApp({
  pool,
  notifier: (log) => (config.telegramBotToken ? new TelegramNotifier(config.telegramBotToken, log) : new MemoryNotifier(log)),
  // TODO: настоящий провайдер СМС (SMS.ru, SMSC, МТС Exolve) с реализацией SmsSender.
  sms: (log) => new LogSms(log),
});

if (config.runWorker) {
  // Расширение радиуса рассылки, если донора долго не выбирают. В продакшене — отдельный процесс или очередь.
  setInterval(() => {
    expandStaleWaves(pool, app.deps.notifier, new Date()).catch((e) => app.log.error(e, 'волна рассылки не удалась'));
  }, 60_000);
}

await app.listen({ port: config.port, host: '0.0.0.0' });
