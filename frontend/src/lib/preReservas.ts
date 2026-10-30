import type { PreReservaAsignada } from '@/types';

// Texto para el toast cuando una entrada de stock llena pre-reservas pendientes.
export function resumenPreReservas(asignadas?: PreReservaAsignada[]): string {
  if (!asignadas || asignadas.length === 0) return '';
  return asignadas
    .map((a) =>
      `Pedido #${a.pedido}: ${a.unidades} un. de ${a.producto} asignadas` +
      (a.completa ? ' (pasa a Reservado)' : ' (aún quedan unidades pendientes)')
    )
    .join('\n');
}

// Colores del badge de cada evento de la auditoría de pre-reservas.
export const EVENTO_PRE_RESERVA_CLASE: Record<string, string> = {
  creada: 'bg-amber-100 text-amber-800',
  aumentada: 'bg-orange-100 text-orange-800',
  asignada: 'bg-green-100 text-green-800',
  reducida: 'bg-slate-200 text-slate-700',
  cancelada: 'bg-red-100 text-red-700',
};

// Invalida lo que cambia cuando se asignan o liberan pre-reservas.
export function invalidarPreReservas(qc: { invalidateQueries: (o: { queryKey: unknown[] }) => unknown }) {
  qc.invalidateQueries({ queryKey: ['pedidos'] });
  qc.invalidateQueries({ queryKey: ['stock'] });
  qc.invalidateQueries({ queryKey: ['auditoria-pre-reservas'] });
}
