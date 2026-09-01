import { prisma } from '@imvoces/db';

/** La auditoría nunca debe tumbar la petición: se registra en best-effort. */
export async function audit(
  userId: string,
  action: string,
  result: 'ok' | 'error',
  target?: unknown,
  ip?: string,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        result,
        target: (target ?? null) as never,
        ip: ip ?? null,
      },
    });
  } catch {
    // ignorado a propósito
  }
}
