import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoot, stripRoot, withRoot } from './paths.ts';

/**
 * El almacenamiento gestionado pone a todos los usuarios en un mismo bucket,
 * separados solo por su prefijo. Estas son las pruebas de esa frontera.
 */

test('sin prefijo, la ruta es la clave', () => {
  assert.equal(withRoot('', '/a/b.txt'), 'a/b.txt');
  assert.equal(withRoot(undefined, '/'), '');
  assert.equal(stripRoot('', 'a/b.txt'), '/a/b.txt');
});

test('con prefijo, toda clave cuelga de el', () => {
  assert.equal(withRoot('users/u1', '/'), 'users/u1');
  assert.equal(withRoot('users/u1', '/fotos/x.jpg'), 'users/u1/fotos/x.jpg');
});

test('el prefijo se oculta al volver a ruta', () => {
  assert.equal(stripRoot('users/u1', 'users/u1/fotos/x.jpg'), '/fotos/x.jpg');
  assert.equal(stripRoot('users/u1', 'users/u1'), '/');
});

test('una ruta con .. no escapa del prefijo', () => {
  assert.throws(() => withRoot('users/u1', '/../u2/secreto.txt'), /no permitida/);
  assert.throws(() => withRoot('users/u1', '/a/../../u2'), /no permitida/);
});

test('un prefijo hermano no se confunde con el propio', () => {
  // 'users/u10' empieza por 'users/u1' como texto, pero no cuelga de el.
  assert.equal(stripRoot('users/u1', 'users/u10/x'), '/users/u10/x');
});

test('las barras sobrantes del prefijo no crean claves dobles', () => {
  assert.equal(withRoot('/users/u1/', '/x'), 'users/u1/x');
  assert.equal(normalizeRoot('//a/b//'), 'a/b');
});
