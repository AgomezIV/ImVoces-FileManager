import { fileKind, type FileKind } from './fileTypes';

/** Cómo se puede previsualizar un archivo dentro de la aplicación. */
export type PreviewMode = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none';

/**
 * Miniaturas solo por debajo de este tamaño: la API sirve el archivo entero, así
 * que pedir una foto de 40 MB para pintarla a 120 px sería tirar ancho de banda.
 */
export const THUMBNAIL_MAX_BYTES = 12 * 1024 * 1024;

/** Vista previa de texto acotada: un log de 500 MB no cabe en el navegador. */
export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'yml', 'yaml', 'xml',
  'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'sh', 'sql', 'ini', 'toml', 'env',
]);

export function previewMode(name: string, mimeType: string | null): PreviewMode {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const kind: FileKind = fileKind(name, false);

  if (kind === 'image') return 'image';
  if (kind === 'video') return 'video';
  if (kind === 'audio') return 'audio';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (TEXT_EXT.has(ext) || mimeType?.startsWith('text/')) return 'text';
  return 'none';
}

/** Solo las imágenes pequeñas se pintan como miniatura en la cuadrícula. */
export function canThumbnail(name: string, size: number): boolean {
  return fileKind(name, false) === 'image' && size > 0 && size <= THUMBNAIL_MAX_BYTES;
}
