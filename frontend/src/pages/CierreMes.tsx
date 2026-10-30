import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { AlertTriangle, Download, FileWarning, HandCoins, Receipt, Search, TrendingUp, Wallet } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatCard } from '@/components/shared/StatCard';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { DetallePedidoCierre, Etiqueta } from '@/components/cierre/DetallePedidoCierre';
import { DocumentosSII } from '@/components/cierre/DocumentosSII';
import { getVendedores, getVentasMes } from '@/services/api';
import { cn, formatCLP, formatFecha } from '@/lib/utils';
import {
  ETIQUETA_COBRO, ETIQUETA_TRIBUTARIO, MEDIOS_PAGO, mesActual, nombreMes,
  type PedidoCierre, type VentasMes,
} from '@/lib/cierre';

type Filtro = 'todos' | 'por_cobrar' | 'sin_documento' | 'alertas';

export default function CierreMes() {
  const [mes, setMes] = useState(mesActual());
  const [vendedor, setVendedor] = useState('todos');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [seleccionado, setSeleccionado] = useState<number | null>(null);

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: async () => (await getVendedores()).data });
  const { data, isLoading, error } = useQuery({
    queryKey: ['cierre-ventas', mes, vendedor],
    queryFn: async () => (await getVentasMes({ mes, vendedor: vendedor === 'todos' ? undefined : vendedor })).data as VentasMes,
  });

  const pedidos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (data?.pedidos ?? []).filter((p) => {
      if (filtro === 'por_cobrar' && p.estado_cobro === 'pagado') return false;
      if (filtro === 'sin_documento' && p.estado_tributario === 'emitido') return false;
      if (filtro === 'alertas' && p.alertas.length === 0) return false;
      return !q || p.cliente.nombre.toLowerCase().includes(q) || String(p.id) === q;
    });
  }, [data, filtro, busqueda]);

  // Se busca por id en los datos frescos para que el panel se actualice al registrar algo.
  const pedidoAbierto = data?.pedidos.find((p) => p.id === seleccionado) ?? null;

  const exportar = () => {
    if (!data) return;
    const ventas = data.pedidos.flatMap((p) => p.lineas.map((l, i) => ({
      'Pedido': p.id, 'Fecha venta': formatFecha(p.fecha), 'Cliente': p.cliente.nombre, 'RUT cliente': p.cliente.rut,
      'Tipo cliente': p.cliente.tipo, 'Producto': l.producto, 'Kilos': Number(l.kilos), 'Unidades': Number(l.unidades ?? 0),
      'Precio/kg con IVA': Number(l.precio_venta), 'Total línea con IVA': Number(l.total), 'Costo línea neto': Number(l.costo),
      // Los totales del pedido solo en su primera línea, para que sumar la columna no los duplique.
      'Total pedido con IVA': i === 0 ? Number(p.total) : null, 'Neto pedido': i === 0 ? Number(p.neto) : null,
      'IVA pedido': i === 0 ? Number(p.iva) : null, 'Margen pedido': i === 0 ? Number(p.margen) : null,
      'Vendedor': p.vendedor?.nombre ?? '', 'Cobrado': i === 0 ? Number(p.cobrado) : null,
      'Estado cobro': ETIQUETA_COBRO[p.estado_cobro].texto, 'Documento requerido': p.documento_requerido,
      'Documento emitido': p.documentos.map((d) => `${d.tipo_nombre} ${d.folio} (${formatFecha(d.fecha_emision)})`).join(', '),
      'Estado tributario': ETIQUETA_TRIBUTARIO[p.estado_tributario].texto, 'Alertas': p.alertas.join('; '),
    })));
    const cobros = data.pedidos.flatMap((p) => p.cobros.map((c) => ({
      'Pedido': p.id, 'Cliente': p.cliente.nombre, 'Fecha cobro': formatFecha(c.fecha), 'Monto': Number(c.monto),
      'Medio': MEDIOS_PAGO.find((m) => m.value === c.medio)?.label ?? c.medio,
      'Recibió': c.receptor === 'empresa' ? 'Cuenta de la empresa' : c.vendedor_nombre ?? '',
      'Desde cartola': c.desde_banco ? 'Sí' : 'No', 'Comentario': c.comentario,
    })));
    const r = data.resumen;
    const resumen = [
      ['Mes', nombreMes(data.mes)], ['Ventas con IVA', Number(r.ventas_total)], ['Ventas netas', Number(r.ventas_netas)],
      ['IVA débito según ventas', Number(r.iva_debito_teorico)], ['IVA débito según documentos emitidos', Number(r.iva_debito_documentos)],
      ['Cobrado de las ventas del mes', Number(r.cobrado)], ['Por cobrar', Number(r.saldo_pendiente)],
      ['Costo de lo vendido', Number(r.costo)], ['Margen bruto', Number(r.margen)], ['Cantidad de ventas', r.cantidad],
      ['Con documento', r.con_documento], ['Sin documento', r.sin_documento], ['Por revisar', r.por_revisar],
    ];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(resumen), 'Resumen');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(ventas), 'Ventas');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(cobros), 'Cobros');
    XLSX.writeFile(libro, `cierre-${data.mes}.xlsx`);
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Cierre de mes</h1>
          <p className="text-muted-foreground">Ventas, cobros y documentos tributarios de {nombreMes(mes)}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input type="month" value={mes} max={mesActual()} onChange={(e) => e.target.value && setMes(e.target.value)} className="w-[160px]" />
          <Select value={vendedor} onValueChange={setVendedor}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los vendedores</SelectItem>
              {vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportar} disabled={!data}><Download className="h-4 w-4 mr-2" />Excel</Button>
        </div>
      </div>

      {isLoading ? <LoadingSpinner /> : error || !data ? <ErrorMessage message="No se pudo cargar el cierre" /> : (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <StatCard title="Ventas del mes" value={formatCLP(data.resumen.ventas_total)} icon={TrendingUp}
              description={`${data.resumen.cantidad} ventas · neto ${formatCLP(data.resumen.ventas_netas)}`} />
            <StatCard title="Por cobrar" value={formatCLP(data.resumen.saldo_pendiente)} icon={HandCoins}
              accent={Number(data.resumen.saldo_pendiente) > 0 ? 'text-orange-600' : 'text-green-600'}
              description={`Cobrado ${formatCLP(data.resumen.cobrado)}`} onClick={() => setFiltro('por_cobrar')} />
            <StatCard title="Sin documento" value={data.resumen.sin_documento + data.resumen.por_revisar} icon={FileWarning}
              accent={data.resumen.sin_documento + data.resumen.por_revisar > 0 ? 'text-destructive' : 'text-green-600'}
              description={`${data.resumen.con_documento} con boleta o factura · ${data.resumen.por_revisar} por revisar`}
              onClick={() => setFiltro('sin_documento')} />
            <StatCard title="Margen bruto" value={formatCLP(data.resumen.margen)} icon={Wallet}
              description={`${data.resumen.margen_pct ?? 0}% sobre el neto · costo ${formatCLP(data.resumen.costo)}`} />
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" />IVA de ventas</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3 text-sm">
              <div><p className="text-muted-foreground">Según las ventas</p><p className="text-lg font-bold tabular-nums">{formatCLP(data.resumen.iva_debito_teorico)}</p></div>
              <div><p className="text-muted-foreground">Según documentos emitidos</p><p className="text-lg font-bold tabular-nums">{formatCLP(data.resumen.iva_debito_documentos)}</p></div>
              <div>
                <p className="text-muted-foreground">Diferencia</p>
                <p className={cn('text-lg font-bold tabular-nums',
                  Math.abs(Number(data.resumen.iva_debito_teorico) - Number(data.resumen.iva_debito_documentos)) > 2 && 'text-amber-600')}>
                  {formatCLP(Number(data.resumen.iva_debito_teorico) - Number(data.resumen.iva_debito_documentos))}
                </p>
                <p className="text-xs text-muted-foreground">El F29 se declara con lo emitido. Una diferencia indica ventas sin documento.</p>
              </div>
            </CardContent>
          </Card>

          {data.resumen.pagado_sin_cobro > 0 && (
            <button onClick={() => setFiltro('alertas')}
              className="flex w-full items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {data.resumen.pagado_sin_cobro} pedido(s) están marcados Pagado pero no tienen el cobro registrado (monto, fecha y quién lo recibió).
            </button>
          )}

          <Tabs defaultValue="ventas" className="space-y-4">
            <TabsList>
              <TabsTrigger value="ventas">Ventas</TabsTrigger>
              <TabsTrigger value="documentos">Documentos SII{data.documentos_sin_pedido.length > 0 && ` (${data.documentos_sin_pedido.length})`}</TabsTrigger>
              <TabsTrigger value="vendedores">Por vendedor</TabsTrigger>
            </TabsList>

            <TabsContent value="ventas" className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px] max-w-sm">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Cliente o N° de pedido" className="pl-8" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                </div>
                {([['todos', 'Todas'], ['por_cobrar', 'Por cobrar'], ['sin_documento', 'Sin documento'], ['alertas', 'Con alertas']] as [Filtro, string][]).map(([v, t]) => (
                  <Button key={v} size="sm" variant={filtro === v ? 'default' : 'outline'} onClick={() => setFiltro(v)}>{t}</Button>
                ))}
              </div>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="hidden md:table-cell">Vendedor</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right hidden lg:table-cell">Margen</TableHead>
                      <TableHead>Cobro</TableHead>
                      <TableHead>Documento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pedidos.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="h-20 text-center text-muted-foreground">No hay ventas con este filtro</TableCell></TableRow>
                    ) : pedidos.map((p) => <FilaPedido key={p.id} p={p} onClick={() => setSeleccionado(p.id)} />)}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="documentos">
              <DocumentosSII mes={data.mes} pedidos={data.pedidos} sinPedido={data.documentos_sin_pedido} />
            </TabsContent>

            <TabsContent value="vendedores" className="space-y-4">
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Vendedor</TableHead><TableHead className="text-right">Ventas</TableHead><TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Cobrado</TableHead><TableHead className="text-right">Por cobrar</TableHead><TableHead className="text-right">Margen</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.por_vendedor.map((v) => (
                      <TableRow key={v.vendedor ?? 'sin'}>
                        <TableCell className="font-medium">{v.nombre}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.cantidad}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCLP(v.ventas_total)}</TableCell>
                        <TableCell className="text-right tabular-nums text-green-600">{formatCLP(v.cobrado)}</TableCell>
                        <TableCell className={cn('text-right tabular-nums', Number(v.saldo_pendiente) > 0 && 'text-orange-600')}>{formatCLP(v.saldo_pendiente)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCLP(v.margen)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Plata recibida en el mes</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {data.recibido_por.length === 0 ? <p className="text-muted-foreground">Sin cobros registrados con fecha de este mes.</p> :
                    data.recibido_por.map((r) => (
                      <div key={r.nombre} className="flex justify-between"><span>{r.nombre}</span><span className="tabular-nums font-medium">{formatCLP(r.monto)}</span></div>
                    ))}
                  <p className="pt-2 text-xs text-muted-foreground">Incluye cobros de ventas de meses anteriores. Mientras no exista cuenta de la empresa, esta plata la tiene cada vendedor.</p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <DetallePedidoCierre pedido={pedidoAbierto} receptorPorDefecto={data.config.receptor_cobro} onClose={() => setSeleccionado(null)} />
        </>
      )}
    </div>
  );
}

