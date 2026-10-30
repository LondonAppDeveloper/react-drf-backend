import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, FileUp, Link2, MessageSquare, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import {
  asignarMovimiento, createGasto, deleteAsignacion, deleteCartola, getCartolas, getFacturas,
  getMovimientosBanco, getPedidos, updateMovimientoBanco,
} from '@/services/api';
import { totalAPagar, type Factura, type Pedido } from '@/types';
import { cn, formatCLP, formatFecha, parseDecimal } from '@/lib/utils';
import { CargarCartolaDialog } from './CargarCartolaDialog';

export interface Movimiento {
  id: number;
  fecha: string;
  descripcion: string;
  monto: number | string;
  saldo: number | string | null;
  documento: string;
  categoria: string;
  comentario: string;
  asignado: number | string;
  pendiente: number | string;
  asignaciones: {
    id: number; monto: number | string;
    pedido: number | null; pedido_cliente: string | null;
    factura: string | null; factura_proveedor: string | null;
  }[];
  gastos: number[];
}

type Opcion = { value: string; label: string };

// Palabras de 4+ letras del texto, para cruzar la glosa del banco con nombres.
const palabras = (t: string) =>
  new Set(t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().match(/[A-Z]{4,}/g) ?? []);

const coincide = (glosa: Set<string>, nombre: string) => [...palabras(nombre)].some((p) => glosa.has(p));

