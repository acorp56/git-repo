'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Me, type Progress } from './api';

interface Session {
  me: Me | null;
  progress: Progress | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<Session>({ me: null, progress: null, loading: true, reload: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ me: Me | null; progress: Progress | null; loading: boolean }>({
    me: null,
    progress: null,
    loading: true,
  });
  const reload = useCallback(async () => {
    try {
      const r = await api<{ user: Me | null; progress?: Progress }>('/me');
      setState({ me: r.user, progress: r.progress ?? null, loading: false });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return <Ctx.Provider value={{ ...state, reload }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
