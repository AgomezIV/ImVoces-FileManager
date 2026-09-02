/** Familia visual de un archivo, para elegir icono y color de acento. */
export type FileKind = 'folder' | 'image' | 'video' | 'audio' | 'archive' | 'doc' | 'file';

const BY_EXT: Record<string, FileKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  svg: 'image', heic: 'image', bmp: 'image', avif: 'image',
  mp4: 'video', mov: 'video', mkv: 'video', avi: 'video', webm: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', m4a: 'audio', ogg: 'audio',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  pdf: 'doc', doc: 'doc', docx: 'doc', txt: 'doc', md: 'doc',
  xls: 'doc', xlsx: 'doc', csv: 'doc', ppt: 'doc', pptx: 'doc',
};

export function fileKind(name: string, isFolder: boolean): FileKind {
  if (isFolder) return 'folder';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'file';
  return BY_EXT[name.slice(dot + 1).toLowerCase()] ?? 'file';
}

/** Color de acento por familia. Suficiente para distinguir de un vistazo. */
export const KIND_COLOR: Record<FileKind, string> = {
  folder: '#e0a33c',
  image: '#8b6fd6',
  video: '#d4674f',
  audio: '#3f9e7c',
  archive: '#9a8b6b',
  doc: '#3f7fbf',
  file: '#8a939e',
};

/**
 * Identidad única de una entrada dentro de su carpeta.
 *
 * La ruta NO sirve: Google Drive admite dos archivos con el mismo nombre en la
 * misma carpeta, así que dos entradas distintas comparten ruta. El id del
 * proveedor sí las separa, y donde no lo hay (S3, donde la clave es única) la
 * ruta ya es identidad suficiente.
 */
export function entryUid(entry: { path: string; nativeId?: string | null }): string {
  return entry.nativeId ?? entry.path;
}
