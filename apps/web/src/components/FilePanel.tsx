'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RemoteEntry, StorageAccountView } from '@imvoces/contracts';
import { api } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';

export interface PanelState {
  accountId: string | null;
  path: string;
  selected: string[];
}

interface Props {
  side: 'left' | 'right';
  accounts: StorageAccountView[];
  state: PanelState;
  onChange: (next: PanelState) => void;
  /** Soltar aquí una selección del otro panel dispara la transferencia. */
  onDropFrom: (side: 'left' | 'right') => void;
}

function parentOf(path: string): string {
  if (path === '/') return '/';
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

/**
 * Un lado del explorador: selector de cuenta, migas de pan y listado.
 * Los dos paneles son la misma pieza; lo que los diferencia es su estado.
 */
export function FilePanel({ side, accounts, state, onChange, onDropFrom }: Props) {
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const { accountId, path, selected } = state;

  // Sin cuenta elegida se toma la primera: un panel vacío no ayuda a nadie.
  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      onChange({ ...state, accountId: accounts[0]!.id, path: '/', selected: [] });
    }
  }, [accountId, accounts, onChange, state]);

  const query = useQuery({
    queryKey: ['list', accountId, path],
    queryFn: () => api.list(accountId as string, path),
    enabled: !!accountId,
  });

  const entries = useMemo(() => query.data?.entries ?? [], [query.data]);

  const toggle = useCallback(
    (entry: RemoteEntry, additive: boolean) => {
      const next = additive
        ? selected.includes(entry.path)
          ? selected.filter((p) => p !== entry.path)
          : [...selected, entry.path]
        : [entry.path];
      onChange({ ...state, selected: next });
    },
    [onChange, selected, state],
  );

  const open = useCallback(
    (entry: RemoteEntry) => {
      if (entry.kind !== 'folder') return;
      onChange({ ...state, path: entry.path, selected: [] });
    },
    [onChange, state],
  );

  const crumbs = useMemo(() => {
    const parts = path.split('/').filter(Boolean);
    return [{ label: 'Inicio', path: '/' }].concat(
      parts.map((part, i) => ({ label: part, path: `/${parts.slice(0, i + 1).join('/')}` })),
    );
  }, [path]);

  const createFolder = async () => {
    const name = window.prompt('Nombre de la carpeta nueva');
    if (!name || !accountId) return;
    await api.createFolder(accountId, path, name);
    await queryClient.invalidateQueries({ queryKey: ['list', accountId, path] });
  };

  const removeSelected = async () => {
    if (!accountId || selected.length === 0) return;
    if (!window.confirm(`¿Eliminar ${selected.length} elemento(s)?`)) return;
    await api.remove(accountId, selected);
    onChange({ ...state, selected: [] });
    await queryClient.invalidateQueries({ queryKey: ['list', accountId, path] });
  };

  return (
    <section
      className="card"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, outline: dragOver ? '2px solid var(--brand)' : 'none' }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const from = e.dataTransfer.getData('text/imvoces-side');
        if (from === 'left' || from === 'right') onDropFrom(from);
      }}
    >
      <header style={{ display: 'flex', gap: 8, padding: 10, borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
        <select
          value={accountId ?? ''}
          onChange={(e) => onChange({ accountId: e.target.value, path: '/', selected: [] })}
          style={{ flex: 1, minWidth: 0 }}
        >
          {accounts.length === 0 && <option value="">Sin cuentas conectadas</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <button onClick={createFolder} disabled={!accountId} title="Nueva carpeta">
          Nueva carpeta
        </button>
        <button onClick={removeSelected} disabled={selected.length === 0} title="Eliminar selección">
          Eliminar
        </button>
      </header>

      <nav style={{ display: 'flex', gap: 4, padding: '8px 10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => onChange({ ...state, path: parentOf(path), selected: [] })}
          disabled={path === '/'}
          style={{ padding: '3px 8px' }}
        >
          ↑
        </button>
        {crumbs.map((c, i) => (
          <span key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span className="muted">/</span>}
            <button
              onClick={() => onChange({ ...state, path: c.path, selected: [] })}
              style={{ border: 'none', background: 'none', padding: '3px 4px', color: i === crumbs.length - 1 ? 'var(--text)' : 'var(--text-muted)' }}
            >
              {c.label}
            </button>
          </span>
        ))}
      </nav>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {query.isLoading && <p className="muted" style={{ padding: 16 }}>Cargando…</p>}
        {query.isError && (
          <p style={{ padding: 16, color: 'var(--danger)' }}>
            {(query.error as Error).message}
          </p>
        )}
        {!query.isLoading && entries.length === 0 && (
          <p className="muted" style={{ padding: 16 }}>Esta carpeta está vacía.</p>
        )}

        {entries.map((entry) => {
          const isSelected = selected.includes(entry.path);
          return (
            <div
              key={entry.path}
              draggable={entry.kind === 'file' || entry.kind === 'folder'}
              onDragStart={(e) => {
                if (!isSelected) toggle(entry, false);
                e.dataTransfer.setData('text/imvoces-side', side);
              }}
              onClick={(e) => toggle(entry, e.ctrlKey || e.metaKey)}
              onDoubleClick={() => open(entry)}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 90px 110px',
                gap: 8,
                padding: '7px 12px',
                cursor: 'pointer',
                background: isSelected ? 'var(--surface-2)' : 'transparent',
                borderLeft: `3px solid ${isSelected ? 'var(--brand)' : 'transparent'}`,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.kind === 'folder' ? '📁' : '📄'} {entry.name}
              </span>
              <span className="muted" style={{ textAlign: 'right' }}>
                {entry.kind === 'folder' ? '—' : formatBytes(entry.size)}
              </span>
              <span className="muted" style={{ textAlign: 'right' }}>{formatDate(entry.modifiedAt)}</span>
            </div>
          );
        })}
      </div>

      <footer style={{ padding: '6px 12px', borderTop: '1px solid var(--border)' }} className="muted">
        {selected.length > 0 ? `${selected.length} seleccionado(s)` : `${entries.length} elemento(s)`}
      </footer>
    </section>
  );
}