function FilaPedido({ p, onClick }: { p: PedidoCierre; onClick: () => void }) {
  return (
    <TableRow className="cursor-pointer" onClick={onClick}>
      <TableCell>
        <p className="font-medium">#{p.id}</p>
        <p className="text-xs text-muted-foreground">{formatFecha(p.fecha)}</p>
      </TableCell>
      <TableCell>
        <p className="font-medium flex items-center gap-1">
          {p.cliente.nombre}
          {p.alertas.length > 0 && <span title={p.alertas.join('\n')}><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /></span>}
        </p>
        <p className="text-xs text-muted-foreground capitalize">{p.cliente.tipo}</p>
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm">{p.vendedor?.nombre ?? '—'}</TableCell>
      <TableCell className="text-right tabular-nums font-medium">{formatCLP(p.total)}</TableCell>
      <TableCell className="text-right tabular-nums hidden lg:table-cell">
        {formatCLP(p.margen)}<span className="block text-xs text-muted-foreground">{p.margen_pct ?? 0}%</span>
      </TableCell>
      <TableCell>
        <Etiqueta {...ETIQUETA_COBRO[p.estado_cobro]} />
        {p.estado_cobro !== 'pagado' && <p className="text-xs text-muted-foreground tabular-nums mt-0.5">debe {formatCLP(p.saldo)}</p>}
      </TableCell>
      <TableCell>
        <Etiqueta {...ETIQUETA_TRIBUTARIO[p.estado_tributario]} />
        <p className="text-xs text-muted-foreground mt-0.5">
          {p.documentos.length ? p.documentos.map((d) => `${d.tipo === 33 ? 'F' : d.tipo === 39 ? 'B' : d.tipo} ${d.folio}`).join(', ') : `pidió ${p.documento_requerido.toLowerCase()}`}
        </p>
      </TableCell>
    </TableRow>
  );
}
