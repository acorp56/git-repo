'use client';
// Текущий город: из профиля, а до входа — из памяти браузера. По умолчанию Петербург.
import { DEFAULT_CITY, isCity } from '@pavhelp/core';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useSession } from './session';

const KEY = 'pavhelp.city';

function stored(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return isCity(v) ? v : null;
  } catch {
    return null;
  }
}

export function useCity(): [string, (city: string, district?: string | null) => Promise<void>] {
  const { me, reload } = useSession();
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => setLocal(stored()), []);
  const city = me?.city ?? local ?? DEFAULT_CITY;
  const set = useCallback(
    async (c: string, district?: string | null) => {
      try {
        localStorage.setItem(KEY, c);
      } catch {}
      setLocal(c);
      if (me) {
        await api('/me', { method: 'PATCH', body: { city: c, ...(district !== undefined ? { district } : {}) } });
        await reload();
      }
    },
    [me, reload],
  );
  return [city, set];
}
