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
