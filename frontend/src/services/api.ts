import axios from 'axios';
import type {
  Producto,
  Cliente,
  Pedido,
  AuditoriaPreReserva,
  Factura,
  StockItem,
  MovimientoCongelado,
  PreReservaAsignada,
  Vendedor,
  Proveedor,
  HistorialPrecio,
  AjusteInventario,
  ConteoInventario,
  DatosFacturacion,
  ModoPrecio,
  NotaCredito,
} from '@/types';


const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// --- INTERCEPTOR DE SEGURIDAD ---
// Este código se ejecuta antes de CADA petición a la API
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    // Agrega el token de Django (SimpleJWT) a las cabeceras
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const REFRESH_URL = '/token/refresh/';

const forceLogout = () => {
  localStorage.clear();
  window.location.href = '/login';
};

// Comparte una única llamada de refresh entre múltiples 401 simultáneos.
let refreshPromise: Promise<string> | null = null;

export const refreshAccessToken = (): Promise<string> => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refresh = localStorage.getItem('refreshToken');
      if (!refresh) {
        throw new Error('No hay refreshToken disponible');
      }
      const response = await axios.post(`${API_BASE_URL}${REFRESH_URL}`, { refresh });
      const newAccess = response.data.access;
      localStorage.setItem('token', newAccess);
      return newAccess;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

