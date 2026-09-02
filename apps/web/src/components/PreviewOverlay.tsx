'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RemoteEntry } from '@imvoces/contracts';
import { api } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';
import { previewMode, TEXT_PREVIEW_MAX_BYTES } from '@/lib/preview';
import { fileKind, KIND_COLOR } from '@/lib/fileTypes';
import {
  IconArchive, IconAudio, IconChevronRight, IconClose, IconDoc,
  IconDownload, IconFile, IconImage, IconVideo,
} from './Icons';

const BIG_ICON = {
  image: IconImage, video: IconVideo, audio: IconAudio,
  archive: IconArchive, doc: IconDoc, file: IconFile, folder: IconFile,
};

interface Props {
  accountId: string;
  /** Archivos navegables con las flechas, en el orden de la carpeta. */
  entries: RemoteEntry[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}

/**
 * Visor a pantalla completa: imagen, vídeo, audio, PDF o texto.
 *
 * Los bytes llegan por `/fs/content`, así que funciona igual con Drive, Dropbox
 * o R2 sin que el navegador vea credencial alguna.
 */
export function PreviewOverlay({ accountId, entries, index, onIndex, onClose }: Props) {
  const entry = entries[index];
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const mode = entry ? previewMode(entry.name, entry.mimeType) : 'none';
  const src = entry ? api.contentUrl(accountId, entry.path, false, entry.nativeId) : '';

  useEffect(() => {
    setText(null);
    setFailed(false);
    if (!entry || mode !== 'text') return;
    if (entry.size > TEXT_PREVIEW_MAX_BYTES) return;

    let alive = true;
    void fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => { if (alive) setText(t); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [entry, mode, src]);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < entries.length) onIndex(next);
    },
    [entries.length, index, onIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  if (!entry) return null;

  const Icon = BIG_ICON[fileKind(entry.name, false)];

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={entry.name}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 120,
        // Casi opaco: a menos, la lista de detrás se transparenta y el visor
        // parece a medio pintar en lugar de una capa propia.
        background: 'rgba(8,11,14,.97)', backdropFilter: 'blur(6px)',
        display: 'flex', flexDirection: 'column',
        animation: 'imv-fade-in .16s ease',
      }}
    >
      <header
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px', color: '#f2f5f8', flexShrink: 0,
        }}
      >
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.name}
          </span>
          <span style={{ fontSize: 12, opacity: .65 }}>
            {formatBytes(entry.size)} · {formatDate(entry.modifiedAt)}
            {entries.length > 1 && ` · ${index + 1} de ${entries.length}`}
          </span>
        </span>

        <a
          href={api.contentUrl(accountId, entry.path, true, entry.nativeId)}
          download={entry.name}
          onClick={(e) => e.stopPropagation()}
          style={{ color: 'inherit', textDecoration: 'none' }}
        >
          <button className="ghost" style={{ color: '#f2f5f8', borderColor: 'rgba(255,255,255,.2)' }}>
            <IconDownload /> Descargar
          </button>
        </a>
        <button
          className="icon"
          onClick={onClose}
          aria-label="Cerrar"
          style={{ color: '#f2f5f8' }}
        >
          <IconClose size={20} />
        </button>
      </header>

      <div
        style={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: 0, padding: '0 12px 20px', position: 'relative' }}
      >
        {index > 0 && (
          <NavButton side="left" onClick={(e) => { e.stopPropagation(); go(-1); }} />
        )}
        {index < entries.length - 1 && (
          <NavButton side="right" onClick={(e) => { e.stopPropagation(); go(1); }} />
        )}

        <div
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: '100%', maxHeight: '100%', display: 'grid', placeItems: 'center' }}
        >
          {mode === 'image' && !failed && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={entry.name}
              onError={() => setFailed(true)}
              style={{ maxWidth: '100%', maxHeight: '82vh', objectFit: 'contain', borderRadius: 6 }}
            />
          )}

          {mode === 'video' && !failed && (
            <video
              src={src}
              controls
              autoPlay
              onError={() => setFailed(true)}
              style={{ maxWidth: '100%', maxHeight: '82vh', borderRadius: 6, background: '#000' }}
            />
          )}

          {mode === 'audio' && !failed && (
            <div style={{ display: 'grid', placeItems: 'center', gap: 18, color: '#f2f5f8' }}>
              <span style={{ color: KIND_COLOR.audio }}><Icon size={72} /></span>
              <audio src={src} controls autoPlay onError={() => setFailed(true)} style={{ width: 380, maxWidth: '80vw' }} />
            </div>
          )}

          {mode === 'pdf' && !failed && (
            <iframe
              src={src}
              title={entry.name}
              style={{ width: 'min(1000px, 92vw)', height: '82vh', border: 0, borderRadius: 6, background: '#fff' }}
            />
          )}

          {mode === 'text' && (
            <pre
              style={{
                width: 'min(1000px, 92vw)', maxHeight: '82vh', overflow: 'auto', margin: 0,
                background: 'var(--surface)', color: 'var(--text)', padding: 18,
                borderRadius: 8, fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {entry.size > TEXT_PREVIEW_MAX_BYTES
                ? 'El archivo es demasiado grande para previsualizarlo. Descárgalo para verlo completo.'
                : failed
                  ? 'No se pudo leer el archivo.'
                  : text ?? 'Cargando…'}
            </pre>
          )}

          {(mode === 'none' || failed) && mode !== 'text' && (
            <div style={{ display: 'grid', placeItems: 'center', gap: 14, color: '#f2f5f8', textAlign: 'center' }}>
              <span style={{ color: KIND_COLOR[fileKind(entry.name, false)] }}><Icon size={72} /></span>
              <p style={{ margin: 0, opacity: .8 }}>
                {failed
                  ? 'No se pudo cargar la vista previa.'
                  : 'Este tipo de archivo no se puede previsualizar.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={side === 'left' ? 'Anterior' : 'Siguiente'}
      style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
        [side]: 14, zIndex: 2,
        width: 40, height: 40, padding: 0, borderRadius: '50%',
        background: 'rgba(255,255,255,.1)', color: '#f2f5f8',
        border: '1px solid rgba(255,255,255,.18)',
        display: 'grid', placeItems: 'center',
      }}
    >
      <span style={{ transform: side === 'left' ? 'rotate(180deg)' : 'none', display: 'flex' }}>
        <IconChevronRight size={20} />
      </span>
    </button>
  );
}
