// Каналы доставки. СМС не используем вовсе: Telegram-бот — основной канал, Web Push — дублирующий.
import type { FastifyBaseLogger } from 'fastify';
import nodemailer, { type Transporter } from 'nodemailer';

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

type InlineButton = { text: string; url: string } | { text: string; callback_data: string };

/** Вызов метода Telegram Bot API. */
export async function telegramApi(token: string, method: string, body: object): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Отправка через Telegram Bot API. В SOS — inline-кнопки «Могу помочь» и «Не сейчас»:
 * нажатия приходят в webhook (routes/telegram.ts) как callback_query.
 * TODO: Web Push (VAPID) как второй канал.
 */
export class TelegramNotifier implements Notifier {
  constructor(
    private token: string,
    private log: FastifyBaseLogger,
  ) {}

  private async send(chatId: number, text: string, keyboard: InlineButton[][]) {
    const res = await telegramApi(this.token, 'sendMessage', { chat_id: chatId, text, reply_markup: { inline_keyboard: keyboard } });
    if (!res.ok) this.log.warn({ status: res.status, chatId }, 'Telegram sendMessage failed');
  }

  async sos(m: SosMessage) {
    if (!m.telegramChatId) return this.log.info({ userId: m.userId }, 'SOS: у донора не подключён Telegram');
    await this.send(m.telegramChatId, m.text, [
      [
        { text: 'Могу помочь', callback_data: `help:${m.requestId}` },
        { text: 'Не сейчас', callback_data: `skip:${m.requestId}` },
      ],
      [{ text: 'Открыть в Павхелпе', url: m.url }],
    ]);
  }

  async event(userId: string, chatId: number | null, text: string, url: string) {
    if (!chatId) return this.log.info({ userId }, text);
    await this.send(chatId, text, [[{ text: 'Открыть', url }]]);
  }
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(m: Mail): Promise<void>;
}

/** Только для разработки: письмо пишется в лог. В продакшене запрещено конфигом. */
export class LogMailer implements Mailer {
  last: Mail | null = null;
  constructor(private log?: FastifyBaseLogger) {}
  async send(m: Mail) {
    this.last = m;
    this.log?.warn({ to: m.to }, `Письмо (dev): ${m.subject}`);
  }
}

/**
 * Отправка через SMTP почтового сервиса (Unisender Go, Yandex 360, Mail.ru для бизнеса и т. п.).
 * Для доставляемости на домене нужны SPF, DKIM и DMARC.
 */
export class SmtpMailer implements Mailer {
  private transport: Transporter;
  constructor(
    smtpUrl: string,
    private from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }
  async send(m: Mail) {
    await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text });
  }
}
