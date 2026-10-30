import { Navigate } from 'react-router-dom';
import { KeyRound, LogOut, UserRound } from 'lucide-react';
import { InsetGroup, ListRow } from '@/components/shared/InsetList';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { PeriodoSelector } from '@/components/shared/PeriodoSelector';
import { NAV_GROUPS, TAB_ITEMS } from '@/components/layout/nav';

const URLS_EN_PESTANAS = new Set(TAB_ITEMS.map((t) => t.url));

// "Más": el resto de las secciones y la cuenta, como una lista agrupada de Ajustes.
// En escritorio no existe (el menú lateral muestra todo): vuelve al inicio.
export default function Mas() {
  const { user, logout } = useAuth();
  const { confirm, dialog } = useConfirm();

  if (typeof window !== 'undefined' && !window.matchMedia('(max-width: 767px)').matches) {
    return <Navigate to="/" replace />;
  }

  const grupos = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !URLS_EN_PESTANAS.has(i.url)) })).filter(
    (g) => g.items.length > 0
  );

  return (
    <div className="space-y-6 pb-4">
      {dialog}
      <h1 className="tracking-tight">Más</h1>

      <InsetGroup title="Período">
        <div className="p-3"><PeriodoSelector className="w-full" /></div>
      </InsetGroup>

      {grupos.map((g) => (
        <InsetGroup key={g.label} title={g.label}>
          {g.items.map((item) => (
            <ListRow key={item.url} icon={item.icon} title={item.title} to={item.url} />
          ))}
        </InsetGroup>
      ))}

      <InsetGroup title="Cuenta">
        <ListRow icon={UserRound} title={user?.username ?? 'Mi usuario'} subtitle={user?.email || undefined} />
        <ListRow icon={KeyRound} title="Cambiar contraseña" to="/cuenta" />
        <ListRow
          icon={LogOut}
          title="Cerrar sesión"
          destructive
          onClick={() =>
            confirm({
              title: '¿Cerrar sesión?',
              confirmLabel: 'Cerrar sesión',
              destructive: true,
              onConfirm: logout,
            })
          }
        />
      </InsetGroup>
    </div>
  );
}