// Interceptor para manejar errores 401 (Token expirado): refresca en background y reintenta.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes(REFRESH_URL)
    ) {
      originalRequest._retry = true;
      try {
        const newAccess = await refreshAccessToken();
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${newAccess}`;
        return api(originalRequest);
      } catch {
        forceLogout();
        return new Promise(() => {}); // corta la cadena: ya estamos redirigiendo
      }
    }

    if (error.response?.status === 401 && originalRequest?.url?.includes(REFRESH_URL)) {
      forceLogout();
      return new Promise(() => {});
    }

    return Promise.reject(error);
  }
);

// --- AUTENTICACIÓN ---
export const loginRequest = (credentials: { username: string; password: string }) =>
  api.post('/token/', credentials); // El endpoint que configuramos en Django

export const cambiarPassword = (password_actual: string, password_nueva: string) =>
  api.post('/auth/cambiar-password/', { password_actual, password_nueva });

export interface Perfil {
  username: string;
  nombre: string;
  telefono: string;
  mensaje_whatsapp: string;
  tiene_vendedor: boolean;
  es_admin: boolean;
  foto1: string | null;
  foto2: string | null;
  logo: string | null;
}

export const getPerfil = () => api.get<Perfil>('/auth/perfil/');

// Datos propios del usuario (teléfono, mensaje). Las fotos van con FormData.
export const updatePerfil = (data: Partial<Pick<Perfil, 'telefono' | 'mensaje_whatsapp'>> | FormData) =>
  api.patch<Perfil>('/auth/perfil/', data, data instanceof FormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : undefined);

export const refreshToken = (refresh: string) =>
  api.post(REFRESH_URL, { refresh });

// Productos
export const getProveedores = () => api.get<Proveedor[]>('/proveedores/');
export const createProveedor = (data: { nombre: string; rut?: string }) =>
  api.post<Proveedor>('/proveedores/', data);
export const updateProveedor = (id: number, data: { nombre: string; rut?: string }) =>
  api.put<Proveedor>(`/proveedores/${id}/`, data);
export const deleteProveedor = (id: number) => api.delete(`/proveedores/${id}/`);
export const getProductos = () => api.get<Producto[]>('/productos/');
export const createProducto = (data: {
  nombre: string;
  descripcion?: string;
  categoria?: string;
  precio_por_kilo: number;
  estado?: string;
}) => api.post<Producto>('/productos/crear/', data);
export const updateProducto = (id: number, data: Partial<Producto>) =>
  api.put<Producto>(`/productos/${id}/`, data);
export const getHistorialPrecio = (id: number) =>
  api.get<HistorialPrecio[]>(`/productos/${id}/historial-precio/`);

// Clientes
export const getClientes = () => api.get<Cliente[]>('/clientes/');
type ClientePayload = {
  nombre: string;
  direccion: string;
  telefono?: string;
  email?: string | null;
  vendedor_id: number;
} & DatosFacturacion;

export const createCliente = (data: ClientePayload) => api.post<Cliente>('/clientes/crear/', data);

// Pedidos
export const getPedidos = (incluirAnulados = false) =>
  api.get<Pedido[]>('/pedidos/', { params: incluirAnulados ? { incluir_anulados: '1' } : {} });
export const getPedido = (id: number) => api.get<Pedido>(`/pedidos/${id}/`);
export type PrecioLinea = {
  modo_precio?: ModoPrecio;
  descuento_por_kilo?: number;
  precio_personalizado?: number;
};

export const createPedido = (data: {
  cliente: number;
  vendedor: number;
  detalles: ({
    producto: number;
    cantidad_kilos: number;
    cantidad_unidades: number;
  } & PrecioLinea)[];
  observaciones?: string;
  tipo_recibo?: 'Boleta' | 'Factura';
}) => api.post<Pedido>('/pedidos/crear/', data);
export const cancelarPedido = (id: number) => api.post(`/pedidos/cancelar/`, { pedido_id: id });
export const cancelarProductoPedido = (pedidoId: number, detalleId: number) =>
  api.post<Pedido>(`/pedidos/cancelar-producto/`, { pedido_id: pedidoId, detalle_id: detalleId });
export const agregarProductoPedido = (pedidoId: number, data: {
  producto_id: number;
  cantidad_kilos: number;
  cantidad_unidades: number;
  congelado?: boolean;
  permitir_pre_reserva?: boolean;
} & PrecioLinea) => api.post<Pedido>(`/pedidos/agregar-producto/`, { pedido_id: pedidoId, ...data });
export const actualizarKilosPedido = (id: number, detalles: any[]) =>
  api.post(`/pedidos/actualizar_kilos/${id}/`, { detalles });

// Facturas
const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };
const opcionesPara = (data: unknown) => (data instanceof FormData ? multipart : undefined);

export const getFacturas = () => api.get<Factura[]>('/facturas/');
// Con foto se manda FormData (y los detalles como JSON en texto).
export const createFactura = (data: any) => api.post('/facturas/crear/', data, opcionesPara(data));
export const updateFactura = (numeroFactura: string, data: any) =>
  api.put<Factura>(`/facturas/${encodeURIComponent(numeroFactura)}/`, data, opcionesPara(data));
export const createNotaCredito = (numeroFactura: string, data: FormData) =>
  api.post<NotaCredito>(`/facturas/${encodeURIComponent(numeroFactura)}/notas-credito/`, data, multipart);
export const deleteNotaCredito = (id: number) => api.delete(`/facturas/notas-credito/${id}/`);
export const pagarFactura = (factura: string, fecha_de_pago: string, monto_del_pago: number) =>
  api.post(`/facturas/pagar/`, {
    factura,
    fecha_de_pago,
    monto_del_pago,
  });

// Pagos Vendedores
export const getPagosVendedor = (vendedorId?: string) => 
  api.get(`/pagos-vendedor/${vendedorId ? `?vendedor=${vendedorId}` : ''}`);

export const createPagoVendedor = (formData: FormData) => 
  api.post('/pagos-vendedor/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
export const deletePagoVendedor = (id: number) => api.delete(`/pagos-vendedor/${id}/`);

// En services/api.ts

// Obtener un solo pedido para editar
export const getPedidoById = async (id: number) => {
  const response = await api.get(`/pedidos/${id}/`);
  return response.data;
};

export const updateCliente = (id: number, data: ClientePayload) => api.put<Cliente>(`/clientes/${id}/`, data);

// Actualizar pedido (PUT o PATCH)
export const updatePedido = async (id: number, data: any) => {
  const response = await api.put(`/pedidos/${id}/`, data);
  return response.data;
};


export const getDetalleFacturas = async () => {
  return await api.get('/inventario/detalle-facturas/');
};

// Obtener detalles de todos los pedidos (Salidas)
export const getDetallePedidos = async () => {
  return await api.get('/inventario/detalle-pedidos/');
};

// Stock
export const getAuditoriaPreReservas = (params: { pedido?: number; producto?: number; evento?: string } = {}) =>
  api.get<AuditoriaPreReserva[]>('/pedidos/pre-reservas/auditoria/', { params });
export const getStock = () => api.get<StockItem[]>('/stock/');
export const getMovimientosCongelado = (producto?: number) =>
  api.get<MovimientoCongelado[]>('/inventario/congelado/', { params: producto ? { producto } : undefined });
export const moverStockCongelado = (data: {
  producto: number;
  cantidad_unidades: number;
  cantidad_kilos?: number;
  direccion: 'congelar' | 'descongelar';
  razon?: string;
}) => api.post<MovimientoCongelado & { pre_reservas_asignadas?: PreReservaAsignada[] }>('/inventario/congelado/', data);

// Ajustes de Inventario (Mermas / Excesos / Ajustes manuales)
export const getAjustesInventario = (params?: { producto?: number; tipo?: string }) =>
  api.get<AjusteInventario[]>('/inventario/ajustes/', { params });
export const createAjusteInventario = (data: {
  producto: number;
  tipo: 'merma' | 'exceso' | 'ajuste';
  cantidad: number;
  cantidad_unidades: number;
  razon?: string;
}) => api.post<AjusteInventario>('/inventario/ajustes/crear/', data);
// Editar y eliminar revierten en el backend el movimiento de stock que el
// ajuste hizo al registrarse, asi que despues de llamarlos hay que invalidar
// tambien la query de stock, no solo la de ajustes.
export const updateAjusteInventario = (
  id: number,
  data: {
    producto: number;
    tipo: 'merma' | 'exceso' | 'ajuste';
    cantidad: number;
    cantidad_unidades: number;
    razon?: string;
  }
) => api.put<AjusteInventario>(`/inventario/ajustes/${id}/`, data);
export const deleteAjusteInventario = (id: number) =>
  api.delete(`/inventario/ajustes/${id}/`);
// Vendedores
export const getVendedores = () => api.get<Vendedor[]>('/vendedores/');

// --- Reportes (Plan 03) ---
export const getReporteGanancias = (params?: { desde?: string; hasta?: string }) =>
  api.get('/reportes/ganancias/', { params });
export const getReportePerdidas = (params?: { desde?: string; hasta?: string }) =>
  api.get('/reportes/perdidas/', { params });
export const getFluctuacionPrecios = (productoId?: number | string) =>
  api.get('/reportes/fluctuacion-precios/', {
    params: productoId ? { producto: productoId } : undefined,
  });
export const getMargenProductos = () => api.get('/reportes/margen-productos/');
export const getRentabilidadHistorica = (productoId?: number | string) =>
  api.get('/reportes/rentabilidad-historica/', {
    params: productoId ? { producto: productoId } : undefined,
  });

// --- Tesorería ---
export const getCartolas = () => api.get('/tesoreria/cartolas/');
export const analizarCartola = (data: { filas: unknown[][]; nombre_archivo: string } | FormData) =>
  api.post('/tesoreria/cartolas/analizar/', data, { ...opcionesPara(data), timeout: 300_000 });
export const importarCartola = (data: { nombre_archivo: string; banco: string; metodo: string; movimientos: unknown[] }) =>
  api.post('/tesoreria/cartolas/importar/', data);
export const deleteCartola = (id: number) => api.delete(`/tesoreria/cartolas/${id}/`);
export const getMovimientosBanco = (params?: Record<string, string>) => api.get('/tesoreria/movimientos/', { params });
export const updateMovimientoBanco = (id: number, data: { categoria?: string; comentario?: string }) =>
  api.patch(`/tesoreria/movimientos/${id}/`, data);
export const asignarMovimiento = (id: number, data: { pedido?: number; factura?: string; monto: number; marcar_pagado?: boolean }) =>
  api.post(`/tesoreria/movimientos/${id}/asignar/`, data);
export const deleteAsignacion = (id: number) => api.delete(`/tesoreria/asignaciones/${id}/`);
export const getGastos = (params?: Record<string, string>) => api.get('/tesoreria/gastos/', { params });
export const createGasto = (data: Record<string, unknown>) => api.post('/tesoreria/gastos/', data);
export const updateGasto = (id: number, data: Record<string, unknown>) => api.put(`/tesoreria/gastos/${id}/`, data);
export const deleteGasto = (id: number) => api.delete(`/tesoreria/gastos/${id}/`);
export const getContabilidad = (params?: { desde?: string; hasta?: string }) => api.get('/tesoreria/contabilidad/', { params });
export interface ConfiguracionContable {
  tasa_impuesto_renta: string; tasa_ppm: string; tasa_iva: string; tasa_anticipo_carne: string;
  receptor_cobro: 'vendedor' | 'empresa';
}
export const getConfiguracionContable = () => api.get<ConfiguracionContable>('/tesoreria/configuracion/');
export const updateConfiguracionContable = (data: {
  tasa_impuesto_renta?: number; tasa_ppm?: number; tasa_iva?: number; tasa_anticipo_carne?: number;
  receptor_cobro?: 'vendedor' | 'empresa';
}) => api.put<ConfiguracionContable>('/tesoreria/configuracion/', data);

// --- Cierre de mes: ventas, cobros y documentos tributarios ---
export const getVentasMes = (params: { mes: string; vendedor?: string }) => api.get('/cierre/ventas/', { params });
export const crearCobro = (data: Record<string, unknown> | FormData) => api.post('/cierre/cobros/', data, opcionesPara(data));
export const actualizarCobro = (id: number, data: Record<string, unknown>) => api.patch(`/cierre/cobros/${id}/`, data);
export const eliminarCobro = (id: number) => api.delete(`/cierre/cobros/${id}/`);
export const getDocumentos = (params?: { mes?: string; sin_pedido?: string }) => api.get('/cierre/documentos/', { params });
export const crearDocumento = (data: Record<string, unknown>) => api.post('/cierre/documentos/', data);
export const actualizarDocumento = (id: number, data: Record<string, unknown>) => api.patch(`/cierre/documentos/${id}/`, data);
export const eliminarDocumento = (id: number) => api.delete(`/cierre/documentos/${id}/`);
export const getImportacionesSII = () => api.get('/cierre/sii/');
export const importarArchivoSII = (data: FormData) => api.post('/cierre/sii/', data, opcionesPara(data));

export default api;

// Cuadratura de inventario: stock que el sistema cree que hay y conteos ya registrados.
export const getStockFisico = () =>
  api.get<{ id: number; nombre: string; categoria?: string | null; sistema_kilos: string; sistema_unidades: number }[]>(
    '/inventario/stock-fisico/'
  );
export const getConteos = () => api.get<ConteoInventario[]>('/inventario/conteos/');
export const createConteo = (data: {
  notas?: string;
  lineas: { producto: number; contado_kilos?: string; contado_unidades?: string }[];
}) => api.post<ConteoInventario>('/inventario/conteos/', data);

// --- Períodos (cortes contables) ---
export interface Periodo { id: number; nombre: string; fecha_inicio: string; fecha_fin: string | null }
export const getPeriodos = () => api.get<Periodo[]>('/periodos/');
export const crearPeriodo = (data: { nombre: string; fecha_inicio: string }) => api.post<Periodo>('/periodos/', data);
export const actualizarPeriodo = (id: number, data: Partial<Pick<Periodo, 'nombre' | 'fecha_inicio'>>) =>
  api.patch<Periodo>(`/periodos/${id}/`, data);
export const eliminarPeriodo = (id: number) => api.delete(`/periodos/${id}/`);
