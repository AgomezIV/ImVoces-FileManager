'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RemoteEntry } from '@imvoces/contracts';
import { api } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';
import { fileKind, KIND_COLOR } from '@/lib/fileTypes';
import { canThumbnail } from '@/lib/preview';
import {
  IconArchive, IconArrowUp, IconAudio, IconDoc, IconFile, IconFolder, IconHome,
  IconImage, IconNewFolder, IconRefresh, IconSearch, IconVideo,
} from './Icons';

const ICONS = {
  folder: IconFolder, image: IconImage, video: IconVideo,
  audio: IconAudio, archive: IconArchive, doc: IconDoc, file: IconFile,
};

export type SortKey = 'name' | 'size' | 'modified';
export type ViewMode = 'list' | 'grid';

interface Props {
  accountId: string;
  accountLabel: string;
  path: string;
  selected: string[];
  /** Dirección de la última navegación, para animar hacia dentro o hacia fuera. */
  direction: 'in' | 'out';
  onNavigate: (path: string, direction: 'in' | 'out') => void;
  onSelect: (paths: string[]) => void;
  onOpenFile: (entry: RemoteEntry, all: RemoteEntry[]) => void;
  onContextMenu: (e: React.MouseEvent, entry: RemoteEntry | null) => void;
  onEntries: (entries: RemoteEntry[]) => void;
}

