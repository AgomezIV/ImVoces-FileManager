import { ProviderError, toProviderError } from './errors.js';

/** Credenciales OAuth guardadas (cifradas) de una cuenta conectada. */
export interface OAuthCredentials {
  accessToken?: string;
  refreshToken: string;
  /** Epoch ms en que caduca el access token. */
  expiresAt?: number;
  scopes?: string[];
}

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
}

/**
 * Sesion OAuth con refresco automatico.
 *
 * El usuario final nunca ve nada de esto: inicia sesion con su cuenta de
 * siempre y el servidor guarda el refresh token cifrado. Cuando el access
 * token caduca se renueva solo, y el nuevo se persiste via `onRefresh` para
 * que no haya que volver a pedir consentimiento.
 */
export class OAuthSession {
  private creds: OAuthCredentials;

  constructor(
    creds: OAuthCredentials,
    private readonly app: OAuthApp,
    private readonly onRefresh?: (next: OAuthCredentials) => void | Promise<void>,
  ) {
    this.creds = { ...creds };
  }

  private get expired(): boolean {
    if (!this.creds.accessToken) return true;
    // Margen de 60 s: evita usar un token que caduca a mitad de la peticion.
    return (this.creds.expiresAt ?? 0) < Date.now() + 60_000;
  }

  async token(): Promise<string> {
    if (!this.expired) return this.creds.accessToken as string;

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.creds.refreshToken,
      client_id: this.app.clientId,
      client_secret: this.app.clientSecret,
    });
    const res = await fetch(this.app.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // Un refresh rechazado significa consentimiento revocado: no se reintenta.
      throw new ProviderError(
        `No se pudo renovar la sesion (${res.status}): ${detail.slice(0, 200)}`,
        'REAUTH_REQUIRED',
        false,
        res.status,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
    };
    this.creds = {
      accessToken: json.access_token,
      // Algunos proveedores rotan el refresh token; hay que quedarse con el nuevo.
      refreshToken: json.refresh_token ?? this.creds.refreshToken,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
      scopes: this.creds.scopes,
    };
    await this.onRefresh?.(this.creds);
    return json.access_token;
  }

  /** Peticion autenticada que renueva el token y traduce el error del proveedor. */
  async request(url: string, init: RequestInit, context: string): Promise<Response> {
    const send = async () =>
      fetch(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await this.token()}` },
      });

    let res: Response;
    try {
      res = await send();
      // Un 401 con token fresco: se fuerza un refresco y se reintenta una vez.
      if (res.status === 401) {
        this.creds = { ...this.creds, accessToken: undefined, expiresAt: 0 };
        res = await send();
      }
    } catch (err) {
      throw toProviderError(err, context);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw toProviderError(
        { status: res.status, message: detail.slice(0, 300) },
        context,
      );
    }
    return res;
  }

  async json<T>(url: string, init: RequestInit, context: string): Promise<T> {
    const res = await this.request(url, init, context);
    return (await res.json()) as T;
  }
}
