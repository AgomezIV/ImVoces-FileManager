/** Error con código y status HTTP que el manejador global sabe serializar. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'No autenticado') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Sin permiso') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'No encontrado') => new HttpError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string) => new HttpError(409, 'CONFLICT', msg);
