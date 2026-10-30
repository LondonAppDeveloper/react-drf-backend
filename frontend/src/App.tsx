import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Layout } from "./components/layout/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Productos from "./pages/Productos";
import Clientes from "./pages/Clientes";
import Proveedores from "./pages/Proveedores";
import Pedidos from "./pages/Pedidos";
import PedidoNuevo from "./pages/PedidoNuevo";
import MovimientosInventarios from "./pages/MovimientosInventario";
import Facturas from "./pages/Facturas";
import Stock from "./pages/Stock";
import ConteoInventario from "./pages/ConteoInventario";
import Reportes from "./pages/Reportes";
import NotFound from "./pages/NotFound";
import GestionPagosVendedor from "./pages/GestioPagosVendedor";
import CambiarPassword from "./pages/CambiarPassword";
import Flyer from "./pages/Flyer";
import Tesoreria from "./pages/Tesoreria";
import CierreMes from "./pages/CierreMes";
import PreReservas from "./pages/PreReservas";
import Precios from "./pages/Precios";
import Mas from "./pages/Mas";
import { PeriodoProvider } from "./contexts/PeriodoContext";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <PeriodoProvider>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Al abrir la app se ven los precios y el stock; el Resumen sigue en /resumen. */}
            <Route path="/" element={<Navigate to="/precios" replace />} />
            <Route
              path="/resumen"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Dashboard />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/productos"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Productos />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/clientes"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Clientes />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/proveedores"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Proveedores />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/pedidos"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Pedidos />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/gestion-pagos"
              element={
                <ProtectedRoute>
                  <Layout>
                    <GestionPagosVendedor />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/pedidos/nuevo"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PedidoNuevo />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/facturas"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Facturas />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/flujos-de-inventario"
              element={
                <ProtectedRoute>
                  <Layout>
                    <MovimientosInventarios />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/stock"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Stock />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/cuadrar-inventario"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ConteoInventario />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/reportes"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Reportes />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/cuenta"
              element={
                <ProtectedRoute>
                  <Layout>
                    <CambiarPassword />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/flyer"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Flyer />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/mas"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Mas />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/precios"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Precios />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/cierre-mes"
              element={
                <ProtectedRoute>
                  <Layout>
                    <CierreMes />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/tesoreria"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Tesoreria />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/pre-reservas"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PreReservas />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
      </PeriodoProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
