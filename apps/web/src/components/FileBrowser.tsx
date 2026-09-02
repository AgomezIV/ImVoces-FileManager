'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RemoteEntry } from '@imvoces/contracts';
import { api } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';
import { fileKind, KIND_COLOR } from '@/lib/fileTypes';
import {
  IconArchive, IconArrowUp, IconAudio, IconDoc, IconFile, IconFolder, IconHome,
  IconImage, IconNewFolder, IconRefresh, IconSearch, IconVideo,
} from './Icons';

const ICONS = {
  folder: IconFolder, image: IconImage, video: IconVideo,
  audio: IconAudio, archive: IconArchive, doc: IconDoc, file: IconFile,
};

export type SortKey = 'name' | 'size' | 'modified';

interface Props {
  accountId: string;
  accountLabel: string;
  path: string;
  selected: string[];
  onNavigate: (path: string) => void;
  onSelect: (paths: string[]) => void;
}

function parentOf(path: string): string {
  if (path === '/') return '/';
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

/** Vista de una carpeta: la misma tanto si la nube es Drive, Dropbox o R2. */
export function FileBrowser({ accountId, accountLabel, path, selected, onNavigate, onSelect }: Props) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true });
  const [lastIndex, setLastIndex] = useState<number | null>(null);

  const listQuery = useQuery({
    queryKey: ['list', accountId, path],
    queryFn: () => api.list(accountId, path),
    enabled: !!accountId,
  });

  const entries = useMemo(() => {
    const all = listQuery.data?.entries ?? [];
    const filtered = query
      ? all.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
      : all;

    const dir = sort.asc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // Las carpetas siempre primero, como en cualquier gestor de archivos.
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      if (sort.key === 'size') return (a.size - b.size) * dir;
      if (sort.key === 'modified') {
        return ((a.modifiedAt ?? '') < (b.modifiedAt ?? '') ? -1 : 1) * dir;
      }
      return a.name.localeCompare(b.name, 'es', { numeric: true }) * dir;
    });
  }, [listQuery.data, query, sort]);

  const crumbs = useMemo(() => {
    const parts = path.split('/').filter(Boolean);
    return parts.map((part, i) => ({ label: part, path: `/${parts.slice(0, i + 1).join('/')}` }));
  }, [path]);

  const click = useCallback(
    (entry: RemoteEntry, index: number, e: React.MouseEvent) => {
      if (e.shiftKey && lastIndex !== null) {
        const [from, to] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
        onSelect(entries.slice(from, to + 1).map((x) => x.path));
        return;
      }
      setLastIndex(index);
      if (e.ctrlKey || e.metaKey) {
        onSelect(
          selected.includes(entry.path)
            ? selected.filter((p) => p !== entry.path)
            : [...selected, entry.path],
        );
        return;
      }
      onSelect([entry.path]);
    },
    [entries, lastIndex, onSelect, selected],
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['list', accountId, path] });

  const newFolder = async () => {
    const name = window.prompt('Nombre de la carpeta nueva');
    if (!name) return;
    await api.createFolder(accountId, path, name);
    await refresh();
  };

  const header = (key: SortKey, label: string, align: 'left' | 'right') => (
    <button
      onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}
      className="ghost"
      style={{
        padding: '2px 4px', fontSize: 12, fontWeight: 550, color: 'var(--text-2)',
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start', width: '100%',
      }}
    >
      {label}
      {sort.key === key && <span aria-hidden>{sort.asc ? '↑' : '↓'}</span>}
    </button>
  );

  return (
    <section style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      {/* Barra de navegación */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
          borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        }}
      >
        <button className="icon" onClick={() => onNavigate(parentOf(path))} disabled={path === '/'} aria-label="Subir un nivel">
          <IconArrowUp />
        </button>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <button className="ghost" onClick={() => onNavigate('/')} style={{ gap: 6, padding: '4px 7px', color: path === '/' ? 'var(--text)' : 'var(--text-2)' }}>
            <IconHome /> {accountLabel}
          </button>
          {crumbs.map((c, i) => (
            <span key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
              <span className="dim">/</span>
              <button
                className="ghost"
                onClick={() => onNavigate(c.path)}
                style={{
                  padding: '4px 7px', maxWidth: 180,
                  color: i === crumbs.length - 1 ? 'var(--text)' : 'var(--text-2)',
                  fontWeight: i === crumbs.length - 1 ? 550 : 400,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
              </button>
            </span>
          ))}
        </nav>

        <div style={{ position: 'relative', width: 210 }}>
          <span className="dim" style={{ position: 'absolute', left: 9, top: 8, display: 'flex' }}><IconSearch /></span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en esta carpeta"
            style={{ paddingLeft: 30 }}
          />
        </div>

        <button className="icon" onClick={() => void refresh()} aria-label="Actualizar"><IconRefresh /></button>
        <button onClick={() => void newFolder()}><IconNewFolder /> Nueva carpeta</button>
      </div>

      {/* Cabecera de columnas */}
      <div
        style={{
          display: 'grid', gridTemplateColumns: '1fr 110px 140px', gap: 12,
          padding: '6px 16px', borderBottom: '1px solid var(--border)',
        }}
      >
        {header('name', 'Nombre', 'left')}
        {header('size', 'Tamaño', 'right')}
        {header('modified', 'Modificado', 'right')}
      </div>

      {/* Lista */}
      <div
        style={{ flex: 1, overflow: 'auto', minHeight: 0 }}
        onClick={(e) => { if (e.target === e.currentTarget) onSelect([]); }}
      >
        {listQuery.isLoading && <p className="muted" style={{ padding: 20 }}>Cargando…</p>}

        {listQuery.isError && (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <p style={{ color: 'var(--danger)' }}>{(listQuery.error as Error).message}</p>
            <button onClick={() => void refresh()}>Reintentar</button>
          </div>
        )}

        {!listQuery.isLoading && !listQuery.isError && entries.length === 0 && (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <span className="dim" style={{ display: 'inline-flex' }}><IconFolder size={34} /></span>
            <p className="muted" style={{ marginTop: 10 }}>
              {query ? 'Nada coincide con la búsqueda.' : 'Esta carpeta está vacía.'}
            </p>
          </div>
        )}

        {entries.map((entry, i) => {
          const isSelected = selected.includes(entry.path);
          const kind = fileKind(entry.name, entry.kind === 'folder');
          const Icon = ICONS[kind];

          return (
            <div
              key={entry.path}
              draggable
              onDragStart={(e) => {
                if (!isSelected) onSelect([entry.path]);
                e.dataTransfer.setData('text/imvoces-drag', '1');
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={(e) => click(entry, i, e)}
              onDoubleClick={() => entry.kind === 'folder' && onNavigate(entry.path)}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 110px 140px', gap: 12,
                alignItems: 'center', padding: '0 16px', height: 'var(--row-h)',
                cursor: 'default', userSelect: 'none',
                background: isSelected ? 'var(--brand-soft)' : 'transparent',
                boxShadow: isSelected ? 'inset 2px 0 0 var(--brand)' : 'none',
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ color: KIND_COLOR[kind], display: 'flex', flexShrink: 0 }}><Icon size={17} /></span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.name}
                </span>
              </span>
              <span className="muted" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {entry.kind === 'folder' ? '—' : formatBytes(entry.size)}
              </span>
              <span className="muted" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatDate(entry.modifiedAt)}
              </span>
            </div>
          );
        })}
      </div>

      <footer
        className="muted"
        style={{ padding: '7px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12 }}
      >
        {selected.length > 0
          ? `${selected.length} de ${entries.length} seleccionado${selected.length === 1 ? '' : 's'}`
          : `${entries.length} elemento${entries.length === 1 ? '' : 's'}`}
      </footer>
    </section>
  );
}
