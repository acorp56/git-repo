// Клиент API. Все запросы идут на /api/* того же домена, Next.js проксирует их в бэкенд.
import type { BloodGroup, CheckResult, Component, Eligibility, Level, NotifySettings, Species, Urgency } from '@pavhelp/core';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
    public data: Record<string, unknown> = {},
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
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Что-то пошло не так', data.fields, data.data);
  return data as T;
}

export interface Clinic {
  id: string;
  name: string;
  address: string;
  city: string;
  district: string;
  phone: string;
  night: boolean;
  bloodBank: boolean;
}

export interface BankOffer {
  clinicId: string;
  clinicName: string;
  clinicPhone: string;
  address: string;
  bloodGroup: BloodGroup;
  component: Component;
  doses: number;
  doseMl: number;
  check: boolean;
  km: number | null;
  updatedAt: string;
}

export interface Me {
  id: string;
  name: string;
  email: string | null;
  /** Телефон для связи, необязательный. */
  phone: string | null;
  city: string | null;
  district: string | null;
  notify: NotifySettings;
  telegramConnected: boolean;
  needsConsent: boolean;
  providers: string[];
  noChannels: boolean;
  clinics: { id: string; name: string; role: string }[];
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
  city: string;
  district: string;
  outdoor: boolean;
  chronic: boolean;
  donorEnabled: boolean;
  sex: 'm' | 'f' | null;
  chip: string | null;
  housing: 'flat' | 'house' | 'aviary' | null;
  underTreatment: boolean;
  transfused: boolean;
  pausedUntil: string | null;
  deceased: boolean;
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
  component: Component;
  volumeMl: number | null;
  urgency: Urgency;
  reason: string;
  status: 'open' | 'donor_chosen' | 'closed';
  priority: boolean;
  clinicStatus: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
  clinic: Clinic;
  responders: number;
  staleAsk?: boolean;
}

export interface Message {
  id: string;
  system: boolean;
  mine: boolean;
  text: string;
  /** Похоже на просьбу о деньгах. */
  flagged: boolean;
  at: string;
}

export interface RequestDetail extends RequestSummary {
  postText: string;
  publicUrl: string;
  role: 'guest' | 'viewer' | 'author' | 'donor';
  authorSince: string;
  authorNew: boolean;
  reportedByMe?: boolean;
  trip?: { step: number; steps: string[] } | null;
  messages?: Message[];
  chat?: { blocked: boolean };
  myPhoneShown?: boolean;
  myPhone?: string | null;
  // автор
  notified?: number;
  wave?: number;
  radiusKm?: number;
  canExpand?: boolean;
  staleAsk?: boolean;
  hidden?: boolean;
  banks?: BankOffer[];
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
    phoneShown: boolean;
  }[];
  // донор и зритель
  myResponse?: { id: string; status: string; petName: string } | null;
  author?: { name: string; phone: string | null; phoneShown: boolean };
  myPets?: { id: string; name: string; ready: boolean; paused: boolean; compatible: boolean; daysLeft: number; firstProblem: string | null }[];
}

export type { CheckResult };
