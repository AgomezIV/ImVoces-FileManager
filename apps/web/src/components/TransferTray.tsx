'use client';

import { useState } from 'react';
import { useTransfers } from './TransfersProvider';
import { formatBytes, percent } from '@/lib/format';

const LABEL: Record<string, string> = {
  QUEUED: 'En cola',
  EXPANDING: 'Leyendo carpetas',
  RUNNING: 'Transfiriendo',
  COMPLETED: 'Completada',
  COMPLETED_WITH_ERRORS: 'Completada con errores',
  FAILED: 'Fallida',
  CANCELLED: 'Cancelada',
};

/** Bandeja flotante de transferencias, siempre visible mientras haya trabajo. */
export function TransferTray() {
  const { jobs, cancel, retry, dismiss } = useTransfers();
  const [collapsed, setCollapsed] = useState(false);

  if (jobs.length === 0) return null;

  return (
    <aside
      className="card"
      style={{ position: 'fixed', right: 16, bottom: 16, width: 380, maxWidth: 'calc(100vw - 32px)', zIndex: 50 }}
    >
      <header
        onClick={() => setCollapsed((c) => !c)}
        style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', cursor: 'pointer', borderBottom: collapsed ? 'none' : '1px solid var(--border)' }}
      >
        <strong>Transferencias ({jobs.length})</strong>
        <span className="muted">{collapsed ? '▲' : '▼'}</span>
      </header>

      {!collapsed && (
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          {jobs.map((job) => {
            const pct = percent(job.doneBytes, job.totalBytes) || percent(job.itemsDone, job.itemsTotal);
            const active = job.status === 'RUNNING' || job.status === 'QUEUED' || job.status === 'EXPANDING';
            return (
              <div key={job.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{job.kind === 'MOVE' ? 'Mover' : 'Copiar'} · {LABEL[job.status] ?? job.status}</span>
                  <span className="muted">{job.itemsDone}/{job.itemsTotal}</span>
                </div>

                <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, margin: '8px 0' }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      borderRadius: 3,
                      background: job.itemsFailed > 0 ? 'var(--danger)' : 'var(--ok)',
                      transition: 'width .3s ease',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span className="muted">
                    {formatBytes(job.doneBytes)} / {formatBytes(job.totalBytes)}
                    {job.itemsFailed > 0 && ` · ${job.itemsFailed} con error`}
                  </span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    {active && <button onClick={() => void cancel(job.id)} style={{ padding: '3px 8px' }}>Cancelar</button>}
                    {job.itemsFailed > 0 && !active && (
                      <button onClick={() => void retry(job.id)} style={{ padding: '3px 8px' }}>Reintentar</button>
                    )}
                    {!active && <button onClick={() => dismiss(job.id)} style={{ padding: '3px 8px' }}>Ocultar</button>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
