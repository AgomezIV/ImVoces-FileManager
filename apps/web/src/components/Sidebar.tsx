'use client';

import Link from 'next/link';
import type { StorageAccountView } from '@imvoces/contracts';
import { IconCloud, IconPlus } from './Icons';
import { formatBytes } from '@/lib/format';

type Account = StorageAccountView & { managed?: boolean };

interface Props {
  accounts: Account[];
  activeId: string | null;
  onSelect: (accountId: string) => void;
  /** Soltar archivos sobre una ubicación los copia a su raíz. */
  onDropTo: (accountId: string) => void;
  user: { email: string; name: string | null };
  onLogout: () => void;
}

const PROVIDER_COLOR: Record<string, string> = {
  GDRIVE: '#1a73e8',
  DROPBOX: '#0061ff',
  ONEDRIVE: '#0078d4',
  R2: '#f6821f',
  S3: '#569a31',
};

/**
 * Ubicaciones, como la barra lateral de cualquier gestor de archivos.
 *
 * Cada nube conectada es una fila más: se navega igual que una carpeta local,
 * y arrastrar una selección encima la copia allí.
 */
export function Sidebar({ accounts, activeId, onSelect, onDropTo, user, onLogout }: Props) {
  return (
    <aside
      style={{
        width: 'var(--sidebar-w)',
        flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--brand)', display: 'flex' }}><IconCloud size={20} /></span>
        <strong style={{ fontSize: 14, letterSpacing: -0.1 }}>ImVoces</strong>
      </div>

      <div style={{ padding: '4px 10px 6px' }}>
        <div className="dim" style={{ fontSize: 11, fontWeight: 600, letterSpacing: .4, padding: '6px 8px', textTransform: 'uppercase' }}>
          Ubicaciones
        </div>

        {accounts.length === 0 && (
          <p className="muted" style={{ padding: '4px 8px 8px', margin: 0 }}>
            Ninguna nube conectada todavía.
          </p>
        )}

        {accounts.map((a) => {
          const active = a.id === activeId;
          const color = PROVIDER_COLOR[a.provider] ?? 'var(--text-2)';
          const pct = a.quotaTotal ? Math.min(100, ((a.quotaUsed ?? 0) / a.quotaTotal) * 100) : null;

          return (
            <button
              key={a.id}
              onClick={() => onSelect(a.id)}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.background = 'var(--brand-soft)'; }}
              onDragLeave={(e) => { e.currentTarget.style.background = active ? 'var(--surface-2)' : 'transparent'; }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.style.background = active ? 'var(--surface-2)' : 'transparent';
                if (e.dataTransfer.getData('text/imvoces-drag')) onDropTo(a.id);
              }}
              style={{
                width: '100%',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                background: active ? 'var(--surface-2)' : 'transparent',
                padding: '7px 8px',
                display: 'grid',
                gridTemplateColumns: '18px 1fr',
                gap: 9,
                alignItems: 'center',
                textAlign: 'left',
                fontWeight: active ? 550 : 400,
              }}
            >
              <span style={{ color, display: 'flex' }}><IconCloud size={17} /></span>
              <span style={{ minWidth: 0, display: 'grid', gap: 3 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.label}
                </span>
                {pct !== null ? (
                  <>
                    <span style={{ height: 3, borderRadius: 2, background: 'var(--surface-3)', overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: color }} />
                    </span>
                    <span className="dim" style={{ fontSize: 11 }}>
                      {formatBytes(a.quotaUsed ?? 0)} de {formatBytes(a.quotaTotal as number)}
                    </span>
                  </>
                ) : (
                  a.status !== 'ACTIVE' && (
                    <span style={{ fontSize: 11, color: 'var(--danger)' }}>{a.status}</span>
                  )
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ padding: '2px 10px' }}>
        <Link href="/accounts" style={{ textDecoration: 'none' }}>
          <button className="ghost" style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--text-2)' }}>
            <IconPlus /> Conectar una nube
          </button>
        </Link>
      </div>

      <div style={{ marginTop: 'auto', padding: 10, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px' }}>
          <span
            aria-hidden
            style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              background: 'var(--brand-soft)', color: 'var(--brand)',
              display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: 12,
            }}
          >
            {(user.name ?? user.email).charAt(0).toUpperCase()}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span
              className="muted"
              style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {user.email}
            </span>
          </span>
          <button className="ghost" onClick={onLogout} style={{ fontSize: 12, padding: '4px 7px' }}>
            Salir
          </button>
        </div>
      </div>
    </aside>
  );
}
