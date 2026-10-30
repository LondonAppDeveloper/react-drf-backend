import { useMemo, useState } from 'react';
import { Search, AlertTriangle, Package, Scale, TrendingUp, Coins, Snowflake } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToast } from '@/hooks/use-toast';
import { resumenPreReservas } from '@/lib/preReservas';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getStock, getMargenProductos, getMovimientosCongelado, moverStockCongelado } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { StatCard } from '@/components/shared/StatCard';
import type { MargenProducto, StockItem } from '@/types';
import { formatCLP, parseDecimal } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Mismo umbral que las alertas del Resumen.
const UMBRAL_STOCK_BAJO = 10;

type Filtro = 'todos' | 'bajo' | 'reservado' | 'congelado' | 'prereserva';

export default function Stock() {
  const [search, setSearch] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [moverItem, setMoverItem] = useState<StockItem | null>(null);
  const [direccion, setDireccion] = useState<'congelar' | 'descongelar'>('congelar');
  const [unidadesTxt, setUnidadesTxt] = useState('');
  const [kilosTxt, setKilosTxt] = useState('');
  const [razon, setRazon] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['stock'],
    queryFn: async () => (await getStock()).data,
    refetchOnMount: true,
  });
  // costo_reciente viene CON IVA, igual que precio_por_kilo: se pueden comparar directo.
  const { data: margenes } = useQuery({
    queryKey: ['margen-productos'],
    queryFn: async () => (await getMargenProductos()).data as MargenProducto[],
  });
  const { data: movimientos } = useQuery({
    queryKey: ['movimientos-congelado'],
    queryFn: async () => (await getMovimientosCongelado()).data,
  });
  const costoPorId = useMemo(() => {
    const m = new Map<number, number>();
    (margenes ?? []).forEach((r) => r.costo_reciente != null && m.set(r.producto_id, Number(r.costo_reciente)));
    return m;
  }, [margenes]);

  const stock: StockItem[] = Array.isArray(data) ? data : [];

  const filteredStock = useMemo(() => {
    const q = search.toLowerCase();
    return stock
      .filter((item) => item.producto.toLowerCase().includes(q))
      .filter((item) =>
        filtro === 'bajo' ? item.estado === 'disponible' && item.disponibles < UMBRAL_STOCK_BAJO
        : filtro === 'reservado' ? item.reservas > 0
        : filtro === 'congelado' ? (item.congelado_unidades ?? 0) > 0
        : filtro === 'prereserva' ? (item.pre_reservas ?? 0) > 0
        : true
      )
      .sort((a, b) => (b.stock + (b.congelado_unidades ?? 0)) - (a.stock + (a.congelado_unidades ?? 0)));
  }, [stock, search, filtro]);

  const totales = useMemo(() => {
    let venta = 0;
    let costo = 0;
    let kilos = 0;
    let sinCosto = 0;
    filteredStock.forEach((item) => {
      const kg = Number(item.kilos_actuales);
      kilos += kg;
      venta += kg * Number(item.precio_por_kilo);
      const c = costoPorId.get(item.id);
      if (c != null) costo += kg * c;
      else if (kg > 0) sinCosto += 1;
    });
    return { venta, costo, kilos, sinCosto };
  }, [filteredStock, costoPorId]);

  const totalCongelado = stock.reduce((s, i) => s + (i.congelado_unidades ?? 0), 0);
  const kilosCongelado = stock.reduce((s, i) => s + Number(i.congelado_kilos ?? 0), 0);
  const totalPreReservas = stock.reduce((s, i) => s + (i.pre_reservas ?? 0), 0);

  const abrirMover = (item: StockItem) => {
    setMoverItem(item);
    setDireccion('congelar');
    setUnidadesTxt('');
    setKilosTxt('');
    setRazon('');
  };

  const moverMutation = useMutation({
    mutationFn: () => {
      if (!moverItem) throw new Error('Sin producto');
      const kilos = parseDecimal(kilosTxt);
      return moverStockCongelado({
        producto: moverItem.id,
        cantidad_unidades: Math.trunc(parseDecimal(unidadesTxt)),
        ...(kilos > 0 ? { cantidad_kilos: kilos } : {}),
        direccion: direccion,
        razon: razon.trim() || undefined,
      });
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['movimientos-congelado'] });
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      queryClient.invalidateQueries({ queryKey: ['auditoria-pre-reservas'] });
      const asignadas = resumenPreReservas(response.data?.pre_reservas_asignadas);
      toast({
        title: direccion === 'congelar' ? 'Stock congelado' : 'Stock descongelado',
        description: asignadas || 'El movimiento quedó registrado.',
        className: 'whitespace-pre-line',
      });
      setMoverItem(null);
    },
    onError: (err: any) => {
      toast({
        title: 'No se pudo mover el stock',
        description: err?.response?.data?.error ?? err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    },
  });

  const disponibleOrigen = moverItem
    ? direccion === 'congelar' ? moverItem.disponibles : Math.max((moverItem.congelado_unidades ?? 0) - (moverItem.congelado_reservas ?? 0), 0)
    : 0;
  const unidadesMover = Math.trunc(parseDecimal(unidadesTxt));

  const itemsBajos = stock.filter((item) => item.estado === 'disponible' && item.disponibles < UMBRAL_STOCK_BAJO).length;

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudo cargar el inventario" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Stock</h1>
        <p className="text-muted-foreground">Unidades disponibles, reservadas por pedidos y kilos en bodega.</p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Valor a costo"
          value={formatCLP(totales.costo)}
          icon={Coins}
          description={totales.sinCosto ? `${totales.sinCosto} cortes sin costo de compra` : 'Último costo de compra, con IVA'}
        />
        <StatCard
          title="Valor a precio de venta"
          value={formatCLP(totales.venta)}
          icon={TrendingUp}
          accent="text-green-600"
          description={totales.costo > 0 ? `Ganancia potencial ${formatCLP(totales.venta - totales.costo)} (con IVA)` : 'Precio vigente, con IVA'}
        />
        <StatCard
          title="Kilos en bodega"
          value={`${totales.kilos.toLocaleString('es-CL', { maximumFractionDigits: 1 })} kg`}
          icon={Scale}
          accent="text-blue-600"
        />
        <StatCard
          title="Congelado"
          value={`${totalCongelado} un.`}
          icon={Snowflake}
          accent="text-sky-600"
          description={`${kilosCongelado.toLocaleString('es-CL', { maximumFractionDigits: 1 })} kg · ${totalPreReservas} un. en pre-reserva`}
          onClick={() => setFiltro(filtro === 'congelado' ? 'todos' : 'congelado')}
        />
        <StatCard
          title="Stock bajo"
          value={itemsBajos}
          icon={AlertTriangle}
          accent={itemsBajos > 0 ? 'text-destructive' : undefined}
          description={`Cortes con menos de ${UMBRAL_STOCK_BAJO} unidades`}
          onClick={() => setFiltro(filtro === 'bajo' ? 'todos' : 'bajo')}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filtrar por nombre de producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
          <SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los cortes</SelectItem>
            <SelectItem value="bajo">Solo stock bajo</SelectItem>
            <SelectItem value="reservado">Con reservas</SelectItem>
            <SelectItem value="congelado">Con stock congelado</SelectItem>
            <SelectItem value="prereserva">Con pre-reservas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Producto</TableHead>
              <TableHead className="text-center">Disponibles</TableHead>
              <TableHead className="text-center">Reservas</TableHead>
              <TableHead className="text-center">Pre-reservas</TableHead>
              <TableHead className="text-center">Congelado</TableHead>
              <TableHead className="text-center hidden md:table-cell">Stock físico</TableHead>
              <TableHead className="text-right">Kilos</TableHead>
              <TableHead className="text-right hidden md:table-cell">Peso prom.</TableHead>
              <TableHead className="text-right hidden lg:table-cell">Costo/kg</TableHead>
              <TableHead className="text-right">Precio/kg</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredStock.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">No hay cortes con estos filtros.</TableCell>
              </TableRow>
            )}
            {filteredStock.map((item) => {
              // Peso promedio sobre el stock físico: son las unidades que generan esos kilos.
              const pesoPromedio = item.stock > 0 ? Number(item.kilos_actuales) / item.stock : 0;
              const bajo = item.estado === 'disponible' && item.disponibles < UMBRAL_STOCK_BAJO;
              const costo = costoPorId.get(item.id);
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>{item.producto}</span>
                      {item.estado === 'agotado' && <Badge variant="outline" className="text-[10px] text-muted-foreground">Agotado</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className={`text-center font-bold tabular-nums ${bajo ? 'text-destructive' : 'text-green-600'}`}>
                    {item.disponibles}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={item.reservas > 0 ? 'text-orange-600 border-orange-200 bg-orange-50' : 'text-muted-foreground'}>
                      {item.reservas}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={(item.pre_reservas ?? 0) > 0 ? 'text-amber-700 border-amber-300 bg-amber-50' : 'text-muted-foreground'}>
                      {item.pre_reservas ?? 0}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center tabular-nums whitespace-nowrap">
                    {(item.congelado_unidades ?? 0) > 0 ? (
                      <>
                        <span className="font-bold text-sky-700">{item.congelado_unidades}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {Number(item.congelado_kilos ?? 0).toFixed(2)} kg
                          {(item.congelado_reservas ?? 0) > 0 && ` · ${item.congelado_reservas} res.`}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center font-medium hidden md:table-cell tabular-nums">{item.stock}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                    {Number(item.kilos_actuales).toFixed(2)} <span className="text-[10px] text-muted-foreground">kg</span>
                  </TableCell>
                  <TableCell className="text-right hidden md:table-cell">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help tabular-nums">
                          {pesoPromedio.toFixed(3)}
                          <span className="text-[10px] ml-1 text-muted-foreground">kg/u</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Promedio basado en stock físico ({item.stock} un.)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground hidden lg:table-cell">
                    {costo != null ? formatCLP(costo) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(item.precio_por_kilo)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Congelar o descongelar ${item.producto}`} onClick={() => abrirMover(item)}>
                      <Snowflake className="h-4 w-4 text-sky-600" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {movimientos && movimientos.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Últimos movimientos de congelado</h2>
          <div className="rounded-lg border bg-card divide-y">
            {movimientos.slice(0, 8).map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={m.direccion === 'congelar' ? 'text-sky-700 border-sky-200 bg-sky-50' : 'text-orange-700 border-orange-200 bg-orange-50'}>
                    {m.direccion === 'congelar' ? 'Congelar' : 'Descongelar'}
                  </Badge>
                  <span className="font-medium">{m.producto_nombre}</span>
                  <span className="text-muted-foreground tabular-nums">{m.cantidad_unidades} un. · {Number(m.cantidad_kilos).toFixed(2)} kg</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {m.razon ? `${m.razon} · ` : ''}{m.usuario_nombre ? `${m.usuario_nombre} · ` : ''}
                  {new Date(m.fecha).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!moverItem} onOpenChange={(o) => !o && setMoverItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Snowflake className="h-5 w-5 text-sky-600" /> Congelar / Descongelar</DialogTitle>
            <DialogDescription>
              {moverItem?.producto} · {moverItem?.disponibles} disponibles en inventario · {moverItem?.congelado_unidades ?? 0} congeladas
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ToggleGroup
              type="single"
              variant="outline"
              value={direccion}
              onValueChange={(v) => v && setDireccion(v as 'congelar' | 'descongelar')}
              className="justify-start"
            >
              <ToggleGroupItem value="congelar">Congelar</ToggleGroupItem>
              <ToggleGroupItem value="descongelar">Descongelar</ToggleGroupItem>
            </ToggleGroup>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Unidades</Label>
                <DecimalInput decimales={false} value={unidadesTxt} onValueChange={setUnidadesTxt} className="text-center font-semibold" aria-label="Unidades a mover" />
                <p className="text-[11px] text-muted-foreground">Máximo {disponibleOrigen}</p>
              </div>
              <div className="space-y-1">
                <Label>Kilos (opcional)</Label>
                <DecimalInput value={kilosTxt} onValueChange={setKilosTxt} placeholder="0,000" className="text-center font-semibold" aria-label="Kilos a mover" />
                <p className="text-[11px] text-muted-foreground">Vacío = se estima por el peso promedio del lote</p>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Razón (opcional)</Label>
              <Textarea value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Ej: sobrante de la semana" rows={2} />
            </div>
            {direccion === 'descongelar' && (
              <p className="text-xs text-muted-foreground">Al descongelar, las pre-reservas pendientes de este corte se llenan automáticamente (las más antiguas primero).</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoverItem(null)}>Cancelar</Button>
            <Button
              onClick={() => moverMutation.mutate()}
              disabled={moverMutation.isPending || unidadesMover <= 0 || unidadesMover > disponibleOrigen}
            >
              {moverMutation.isPending ? 'Guardando...' : direccion === 'congelar' ? 'Congelar' : 'Descongelar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
