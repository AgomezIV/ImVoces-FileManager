import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, dedupeName, dirname, joinPath, normalizePath, segments } from './paths.ts';

test('normalizePath colapsa barras y quita la final', () => {
  assert.equal(normalizePath('a/b'), '/a/b');
  assert.equal(normalizePath('//a///b//'), '/a/b');
  assert.equal(normalizePath(''), '/');
  assert.equal(normalizePath('/'), '/');
});

test('normalizePath rechaza el salto de directorio', () => {
  assert.throws(() => normalizePath('/a/../../etc'), /no permitida/);
});

test('basename y dirname sobre la raíz', () => {
  assert.equal(basename('/a/b.txt'), 'b.txt');
  assert.equal(dirname('/a/b.txt'), '/a');
  assert.equal(dirname('/a'), '/');
  assert.equal(basename('/'), '/');
});

test('joinPath y segments', () => {
  assert.equal(joinPath('/a', 'b', 'c.txt'), '/a/b/c.txt');
  assert.deepEqual(segments('/a/b/c.txt'), ['a', 'b', 'c.txt']);
  assert.deepEqual(segments('/'), []);
});

test('dedupeName inserta el sufijo antes de la extensión', () => {
  assert.equal(dedupeName('foto.jpg', 1), 'foto.jpg');
  assert.equal(dedupeName('foto.jpg', 2), 'foto (2).jpg');
  assert.equal(dedupeName('README', 3), 'README (3)');
  assert.equal(dedupeName('.gitignore', 2), '.gitignore (2)');
});
