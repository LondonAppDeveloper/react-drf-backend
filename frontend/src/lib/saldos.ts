import type { Pedido, Vendedor } from '@/types';

export interface PagoVendedor {
  id: number;
  vendedor: number;
  monto: number | string;
  comentario?: string;
  tipo: 'pago' | 'adelanto';
  fecha: string;
  comprobante?: string | null;
}

export interface SaldoVendedor extends Vendedor {
  ventas: number;
  pagos: number;
  adelantos: number;
  // Lo que el vendedor aún debe rendir: ventas − pagos − adelantos.
  // Negativo = saldo a favor del vendedor.
  saldo: number;
}

// /pagos-vendedor/ responde { data: [...] }.
export function pagosDesdeRespuesta(body: unknown): PagoVendedor[] {
  if (Array.isArray(body)) return body;
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? data : [];
}

const idVendedorDe = (v: unknown) =>
  Number(typeof v === 'object' && v !== null ? (v as { id?: number }).id : v);

// `pedidos` debe venir SIN anulados. El adelanto es "saldo a favor" del
// vendedor (ver PagoVendedor.TIPOS en el backend), así que también descuenta.
export function calcularSaldosVendedores(
  vendedores: Vendedor[],
  pedidos: Pedido[],
  pagos: PagoVendedor[]
): SaldoVendedor[] {
  return vendedores.map((v) => {
    const ventas = pedidos
      .filter((p) => idVendedorDe(p.vendedor) === v.id)
      .reduce((s, p) => s + Number(p.total || 0), 0);
    const suma = (tipo: PagoVendedor['tipo']) =>
      pagos
        .filter((p) => idVendedorDe(p.vendedor) === v.id && p.tipo === tipo)
        .reduce((s, p) => s + Number(p.monto || 0), 0);
    const pagosV = suma('pago');
    const adelantos = suma('adelanto');
    return { ...v, ventas, pagos: pagosV, adelantos, saldo: ventas - pagosV - adelantos };
  });
}
