/** Utilidades de rutas normalizadas: siempre '/', sin barra final (salvo la raíz). */

export function normalizePath(input: string): string {
  const collapsed = `/${input}`.replace(/\/+/g, '/');
  const trimmed = collapsed.length > 1 ? collapsed.replace(/\/$/, '') : '/';
  if (trimmed.split('/').includes('..')) {
    throw new Error(`Ruta no permitida: ${input}`);
  }
  return trimmed;
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.join('/'));
}

export function basename(path: string): string {
  const p = normalizePath(path);
  return p === '/' ? '/' : p.slice(p.lastIndexOf('/') + 1);
}

export function dirname(path: string): string {
  const p = normalizePath(path);
  if (p === '/') return '/';
  const idx = p.lastIndexOf('/');
  return idx <= 0 ? '/' : p.slice(0, idx);
}

/** Segmentos no vacíos de la ruta: '/a/b' → ['a','b']. */
export function segments(path: string): string[] {
  return normalizePath(path).split('/').filter(Boolean);
}

/** Añade ' (2)', ' (3)'… antes de la extensión, para la política de conflicto 'rename'. */
export function dedupeName(name: string, attempt: number): string {
  if (attempt <= 1) return name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} (${attempt})`;
  return `${name.slice(0, dot)} (${attempt})${name.slice(dot)}`;
}

/** Prefijo raiz normalizado: sin barras al principio ni al final. */
export function normalizeRoot(root: string | undefined | null): string {
  return (root ?? '').replace(/^\/+|\/+$/g, '');
}

/**
 * Traduce una ruta de la UI a la clave real dentro del bucket.
 *
 * Es la frontera del almacenamiento gestionado: con un `root` por usuario,
 * ninguna ruta puede apuntar fuera de su espacio. `normalizePath` ya rechaza
 * el salto de directorio, asi que '..' nunca llega a componerse.
 */
export function withRoot(root: string | undefined | null, path: string): string {
  const rel = normalizePath(path).replace(/^\//, '');
  const base = normalizeRoot(root);
  if (!base) return rel;
  return rel === '' ? base : `${base}/${rel}`;
}

/** Inverso de `withRoot`: la UI nunca ve el prefijo del usuario. */
export function stripRoot(root: string | undefined | null, key: string): string {
  const base = normalizeRoot(root);
  if (!base) return normalizePath(`/${key}`);
  if (key === base) return '/';
  const prefix = `${base}/`;
  // Una clave fuera del prefijo no pertenece a esta cuenta.
  if (!key.startsWith(prefix)) return normalizePath(`/${key}`);
  return normalizePath(`/${key.slice(prefix.length)}`);
}
