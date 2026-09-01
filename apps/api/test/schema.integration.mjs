// Prueba de integracion contra un PostgreSQL real. No usa mocks: comprueba que
// el esquema, el cifrado de credenciales y el aislamiento entre usuarios se
// comportan como asume la API.
//
//   DATABASE_URL=postgresql://... node test/schema.integration.mjs
process.env.CREDENTIALS_KEY ??= Buffer.alloc(32, 7).toString('base64');

const { prisma } = await import('@imvoces/db');
const { encryptJson, decryptJson } = await import('@imvoces/providers');
let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
};

const alice = await prisma.user.create({
  data: { googleSub: 'sub-alice', email: 'alice@example.com', name: 'Alice' },
});
const bob = await prisma.user.create({
  data: { googleSub: 'sub-bob', email: 'bob@example.com', name: 'Bob' },
});

const secret = { provider: 'R2', bucket: 'fotos', accessKeyId: 'AKIA', secretAccessKey: 'shhh', region: 'auto', forcePathStyle: true };
const drive = await prisma.storageAccount.create({
  data: { userId: alice.id, provider: 'GDRIVE', label: 'Drive de Alice', externalId: 'alice@example.com', credentialsEnc: encryptJson({ refreshToken: 'rt' }) },
});
const r2 = await prisma.storageAccount.create({
  data: { userId: alice.id, provider: 'R2', label: 'R2 fotos', externalId: 'fotos', credentialsEnc: encryptJson(secret) },
});

check('las credenciales no se guardan en claro', !r2.credentialsEnc.includes('shhh'));
check('el descifrado devuelve el original', decryptJson(r2.credentialsEnc).secretAccessKey === 'shhh');

// El guard de la API busca por (id, userId): la cuenta de Alice no existe para Bob.
const stolen = await prisma.storageAccount.findFirst({ where: { id: r2.id, userId: bob.id } });
check('un usuario no puede cargar la cuenta de otro', stolen === null);

const job = await prisma.transferJob.create({
  data: {
    userId: alice.id, kind: 'COPY', itemsTotal: 2,
    items: { create: [
      { srcAccountId: drive.id, srcPath: '/docs/a.pdf', destAccountId: r2.id, destPath: '/backup/a.pdf', size: 1024n },
      { srcAccountId: drive.id, srcPath: '/docs/b.pdf', destAccountId: r2.id, destPath: '/backup/b.pdf', size: 2048n },
    ] },
  },
  include: { items: true },
});
check('el job se crea con sus items', job.items.length === 2);

// La clave unica (job, src, dest) hace idempotente la expansion del worker.
const dup = await prisma.transferItem.createMany({
  data: [{ jobId: job.id, srcAccountId: drive.id, srcPath: '/docs/a.pdf', destAccountId: r2.id, destPath: '/backup/a.pdf', size: 1024n }],
  skipDuplicates: true,
});
check('reencolar el mismo item no lo duplica', dup.count === 0);

// El progreso se agrega igual que en el worker.
await prisma.transferItem.update({ where: { id: job.items[0].id }, data: { status: 'DONE', bytesDone: 1024n } });
await prisma.transferJob.update({ where: { id: job.id }, data: { itemsDone: 1, doneBytes: 1024n } });
const agg = await prisma.transferItem.aggregate({ where: { jobId: job.id }, _count: true, _sum: { size: true } });
check('los bytes totales se agregan bien', agg._sum.size === 3072n && agg._count === 2);

// Borrar el usuario debe llevarse todo lo suyo (onDelete: Cascade).
await prisma.user.delete({ where: { id: alice.id } });
check('el borrado en cascada limpia cuentas y jobs',
  (await prisma.storageAccount.count({ where: { userId: alice.id } })) === 0 &&
  (await prisma.transferJob.count({ where: { userId: alice.id } })) === 0);

await prisma.user.delete({ where: { id: bob.id } });
await prisma.$disconnect();
console.log(failures === 0 ? '\nTODO OK' : `\n${failures} FALLO(S)`);
process.exit(failures === 0 ? 0 : 1);
