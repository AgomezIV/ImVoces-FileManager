'use client';

import { IconClose, IconCopy, IconDownload, IconMove, IconRename, IconTrash } from './Icons';

interface Props {
  count: number;
  /** Descargar y renombrar solo aplican a un único archivo. */
  single: boolean;
  onCopy: () => void;
  onMove: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClear: () => void;
}

/**
 * Acciones sobre lo seleccionado. Aparece flotando sobre la lista, así que la
 * carpeta sigue visible mientras se decide qué hacer.
 */
export function SelectionBar({
  count, single, onCopy, onMove, onDownload, onRename, onDelete, onClear,
}: Props) {
  if (count === 0) return null;

  return (
    <div
      className="card"
      style={{
        position: 'absolute', left: '50%', bottom: 20, transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 4, padding: 6,
        boxShadow: 'var(--shadow-2)', zIndex: 20,
        animation: 'imv-fade-in .14s ease',
      }}
    >
      <span className="tag" style={{ marginRight: 4 }}>
        {count} seleccionado{count === 1 ? '' : 's'}
      </span>

      <button className="primary" onClick={onCopy}><IconCopy /> Copiar a…</button>
      <button onClick={onMove}><IconMove /> Mover a…</button>

      <span style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 3px' }} />

      <button className="ghost" onClick={onDownload} disabled={!single} title="Descargar">
        <IconDownload />
      </button>
      <button className="ghost" onClick={onRename} disabled={!single} title="Renombrar">
        <IconRename />
      </button>
      <button className="ghost danger" onClick={onDelete} title="Eliminar">
        <IconTrash />
      </button>

      <span style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 3px' }} />

      <button className="icon" onClick={onClear} aria-label="Quitar selección"><IconClose /></button>
    </div>
  );
}
