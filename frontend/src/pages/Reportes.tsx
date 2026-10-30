import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  DollarSign,
  Percent,
  AlertTriangle,
  ShoppingCart,
  Landmark,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import {
  getReporteGanancias,
  getReportePerdidas,
  getFluctuacionPrecios,
  getRentabilidadHistorica,
} from '@/services/api';
import { formatCLP, formatFecha } from '@/lib/utils';
import { StatCard } from '@/components/shared/StatCard';
import { RangoFechaSelect, rangoInicial, type RangoState } from '@/components/shared/RangoFechaSelect';

const clp = formatCLP;

const pct = (n: number | string | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`;

// --- Tipos de respuesta del backend ---
interface GananciaTotal {
  ganancia: number;
  ventas: number;
  costo: number;
  kilos: number;
  margen_pct: number;
  iva_debito: number;
  iva_credito: number;
  iva_a_pagar: number;
}
interface FilaProducto {
  producto_id: number;
  nombre: string;
  ganancia: number;
  ventas: number;
  costo: number;
  kilos: number;
  margen_pct: number;
}
interface FilaMes {
  mes: string;
  ganancia: number;
  ventas: number;
  costo: number;
  iva_debito: number;
  iva_credito: number;
  iva_a_pagar: number;
}
interface FilaVendedor {
  vendedor_id: number | null;
  nombre: string;
  ganancia: number;
  ventas: number;
  margen_pct: number;
}
interface ReporteGanancias {
  total: GananciaTotal;
  por_producto: FilaProducto[];
  por_mes: FilaMes[];
  por_vendedor: FilaVendedor[];
}
interface ReportePerdidas {
  total: { valor: number; kilos: number };
  por_producto: { producto_id: number; nombre: string; kilos: number; valor: number }[];
  por_mes: { mes: string; kilos: number; valor: number }[];
}
interface TramoRentabilidad {
  precio: number;
  costo_por_kilo: number | null;
  costo_unitario: number | null;
  ganancia_unitaria: number | null;
  desde: string | null;
  hasta: string | null;
  vigente: boolean;
  kilos: number;
  ventas: number;
  costo: number;
  ganancia: number;
  margen_pct: number | null;
}

export default function Reportes() {
  const [periodo, setPeriodo] = useState<RangoState>(rangoInicial('anio'));
  const rango = periodo.rango;

  const {
    data: ganancias,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['reporte-ganancias', rango],
    queryFn: async () => (await getReporteGanancias(rango)).data as ReporteGanancias,
    // Al cambiar el período se mantiene lo anterior en pantalla mientras carga.
    placeholderData: (prev) => prev,
  });

  const { data: perdidas } = useQuery({
    queryKey: ['reporte-perdidas', rango],
    queryFn: async () => (await getReportePerdidas(rango)).data as ReportePerdidas,
    // Al cambiar el período se mantiene lo anterior en pantalla mientras carga.
    placeholderData: (prev) => prev,
  });

  const [productoFluct, setProductoFluct] = useState<string>('');

  const { data: fluctuacion } = useQuery({
    queryKey: ['fluctuacion-precios', productoFluct],
    queryFn: async () =>
      (await getFluctuacionPrecios(productoFluct || undefined)).data as {
        productos: { id: number; nombre: string }[];
        producto_id: number | null;
        compras: { fecha: string; costo: number; numero_factura: string }[];
        ventas: { fecha: string; precio: number }[];
      },
  });

  // Serie combinada compra/venta para el gráfico de fluctuación. Cada compra es
  // un punto propio (una factura real), por lo que se le da una clave única
  // aunque comparta fecha con otra factura o con un punto de venta — así no se
  // pisan entre sí y se ven todos los costos de factura individualmente.
  const serieFluct = useMemo(() => {
    if (!fluctuacion) return [];
    const map = new Map<string, { fecha: string; costo?: number; precio?: number; numero_factura?: string }>();
    fluctuacion.compras.forEach((c, i) => {
      map.set(`compra-${i}-${c.fecha}`, {
        fecha: c.fecha,
        costo: Number(c.costo),
        numero_factura: c.numero_factura,
      });
    });
    for (const v of fluctuacion.ventas) {
      map.set(`venta-${v.fecha}`, { ...(map.get(`venta-${v.fecha}`) || { fecha: v.fecha }), precio: Number(v.precio) });
    }
    return Array.from(map.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [fluctuacion]);

  const [productoRentabilidad, setProductoRentabilidad] = useState<string>('');

  const { data: rentabilidad } = useQuery({
    queryKey: ['rentabilidad-historica', productoRentabilidad],
    queryFn: async () =>
      (await getRentabilidadHistorica(productoRentabilidad || undefined)).data as {
        productos: { id: number; nombre: string }[];
        producto_id: number | null;
        periodos: TramoRentabilidad[];
      },
  });

  const tramoLabel = (t: TramoRentabilidad) =>
    `${clp(t.precio)} / costo ${t.costo_unitario != null ? clp(t.costo_unitario) : 'N/A'}`;

  const tramoRango = (t: TramoRentabilidad) => {
    const desde = t.desde ? formatFecha(t.desde) : 'Inicio';
    const hasta = t.hasta ? formatFecha(t.hasta) : 'Hoy';
    return `${desde} – ${hasta}`;
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Error al cargar los reportes" />;

  const total = ganancias?.total;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Reportes</h1>
          <p className="text-muted-foreground">
            Rentabilidad por corte, vendedor y mes, neta de IVA. No incluye pedidos anulados.
          </p>
        </div>
        <RangoFechaSelect value={periodo} onChange={setPeriodo} />
      </div>

      {/* TARJETAS DE RESUMEN */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Ganancia Total"
          value={clp(total?.ganancia)}
          description="Venta sin IVA − costo sin IVA"
          icon={TrendingUp}
          accent={Number(total?.ganancia) >= 0 ? 'text-green-600' : 'text-destructive'}
        />
        <StatCard title="Ventas Totales" value={clp(total?.ventas)} description="Ingresos sin IVA" icon={DollarSign} />
        <StatCard
          title="Margen Promedio"
          value={pct(total?.margen_pct)}
          description="Ganancia / Ventas"
          icon={Percent}
          accent="text-blue-600"
        />
        <StatCard
          title={Number(total?.iva_a_pagar) >= 0 ? 'IVA a Pagar' : 'IVA a Favor'}
          value={clp(Math.abs(Number(total?.iva_a_pagar ?? 0)))}
          description="Débito de venta − crédito de compra"
          icon={Landmark}
          accent={Number(total?.iva_a_pagar) >= 0 ? 'text-amber-600' : 'text-blue-600'}
        />
        <StatCard
          title="Pérdidas (Mermas)"
          value={clp(perdidas?.total.valor)}
          description={`${Number(perdidas?.total.kilos ?? 0).toLocaleString('es-CL')} kg mermados`}
          icon={AlertTriangle}
          accent="text-destructive"
        />
      </div>

      {/* VISTAS DETALLADAS */}
      <Tabs defaultValue="mensual" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="mensual">Mensual</TabsTrigger>
          <TabsTrigger value="producto">Por Corte</TabsTrigger>
          <TabsTrigger value="vendedor">Por Vendedor</TabsTrigger>
          <TabsTrigger value="perdidas">Pérdidas</TabsTrigger>
          <TabsTrigger value="fluctuacion">Fluctuación de Precios</TabsTrigger>
          <TabsTrigger value="rentabilidad">Rentabilidad por Precio</TabsTrigger>
        </TabsList>

        {/* --- MENSUAL --- */}
        <TabsContent value="mensual" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Ganancia por Mes</CardTitle>
            </CardHeader>
            <CardContent>
              {ganancias && ganancias.por_mes.length > 0 ? (
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={ganancias.por_mes}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="mes" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={(v) => clp(v)} width={80} />
                    <ReTooltip formatter={(v: number) => clp(v)} />
                    <Legend />
                    <Bar dataKey="ventas" name="Ventas" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="ganancia" name="Ganancia" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-muted-foreground py-10">Sin datos.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>IVA por Mes (Formulario 29)</CardTitle>
              <p className="text-xs text-muted-foreground">
                Débito fiscal (IVA recargado en las ventas) menos crédito fiscal (IVA pagado en las
                compras). Si el neto es negativo, queda como crédito/remanente a favor del negocio.
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mes</TableHead>
                    <TableHead className="text-right">Débito (venta)</TableHead>
                    <TableHead className="text-right">Crédito (compra)</TableHead>
                    <TableHead className="text-right">Neto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(ganancias?.por_mes ?? []).map((r) => (
                    <TableRow key={r.mes}>
                      <TableCell className="font-medium">{r.mes}</TableCell>
                      <TableCell className="text-right">{clp(r.iva_debito)}</TableCell>
                      <TableCell className="text-right">{clp(r.iva_credito)}</TableCell>
                      <TableCell
                        className={`text-right font-bold ${
                          Number(r.iva_a_pagar) >= 0 ? 'text-amber-600' : 'text-blue-600'
                        }`}
                      >
                        {Number(r.iva_a_pagar) >= 0
                          ? `${clp(r.iva_a_pagar)} a pagar`
                          : `${clp(Math.abs(Number(r.iva_a_pagar)))} a favor`}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(ganancias?.por_mes ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        Sin datos.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- POR PRODUCTO / CORTE --- */}
        <TabsContent value="producto">
          <Card>
            <CardHeader>
              <CardTitle>Ganancia por Corte (Producto)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Corte</TableHead>
                    <TableHead className="text-right">Kilos</TableHead>
                    <TableHead className="text-right">Ventas</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead className="text-right">Ganancia</TableHead>
                    <TableHead className="text-right">Margen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(ganancias?.por_producto ?? []).map((r) => (
                    <TableRow key={r.producto_id}>
                      <TableCell className="font-medium">{r.nombre}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(r.kilos).toLocaleString('es-CL', { maximumFractionDigits: 1 })} kg</TableCell>
                      <TableCell className="text-right">{clp(r.ventas)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{clp(r.costo)}</TableCell>
                      <TableCell
                        className={`text-right font-bold ${
                          Number(r.ganancia) >= 0 ? 'text-green-600' : 'text-destructive'
                        }`}
                      >
                        {clp(r.ganancia)}
                      </TableCell>
                      <TableCell className="text-right">{pct(r.margen_pct)}</TableCell>
                    </TableRow>
                  ))}
                  {(ganancias?.por_producto ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Sin datos.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- POR VENDEDOR --- */}
        <TabsContent value="vendedor">
          <Card>
            <CardHeader>
              <CardTitle>Ganancia por Vendedor</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead>
                    <TableHead className="text-right">Ventas</TableHead>
                    <TableHead className="text-right">Ganancia</TableHead>
                    <TableHead className="text-right">Margen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(ganancias?.por_vendedor ?? []).map((r) => (
                    <TableRow key={`${r.vendedor_id}-${r.nombre}`}>
                      <TableCell className="font-medium flex items-center gap-2">
                        <ShoppingCart className="h-4 w-4 text-muted-foreground" /> {r.nombre}
                      </TableCell>
                      <TableCell className="text-right">{clp(r.ventas)}</TableCell>
                      <TableCell
                        className={`text-right font-bold ${
                          Number(r.ganancia) >= 0 ? 'text-green-600' : 'text-destructive'
                        }`}
                      >
                        {clp(r.ganancia)}
                      </TableCell>
                      <TableCell className="text-right">{pct(r.margen_pct)}</TableCell>
                    </TableRow>
                  ))}
                  {(ganancias?.por_vendedor ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        Sin datos.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- PÉRDIDAS --- */}
        <TabsContent value="perdidas">
          <Card>
            <CardHeader>
              <CardTitle>Pérdidas por Merma</CardTitle>
              <p className="text-xs text-muted-foreground">
                Valorizadas con el último costo de compra conocido de cada producto.
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Kilos mermados</TableHead>
                    <TableHead className="text-right">Valor perdido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(perdidas?.por_producto ?? []).map((r) => (
                    <TableRow key={r.producto_id}>
                      <TableCell className="font-medium">{r.nombre}</TableCell>
                      <TableCell className="text-right">
                        {Number(r.kilos).toLocaleString('es-CL')} kg
                      </TableCell>
                      <TableCell className="text-right font-bold text-destructive">{clp(r.valor)}</TableCell>
                    </TableRow>
                  ))}
                  {(perdidas?.por_producto ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                        Sin mermas registradas.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- FLUCTUACIÓN DE PRECIOS --- */}
        <TabsContent value="fluctuacion">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Fluctuación de Precios</CardTitle>
              <Select value={productoFluct} onValueChange={setProductoFluct}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Seleccione producto" />
                </SelectTrigger>
                <SelectContent>
                  {(fluctuacion?.productos ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {!productoFluct ? (
                <p className="text-center text-muted-foreground py-10">
                  Seleccione un producto para ver la evolución de cada costo de factura de compra frente al
                  precio de venta.
                </p>
              ) : serieFluct.length > 0 ? (
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart data={serieFluct}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="fecha" fontSize={11} interval={0} angle={-30} textAnchor="end" height={70} />
                    <YAxis fontSize={12} tickFormatter={(v) => clp(v)} width={80} />
                    <ReTooltip
                      formatter={(value: number, name: string, entry: any) =>
                        name === 'Costo de compra' && entry?.payload?.numero_factura
                          ? [clp(value), `Costo de compra (Factura ${entry.payload.numero_factura})`]
                          : [clp(value), name]
                      }
                    />
                    <Legend />
                    <Line
                      type="stepAfter"
                      dataKey="costo"
                      name="Costo de compra"
                      stroke="hsl(var(--destructive))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="precio"
                      name="Precio de venta"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-muted-foreground py-10">Sin datos para este producto.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- RENTABILIDAD POR PRECIO --- */}
        <TabsContent value="rentabilidad">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Rentabilidad por Tramo de Precio</CardTitle>
              <Select value={productoRentabilidad} onValueChange={setProductoRentabilidad}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Seleccione producto" />
                </SelectTrigger>
                <SelectContent>
                  {(rentabilidad?.productos ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="space-y-6">
              {!productoRentabilidad ? (
                <p className="text-center text-muted-foreground py-10">
                  Seleccione un producto para ver, por cada precio de venta que ha tenido, con qué costo de
                  factura se vendió y la diferencia entre ambos.
                </p>
              ) : rentabilidad && rentabilidad.periodos.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={rentabilidad.periodos.map((t) => ({ ...t, label: tramoLabel(t) }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" fontSize={11} interval={0} angle={-15} textAnchor="end" height={70} />
                      <YAxis fontSize={12} tickFormatter={(v) => clp(v)} width={80} />
                      <ReTooltip formatter={(v: number) => clp(v)} />
                      <Legend />
                      <Bar dataKey="costo_unitario" name="Costo por kilo" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="precio" name="Precio de venta" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Precio de venta</TableHead>
                        <TableHead>Costo por kilo (con IVA)</TableHead>
                        <TableHead>Vigencia</TableHead>
                        <TableHead className="text-right">Kilos vendidos</TableHead>
                        <TableHead className="text-right">Ventas</TableHead>
                        <TableHead className="text-right">Costo</TableHead>
                        <TableHead className="text-right">Ganancia</TableHead>
                        <TableHead className="text-right">Ganancia por kilo</TableHead>
                        <TableHead className="text-right">Margen %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rentabilidad.periodos.map((t, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">
                            {clp(t.precio)} {t.vigente && <span className="text-xs text-muted-foreground">(vigente)</span>}
                          </TableCell>
                          <TableCell>{t.costo_unitario != null ? clp(t.costo_unitario) : 'N/A'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{tramoRango(t)}</TableCell>
                          <TableCell className="text-right">
                            {Number(t.kilos).toLocaleString('es-CL')} kg
                          </TableCell>
                          <TableCell className="text-right">{clp(t.ventas)}</TableCell>
                          <TableCell className="text-right">{clp(t.costo)}</TableCell>
                          <TableCell className="text-right font-medium text-green-600">
                            {clp(t.ganancia)}
                          </TableCell>
                          <TableCell className="text-right font-medium text-green-600">
                            {t.ganancia_unitaria != null ? clp(t.ganancia_unitaria) : '—'}
                          </TableCell>
                          <TableCell className="text-right">{t.margen_pct !== null ? pct(t.margen_pct) : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              ) : (
                <p className="text-center text-muted-foreground py-10">Sin datos para este producto.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
