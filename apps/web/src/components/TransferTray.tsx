'use client';

import { useState } from 'react';
import { useTransfers } from './TransfersProvider';
import { formatBytes, percent } from '@/lib/format';
import { IconChevronDown, IconChevronRight, IconClose } from './Icons';

const LABEL: Record<string, string> = {
  QUEUED: 'En cola',
  EXPANDING: 'Leyendo carpetas',
  RUNNING: 'Transfiriendo',
  COMPLETED: 'Completada',
  COMPLETED_WITH_ERRORS: 'Completada con errores',
  FAILED: 'Fallida',
  CANCELLED: 'Cancelada',
};

/** Bandeja flotante. Vive por encima del router: sobrevive a la navegación. */
export function TransferTray() {
  const { jobs, cancel, retry, dismiss } = useTransfers();
  const [collapsed, setCollapsed] = useState(false);

  if (jobs.length === 0) return null;

  const active = jobs.filter((j) => j.status === 'RUNNING' || j.status === 'QUEUED' || j.status === 'EXPANDING').length;

  return (
    <aside
      className="card"
      style={{
        position: 'fixed', right: 18, bottom: 18, width: 360, maxWidth: 'calc(100vw - 36px)',
        zIndex: 60, boxShadow: 'var(--shadow-2)', overflow: 'hidden',
        animation: 'imv-fade-in .15s ease',
      }}
    >
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          width: '100%', border: 'none', borderRadius: 0, background: 'var(--surface)',
          padding: '11px 13px', justifyContent: 'space-between', fontWeight: 550,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {collapsed ? <IconChevronRight /> : <IconChevronDown />}
          Transferencias
        </span>
        <span className="tag">{active > 0 ? `${active} en curso` : `${jobs.length}`}</span>
      </button>

      {!collapsed && (
        <div style={{ maxHeight: 300, overflow: 'auto', borderTop: '1px solid var(--border)' }}>
          {jobs.map((job) => {
            const pct = percent(job.doneBytes, job.totalBytes) || percent(job.itemsDone, job.itemsTotal);
            const running = job.status === 'RUNNING' || job.status === 'QUEUED' || job.status === 'EXPANDING';
            const failed = job.itemsFailed > 0;

            return (
              <div key={job.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 500 }}>
                    {job.kind === 'MOVE' ? 'Mover' : 'Copiar'}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {LABEL[job.status] ?? job.status} · {job.itemsDone}/{job.itemsTotal}
                  </span>
                </div>

                <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 3, margin: '9px 0 7px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${pct}%`, height: '100%', borderRadius: 3,
                      background: failed ? 'var(--danger)' : running ? 'var(--brand)' : 'var(--ok)',
                      transition: 'width .3s ease',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span className="muted" style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatBytes(job.doneBytes)} / {formatBytes(job.totalBytes)}
                    {failed && ` · ${job.itemsFailed} con error`}
                  </span>
                  <span style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                    {running && (
                      <button className="ghost" onClick={() => void cancel(job.id)} style={{ fontSize: 12, padding: '3px 8px' }}>
                        Cancelar
                      </button>
                    )}
                    {failed && !running && (
                      <button className="ghost" onClick={() => void retry(job.id)} style={{ fontSize: 12, padding: '3px 8px' }}>
                        Reintentar
                      </button>
                    )}
                    {!running && (
                      <button className="icon" onClick={() => dismiss(job.id)} aria-label="Ocultar"><IconClose /></button>
                    )}
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
