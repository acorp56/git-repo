// Клиент API. Все запросы идут на /api/* того же домена, Next.js проксирует их в бэкенд.
import type { BloodGroup, CheckResult, Eligibility, Level, NotifySettings, Species, Urgency } from '@pavhelp/core';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      // Изменяющие запросы всегда с JSON: сервер отклоняет остальные (защита от CSRF).
      ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body ?? {}) }),
    });
  } catch {
    throw new ApiError(0, 'Нет соединения. Проверьте интернет и попробуйте ещё раз');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Что-то пошло не так', data.fields);
  return data as T;
}

export interface Clinic {
  id: string;
  name: string;
  address: string;
  district: string;
  phone: string;
  night: boolean;
  bloodBank: boolean;
}

export interface Me {
  id: string;
  name: string;
  email: string | null;
  /** Телефон для связи, необязательный. */
  phone: string | null;
  district: string | null;
  notify: NotifySettings;
  telegramConnected: boolean;
  needsConsent: boolean;
  providers: string[];
  noChannels: boolean;
}

export interface Progress {
  xp: number;
  level: Level;
  badges: { id: string; symbol: string; title: string; description: string; goal: number; earned: boolean; value: number }[];
}

export interface Pet {
  id: string;
  species: Species;
  name: string;
  breed: string;
  birthDate: string | null;
  weightKg: number | null;
  bloodGroup: BloodGroup;
  district: string;
  outdoor: boolean;
  chronic: boolean;
  donorEnabled: boolean;
  lastDonation: string | null;
  med: { id: string; kind: string; date: string; note: string }[];
  eligibility: Eligibility;
}

export interface RequestSummary {
  id: string;
  slug: string;
  petName: string;
  species: Species;
  weightKg: number;
  bloodGroup: BloodGroup;
  urgency: Urgency;
  reason: string;
  status: 'open' | 'donor_chosen' | 'closed';
  createdAt: string;
  clinic: Clinic;
  responders: number;
}

export interface Message {
  id: string;
  system: boolean;
  mine: boolean;
  text: string;
  at: string;
}

export interface RequestDetail extends RequestSummary {
  postText: string;
  publicUrl: string;
  role: 'guest' | 'viewer' | 'author' | 'donor';
  trip?: { step: number; steps: string[] } | null;
  messages?: Message[];
  // автор
  notified?: number;
  wave?: number;
  radiusKm?: number;
  responses?: {
    id: string;
    status: string;
    petName: string;
    breed: string;
    weightKg: number;
    bloodGroup: BloodGroup;
    district: string;
    km: number | null;
    ownerName: string;
    phone: string | null;
  }[];
  // донор и зритель
  myResponse?: { id: string; status: string; petName: string } | null;
  author?: { name: string; phone: string | null };
  myPets?: { id: string; name: string; ready: boolean; compatible: boolean; daysLeft: number; firstProblem: string | null }[];
}

export type { CheckResult };
