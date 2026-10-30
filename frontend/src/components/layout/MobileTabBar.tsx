import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPedidos } from '@/services/api';
import type { Pedido } from '@/types';
import { cn } from '@/lib/utils';
import { TAB_ITEMS, tabActiva } from './nav';

// Barra de pestañas flotante del teléfono. Es capa funcional: lleva el vidrio; el
// contenido pasa por debajo. Las pestañas navegan, no ejecutan acciones.
export function MobileTabBar() {
  const { pathname } = useLocation();
  const activa = tabActiva(pathname);

  // Misma clave y forma que Pedidos y Resumen: comparte caché, no hace otra consulta.
  const { data } = useQuery({
    queryKey: ['pedidos'],
    queryFn: async () => (await getPedidos(true)).data as Pedido[],
    staleTime: 30_000,
  });
  // La insignia queda para lo que necesita acción: pedidos por pesar.
  const porPesar = (data ?? []).filter((p) => p.estado === 'Reservado').length;

  return (
    <nav aria-label="Secciones" className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-40 no-select">
      <ul className="glass flex gap-0.5 rounded-[28px] border border-border/60 p-1 shadow-lg">
        {TAB_ITEMS.map(({ url, title, icon: Icono }) => {
          const seleccionada = activa === url;
          return (
            <li key={url} className="relative flex-1">
              <Link
                to={url}
                aria-current={seleccionada ? 'page' : undefined}
                // Tocar la pestaña ya abierta vuelve al inicio de la pantalla, como en iOS.
                onClick={() => seleccionada && document.querySelector('[data-scroll-root]')?.scrollTo({ top: 0, behavior: 'smooth' })}
                className={cn(
                  'flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-3xl px-1 transition-colors duration-150',
                  seleccionada ? 'bg-primary/10 text-primary' : 'text-muted-foreground active:bg-muted'
                )}
              >
                <Icono className="h-6 w-6" strokeWidth={seleccionada ? 2.25 : 1.75} aria-hidden />
                <span className="text-[11px] font-medium leading-none">{title}</span>
              </Link>
              {url === '/pedidos' && porPesar > 0 && (
                <span
                  aria-label={`${porPesar} por pesar`}
                  className="pointer-events-none absolute right-[18%] top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[hsl(0_72%_45%)] px-1 text-[11px] font-semibold leading-none text-white"
                >
                  {porPesar}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
