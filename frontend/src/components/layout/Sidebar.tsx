import { useEffect } from 'react'; // Añadir useEffect
import { NavLink, useLocation, useNavigate } from 'react-router-dom'; // Añadir useLocation
import { LogOut, Package, KeyRound } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { NAV_GROUPS } from './nav';


export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar(); // Extraemos isMobile y setOpenMobile
  const { logout, user } = useAuth();
  const location = useLocation(); // Detecta cambios de URL
  const navigate = useNavigate();
  const collapsed = state === 'collapsed';

  // Cerrar automáticamente cuando cambie la ruta solo si estamos en móvil
  useEffect(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [location.pathname, isMobile, setOpenMobile]);

  return (
    <Sidebar collapsible="icon" className="border-r border-border h-full">
      <SidebarHeader className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-lg font-bold text-primary">MeatME</span>
              <span className="text-xs text-muted-foreground">Gestión Cárnica</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild tooltip={item.title}>
                      <NavLink
                        to={item.url}
                        end={item.url === '/'}
                        className={({ isActive }) =>
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-primary font-medium'
                            : 'hover:bg-sidebar-accent/50'
                        }
                      >
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-border p-4">
        {!collapsed && user && (
          <div className="mb-2 rounded-lg bg-muted p-3">
            <p className="text-sm font-medium">{user.username}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        )}
        <Button
          variant={location.pathname === '/cuenta' ? 'secondary' : 'ghost'}
          size={collapsed ? 'icon' : 'default'}
          onClick={() => navigate('/cuenta')}
          className="w-full"
        >
          <KeyRound className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Cambiar Contraseña</span>}
        </Button>
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'default'}
          onClick={logout}
          className="w-full"
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Cerrar Sesión</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
