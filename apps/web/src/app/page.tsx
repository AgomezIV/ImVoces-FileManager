'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RemoteEntry } from '@imvoces/contracts';
import { api } from '@/lib/api';
import { useSession } from '@/components/SessionProvider';
import { useTransfers } from '@/components/TransfersProvider';
import { Sidebar } from '@/components/Sidebar';
import { FileBrowser } from '@/components/FileBrowser';
import { SelectionBar } from '@/components/SelectionBar';
import { DestinationDialog } from '@/components/DestinationDialog';
import { PreviewOverlay } from '@/components/PreviewOverlay';
import { ContextMenu, type MenuEntry } from '@/components/ContextMenu';
import { TransferTray } from '@/components/TransferTray';
import { GoogleLoginButton } from '@/components/GoogleLoginButton';
import {
  IconCloud, IconCopy, IconDownload, IconFile, IconMove,
  IconNewFolder, IconRefresh, IconRename, IconTrash,
} from '@/components/Icons';
import { previewMode } from '@/lib/preview';
import { entryUid } from '@/lib/fileTypes';

/** Lo que espera para pegarse. `cut` mueve, `copy` copia. */
interface ClipboardItem {
  path: string;
  nativeId: string | null;
}

interface Clipboard {
  mode: 'copy' | 'cut';
  accountId: string;
  items: ClipboardItem[];
}

