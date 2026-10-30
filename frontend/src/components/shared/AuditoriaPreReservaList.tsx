import { useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getAuditoriaPreReservas } from '@/services/api';
import { EVENTO_PRE_RESERVA_CLASE } from '@/lib/preReservas';
import type { AuditoriaPreReserva } from '@/types';

export function formatFechaHora(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function EventoBadge({ evento, label }: { evento: string; label: string }) {
  return (
    <Badge className={`text-[10px] px-1.5 py-0 h-5 border-none ${EVENTO_PRE_RESERVA_CLASE[evento] ?? 'bg-slate-100 text-slate-700'}`}>
      {label}
    </Badge>
  );
}

// Lista de eventos como tarjetas (sirve igual en móvil y escritorio).
export function AuditoriaPreReservaList({ rows, mostrarPedido = true }: { rows: AuditoriaPreReserva[]; mostrarPedido?: boolean }) {
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.id} className="rounded-lg border bg-white p-2.5 text-xs shadow-xs">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <EventoBadge evento={r.evento} label={r.evento_display} />
            <span className="font-bold text-slate-700">{r.producto_nombre}</span>
            {mostrarPedido && (
              <span className="text-slate-500">
                <span className="font-mono font-bold text-blue-600">#{r.pedido}</span> · {r.cliente_nombre}
              </span>
            )}
            <span className="ml-auto text-[10px] text-slate-400">{formatFechaHora(r.fecha)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-slate-600">
            <span><span className="font-bold">{r.unidades}</span> un.</span>
            <span>Pendientes después: <span className="font-bold">{r.pendientes_despues}</span></span>
            <span>{r.origen_display}{r.referencia ? ` · ${r.referencia}` : ''}</span>
            {r.factura && (
              <span>Factura {r.factura}{r.proveedor_nombre ? ` · ${r.proveedor_nombre}` : ''}</span>
            )}
            {r.usuario_nombre && <span className="text-slate-400">por {r.usuario_nombre}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// Historial colapsable de un pedido; solo consulta al abrirlo.
export function HistorialPreReserva({ pedidoId }: { pedidoId: number }) {
  const [abierto, setAbierto] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['auditoria-pre-reservas', { pedido: pedidoId }],
    queryFn: async () => (await getAuditoriaPreReservas({ pedido: pedidoId })).data,
    enabled: abierto,
  });

  return (
    <div className="mx-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-slate-500" onClick={() => setAbierto(!abierto)}>
        {abierto ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
        <History className="mr-1 h-3.5 w-3.5" /> Historial pre-reserva
      </Button>
      {abierto && (
        <div className="mt-1">
          {isLoading && <p className="text-xs text-slate-400 px-2">Cargando…</p>}
          {error && <p className="text-xs text-red-600 px-2">No se pudo cargar el historial.</p>}
          {data && data.length === 0 && <p className="text-xs text-slate-400 px-2">Este pedido no tiene movimientos de pre-reserva.</p>}
          {data && data.length > 0 && <AuditoriaPreReservaList rows={data} mostrarPedido={false} />}
        </div>
      )}
    </div>
  );
}
