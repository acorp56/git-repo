// Каналы доставки. СМС для SOS не используем: Telegram-бот — основной канал, Web Push — дублирующий.
import type { FastifyBaseLogger } from 'fastify';

export interface SosMessage {
  userId: string;
  telegramChatId: number | null;
  requestId: string;
  text: string;
  url: string;
}

export interface Notifier {
  sos(m: SosMessage): Promise<void>;
  /** Событие по запросу: донор откликнулся, вас выбрали, донор выехал… */
  event(userId: string, telegramChatId: number | null, text: string, url: string): Promise<void>;
}

/** Для разработки и тестов: только пишет в лог и копит сообщения. */
export class MemoryNotifier implements Notifier {
  sent: { userId: string; text: string; url: string }[] = [];
  constructor(private log?: FastifyBaseLogger) {}
  async sos(m: SosMessage) {
    this.sent.push({ userId: m.userId, text: m.text, url: m.url });
    this.log?.info({ userId: m.userId, url: m.url }, 'SOS: ' + m.text);
  }
  async event(userId: string, _chat: number | null, text: string, url: string) {
    this.sent.push({ userId, text, url });
    this.log?.info({ userId, url }, text);
  }
}

/**
 * Отправка через Telegram Bot API.
 * Кнопки «Могу приехать» и «Не сейчас» требуют обработчика callback_query в сервисе бота —
 * пока в сообщении ссылка на запрос, отклик делается в приложении.
 * TODO: Web Push (VAPID) как второй канал.
 */
export class TelegramNotifier implements Notifier {
  constructor(
    private token: string,
    private log: FastifyBaseLogger,
  ) {}

  private async send(chatId: number, text: string, url: string, button: string) {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: { inline_keyboard: [[{ text: button, url }]] },
      }),
    });
    if (!res.ok) this.log.warn({ status: res.status, chatId }, 'Telegram sendMessage failed');
  }

  async sos(m: SosMessage) {
    if (!m.telegramChatId) return this.log.info({ userId: m.userId }, 'SOS: у донора не подключён Telegram');
    await this.send(m.telegramChatId, m.text, m.url, 'Могу приехать');
  }

  async event(userId: string, chatId: number | null, text: string, url: string) {
    if (!chatId) return this.log.info({ userId }, text);
    await this.send(chatId, text, url, 'Открыть');
  }
}

export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

/** Только для разработки: код пишется в лог. В продакшене запрещено конфигом. */
export class LogSms implements SmsSender {
  last: { phone: string; text: string } | null = null;
  constructor(private log?: FastifyBaseLogger) {}
  async send(phone: string, text: string) {
    this.last = { phone, text };
    this.log?.warn({ phone }, `СМС (dev): ${text}`);
  }
}
