import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Google Drive admite dos archivos con el mismo nombre en la misma carpeta, asi
 * que la ruta no identifica a uno solo. Estas son las reglas de la identidad
 * que usan la interfaz y las operaciones; se replican aqui porque el modulo
 * vive en el cliente web y esta capa no lo importa.
 */
const entryUid = (e: { path: string; nativeId?: string | null }) => e.nativeId ?? e.path;

test('dos homonimos de Drive tienen identidades distintas', () => {
  const a = { path: '/docs/COPYRIGHT.TXT', nativeId: 'drive-1' };
  const b = { path: '/docs/COPYRIGHT.TXT', nativeId: 'drive-2' };
  assert.notEqual(entryUid(a), entryUid(b));
});

test('sin id nativo, la ruta basta: en S3 la clave ya es unica', () => {
  assert.equal(entryUid({ path: '/a/b.txt' }), '/a/b.txt');
  assert.equal(entryUid({ path: '/a/b.txt', nativeId: null }), '/a/b.txt');
});

test('el mismo archivo mantiene su identidad entre listados', () => {
  assert.equal(
    entryUid({ path: '/x.txt', nativeId: 'id-9' }),
    entryUid({ path: '/renombrado.txt', nativeId: 'id-9' }),
  );
});