export default function Home() {
  const { user, loading, logout } = useSession();
  const { track } = useTransfers();
  const queryClient = useQueryClient();

  const [accountId, setAccountId] = useState<string | null>(null);
  const [path, setPath] = useState('/');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [selected, setSelected] = useState<string[]>([]);
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [dialog, setDialog] = useState<'COPY' | 'MOVE' | null>(null);
  const [preview, setPreview] = useState<{ list: RemoteEntry[]; index: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: RemoteEntry | null } | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);

  /**
   * Entradas seleccionadas, resueltas desde sus identificadores.
   *
   * `selected` guarda uids porque dos archivos de Drive pueden compartir ruta;
   * las operaciones necesitan la entrada entera para mandar también el id del
   * proveedor y actuar sobre el archivo exacto.
   */
  const selectedEntries = entries.filter((e) => selected.includes(entryUid(e)));
  const only = selectedEntries.length === 1 ? selectedEntries[0] : null;

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts(),
    enabled: !!user,
  });
  const accounts = accountsQuery.data?.accounts ?? [];

  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0]!.id);
  }, [accountId, accounts]);

  const navigate = useCallback((next: string, dir: 'in' | 'out') => {
    setDirection(dir);
    setPath(next);
    setSelected([]);
  }, []);

  const openLocation = useCallback((id: string) => {
    setDirection('out');
    setAccountId(id);
    setPath('/');
    setSelected([]);
  }, []);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['list', accountId, path] }),
    [accountId, path, queryClient],
  );

  /**
   * Lanza la transferencia. El cliente no expande carpetas: manda la selección
   * tal cual y el worker resuelve el árbol, así que copiar 10 000 archivos
   * cuesta lo mismo que copiar uno.
   */
  const transfer = useCallback(
    async (
      src: { accountId: string; items: ClipboardItem[] },
      dest: { accountId: string; path: string },
      kind: 'COPY' | 'MOVE',
    ) => {
      if (src.items.length === 0) return;
      const job = await api.createTransfer({
        kind,
        onConflict: 'rename',
        items: src.items.map(({ path: p, nativeId }) => ({
          // El id nativo viaja con el origen: con dos archivos homónimos en
          // Drive, la copia apunta al que el usuario eligió.
          src: { accountId: src.accountId, path: p, nativeId: nativeId ?? undefined },
          dest: {
            accountId: dest.accountId,
            path: `${dest.path === '/' ? '' : dest.path}/${p.slice(p.lastIndexOf('/') + 1)}`,
          },
        })),
      });
      track(job);
      setSelected([]);
      setDialog(null);
    },
    [track],
  );

  const paste = useCallback(async () => {
    if (!clipboard || !accountId) return;
    await transfer(
      { accountId: clipboard.accountId, items: clipboard.items },
      { accountId, path },
      clipboard.mode === 'cut' ? 'MOVE' : 'COPY',
    );
    // Un corte se consume al pegar; una copia se puede pegar varias veces.
    if (clipboard.mode === 'cut') setClipboard(null);
  }, [accountId, clipboard, path, transfer]);

  const download = useCallback(() => {
    if (!accountId || !only) return;
    window.open(api.contentUrl(accountId, only.path, true, only.nativeId), '_blank', 'noopener');
  }, [accountId, only]);

  const rename = useCallback(async () => {
    if (!accountId || !only) return;
    const name = window.prompt('Nuevo nombre', only.name);
    if (!name || name === only.name) return;
    await api.rename(accountId, only.path, name, only.nativeId);
    setSelected([]);
    await invalidate();
  }, [accountId, invalidate, only]);

  const remove = useCallback(async () => {
    if (!accountId || selectedEntries.length === 0) return;
    if (!window.confirm(`¿Eliminar ${selectedEntries.length} elemento(s)?`)) return;
    await api.remove(accountId, selectedEntries.map((e) => ({ path: e.path, nativeId: e.nativeId })));
    setSelected([]);
    await invalidate();
  }, [accountId, invalidate, selectedEntries]);

  const newFolder = useCallback(async () => {
    if (!accountId) return;
    const name = window.prompt('Nombre de la carpeta nueva');
    if (!name) return;
    await api.createFolder(accountId, path, name);
    await invalidate();
  }, [accountId, invalidate, path]);

  const openFile = useCallback((entry: RemoteEntry, all: RemoteEntry[]) => {
    // El visor solo pasea por archivos: saltar a una carpeta no tendría sentido.
    const files = all.filter((e) => e.kind === 'file');
    const index = files.findIndex((e) => e.path === entry.path);
    setPreview({ list: files, index: Math.max(0, index) });
  }, []);

  // Atajos de teclado del gestor de archivos.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (preview) return;

      const mod = e.ctrlKey || e.metaKey;
      const asItems = () => selectedEntries.map((x) => ({ path: x.path, nativeId: x.nativeId }));
      if (mod && e.key.toLowerCase() === 'c' && selectedEntries.length && accountId) {
        setClipboard({ mode: 'copy', accountId, items: asItems() });
      } else if (mod && e.key.toLowerCase() === 'x' && selectedEntries.length && accountId) {
        setClipboard({ mode: 'cut', accountId, items: asItems() });
      } else if (mod && e.key.toLowerCase() === 'v' && clipboard) {
        void paste();
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(entries.map(entryUid));
      } else if (e.key === 'Delete' && selectedEntries.length) {
        void remove();
      } else if (e.key === 'F2' && selectedEntries.length === 1) {
        void rename();
      } else if (e.key === 'Escape') {
        setSelected([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accountId, clipboard, entries, paste, preview, remove, rename, selectedEntries]);

  const menuItems = useCallback((): MenuEntry[] => {
    const entry = menu?.entry ?? null;
    const many = selectedEntries.length;

    if (!entry) {
      return [
        { id: 'paste', label: 'Pegar', icon: <IconCopy />, shortcut: 'Ctrl+V', disabled: !clipboard, onSelect: () => void paste() },
        null,
        { id: 'newfolder', label: 'Nueva carpeta', icon: <IconNewFolder />, onSelect: () => void newFolder() },
        { id: 'refresh', label: 'Actualizar', icon: <IconRefresh />, onSelect: () => void invalidate() },
      ];
    }

    const isFolder = entry.kind === 'folder';
    const canPreview = !isFolder && previewMode(entry.name, entry.mimeType) !== 'none';

    return [
      {
        id: 'open',
        label: isFolder ? 'Abrir' : canPreview ? 'Vista previa' : 'Abrir',
        icon: <IconFile />,
        onSelect: () => (isFolder ? navigate(entry.path, 'in') : openFile(entry, entries)),
      },
      null,
      { id: 'copy', label: 'Copiar', icon: <IconCopy />, shortcut: 'Ctrl+C', onSelect: () => accountId && setClipboard({ mode: 'copy', accountId, items: selectedEntries.map((x) => ({ path: x.path, nativeId: x.nativeId })) }) },
      { id: 'cut', label: 'Cortar', icon: <IconMove />, shortcut: 'Ctrl+X', onSelect: () => accountId && setClipboard({ mode: 'cut', accountId, items: selectedEntries.map((x) => ({ path: x.path, nativeId: x.nativeId })) }) },
      { id: 'paste', label: 'Pegar', icon: <IconCopy />, shortcut: 'Ctrl+V', disabled: !clipboard, onSelect: () => void paste() },
      null,
      { id: 'copyto', label: 'Copiar a otra nube…', icon: <IconCopy />, onSelect: () => setDialog('COPY') },
      { id: 'moveto', label: 'Mover a otra nube…', icon: <IconMove />, onSelect: () => setDialog('MOVE') },
      null,
      { id: 'download', label: 'Descargar', icon: <IconDownload />, disabled: isFolder || many !== 1, onSelect: download },
      { id: 'rename', label: 'Renombrar', icon: <IconRename />, shortcut: 'F2', disabled: many !== 1, onSelect: () => void rename() },
      null,
      { id: 'delete', label: `Eliminar${many > 1 ? ` (${many})` : ''}`, icon: <IconTrash />, shortcut: 'Supr', danger: true, onSelect: () => void remove() },
    ];
  }, [accountId, clipboard, download, entries, invalidate, menu, navigate, newFolder, openFile, paste, remove, rename, selectedEntries]);

  if (loading) {
    return <main style={{ display: 'grid', placeItems: 'center', height: '100vh' }} className="muted">Cargando…</main>;
  }

  if (!user) {
    return (
      <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
        <div className="card" style={{ padding: 36, maxWidth: 400, textAlign: 'center', boxShadow: 'var(--shadow-2)' }}>
          <span style={{ color: 'var(--brand)', display: 'inline-flex' }}><IconCloud size={38} /></span>
          <h1 style={{ margin: '12px 0 6px', fontSize: 20 }}>ImVoces FileManager</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            Todos tus archivos, de todas tus nubes, en un solo sitio. Copiar entre
            plataformas ocurre en el servidor: no gasta tu conexión.
          </p>
          <div style={{ display: 'grid', placeItems: 'center', marginTop: 22 }}>
            <GoogleLoginButton />
          </div>
        </div>
      </main>
    );
  }

  const account = accounts.find((a) => a.id === accountId);

  return (
    <main style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        accounts={accounts}
        activeId={accountId}
        onSelect={openLocation}
        onDropTo={(dest) =>
          accountId &&
          void transfer(
            { accountId, items: selectedEntries.map((x) => ({ path: x.path, nativeId: x.nativeId })) },
            { accountId: dest, path: '/' },
            'COPY',
          )
        }
        user={user}
        onLogout={() => void logout()}
      />

      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {accounts.length === 0 ? (
          <div style={{ display: 'grid', placeItems: 'center', flex: 1, padding: 24, textAlign: 'center' }}>
            <div>
              <span className="dim" style={{ display: 'inline-flex' }}><IconCloud size={36} /></span>
              <h2 style={{ fontSize: 17, margin: '10px 0 4px' }}>Conecta tu primera nube</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Inicias sesión con tu cuenta de siempre. No hacen falta claves.
              </p>
              <Link href="/accounts"><button className="primary" style={{ marginTop: 8 }}>Conectar una nube</button></Link>
            </div>
          </div>
        ) : account ? (
          <>
            <FileBrowser
              accountId={account.id}
              accountLabel={account.label}
              path={path}
              selected={selected}
              direction={direction}
              onNavigate={navigate}
              onSelect={setSelected}
              onOpenFile={openFile}
              onEntries={setEntries}
              onContextMenu={(e, entry) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, entry });
              }}
            />
            <SelectionBar
              count={selectedEntries.length}
              single={selectedEntries.length === 1}
              onCopy={() => setDialog('COPY')}
              onMove={() => setDialog('MOVE')}
              onDownload={download}
              onRename={() => void rename()}
              onDelete={() => void remove()}
              onClear={() => setSelected([])}
            />
          </>
        ) : null}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
      )}

      {dialog && account && (
        <DestinationDialog
          accounts={accounts}
          from={{ accountId: account.id, path }}
          count={selectedEntries.length}
          kind={dialog}
          onCancel={() => setDialog(null)}
          onConfirm={(dest) =>
            void transfer(
              { accountId: account.id, items: selectedEntries.map((x) => ({ path: x.path, nativeId: x.nativeId })) },
              dest,
              dialog,
            )
          }
        />
      )}

      {preview && account && (
        <PreviewOverlay
          accountId={account.id}
          entries={preview.list}
          index={preview.index}
          onIndex={(index) => setPreview((p) => (p ? { ...p, index } : p))}
          onClose={() => setPreview(null)}
        />
      )}

      <TransferTray />
    </main>
  );
}
