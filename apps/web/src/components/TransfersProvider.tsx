'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { TransferJobView } from '@imvoces/contracts';
import { api, subscribeToJob } from '@/lib/api';

interface TransfersValue {
  jobs: TransferJobView[];
  track: (job: TransferJobView) => void;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  dismiss: (id: string) => void;
}

const Ctx = createContext<TransfersValue | null>(null);

const isFinished = (status: TransferJobView['status']) =>
  status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED' || status === 'COMPLETED_WITH_ERRORS';

/**
 * Bandeja de transferencias: vive por encima del router, así que sobrevive a la
 * navegación entre páginas igual que la de Drive.
 */
export function TransfersProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<TransferJobView[]>([]);
  const subs = useRef(new Map<string, () => void>());

  const refresh = useCallback(async (id: string) => {
    const fresh = await api.transfer(id).catch(() => null);
    if (fresh) setJobs((prev) => prev.map((j) => (j.id === id ? fresh : j)));
    return fresh;
  }, []);

  const track = useCallback(
    (job: TransferJobView) => {
      setJobs((prev) => (prev.some((j) => j.id === job.id) ? prev : [job, ...prev]));
      if (subs.current.has(job.id) || isFinished(job.status)) return;

      const close = subscribeToJob(job.id, (raw) => {
        const ev = raw as { type: string; status?: TransferJobView['status'] };
        if (ev.type === 'done' || ev.type === 'job') {
          void refresh(job.id);
          if (ev.type === 'done') {
            subs.current.get(job.id)?.();
            subs.current.delete(job.id);
          }
        }
        // Los eventos 'item' llegan con mucha frecuencia; el progreso agregado se
        // recalcula desde el job para no re-renderizar en cada chunk.
      });
      subs.current.set(job.id, close);

      // Red de seguridad: si el SSE se corta sin avisar, se sondea el estado.
      const poll = setInterval(async () => {
        const fresh = await refresh(job.id);
        if (fresh && isFinished(fresh.status)) clearInterval(poll);
      }, 5000);
    },
    [refresh],
  );

  // Al montar se recuperan los jobs en curso: recargar la página no pierde la bandeja.
  useEffect(() => {
    void api
      .transfers()
      .then(({ jobs: existing }) => existing.filter((j) => !isFinished(j.status)).forEach(track))
      .catch(() => undefined);

    const openSubs = subs.current;
    return () => {
      openSubs.forEach((close) => close());
      openSubs.clear();
    };
  }, [track]);

  const cancel = useCallback(
    async (id: string) => {
      await api.cancelTransfer(id);
      await refresh(id);
    },
    [refresh],
  );

  const retry = useCallback(
    async (id: string) => {
      await api.retryTransfer(id);
      const fresh = await refresh(id);
      if (fresh) track(fresh);
    },
    [refresh, track],
  );

  const dismiss = useCallback((id: string) => {
    subs.current.get(id)?.();
    subs.current.delete(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  return <Ctx.Provider value={{ jobs, track, cancel, retry, dismiss }}>{children}</Ctx.Provider>;
}

export function useTransfers(): TransfersValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTransfers debe usarse dentro de TransfersProvider');
  return ctx;
}
