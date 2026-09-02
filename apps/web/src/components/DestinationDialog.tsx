'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RemoteEntry, StorageAccountView } from '@imvoces/contracts';
import { api } from '@/lib/api';
import { IconArrowUp, IconClose, IconCloud, IconFolder, IconNewFolder } from './Icons';

interface Props {
  accounts: StorageAccountView[];
  /** Cuenta y ruta desde donde se copia, para no proponer el mismo sitio. */
  from: { accountId: string; path: string };
  count: number;
  kind: 'COPY' | 'MOVE';
  onCancel: () => void;
  onConfirm: (dest: { accountId: string; path: string }) => void;
}

/**
 * Selector de destino: elegir nube y navegar hasta la carpeta.
 *
 * Es el equivalente al "Mover a…" de cualquier gestor de archivos, y lo que
 * sustituye al doble panel: copiar entre nubes distintas es el mismo gesto que
 * copiar a otra carpeta de la misma.
 */
export function DestinationDialog({ accounts, from, count, kind, onCancel, onConfirm }: Props) {
  const other = accounts.find((a) => a.id !== from.accountId);
  const [accountId, setAccountId] = useState(other?.id ?? accounts[0]?.id ?? '');
  const [path, setPath] = useState('/');
  const [folders, setFolders] = useState<RemoteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (acc: string, p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.list(acc, p);
      setFolders(res.entries.filter((e) => e.kind === 'folder'));
    } catch (err) {
      setError((err as Error).message);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accountId) void load(accountId, path);
  }, [accountId, path, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const up = () => setPath((p) => (p === '/' ? '/' : p.slice(0, Math.max(1, p.lastIndexOf('/')))));

  const newFolder = async () => {
    const name = window.prompt('Nombre de la carpeta nueva');
    if (!name) return;
    await api.createFolder(accountId, path, name);
    await load(accountId, path);
  };

  const sameAsOrigin = accountId === from.accountId && path === from.path;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={kind === 'MOVE' ? 'Mover a' : 'Copiar a'}
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(8,12,16,.45)',
        display: 'grid', placeItems: 'center', padding: 20,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, 100%)', boxShadow: 'var(--shadow-3)',
          display: 'flex', flexDirection: 'column', maxHeight: '80vh',
          animation: 'imv-fade-in .14s ease',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <strong style={{ flex: 1 }}>
            {kind === 'MOVE' ? 'Mover' : 'Copiar'} {count} elemento{count === 1 ? '' : 's'} a…
          </strong>
          <button className="icon" onClick={onCancel} aria-label="Cerrar"><IconClose /></button>
        </header>

        <div style={{ padding: '12px 16px', display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 5 }}>
            <span className="dim" style={{ fontSize: 12 }}>Destino</span>
            <select
              value={accountId}
              onChange={(e) => { setAccountId(e.target.value); setPath('/'); }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="icon" onClick={up} disabled={path === '/'} aria-label="Subir un nivel">
              <IconArrowUp />
            </button>
            <span className="muted" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl' }}>
              {path}
            </span>
            <button className="ghost" onClick={() => void newFolder()} style={{ fontSize: 12 }}>
              <IconNewFolder /> Nueva
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', minHeight: 140, borderTop: '1px solid var(--border)' }}>
          {loading && <p className="muted" style={{ padding: 16, margin: 0 }}>Cargando…</p>}
          {error && <p style={{ padding: 16, margin: 0, color: 'var(--danger)' }}>{error}</p>}
          {!loading && !error && folders.length === 0 && (
            <p className="muted" style={{ padding: 16, margin: 0 }}>
              Sin subcarpetas. Se guardará aquí.
            </p>
          )}
          {folders.map((f) => (
            <button
              key={f.path}
              onClick={() => setPath(f.path)}
              style={{
                width: '100%', border: 'none', background: 'transparent',
                borderRadius: 0, padding: '9px 16px', gap: 10, justifyContent: 'flex-start',
              }}
            >
              <span style={{ color: '#e0a33c', display: 'flex' }}><IconFolder size={17} /></span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
            </button>
          ))}
        </div>

        <footer style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          {sameAsOrigin && (
            <span className="muted" style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
              Es la carpeta de origen. Elige otra.
            </span>
          )}
          <span style={{ flex: sameAsOrigin ? '0 0 auto' : 1 }} />
          <button onClick={onCancel}>Cancelar</button>
          <button
            className="primary"
            disabled={!accountId || sameAsOrigin}
            title={sameAsOrigin ? 'Elige un destino distinto del origen' : undefined}
            onClick={() => onConfirm({ accountId, path })}
          >
            <IconCloud size={16} />
            {kind === 'MOVE' ? 'Mover aquí' : 'Copiar aquí'}
          </button>
        </footer>
      </div>
    </div>
  );
}
