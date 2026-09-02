'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AvailableProvider } from '@/lib/api';
import { useSession } from '@/components/SessionProvider';
import { formatBytes } from '@/lib/format';

/**
 * Alta manual de un bucket S3-compatible.
 *
 * Es la vía avanzada, escondida a propósito: pide claves de API, que un usuario
 * normal no tiene. Quien conecta Drive o Dropbox nunca pasa por aquí.
 */
function S3Form({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    provider: 'R2' as const,
    label: 'Mi bucket R2',
    endpoint: '',
    region: 'auto',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // La API prueba las credenciales con un listado antes de guardarlas.
      await api.connectS3({ ...form, forcePathStyle: true });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof form, label: string, type = 'text', placeholder = '') => (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className="muted">{label}</span>
      <input
        type={type}
        value={form[key] as string}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        required={key !== 'endpoint'}
      />
    </label>
  );

  return (
    <form onSubmit={submit} className="card" style={{ padding: 20, display: 'grid', gap: 12, maxWidth: 480 }}>
      <div>
        <h3 style={{ margin: 0 }}>Conectar tu propio bucket</h3>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Solo si ya tienes claves de API de Cloudflare R2 o Amazon S3.
        </p>
      </div>
      {field('label', 'Nombre para identificarlo')}
      {field('bucket', 'Bucket')}
      {field('endpoint', 'Endpoint', 'url', 'https://<account_id>.r2.cloudflarestorage.com')}
      {field('region', 'Región')}
      {field('accessKeyId', 'Access Key ID')}
      {field('secretAccessKey', 'Secret Access Key', 'password')}
      {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      <button className="primary" type="submit" disabled={saving}>
        {saving ? 'Comprobando credenciales…' : 'Conectar'}
      </button>
    </form>
  );
}

/** Tarjeta de "conectar": un clic y el usuario solo ve el login de su proveedor. */
function ConnectCard({ provider }: { provider: AvailableProvider }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const { authUrl } = await api.connect(provider.id);
      window.location.href = authUrl;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <button
      onClick={() => void connect()}
      disabled={busy}
      className="card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: 16,
        textAlign: 'left',
        borderLeft: `4px solid ${provider.color}`,
        width: '100%',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 36, height: 36, borderRadius: 9,
          background: provider.color, opacity: 0.15, flexShrink: 0,
        }}
      />
      <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
        <strong>{provider.name}</strong>
        <span className="muted">{busy ? 'Abriendo…' : provider.tagline}</span>
        {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
      </span>
    </button>
  );
}

export default function AccountsPage() {
  const { user, loading } = useSession();
  const queryClient = useQueryClient();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data } = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts(), enabled: !!user });
  const accounts = data?.accounts ?? [];
  const available = data?.available ?? [];

  // Un proveedor ya conectado no se vuelve a ofrecer como tarjeta de alta.
  const connectedIds = new Set(accounts.filter((a) => a.status === 'ACTIVE').map((a) => a.provider));
  const toConnect = available.filter((p) => !connectedIds.has(p.id as never));

  const disconnect = async (id: string) => {
    if (!window.confirm('¿Desconectar esta cuenta?')) return;
    await api.disconnect(id);
    await queryClient.invalidateQueries({ queryKey: ['accounts'] });
  };

  if (loading) return <main style={{ padding: 40 }}>Cargando…</main>;
  if (!user) return <main style={{ padding: 40 }}><Link href="/">Inicia sesión</Link></main>;

  return (
    <main style={{ padding: 24, maxWidth: 760, margin: '0 auto', display: 'grid', gap: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Tus cuentas</h1>
        <Link href="/">← Volver al explorador</Link>
      </header>

      {accounts.length > 0 && (
        <section style={{ display: 'grid', gap: 8 }}>
          {accounts.map((a) => (
            <div
              key={a.id}
              className="card"
              style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
            >
              <div style={{ minWidth: 0 }}>
                <strong>{a.label}</strong>
                {a.managed && (
                  <span
                    className="muted"
                    style={{ marginLeft: 8, fontSize: 12, border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 20 }}
                  >
                    incluido
                  </span>
                )}
                <div className="muted">
                  {a.quotaTotal
                    ? `${formatBytes(a.quotaUsed ?? 0)} de ${formatBytes(a.quotaTotal)}`
                    : a.externalId}
                  {a.status !== 'ACTIVE' && ` · ${a.status}`}
                </div>
                {a.lastError && <div style={{ color: 'var(--danger)' }}>{a.lastError}</div>}
              </div>
              {!a.managed && <button onClick={() => void disconnect(a.id)}>Desconectar</button>}
            </div>
          ))}
        </section>
      )}

      {toConnect.length > 0 && (
        <section style={{ display: 'grid', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Conectar una nube</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Inicias sesión con tu cuenta de siempre. No necesitas claves ni configurar nada.
            </p>
          </div>
          {toConnect.map((p) => (
            <ConnectCard key={p.id} provider={p} />
          ))}
        </section>
      )}

      {available.length === 0 && (
        <p className="muted">
          El servidor todavía no tiene ninguna nube configurada. Revisa las variables de entorno
          de la API.
        </p>
      )}

      <section>
        <button onClick={() => setShowAdvanced((v) => !v)} style={{ border: 'none', background: 'none', padding: 0 }}>
          <span className="muted">
            {showAdvanced ? '▾' : '▸'} Opciones avanzadas — conectar un bucket propio
          </span>
        </button>
        {showAdvanced && (
          <div style={{ marginTop: 12 }}>
            <S3Form
              onDone={() => {
                setShowAdvanced(false);
                void queryClient.invalidateQueries({ queryKey: ['accounts'] });
              }}
            />
          </div>
        )}
      </section>
    </main>
  );
}
