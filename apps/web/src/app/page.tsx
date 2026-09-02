'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/components/SessionProvider';
import { useTransfers } from '@/components/TransfersProvider';
import { Sidebar } from '@/components/Sidebar';
import { FileBrowser } from '@/components/FileBrowser';
import { SelectionBar } from '@/components/SelectionBar';
import { DestinationDialog } from '@/components/DestinationDialog';
import { TransferTray } from '@/components/TransferTray';
import { GoogleLoginButton } from '@/components/GoogleLoginButton';
import { IconCloud } from '@/components/Icons';

export default function Home() {
  const { user, loading, logout } = useSession();
  const { track } = useTransfers();
  const queryClient = useQueryClient();

  const [accountId, setAccountId] = useState<string | null>(null);
  const [path, setPath] = useState('/');
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<'COPY' | 'MOVE' | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts(),
    enabled: !!user,
  });
  const accounts = accountsQuery.data?.accounts ?? [];

  // Sin ubicación elegida se abre la primera: un explorador vacío no sirve de nada.
  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0]!.id);
  }, [accountId, accounts]);

  const navigate = useCallback((next: string) => {
    setPath(next);
    setSelected([]);
  }, []);

  const openLocation = useCallback((id: string) => {
    setAccountId(id);
    setPath('/');
    setSelected([]);
  }, []);

  /**
   * Lanza la transferencia. El cliente no expande carpetas: manda la selección
   * tal cual y el worker resuelve el árbol, así que copiar 10 000 archivos
   * cuesta lo mismo que copiar uno.
   */
  const transfer = useCallback(
    async (dest: { accountId: string; path: string }, kind: 'COPY' | 'MOVE') => {
      if (!accountId || selected.length === 0) return;
      const job = await api.createTransfer({
        kind,
        onConflict: 'rename',
        items: selected.map((p) => ({
          src: { accountId, path: p },
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
    [accountId, selected, track],
  );

  const download = async () => {
    if (!accountId || selected.length !== 1) return;
    const { url } = await api.downloadUrl(accountId, selected[0] as string);
    window.open(url, '_blank', 'noopener');
  };

  const rename = async () => {
    if (!accountId || selected.length !== 1) return;
    const current = (selected[0] as string).split('/').pop() ?? '';
    const name = window.prompt('Nuevo nombre', current);
    if (!name || name === current) return;
    await api.rename(accountId, selected[0] as string, name);
    setSelected([]);
    await queryClient.invalidateQueries({ queryKey: ['list', accountId, path] });
  };

  const remove = async () => {
    if (!accountId || selected.length === 0) return;
    if (!window.confirm(`¿Eliminar ${selected.length} elemento(s)?`)) return;
    await api.remove(accountId, selected);
    setSelected([]);
    await queryClient.invalidateQueries({ queryKey: ['list', accountId, path] });
  };

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
        onDropTo={(destAccount) => void transfer({ accountId: destAccount, path: '/' }, 'COPY')}
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
              onNavigate={navigate}
              onSelect={setSelected}
            />
            <SelectionBar
              count={selected.length}
              single={selected.length === 1}
              onCopy={() => setDialog('COPY')}
              onMove={() => setDialog('MOVE')}
              onDownload={() => void download()}
              onRename={() => void rename()}
              onDelete={() => void remove()}
              onClear={() => setSelected([])}
            />
          </>
        ) : null}
      </div>

      {dialog && account && (
        <DestinationDialog
          accounts={accounts}
          from={{ accountId: account.id, path }}
          count={selected.length}
          kind={dialog}
          onCancel={() => setDialog(null)}
          onConfirm={(dest) => void transfer(dest, dialog)}
        />
      )}

      <TransferTray />
    </main>
  );
}
