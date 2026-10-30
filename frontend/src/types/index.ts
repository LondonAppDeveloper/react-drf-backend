export interface Vendedor {
  id: number;
  nombre: string;
  sigla: string;
}

export interface Proveedor {
  id: number;
  nombre: string;
  rut?: string;
  cantidad_facturas: number;
}

export interface DatosFacturacion {
  tipo_cliente?: 'minorista' | 'mayorista';
  rut?: string;
  razon_social?: string;
  giro?: string;
  direccion_facturacion?: string;
  comuna?: string;
  ciudad?: string;
  email_facturacion?: string;
  contacto?: string;
}

export interface Cliente extends DatosFacturacion {
  id: number;
  nombre: string;
  telefono?: string | null;
  direccion?: string | null;
  email?: string | null;
  vendedor: Vendedor;
}

export type ModoPrecio = 'lista' | 'descuento' | 'personalizado' | 'costo';

export interface Producto {
  id: number;
  nombre: string;
  descripcion?: string | null;
  categoria?: string | null;
  precio_por_kilo: number;
  peso_minimo?: number | string;
  estado: 'disponible' | 'agotado' | 'desactivado';
  venta_por_unidad?: boolean;
  peso_flyer?: string;
}

export interface MargenProducto {
  producto_id: number;
  nombre: string;
  precio_por_kilo: number;
  costo_reciente: number | null;
  margen_unitario_actual: number | null;
  margen_pct_actual: number | null;
  margen_pct_historico: number | null;
}

export interface HistorialPrecio {
  id: number;
  precio_anterior: number;
  precio_nuevo: number;
  usuario_nombre: string;
  fecha_cambio: string;
}

export interface DetallePedido {
  id: number;
  producto: Producto;
  cantidad_unidades: number;
  cantidad_kilos: number;
  precio_venta: number;
  precio_lista?: number;
  modo_precio?: ModoPrecio;
  descuento_por_kilo: number;
  total_venta: number;
  total_costo: number;
  costo_por_kilo?: number;
  estado: 'Activo' | 'Cancelado';
  unidades_pendientes?: number;
  congelado?: boolean;
}

export interface Pedido {
  id: number;
  cliente: Cliente;
  vendedor: Vendedor;
  fecha: string;
  estado: 'Pre-reserva' | 'Reservado' | 'Preparado' | 'Anulado' | 'Pagado';
  total: number;
  detalles: DetallePedido[];
  observaciones?: string;
  tipo_recibo?: 'Boleta' | 'Factura';
  pagado_banco?: number;
}


export type EstadoEdicionLinea = 'libre' | 'parcial' | 'bloqueada';

export interface DetalleFactura {
  id?: number;
  producto: number;
  producto_nombre?: string;
  cantidad_kilos: number;
  costo_total: number;
  cantidad_unidades: number;
  costo_por_kilo: number;
  fecha?: string;
  proveedor_nombre?: string;
  // Guardas de stock calculadas por el backend.
  estado_edicion?: EstadoEdicionLinea;
  unidades_consumidas?: number;
  unidades_vivas?: number;
  pedidos_consumidores?: number[];
}

export interface PagoFactura {
  fecha_de_pago: string;
  monto_del_pago: number;
}

export interface NotaCredito {
  id: number;
  factura: string;
  numero: string;
  fecha: string;
  neto: number;
  iva: number;
  total: number;
  motivo: string;
  foto?: string | null;
}

export interface Factura {
  proveedor: number;
  proveedor_nombre?: string;
  fecha: string;
  fecha_vencimiento?: string | null;
  foto?: string | null;
  numero_factura: string;
  detalles: DetalleFactura[];
  pago_factura?: PagoFactura | null;
  notas_credito?: NotaCredito[];
  total_notas_credito?: number;
  total_a_pagar?: number;
  total: number;
  subtotal: number;
  iva: number;
  anticipo_iva?: number;
}

// Lo que se le debe al proveedor: el total menos sus notas de crédito.
export const totalAPagar = (f: Factura) => Number(f.total_a_pagar ?? f.total);

export interface StockItem {
  id: number;
  producto: string;
  categoria?: string | null;
  venta_por_unidad?: boolean;
  peso_flyer?: string;
  estado: string;
  precio_por_kilo: number;
  disponibles: number;
  stock: number;
  reservas: number;
  kilos_actuales: number;
  // Lotes vivos en orden FIFO (para estimar el costo de una venta).
  lotes?: { unidades: number; costo_por_kilo: number | string }[];
  // Pre-reservas: unidades pedidas sin stock.
  pre_reservas?: number;
  // Stock congelado (pool separado del inventario normal).
  congelado_unidades?: number;
  congelado_kilos?: number;
  congelado_reservas?: number;
  lotes_congelado?: { unidades: number; costo_por_kilo: number | string }[];
}

export interface PreReservaAsignada {
  pedido: number;
  producto: string;
  unidades: number;
  completa: boolean;
}

export interface MovimientoCongelado {
  id: number;
  producto: number;
  producto_nombre: string;
  direccion: 'congelar' | 'descongelar';
  cantidad_unidades: number;
  cantidad_kilos: number | string;
  razon?: string | null;
  usuario_nombre?: string;
  fecha: string;
}

export interface AjusteInventario {
  id: number;
  producto: number;
  producto_nombre: string;
  cantidad: number;
  cantidad_unidades: number;
  tipo: 'merma' | 'exceso' | 'ajuste';
  razon?: string | null;
  fecha: string;
}

export interface KPI {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  trend?: {
    value: number;
    positive: boolean;
  };
}

export type EventoPreReserva = 'creada' | 'aumentada' | 'asignada' | 'reducida' | 'cancelada';

export interface AuditoriaPreReserva {
  id: number;
  pedido: number;
  cliente_nombre: string;
  detalle: number;
  producto: number;
  producto_nombre: string;
  evento: EventoPreReserva;
  evento_display: string;
  origen: string;
  origen_display: string;
  unidades: number;
  pendientes_despues: number;
  factura: string | null;
  proveedor_nombre: string | null;
  referencia: string;
  usuario_nombre: string | null;
  fecha: string;
}

export interface DetalleConteo {
  id: number;
  producto: number;
  producto_nombre: string;
  sistema_kilos: string;
  sistema_unidades: number;
  contado_kilos: string | null;
  contado_unidades: number | null;
  diferencia_kilos: string;
  diferencia_unidades: number;
}

export interface ConteoInventario {
  id: number;
  fecha: string;
  usuario: string | null;
  notas: string;
  detalles: DetalleConteo[];
  productos_con_diferencia: number;
}
