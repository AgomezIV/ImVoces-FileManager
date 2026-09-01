'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/components/SessionProvider';
import { useTransfers } from '@/components/TransfersProvider';
import { FilePanel, type PanelState } from '@/components/FilePanel';
import { TransferTray } from '@/components/TransferTray';
import { GoogleLoginButton } from '@/components/GoogleLoginButton';

const EMPTY: PanelState = { accountId: null, path: '/', selected: [] };

export default function Home() {
  const { user, loading, logout } = useSession();
  const { track } = useTransfers();
  const [left, setLeft] = useState<PanelState>(EMPTY);
  const [right, setRight] = useState<PanelState>(EMPTY);
  const [busy, setBusy] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts(),
    enabled: !!user,
  });
  const accounts = accountsQuery.data?.accounts ?? [];

  /**
   * El "un clic": la selección del panel origen se manda tal cual al destino.
   * No se expanden carpetas aquí — eso lo hace el worker — así que copiar
   * 10 000 archivos cuesta exactamente la misma interacción que copiar uno.
   */
  const transfer = useCallback(
    async (from: 'left' | 'right', kind: 'COPY' | 'MOVE' = 'COPY') => {
      const src = from === 'left' ? left : right;
      const dest = from === 'left' ? right : left;
      if (!src.accountId || !dest.accountId || src.selected.length === 0) return;

      setBusy(true);
      try {
        const job = await api.createTransfer({
          kind,
          onConflict: 'rename',
          items: src.selected.map((path) => ({
            src: { accountId: src.accountId as string, path },
            dest: {
              accountId: dest.accountId as string,
              path: `${dest.path === '/' ? '' : dest.path}/${path.slice(path.lastIndexOf('/') + 1)}`,
            },
          })),
        });
        track(job);
        (from === 'left' ? setLeft : setRight)({ ...src, selected: [] });
      } finally {
        setBusy(false);
      }
    },
    [left, right, track],
  );

  if (loading) return <main style={{ padding: 40 }}>Cargando…</main>;

  if (!user) {
    return (
      <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
        <div className="card" style={{ padding: 32, maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ marginTop: 0 }}>ImVoces FileManager</h1>
          <p className="muted">
            Conecta Google Drive, Cloudflare R2 y más, y mueve archivos entre plataformas con un clic.
            Las transferencias corren en el servidor: no gastan tu conexión.
          </p>
          <div style={{ display: 'grid', placeItems: 'center', marginTop: 20 }}>
            <GoogleLoginButton />
          </div>
        </div>
      </main>
    );
  }

  const canLeftToRight = left.selected.length > 0 && !!right.accountId && !busy;
  const canRightToLeft = right.selected.length > 0 && !!left.accountId && !busy;

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: 16, gap: 12 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>ImVoces FileManager</strong>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link href="/accounts">Cuentas</Link>
          <span className="muted">{user.email}</span>
          <button onClick={() => void logout()}>Salir</button>
        </div>
      </header>

      {accounts.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <p>Todavía no has conectado ninguna cuenta.</p>
          <Link href="/accounts">
            <button className="primary">Conectar mi primera cuenta</button>
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, flex: 1, minHeight: 0 }}>
          <FilePanel
            side="left"
            accounts={accounts}
            state={left}
            onChange={setLeft}
            onDropFrom={(from) => from === 'right' && void transfer('right')}
          />

          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
            <button className="primary" disabled={!canLeftToRight} onClick={() => void transfer('left')} title="Copiar al panel derecho">
              Copiar →
            </button>
            <button disabled={!canLeftToRight} onClick={() => void transfer('left', 'MOVE')} style={{ fontSize: 12 }}>
              Mover →
            </button>
            <div style={{ height: 12 }} />
            <button className="primary" disabled={!canRightToLeft} onClick={() => void transfer('right')} title="Copiar al panel izquierdo">
              ← Copiar
            </button>
            <button disabled={!canRightToLeft} onClick={() => void transfer('right', 'MOVE')} style={{ fontSize: 12 }}>
              ← Mover
            </button>
          </div>

          <FilePanel
            side="right"
            accounts={accounts}
            state={right}
            onChange={setRight}
            onDropFrom={(from) => from === 'left' && void transfer('left')}
          />
        </div>
      )}

      <TransferTray />
    </main>
  );
}
