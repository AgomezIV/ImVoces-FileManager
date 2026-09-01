'use client';

import type {
  ListResponse, RemoteEntry, StorageAccountView, TransferJobView, CreateTransferRequest,
} from '@imvoces/contracts';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Cliente HTTP de la API.
 *
 * Ante un 401 intenta refrescar la sesión una sola vez (la cookie HttpOnly
 * viaja sola) y reintenta; si vuelve a fallar, propaga el error para que la UI
 * lleve al login.
 */
async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401 && retry) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, init, false);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? res.statusText);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export async function refreshSession(): Promise<boolean> {
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    setAccessToken(null);
    return false;
  }
  const data = (await res.json()) as { accessToken: string };
  setAccessToken(data.accessToken);
  return true;
}

export const api = {
  loginWithGoogle: (idToken: string) =>
    request<{ accessToken: string; user: { id: string; email: string; name: string | null; avatarUrl: string | null } }>(
      '/auth/google',
      { method: 'POST', body: JSON.stringify({ idToken }) },
      false,
    ),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST', body: '{}' }, false),

  accounts: () => request<{ accounts: StorageAccountView[] }>('/accounts'),
  connectDrive: () => request<{ authUrl: string }>('/accounts/gdrive/connect', { method: 'POST', body: '{}' }),
  connectS3: (input: unknown) =>
    request<StorageAccountView>('/accounts/s3', { method: 'POST', body: JSON.stringify(input) }),
  disconnect: (id: string) => request<{ ok: true }>(`/accounts/${id}`, { method: 'DELETE' }),

  list: (accountId: string, path: string, cursor?: string) =>
    request<ListResponse>(
      `/fs/list?accountId=${encodeURIComponent(accountId)}&path=${encodeURIComponent(path)}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
    ),
  createFolder: (accountId: string, parentPath: string, name: string) =>
    request<RemoteEntry>('/fs/folder', { method: 'POST', body: JSON.stringify({ accountId, parentPath, name }) }),
  rename: (accountId: string, path: string, newName: string) =>
    request<RemoteEntry>('/fs/rename', { method: 'PATCH', body: JSON.stringify({ accountId, path, newName }) }),
  remove: (accountId: string, paths: string[]) =>
    request<{ failed: number }>('/fs', { method: 'DELETE', body: JSON.stringify({ accountId, paths }) }),
  downloadUrl: (accountId: string, path: string) =>
    request<{ url: string }>(
      `/fs/download-url?accountId=${encodeURIComponent(accountId)}&path=${encodeURIComponent(path)}`,
    ),

  createTransfer: (body: CreateTransferRequest) =>
    request<TransferJobView>('/transfers', { method: 'POST', body: JSON.stringify(body) }),
  transfers: () => request<{ jobs: TransferJobView[] }>('/transfers?limit=25'),
  transfer: (id: string) => request<TransferJobView>(`/transfers/${id}`),
  cancelTransfer: (id: string) => request<{ ok: true }>(`/transfers/${id}/cancel`, { method: 'POST', body: '{}' }),
  retryTransfer: (id: string) => request<{ ok: true }>(`/transfers/${id}/retry`, { method: 'POST', body: '{}' }),
};

/**
 * Suscripción SSE al progreso de un job.
 *
 * EventSource no admite cabeceras, así que el token va en la query; la API lo
 * acepta ahí solo para este endpoint de solo lectura.
 */
export function subscribeToJob(jobId: string, onEvent: (ev: unknown) => void): () => void {
  const url = `${BASE}/transfers/${jobId}/events?access_token=${encodeURIComponent(accessToken ?? '')}`;
  const source = new EventSource(url, { withCredentials: true });
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      // un evento malformado no debe romper la bandeja
    }
  };
  return () => source.close();
}

export { ApiError };
