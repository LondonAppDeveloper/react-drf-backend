import { useEffect, useState } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { useLocation } from 'react-router-dom';
import { AppSidebar } from './Sidebar';
import { MobileShell } from './MobileShell';
import { navInfo } from './nav';
import { PeriodoSelector } from '@/components/shared/PeriodoSelector';

// Ancho de teléfono. Se lee de forma síncrona para no pintar un cuadro con el layout de escritorio.
const CONSULTA_MOVIL = '(max-width: 767px)';
function useEsTelefono() {
  const [movil, setMovil] = useState(() => window.matchMedia(CONSULTA_MOVIL).matches);
  useEffect(() => {
    const mql = window.matchMedia(CONSULTA_MOVIL);
    const alCambiar = () => setMovil(mql.matches);
    mql.addEventListener('change', alCambiar);
    return () => mql.removeEventListener('change', alCambiar);
  }, []);
  return movil;
}

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { pathname } = useLocation();
  const info = navInfo(pathname);
  const esTelefono = useEsTelefono();

  // Teléfono: barra superior con título grande y barra de pestañas, como una app de iOS.
  if (esTelefono) return <MobileShell>{children}</MobileShell>;

  return (
    <SidebarProvider>
      {/* h-screen asegura que el contenedor ocupe exactamente el alto de la pantalla */}
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <AppSidebar />
        
        {/* flex-col y overflow-y-auto permiten que el contenido scrolee mientras el sidebar queda fijo */}
        <main className="flex flex-1 flex-col min-w-0 overflow-hidden">
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background/95 backdrop-blur px-6">
            <SidebarTrigger />
            <div className="flex-1 min-w-0 flex items-baseline gap-2 text-sm">
              {info ? (
                <>
                  <span className="text-muted-foreground hidden sm:inline">{info.group}</span>
                  <span className="text-muted-foreground hidden sm:inline">/</span>
                  <span className="font-semibold truncate">{info.title}</span>
                </>
              ) : (
                <span className="font-semibold">MeatME</span>
              )}
            </div>
            <PeriodoSelector />
          </header>
          
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
              {children}
            </div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}