export function MovimientosBanco() {
  const queryClient = useQueryClient();
  const [cargaAbierta, setCargaAbierta] = useState(false);
  const [tipo, setTipo] = useState<'todos' | 'abonos' | 'cargos'>('todos');
  const [estado, setEstado] = useState<'todos' | 'pendientes' | 'asociados'>('pendientes');
  const [buscar, setBuscar] = useState('');
  const [abierto, setAbierto] = useState<Movimiento | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const movQ = useQuery({
    queryKey: ['movimientos-banco'],
    queryFn: async () => (await getMovimientosBanco()).data as { movimientos: Movimiento[]; categorias: Opcion[] },
  });
  const cartolasQ = useQuery({ queryKey: ['cartolas'], queryFn: async () => (await getCartolas()).data as any[] });

  const categorias = movQ.data?.categorias ?? [];
  const movimientos = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (movQ.data?.movimientos ?? []).filter((m) => {
      const monto = Number(m.monto);
      if (tipo === 'abonos' && monto <= 0) return false;
      if (tipo === 'cargos' && monto >= 0) return false;
      const resuelto = Number(m.pendiente) <= 0.5 || m.gastos.length > 0 || !['sin_clasificar', 'venta', 'proveedor'].includes(m.categoria);
      if (estado === 'pendientes' && resuelto) return false;
      if (estado === 'asociados' && !resuelto) return false;
      return !q || m.descripcion.toLowerCase().includes(q) || m.comentario.toLowerCase().includes(q) || String(Math.abs(monto)).includes(q.replace(/\D/g, '') || '§');
    });
  }, [movQ.data, tipo, estado, buscar]);

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ['movimientos-banco'] });
    queryClient.invalidateQueries({ queryKey: ['cartolas'] });
    queryClient.invalidateQueries({ queryKey: ['contabilidad'] });
  };

  // Mantiene sincronizado el diálogo abierto con la lista recargada.
  useEffect(() => {
    if (abierto) {
      const nuevo = movQ.data?.movimientos.find((m) => m.id === abierto.id);
      if (nuevo && nuevo !== abierto) setAbierto(nuevo);
    }
  }, [movQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (movQ.isLoading) return <LoadingSpinner />;

  const total = movQ.data?.movimientos.length ?? 0;

  return (
    <div className="space-y-4">
      {confirmDialog}
      <CargarCartolaDialog open={cargaAbierta} onOpenChange={setCargaAbierta} onImportada={refrescar} />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setCargaAbierta(true)}>
          <FileUp className="mr-2 h-4 w-4" /> Subir cartola
        </Button>
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar glosa, comentario o monto…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todo</SelectItem>
            <SelectItem value="abonos">Entradas</SelectItem>
            <SelectItem value="cargos">Salidas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={estado} onValueChange={(v) => setEstado(v as typeof estado)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pendientes">Por revisar</SelectItem>
            <SelectItem value="asociados">Revisados</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">Aún no hay movimientos</p>
          <p className="mt-1 text-sm text-muted-foreground">Sube la cartola de tu banco en Excel, CSV o PDF para empezar a conciliar.</p>
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {movimientos.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nada por aquí con estos filtros.</p>}
          {movimientos.map((m) => {
            const monto = Number(m.monto);
            const asignado = Number(m.asignado);
            return (
              <button
                key={m.id}
                onClick={() => setAbierto(m)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/40 sm:px-4"
              >
                <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', monto > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                  {monto > 0 ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.descripcion}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {formatFecha(m.fecha)}
                    <span>· {categorias.find((c) => c.value === m.categoria)?.label}</span>
                    {m.asignaciones.length > 0 && (
                      <span className="flex items-center gap-0.5"><Link2 className="h-3 w-3" />
                        {m.asignaciones.map((a) => (a.pedido ? `#${a.pedido}` : `F${a.factura}`)).join(', ')}
                      </span>
                    )}
                    {m.comentario && <MessageSquare className="h-3 w-3" aria-label="Tiene comentario" />}
                  </span>
                </span>
                <span className="text-right">
                  <span className={cn('block font-semibold tabular-nums', monto > 0 ? 'text-green-700' : 'text-foreground')}>
                    {monto > 0 ? '+' : '−'}{formatCLP(Math.abs(monto))}
                  </span>
                  {asignado > 0 && Number(m.pendiente) > 0.5 && (
                    <span className="text-[11px] text-amber-700">falta {formatCLP(m.pendiente)}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {(cartolasQ.data ?? []).length > 0 && (
        <details className="rounded-xl border bg-card p-4 text-sm">
          <summary className="cursor-pointer font-medium">Cartolas subidas ({cartolasQ.data!.length})</summary>
          <ul className="mt-3 space-y-2">
            {cartolasQ.data!.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {c.nombre_archivo}
                  <span className="text-muted-foreground"> · {formatFecha(c.subida)} · {c.movimientos_actuales} movimientos</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={`Eliminar cartola ${c.nombre_archivo}`}
                  onClick={() => confirm({
                    title: '¿Eliminar esta cartola?',
                    description: `Se borran sus ${c.movimientos_actuales} movimientos y sus asociaciones con pedidos y facturas.`,
                    confirmLabel: 'Eliminar',
                    destructive: true,
                    onConfirm: async () => { await deleteCartola(c.id); refrescar(); },
                  })}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <MovimientoDialog movimiento={abierto} categorias={categorias} onClose={() => setAbierto(null)} onCambio={refrescar} />
    </div>
  );
}

function MovimientoDialog({
  movimiento: m, categorias, onClose, onCambio,
}: {
  movimiento: Movimiento | null;
  categorias: Opcion[];
  onClose: () => void;
  onCambio: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [comentario, setComentario] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [elegido, setElegido] = useState<string | null>(null);
  const [montoTexto, setMontoTexto] = useState('');
  const [marcarPagado, setMarcarPagado] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const esAbono = m ? Number(m.monto) > 0 : true;
  const pedidosQ = useQuery({ queryKey: ['pedidos'], queryFn: async () => (await getPedidos(true)).data as Pedido[], enabled: !!m && esAbono });
  const facturasQ = useQuery({ queryKey: ['facturas'], queryFn: async () => (await getFacturas()).data as Factura[], enabled: !!m && !esAbono });

  useEffect(() => {
    setComentario(m?.comentario ?? '');
    setBusqueda('');
    setElegido(null);
    setMontoTexto('');
  }, [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Candidatos ordenados: primero los que cuadran en monto y nombre con la glosa.
  const candidatos = useMemo(() => {
    if (!m) return [];
    const glosa = palabras(`${m.descripcion} ${m.comentario}`);
    const montoMov = Number(m.pendiente);
    const q = busqueda.trim().toLowerCase().replace(/^#/, '');
    const lista = esAbono
      ? (pedidosQ.data ?? [])
          .filter((p) => p.estado !== 'Anulado')
          .map((p) => ({
            id: String(p.id),
            titulo: `#${p.id} · ${p.cliente.nombre}`,
            detalle: `${formatFecha(p.fecha)} · ${p.estado === 'Pagado' ? 'pagado' : 'por cobrar'}`,
            pendiente: Number(p.total) - Number(p.pagado_banco ?? 0),
            nombre: p.cliente.nombre,
            buscable: `${p.id} ${p.cliente.nombre}`.toLowerCase(),
          }))
      : (facturasQ.data ?? []).map((f) => ({
          id: f.numero_factura,
          titulo: `Factura ${f.numero_factura} · ${f.proveedor_nombre}`,
          detalle: `${formatFecha(f.fecha)} · ${f.pago_factura ? 'pagada' : 'pendiente'}`,
          pendiente: totalAPagar(f),
          nombre: f.proveedor_nombre ?? '',
          buscable: `${f.numero_factura} ${f.proveedor_nombre}`.toLowerCase(),
        }));
    return lista
      .filter((c) => (q ? c.buscable.includes(q) : c.pendiente > 0.5))
      .map((c) => ({ ...c, puntaje: (Math.abs(c.pendiente - montoMov) < 1 ? 2 : 0) + (coincide(glosa, c.nombre) ? 1 : 0) }))
      .sort((a, b) => b.puntaje - a.puntaje || Math.abs(a.pendiente - montoMov) - Math.abs(b.pendiente - montoMov))
      .slice(0, 8);
  }, [m, esAbono, pedidosQ.data, facturasQ.data, busqueda]);

  if (!m) return null;
  const monto = Number(m.monto);

  const accion = async (fn: () => Promise<unknown>, ok?: string) => {
    setGuardando(true);
    try {
      await fn();
      if (ok) toast({ title: ok });
      onCambio();
      queryClient.invalidateQueries({ queryKey: esAbono ? ['pedidos'] : ['facturas'] });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'No se pudo guardar', variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  };

  const elegir = (c: (typeof candidatos)[number]) => {
    setElegido(c.id);
    setMontoTexto(String(Math.round(Math.min(Number(m.pendiente), Math.max(c.pendiente, 0)) || Number(m.pendiente))));
  };

  const asociar = () =>
    accion(async () => {
      await asignarMovimiento(m.id, {
        ...(esAbono ? { pedido: Number(elegido) } : { factura: elegido! }),
        monto: parseDecimal(montoTexto),
        marcar_pagado: marcarPagado,
      });
      setElegido(null);
      setMontoTexto('');
    }, 'Asociado');

  const comoGasto = () =>
    accion(() => createGasto({
      fecha: m.fecha, descripcion: m.descripcion, categoria: 'otro', total: Math.abs(monto),
      con_factura: false, movimiento: m.id, comentario: m.comentario,
    }), 'Registrado como gasto (edítalo en la pestaña Gastos)');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={cn('tabular-nums', monto > 0 ? 'text-green-700' : '')}>
            {monto > 0 ? '+' : '−'}{formatCLP(Math.abs(monto))}
          </DialogTitle>
          <DialogDescription>{formatFecha(m.fecha)} · {m.descripcion}{m.documento ? ` · doc ${m.documento}` : ''}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label>Categoría</Label>
            <Select value={m.categoria} onValueChange={(v) => accion(() => updateMovimientoBanco(m.id, { categoria: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categorias.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="comentario">Comentario</Label>
            <Textarea id="comentario" rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Ej: pago de 2 pedidos de la semana" />
            {comentario !== m.comentario && (
              <Button size="sm" variant="secondary" disabled={guardando} onClick={() => accion(() => updateMovimientoBanco(m.id, { comentario }), 'Comentario guardado')}>
                Guardar comentario
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label>{esAbono ? 'Pedidos pagados con este abono' : 'Facturas pagadas con este cargo'}</Label>
            {m.asignaciones.length === 0 && <p className="text-sm text-muted-foreground">Sin asociar.</p>}
            {m.asignaciones.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span>{a.pedido ? `Pedido #${a.pedido} · ${a.pedido_cliente}` : `Factura ${a.factura} · ${a.factura_proveedor}`}</span>
                <span className="flex items-center gap-1">
                  <b className="tabular-nums">{formatCLP(a.monto)}</b>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Quitar asociación" onClick={() => accion(() => deleteAsignacion(a.id))}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </div>
            ))}

            {Number(m.pendiente) > 0.5 && (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Quedan {formatCLP(m.pendiente)} por asociar. Sugerencias según monto y nombre:</p>
                <Input placeholder={esAbono ? 'Buscar pedido o cliente…' : 'Buscar factura o proveedor…'} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                <div className="space-y-1">
                  {candidatos.length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">Sin coincidencias.</p>}
                  {candidatos.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => elegir(c)}
                      className={cn('flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50', elegido === c.id && 'border-primary bg-primary/5')}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.titulo}</span>
                        <span className="text-xs text-muted-foreground">{c.detalle}</span>
                      </span>
                      <span className="ml-2 shrink-0 text-right">
                        <span className="block tabular-nums">{formatCLP(c.pendiente)}</span>
                        {c.puntaje >= 2 && <Badge className="border-none bg-green-100 text-[10px] text-green-700">monto exacto</Badge>}
                      </span>
                    </button>
                  ))}
                </div>
                {elegido && (
                  <div className="space-y-2 border-t pt-2">
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Monto a asociar</Label>
                        <DecimalInput value={montoTexto} onValueChange={setMontoTexto} />
                      </div>
                      <Button disabled={guardando || parseDecimal(montoTexto) <= 0} onClick={asociar}>
                        <Link2 className="mr-1 h-4 w-4" /> Asociar
                      </Button>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={marcarPagado} onCheckedChange={(v) => setMarcarPagado(v === true)} />
                      {esAbono ? 'Marcar el pedido como pagado si queda cubierto' : 'Registrar el pago de la factura'}
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          {!esAbono && m.gastos.length === 0 && m.asignaciones.length === 0 && (
            <Button variant="outline" className="w-full" disabled={guardando} onClick={comoGasto}>
              Registrar como gasto de la empresa
            </Button>
          )}
          {m.gastos.length > 0 && <p className="text-sm text-muted-foreground">Registrado como gasto.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

