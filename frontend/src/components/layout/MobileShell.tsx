import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MobileTabBar } from './MobileTabBar';
import { TAB_ITEMS, navInfo } from './nav';

// Alto de la barra superior sin el área segura; el IntersectionObserver no admite env().
const ALTO_BARRA = 56;

// El título grande lo escribe cada página como h1. Cuando sale de la vista, la barra
// superior muestra el título pequeño; con contenido por debajo aparece el separador.
function useTituloGrande(raiz: React.RefObject<HTMLElement>, ruta: string) {
  const [colapsado, setColapsado] = useState(false);
  const [conScroll, setConScroll] = useState(false);

  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    el.scrollTo(0, 0);
    setConScroll(false);

    let io: IntersectionObserver | undefined;
    let objetivo: Element | null = null;
    const observar = () => {
      const h1 = el.querySelector('h1');
      if (h1 === objetivo) return;
      io?.disconnect();
      objetivo = h1;
      if (!h1) {
        setColapsado(true);
        return;
      }
      io = new IntersectionObserver(([e]) => setColapsado(!e.isIntersecting), {
        root: el,
        rootMargin: `-${ALTO_BARRA}px 0px 0px 0px`,
      });
      io.observe(h1);
    };
    observar();
    // Las páginas cargan datos antes de pintar su h1: se vuelve a buscar al cambiar el DOM.
    const mo = new MutationObserver(observar);
    mo.observe(el, { childList: true, subtree: true });

    const alHacerScroll = () => setConScroll(el.scrollTop > 2);
    el.addEventListener('scroll', alHacerScroll, { passive: true });
    return () => {
      io?.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', alHacerScroll);
    };
  }, [raiz, ruta]);

  return { colapsado, conScroll };
}

export function MobileShell({ children }: { children: React.ReactNode }) {
  const { pathname, key } = useLocation();
  const navigate = useNavigate();
  const info = navInfo(pathname);
  const raiz = useRef<HTMLElement>(null);
  const { colapsado, conScroll } = useTituloGrande(raiz, pathname);

  const esPestana = TAB_ITEMS.some((t) => t.url === pathname);
  // Crear un pedido es una tarea de varios pasos: se presenta a pantalla completa, sin
  // barra de pestañas, con Cancelar a la izquierda (modal, ver sheets.md).
  const esFlujo = pathname === '/pedidos/nuevo';
  const accionNuevo = pathname === '/resumen' || pathname === '/pedidos';

  const volver = () => (key !== 'default' ? navigate(-1) : navigate(esFlujo ? '/pedidos' : '/mas'));

  return (
    <div
      className="fixed inset-0 bg-[hsl(var(--grouped-bg))]"
      style={esFlujo ? ({ '--tabbar-h': 'env(safe-area-inset-bottom)' } as React.CSSProperties) : undefined}
    >
      <header
        className={cn(
          'glass no-select absolute inset-x-0 top-0 z-30 grid grid-cols-[1fr_auto_1fr] items-center border-b px-2 pt-[env(safe-area-inset-top)] transition-[border-color] duration-200',
          conScroll ? 'border-border' : 'border-transparent'
        )}
        style={{ height: 'var(--navbar-h)' }}
      >
        <div className="flex items-center">
          {esFlujo ? (
            <button type="button" onClick={volver} className="min-h-11 px-2 text-[17px] text-primary active:opacity-50">
              Cancelar
            </button>
          ) : !esPestana ? (
            <button type="button" onClick={volver} className="flex min-h-11 items-center pr-3 text-[17px] text-primary active:opacity-50">
              <ChevronLeft className="h-7 w-7" strokeWidth={2.25} aria-hidden />
              Atrás
            </button>
          ) : null}
        </div>
        <h2
          aria-hidden={!colapsado}
          className={cn(
            'max-w-[55vw] truncate text-[17px] font-semibold transition-all duration-150',
            colapsado ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
          )}
        >
          {info?.title ?? 'MeatME'}
        </h2>
        <div className="flex items-center justify-end">
          {accionNuevo && (
            <button
              type="button"
              aria-label="Nuevo pedido"
              onClick={() => navigate('/pedidos/nuevo')}
              className="flex h-11 w-11 items-center justify-center text-primary active:opacity-50"
            >
              <Plus className="h-7 w-7" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </header>

      <main
        ref={raiz}
        data-scroll-root
        className="absolute inset-0 overflow-y-auto overscroll-contain px-4"
        style={{ paddingTop: 'calc(var(--navbar-h) + 0.5rem)', paddingBottom: 'calc(var(--tabbar-h) + 1rem)' }}
      >
        {children}
      </main>

      {!esFlujo && <MobileTabBar />}
    </div>
  );
}