function parentOf(path: string): string {
  if (path === '/') return '/';
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

/** Miniatura de imagen; cae al icono si el archivo no se puede cargar. */
function Thumb({ accountId, entry, size }: { accountId: string; entry: RemoteEntry; size: number }) {
  const [broken, setBroken] = useState(false);
  const kind = fileKind(entry.name, entry.kind === 'folder');
  const Icon = ICONS[kind];

  if (entry.kind === 'file' && !broken && canThumbnail(entry.name, entry.size)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={entry.thumbnailUrl ?? api.contentUrl(accountId, entry.path)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        style={{
          width: '100%', height: '100%', objectFit: 'cover',
          borderRadius: 6, display: 'block', background: 'var(--surface-3)',
        }}
      />
    );
  }
  return (
    <span style={{ color: KIND_COLOR[kind], display: 'flex' }}>
      <Icon size={size} />
    </span>
  );
}

export function FileBrowser({
  accountId, accountLabel, path, selected, direction,
  onNavigate, onSelect, onOpenFile, onContextMenu, onEntries,
}: Props) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true });
  const [view, setView] = useState<ViewMode>('list');
  const [lastIndex, setLastIndex] = useState<number | null>(null);

  // La vista elegida se recuerda entre sesiones: es preferencia, no estado.
  useEffect(() => {
    const saved = window.localStorage.getItem('imv_view');
    if (saved === 'grid' || saved === 'list') setView(saved);
  }, []);
  const changeView = (next: ViewMode) => {
    setView(next);
    window.localStorage.setItem('imv_view', next);
  };

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
      if (sort.key === 'modified') return ((a.modifiedAt ?? '') < (b.modifiedAt ?? '') ? -1 : 1) * dir;
      return a.name.localeCompare(b.name, 'es', { numeric: true }) * dir;
    });
  }, [listQuery.data, query, sort]);

  // La página necesita la lista para el visor y para "seleccionar todo".
  const reported = useRef<RemoteEntry[]>([]);
  useEffect(() => {
    if (reported.current !== entries) {
      reported.current = entries;
      onEntries(entries);
    }
  }, [entries, onEntries]);

  useEffect(() => setQuery(''), [path, accountId]);

  const crumbs = useMemo(() => {
    const parts = path.split('/').filter(Boolean);
    return parts.map((part, i) => ({ label: part, path: `/${parts.slice(0, i + 1).join('/')}` }));
  }, [path]);

  /**
   * Un solo clic abre: carpeta, dentro; archivo, al visor. Para seleccionar sin
   * abrir están ctrl y shift, igual que en el escritorio.
   */
  const activate = useCallback(
    (entry: RemoteEntry, index: number, e: React.MouseEvent) => {
      if (e.shiftKey && lastIndex !== null) {
        const [from, to] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
        onSelect(entries.slice(from, to + 1).map((x) => x.path));
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        setLastIndex(index);
        onSelect(
          selected.includes(entry.path)
            ? selected.filter((p) => p !== entry.path)
            : [...selected, entry.path],
        );
        return;
      }
      setLastIndex(index);
      if (entry.kind === 'folder') {
        onNavigate(entry.path, 'in');
      } else {
        onSelect([entry.path]);
        onOpenFile(entry, entries);
      }
    },
    [entries, lastIndex, onNavigate, onOpenFile, onSelect, selected],
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

  const rowProps = (entry: RemoteEntry, i: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      if (!selected.includes(entry.path)) onSelect([entry.path]);
      e.dataTransfer.setData('text/imvoces-drag', '1');
      e.dataTransfer.effectAllowed = 'copy' as const;
    },
    onClick: (e: React.MouseEvent) => activate(entry, i, e),
    onContextMenu: (e: React.MouseEvent) => {
      if (!selected.includes(entry.path)) onSelect([entry.path]);
      onContextMenu(e, entry);
    },
  });

  const empty = !listQuery.isLoading && !listQuery.isError && entries.length === 0;

  return (
    <section style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
          borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        }}
      >
        <button className="icon" onClick={() => onNavigate(parentOf(path), 'out')} disabled={path === '/'} aria-label="Subir un nivel">
          <IconArrowUp />
        </button>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <button
            className="ghost"
            onClick={() => onNavigate('/', 'out')}
            style={{ gap: 6, padding: '4px 7px', color: path === '/' ? 'var(--text)' : 'var(--text-2)' }}
          >
            <IconHome /> {accountLabel}
          </button>
          {crumbs.map((c, i) => (
            <span key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
              <span className="dim">/</span>
              <button
                className="ghost"
                onClick={() => onNavigate(c.path, 'out')}
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

        <div style={{ position: 'relative', width: 200 }}>
          <span className="dim" style={{ position: 'absolute', left: 9, top: 8, display: 'flex' }}><IconSearch /></span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar aquí" style={{ paddingLeft: 30 }} />
        </div>

        <div style={{ display: 'flex', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          {(['list', 'grid'] as const).map((m) => (
            <button
              key={m}
              onClick={() => changeView(m)}
              aria-pressed={view === m}
              title={m === 'list' ? 'Vista de lista' : 'Vista de iconos'}
              style={{
                border: 'none', borderRadius: 0, padding: '6px 9px',
                background: view === m ? 'var(--surface-3)' : 'transparent',
              }}
            >
              {m === 'list' ? <ListGlyph /> : <GridGlyph />}
            </button>
          ))}
        </div>

        <button className="icon" onClick={() => void refresh()} aria-label="Actualizar"><IconRefresh /></button>
        <button onClick={() => void newFolder()}><IconNewFolder /> Nueva carpeta</button>
      </div>

      {view === 'list' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 140px', gap: 12, padding: '6px 16px', borderBottom: '1px solid var(--border)' }}>
          {header('name', 'Nombre', 'left')}
          {header('size', 'Tamaño', 'right')}
          {header('modified', 'Modificado', 'right')}
        </div>
      )}

      <div
        style={{ flex: 1, overflow: 'auto', minHeight: 0 }}
        onClick={(e) => { if (e.target === e.currentTarget) onSelect([]); }}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) { onSelect([]); onContextMenu(e, null); }
        }}
      >
        {listQuery.isLoading && <p className="muted" style={{ padding: 20 }}>Cargando…</p>}

        {listQuery.isError && (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <p style={{ color: 'var(--danger)' }}>{(listQuery.error as Error).message}</p>
            <button onClick={() => void refresh()}>Reintentar</button>
          </div>
        )}

        {empty && (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <span className="dim" style={{ display: 'inline-flex' }}><IconFolder size={34} /></span>
            <p className="muted" style={{ marginTop: 10 }}>
              {query ? 'Nada coincide con la búsqueda.' : 'Esta carpeta está vacía.'}
            </p>
          </div>
        )}

        {!empty && (
          <div
            // La clave fuerza el reinicio de la animación en cada carpeta.
            key={`${accountId}${path}`}
            style={{
              animation: `${direction === 'in' ? 'imv-enter-folder' : 'imv-leave-folder'} .16s ease`,
              ...(view === 'grid'
                ? {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
                    gap: 6, padding: 14,
                  }
                : {}),
            }}
          >
            {entries.map((entry, i) =>
              view === 'grid' ? (
                <div
                  key={entry.path}
                  {...rowProps(entry, i)}
                  title={entry.name}
                  style={{
                    display: 'grid', justifyItems: 'center', gap: 8, padding: '12px 8px',
                    borderRadius: 8, cursor: 'default', userSelect: 'none',
                    background: selected.includes(entry.path) ? 'var(--brand-soft)' : 'transparent',
                    outline: selected.includes(entry.path) ? '1px solid var(--brand)' : '1px solid transparent',
                    transition: 'background .1s ease',
                  }}
                  onMouseEnter={(e) => { if (!selected.includes(entry.path)) e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={(e) => { if (!selected.includes(entry.path)) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ width: 84, height: 68, display: 'grid', placeItems: 'center' }}>
                    <Thumb accountId={accountId} entry={entry} size={46} />
                  </span>
                  <span
                    style={{
                      fontSize: 12.5, textAlign: 'center', width: '100%',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      overflow: 'hidden', wordBreak: 'break-word', lineHeight: 1.35,
                    }}
                  >
                    {entry.name}
                  </span>
                </div>
              ) : (
                <div
                  key={entry.path}
                  {...rowProps(entry, i)}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 110px 140px', gap: 12,
                    alignItems: 'center', padding: '0 16px', height: 'var(--row-h)',
                    cursor: 'default', userSelect: 'none',
                    background: selected.includes(entry.path) ? 'var(--brand-soft)' : 'transparent',
                    boxShadow: selected.includes(entry.path) ? 'inset 2px 0 0 var(--brand)' : 'none',
                    transition: 'background .1s ease',
                  }}
                  onMouseEnter={(e) => { if (!selected.includes(entry.path)) e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={(e) => { if (!selected.includes(entry.path)) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <Thumb accountId={accountId} entry={entry} size={17} />
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                  </span>
                  <span className="muted" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {entry.kind === 'folder' ? '—' : formatBytes(entry.size)}
                  </span>
                  <span className="muted" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatDate(entry.modifiedAt)}
                  </span>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <footer className="muted" style={{ padding: '7px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12 }}>
        {selected.length > 0
          ? `${selected.length} de ${entries.length} seleccionado${selected.length === 1 ? '' : 's'}`
          : `${entries.length} elemento${entries.length === 1 ? '' : 's'}`}
      </footer>
    </section>
  );
}

const ListGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

const GridGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.4" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />
  </svg>
);
