import {
  LayoutDashboard,
  Package,
  Users,
  ShoppingCart,
  FileText,
  Warehouse,
  TrendingUp,
  Truck,
  Image,
  ArrowLeftRight,
  Wallet,
  KeyRound,
  Plus,
  Landmark,
  Hourglass,
  Tag,
  Ellipsis,
  ClipboardCheck,
  CalendarCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = { title: string; url: string; icon: LucideIcon };
export type NavGroup = { label: string; items: NavItem[] };

// Fuente única del menú: el Sidebar lo dibuja agrupado y el encabezado del
// Layout usa el mismo título, así el nombre del menú y el de la página coinciden.
export const NAV_GROUPS: NavGroup[] = [
  { label: 'General', items: [{ title: 'Precios', url: '/precios', icon: Tag }, { title: 'Resumen', url: '/resumen', icon: LayoutDashboard }] },
  {
    label: 'Ventas',
    items: [
      { title: 'Pedidos', url: '/pedidos', icon: ShoppingCart },
      { title: 'Pre-reservas', url: '/pre-reservas', icon: Hourglass },
      { title: 'Clientes', url: '/clientes', icon: Users },
      { title: 'Pagos de Vendedores', url: '/gestion-pagos', icon: Wallet },
      { title: 'Flyer de Precios', url: '/flyer', icon: Image },
    ],
  },
  {
    label: 'Compras',
    items: [
      { title: 'Facturas de Compra', url: '/facturas', icon: FileText },
      { title: 'Proveedores', url: '/proveedores', icon: Truck },
    ],
  },
  {
    label: 'Inventario',
    items: [
      { title: 'Stock', url: '/stock', icon: Warehouse },
      { title: 'Cuadrar inventario', url: '/cuadrar-inventario', icon: ClipboardCheck },
      { title: 'Movimientos', url: '/flujos-de-inventario', icon: ArrowLeftRight },
      { title: 'Productos', url: '/productos', icon: Package },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { title: 'Cierre de mes', url: '/cierre-mes', icon: CalendarCheck },
      { title: 'Tesorería', url: '/tesoreria', icon: Landmark },
      { title: 'Reportes', url: '/reportes', icon: TrendingUp },
    ],
  },
];

// Destinos de la barra de pestañas del teléfono (máximo 5). El resto vive en "Más".
export const TAB_ITEMS: NavItem[] = [
  { title: 'Precios', url: '/precios', icon: Tag },
  { title: 'Pedidos', url: '/pedidos', icon: ShoppingCart },
  { title: 'Resumen', url: '/resumen', icon: LayoutDashboard },
  { title: 'Clientes', url: '/clientes', icon: Users },
  { title: 'Más', url: '/mas', icon: Ellipsis },
];

// Pestaña que corresponde a una ruta: las pantallas que no son pestaña se abren desde "Más".
export function tabActiva(pathname: string): string {
  if (pathname.startsWith('/pedidos')) return '/pedidos';
  if (pathname === '/precios' || pathname === '/resumen' || pathname === '/clientes') return pathname;
  return '/mas';
}

const EXTRA: Record<string, { group: string; title: string; icon: NavItem['icon'] }> = {
  '/pedidos/nuevo': { group: 'Ventas', title: 'Nuevo Pedido', icon: Plus },
  '/cuenta': { group: 'Cuenta', title: 'Mi Cuenta', icon: KeyRound },
  '/mas': { group: 'General', title: 'Más', icon: Ellipsis },
};

export function navInfo(pathname: string): { group: string; title: string } | null {
  if (EXTRA[pathname]) return EXTRA[pathname];
  for (const g of NAV_GROUPS) {
    const item = g.items.find((i) => i.url === pathname);
    if (item) return { group: g.label, title: item.title };
  }
  return null;
}
