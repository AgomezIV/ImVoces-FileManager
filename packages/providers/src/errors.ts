import { ProviderError } from './types.js';

const RETRYABLE_STATUS = new Set([408, 423, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_STREAM_PREMATURE_CLOSE',
]);

interface Httpish {
  status?: number;
  statusCode?: number;
  code?: string;
  message?: string;
  response?: { status?: number; headers?: Record<string, string | string[] | undefined> };
  $metadata?: { httpStatusCode?: number };
  $retryable?: { throttling?: boolean };
}

/**
 * Traduce el error de cualquier SDK a `ProviderError`, decidiendo si el motor
 * de transferencias debe reintentar. Es el único sitio donde se toma esa decisión.
 */
export function toProviderError(err: unknown, context: string): ProviderError {
  if (err instanceof ProviderError) return err;

  const e = (err ?? {}) as Httpish;
  const status = e.status ?? e.statusCode ?? e.response?.status ?? e.$metadata?.httpStatusCode;
  const code = e.code ?? (status ? `HTTP_${status}` : 'UNKNOWN');
  const message = `${context}: ${e.message ?? String(err)}`;

  const retryable =
    (status !== undefined && RETRYABLE_STATUS.has(status)) ||
    (e.code !== undefined && RETRYABLE_CODES.has(e.code)) ||
    e.$retryable?.throttling === true;

  const retryAfterMs = parseRetryAfter(e.response?.headers?.['retry-after']);
  return new ProviderError(message, code, retryable, status, retryAfterMs);
}

function parseRetryAfter(header: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export { ProviderError };
