'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

/** `null` es un separador. */
export type MenuEntry = MenuItem | null;

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

/**
 * Menú contextual propio, en la posición del cursor.
 *
 * Se recoloca solo para no salirse de la ventana: abrir cerca del borde
 * derecho o inferior es justo cuando más molesta un menú cortado.
 */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // `capture` para cerrarlo antes de que el clic llegue a la lista de abajo.
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="card"
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 200,
        minWidth: 218, padding: 5, boxShadow: 'var(--shadow-3)',
        animation: 'imv-menu-in .11s cubic-bezier(.2,.8,.3,1)',
        transformOrigin: 'top left',
      }}
    >
      {items.map((item, i) =>
        item === null ? (
          <div key={`sep-${i}`} style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />
        ) : (
          <button
            key={item.id}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => { item.onSelect(); onClose(); }}
            style={{
              width: '100%', border: 'none', background: 'transparent',
              justifyContent: 'flex-start', gap: 10, padding: '7px 9px',
              color: item.danger ? 'var(--danger)' : 'var(--text)',
              borderRadius: 6,
            }}
          >
            <span style={{ display: 'flex', width: 16, flexShrink: 0, opacity: .85 }}>{item.icon}</span>
            <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
            {item.shortcut && <span className="dim" style={{ fontSize: 11.5 }}>{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
