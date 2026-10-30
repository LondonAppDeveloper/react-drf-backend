import type { ModoPrecio, StockItem } from '@/types';

// Los precios de venta incluyen IVA; los costos de compra son netos.
export const FACTOR_IVA = 1.19;

export const MODOS_PRECIO: { value: ModoPrecio; label: string; corto: string }[] = [
  { value: 'lista', label: 'Precio normal', corto: 'Normal' },
  { value: 'descuento', label: 'Descuento por kilo', corto: 'Descuento' },
  { value: 'personalizado', label: 'Precio personalizado', corto: 'Otro precio' },
  { value: 'costo', label: 'A costo', corto: 'A costo' },
];

// Costo neto por kilo que tendrá la venta: mismo promedio que calcula el
// backend (ponderado por unidades de los lotes FIFO que se consumen).
export function costoFifo(lotes: StockItem['lotes'], unidades: number): number | null {
  if (!lotes?.length) return null;
  let restante = Math.max(1, Math.trunc(unidades));
  let suma = 0;
  let tomadas = 0;
  for (const lote of lotes) {
    if (restante <= 0) break;
    const u = Math.min(Number(lote.unidades), restante);
    suma += u * Number(lote.costo_por_kilo);
    tomadas += u;
    restante -= u;
  }
  return tomadas ? suma / tomadas : null;
}

// Precio mínimo (con IVA) para no perder plata: costo neto + IVA.
export const pisoSinPerdida = (costoNeto: number) => Math.ceil(costoNeto * FACTOR_IVA);

export function precioSegunModo(
  modo: ModoPrecio,
  lista: number,
  { descuento = 0, personalizado = 0, costoNeto = null as number | null } = {}
): number {
  switch (modo) {
    case 'costo':
      return costoNeto != null ? pisoSinPerdida(costoNeto) : lista;
    case 'personalizado':
      return personalizado > 0 ? personalizado : lista;
    case 'descuento':
      return Math.max(0, lista - descuento);
    default:
      return lista;
  }
}

// Ganancia neta por kilo de un precio (con IVA) frente a un costo neto.
export const gananciaPorKilo = (precio: number, costoNeto: number) => precio / FACTOR_IVA - costoNeto;
