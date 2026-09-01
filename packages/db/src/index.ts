import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Cliente Prisma único por proceso. En desarrollo se cachea en `globalThis` para
 * que el hot-reload no abra un pool nuevo en cada recarga.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
