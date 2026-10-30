import { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AccionDeslizar {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  /** Color de fondo de la acción (el destructivo va siempre al final). */
  className: string;
}

const ANCHO_ACCION = 76;

// Fila con acciones al deslizar hacia la izquierda, como en Mail o Mensajes.
// Las mismas acciones deben existir en otro lugar (menú o detalle): deslizar es
// un gesto oculto y no es la única vía.
export function SwipeRow({
  acciones, disabled, children,
}: {
  acciones: AccionDeslizar[];
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const ancho = acciones.length * ANCHO_ACCION;
  const [x, setX] = useState(0);
  const [arrastrando, setArrastrando] = useState(false);
  const gesto = useRef<{ x: number; y: number; base: number; activo: boolean } | null>(null);
  const seMovio = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || !acciones.length) return;
    gesto.current = { x: e.clientX, y: e.clientY, base: x, activo: false };
    seMovio.current = false;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesto.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.activo) {
      // Solo se toma el gesto si es claramente horizontal: el scroll vertical queda libre.
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        g.activo = true;
        setArrastrando(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      } else {
        return;
      }
    }
    seMovio.current = true;
    setX(Math.min(0, Math.max(-ancho - 24, g.base + dx)));
  };

  const terminar = () => {
    const g = gesto.current;
    gesto.current = null;
    if (!g?.activo) return;
    setArrastrando(false);
    setX(x < -ancho / 2 ? -ancho : 0);
  };

  // Un toque con la fila abierta solo la cierra; tras arrastrar no cuenta como toque.
  const onClickCapture = (e: React.MouseEvent) => {
    if (seMovio.current) {
      e.stopPropagation();
      e.preventDefault();
      seMovio.current = false;
    } else if (x !== 0) {
      e.stopPropagation();
      e.preventDefault();
      setX(0);
    }
  };

  const abierta = x !== 0;

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 flex" style={{ width: ancho }} aria-hidden={!abierta}>
        {acciones.map(({ label, icon: Icono, onClick, className }) => (
          <button
            key={label}
            type="button"
            tabIndex={abierta ? 0 : -1}
            onClick={() => {
              setX(0);
              onClick();
            }}
            className={cn('flex flex-col items-center justify-center gap-1 text-[13px] font-medium text-white', className)}
            style={{ width: ANCHO_ACCION }}
          >
            {Icono && <Icono className="h-5 w-5" />}
            {label}
          </button>
        ))}
      </div>
      <div
        className={cn('relative touch-pan-y bg-card', !arrastrando && 'transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none')}
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={terminar}
        onPointerCancel={terminar}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  );
}
