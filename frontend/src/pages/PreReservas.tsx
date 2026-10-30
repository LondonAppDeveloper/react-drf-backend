import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hourglass, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { AuditoriaPreReservaList, formatFechaHora } from '@/components/shared/AuditoriaPreReservaList';
import { getAuditoriaPreReservas, getPedidos, getProductos } from '@/services/api';
import type { Pedido, Producto } from '@/types';

const EVENTOS = [
  { value: 'creada', label: 'Creada' },
  { value: 'aumentada', label: 'Aumentada' },
  { value: 'asignada', label: 'Asignada' },
  { value: 'reducida', label: 'Reducida' },
  { value: 'cancelada', label: 'Cancelada' },
];

export default function PreReservas() {
  const [producto, setProducto] = useState('todos');
  const [evento, setEvento] = useState('todos');
  const [pedidoTxt, setPedidoTxt] = useState('');

  const pedidoNum = Number(pedidoTxt.replace(/\D/g, ''));

  const { data: pedidos, isLoading: loadingPedidos, error: errorPedidos } = useQuery({
    queryKey: ['pedidos'],
    queryFn: async () => (await getPedidos(true)).data as Pedido[],
  });

  const { data: productos } = useQuery({
    queryKey: ['productos'],
    queryFn: async () => (await getProductos()).data as Producto[],
  });

  const { data: auditoria, isLoading: loadingAud, error: errorAud } = useQuery({
    queryKey: ['auditoria-pre-reservas', { producto, evento, pedido: pedidoNum || null }],
    queryFn: async () =>
      (await getAuditoriaPreReservas({
        ...(producto !== 'todos' ? { producto: Number(producto) } : {}),
        ...(evento !== 'todos' ? { evento } : {}),
        ...(pedidoNum ? { pedido: pedidoNum } : {}),
      })).data,
  });

  const enPreReserva = useMemo(
    () =>
      (pedidos ?? [])
        .filter((p) => p.estado === 'Pre-reserva')
        .map((p) => ({
          ...p,
          pendientes: p.detalles.filter((d) => d.estado !== 'Cancelado' && Number(d.unidades_pendientes) > 0),
        }))
        .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime()),
    [pedidos]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Pre-reservas</h1>
        <p className="text-muted-foreground">Pedidos esperando stock y registro de cómo se han ido asignando las unidades.</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase text-slate-500 flex items-center gap-2">
          <Hourglass className="h-4 w-4" /> Pedidos en pre-reserva ({enPreReserva.length})
        </h2>
        {loadingPedidos && <LoadingSpinner />}
        {errorPedidos && <ErrorMessage message="No se pudieron cargar los pedidos." />}
        {!loadingPedidos && enPreReserva.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay pedidos en pre-reserva.</p>
        )}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {enPreReserva.map((p) => (
            <div key={p.id} className="rounded-xl border bg-white p-3 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-bold text-blue-600">#{p.id}</span>{' '}
                  <span className="text-sm font-semibold">{p.cliente.nombre}</span>
                </div>
                <span className="text-[10px] text-slate-400 shrink-0">{formatFechaHora(p.fecha)}</span>
              </div>
              <ul className="mt-2 space-y-1">
                {p.pendientes.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-700 truncate">{d.producto.nombre}</span>
                    <Badge className="text-[10px] px-1.5 py-0 h-5 border-none bg-amber-100 text-amber-800 shrink-0">
                      {d.unidades_pendientes} de {d.cantidad_unidades} pendientes
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase text-slate-500">Historial</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative sm:w-40">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              inputMode="numeric"
              placeholder="N° pedido"
              className="pl-8"
              value={pedidoTxt}
              onChange={(e) => setPedidoTxt(e.target.value)}
            />
          </div>
          <Select value={producto} onValueChange={setProducto}>
            <SelectTrigger className="sm:w-64"><SelectValue placeholder="Producto" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los productos</SelectItem>
              {(productos ?? []).map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={evento} onValueChange={setEvento}>
            <SelectTrigger className="sm:w-44"><SelectValue placeholder="Evento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los eventos</SelectItem>
              {EVENTOS.map((e) => (
                <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {loadingAud && <LoadingSpinner />}
        {errorAud && <ErrorMessage message="No se pudo cargar el historial." />}
        {auditoria && auditoria.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin movimientos para estos filtros.</p>
        )}
        {auditoria && auditoria.length > 0 && (
          <>
            <AuditoriaPreReservaList rows={auditoria} />
            {auditoria.length >= 500 && (
              <p className="text-xs text-muted-foreground">Se muestran los 500 movimientos más recientes; usa los filtros para acotar.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
