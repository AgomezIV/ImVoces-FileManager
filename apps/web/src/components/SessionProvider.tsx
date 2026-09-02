'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, refreshSession, setAccessToken } from '@/lib/api';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface SessionValue {
  user: SessionUser | null;
  loading: boolean;
  loginWithIdToken: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Al cargar, la cookie de refresh basta para recuperar la sesión sin volver a
  // pasar por Google. `api.me()` usa el access token que `refreshSession` acaba
  // de dejar en memoria: leerlo de otro sitio devolvería uno caducado y la
  // sesión, siendo válida, se vería como cerrada.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const ok = await refreshSession();
      if (!alive) return;
      if (ok) {
        const me = await api.me().catch(() => null);
        if (alive) setUser(me);
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loginWithIdToken = useCallback(async (idToken: string) => {
    const res = await api.loginWithGoogle(idToken);
    setAccessToken(res.accessToken);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setAccessToken(null);
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, loginWithIdToken, logout }}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession debe usarse dentro de SessionProvider');
  return ctx;
}
