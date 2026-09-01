'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/components/SessionProvider';
import { formatBytes } from '@/lib/format';

/** Alta de una cuenta S3-compatible. R2 es el destino por defecto: no cobra egreso. */
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
    <form onSubmit={submit} className="card" style={{ padding: 16, display: 'grid', gap: 12, maxWidth: 480 }}>
      <h3 style={{ margin: 0 }}>Conectar Cloudflare R2 / S3</h3>
      {field('label', 'Nombre para identificarla')}
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

export default function AccountsPage() {
  const { user, loading } = useSession();
  const queryClient = useQueryClient();
  const [showS3, setShowS3] = useState(false);

  const { data } = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts(), enabled: !!user });
  const accounts = data?.accounts ?? [];

  const connectDrive = async () => {
    const { authUrl } = await api.connectDrive();
    // El consentimiento se abre en la misma pestaña; Google redirige de vuelta aquí.
    window.location.href = authUrl;
  };

  const disconnect = async (id: string) => {
    if (!window.confirm('¿Desconectar esta cuenta?')) return;
    await api.disconnect(id);
    await queryClient.invalidateQueries({ queryKey: ['accounts'] });
  };

  if (loading) return <main style={{ padding: 40 }}>Cargando…</main>;
  if (!user) return <main style={{ padding: 40 }}><Link href="/">Inicia sesión</Link></main>;

  return (
    <main style={{ padding: 24, maxWidth: 860, margin: '0 auto', display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Cuentas conectadas</h1>
        <Link href="/">← Volver al explorador</Link>
      </header>

      <div style={{ display: 'grid', gap: 8 }}>
        {accounts.length === 0 && <p className="muted">Aún no hay cuentas. Conecta la primera abajo.</p>}
        {accounts.map((a) => (
          <div key={a.id} className="card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <strong>{a.label}</strong>
              <div className="muted">
                {a.provider} · {a.externalId}
                {a.quotaTotal ? ` · ${formatBytes(a.quotaUsed ?? 0)} de ${formatBytes(a.quotaTotal)}` : ''}
                {a.status !== 'ACTIVE' && ` · ${a.status}`}
              </div>
              {a.lastError && <div style={{ color: 'var(--danger)' }}>{a.lastError}</div>}
            </div>
            <button onClick={() => void disconnect(a.id)}>Desconectar</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="primary" onClick={() => void connectDrive()}>Conectar Google Drive</button>
        <button onClick={() => setShowS3((s) => !s)}>
          {showS3 ? 'Cancelar' : 'Conectar Cloudflare R2 / S3'}
        </button>
      </div>

      {showS3 && (
        <S3Form
          onDone={() => {
            setShowS3(false);
            void queryClient.invalidateQueries({ queryKey: ['accounts'] });
          }}
        />
      )}
    </main>
  );
}
