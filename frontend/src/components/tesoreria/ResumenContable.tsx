import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Landmark, Percent, Receipt, Scale, Settings2, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatCard } from '@/components/shared/StatCard';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { useToast } from '@/hooks/use-toast';
import { getContabilidad, updateConfiguracionContable } from '@/services/api';
import { cn, decimalATexto, formatCLP, parseDecimal, type RangoFecha } from '@/lib/utils';

type Num = number | string;
interface Mes {
  mes: string;
  ventas_netas: Num; costo_ventas: Num; ganancia_bruta: Num; gastos_netos: Num; mermas: Num; utilidad: Num;
  iva_debito: Num; iva_credito_compras: Num; iva_credito_anticipo: Num; iva_credito_gastos: Num; iva_credito: Num;
  remanente_anterior: Num; iva_a_pagar: Num; remanente: Num; ppm: Num;
}
interface Anio { anio: string; utilidad: Num; ppm: Num; impuesto_estimado: Num; saldo_abril: Num }
interface Contabilidad {
  meses: Mes[];
  anios: Anio[];
  config: { tasa_impuesto_renta: Num; tasa_ppm: Num; tasa_iva: Num; tasa_anticipo_carne: Num; receptor_cobro: 'vendedor' | 'empresa' };
  estado: {
    por_cobrar: Num; por_pagar: Num; facturas_vencidas: number; saldo_banco: Num | null;
    movimientos_sin_clasificar: number; abonos_sin_asociar: number;
  };
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const n = (v: Num | null | undefined) => Number(v ?? 0);

export function ResumenContable({ rango }: { rango: RangoFecha }) {
  const q = useQuery({
    queryKey: ['contabilidad', rango],
    queryFn: async () => (await getContabilidad(rango)).data as Contabilidad,
  });

  if (q.isLoading) return <LoadingSpinner />;
  if (q.error || !q.data) return <ErrorMessage message="No se pudo cargar la contabilidad" />;

  const { meses, anios, estado, config } = q.data;
  const hoy = new Date();
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const filaMes = meses.find((m) => m.mes === mesActual);
  const anio = anios.find((a) => a.anio === String(hoy.getFullYear()));
  const suma = (k: keyof Mes) => meses.reduce((s, m) => s + n(m[k]), 0);
  const utilidad = suma('utilidad');
  const ventasNetas = suma('ventas_netas');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Saldo en banco"
          value={estado.saldo_banco != null ? formatCLP(estado.saldo_banco) : '—'}
          icon={Landmark}
          description={estado.saldo_banco != null ? 'Según la última cartola' : 'Sube una cartola para verlo'}
        />
        <StatCard
          title={n(filaMes?.iva_a_pagar) > 0 ? 'IVA a pagar este mes' : 'IVA este mes'}
          value={formatCLP(filaMes?.iva_a_pagar ?? 0)}
          icon={Receipt}
          accent={n(filaMes?.iva_a_pagar) > 0 ? 'text-amber-600' : undefined}
          description={n(filaMes?.remanente) > 0 ? `${formatCLP(filaMes?.remanente)} de remanente a favor` : 'Débito − crédito − remanente'}
        />
        <StatCard
          title="Utilidad del período"
          value={formatCLP(utilidad)}
          icon={TrendingUp}
          accent={utilidad < 0 ? 'text-destructive' : 'text-green-600'}
          description={ventasNetas ? `${((utilidad / ventasNetas) * 100).toFixed(1)}% de las ventas netas` : 'Sin ventas'}
        />
        <StatCard
          title={`Impuesto a la renta ${hoy.getFullYear()}`}
          value={formatCLP(anio?.impuesto_estimado ?? 0)}
          icon={Percent}
          description={anio ? `PPM estimados ${formatCLP(anio.ppm)} · ${n(anio.saldo_abril) >= 0 ? `faltaría ${formatCLP(anio.saldo_abril)}` : `devolución ${formatCLP(-n(anio.saldo_abril))}`}` : 'Sin datos del año'}
        />
      </div>

      {(estado.movimientos_sin_clasificar > 0 || estado.facturas_vencidas > 0) && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {[
            estado.movimientos_sin_clasificar > 0 && `${estado.movimientos_sin_clasificar} movimiento(s) del banco sin clasificar`,
            estado.facturas_vencidas > 0 && `${estado.facturas_vencidas} factura(s) de proveedor vencida(s)`,
          ].filter(Boolean).join(' · ')}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Utilidad por mes</CardTitle>
          <CardDescription>Ventas netas − costo de lo vendido − gastos − mermas. Todo sin IVA.</CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          {meses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos en el período.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={meses.map((m) => ({ mes: nombreMes(m.mes), utilidad: n(m.utilidad) }))} barCategoryGap="30%">
                <CartesianGrid vertical={false} className="stroke-muted" />
                <XAxis dataKey="mes" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => `${Math.round(v / 1000).toLocaleString('es-CL')}k`} />
                <ReferenceLine y={0} className="stroke-border" />
                <Tooltip formatter={(v: number) => [formatCLP(v), 'Utilidad']} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
                <Bar dataKey="utilidad" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4" /> IVA mensual (F29)</CardTitle>
            <CardDescription>Débito de las ventas; crédito de las compras del mes (menos notas de crédito) y gastos con factura.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0 sm:p-6 sm:pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Débito</TableHead>
                  <TableHead className="text-right">Crédito</TableHead>
                  <TableHead className="text-right">Remanente ant.</TableHead>
                  <TableHead className="text-right">A pagar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meses.map((m) => (
                  <TableRow key={m.mes}>
                    <TableCell className="capitalize">{nombreMes(m.mes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCLP(m.iva_debito)}</TableCell>
                    <TableCell className="text-right tabular-nums" title={`Compras ${formatCLP(m.iva_credito_compras)} · anticipo carne ${formatCLP(m.iva_credito_anticipo)} · gastos ${formatCLP(m.iva_credito_gastos)}`}>
                      {formatCLP(m.iva_credito)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{n(m.remanente_anterior) ? formatCLP(m.remanente_anterior) : '—'}</TableCell>
                    <TableCell className={cn('text-right font-semibold tabular-nums', n(m.iva_a_pagar) > 0 ? 'text-amber-700' : 'text-muted-foreground')}>
                      {n(m.iva_a_pagar) > 0 ? formatCLP(m.iva_a_pagar) : `queda ${formatCLP(m.remanente)}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4" /> Estado de resultados</CardTitle>
            <CardDescription>Montos netos, sin IVA.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0 sm:p-6 sm:pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Ventas</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Gastos</TableHead>
                  <TableHead className="text-right">Mermas</TableHead>
                  <TableHead className="text-right">Utilidad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meses.map((m) => (
                  <TableRow key={m.mes}>
                    <TableCell className="capitalize">{nombreMes(m.mes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCLP(m.ventas_netas)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatCLP(m.costo_ventas)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatCLP(m.gastos_netos)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatCLP(m.mermas)}</TableCell>
                    <TableCell className={cn('text-right font-semibold tabular-nums', n(m.utilidad) < 0 && 'text-destructive')}>{formatCLP(m.utilidad)}</TableCell>
                  </TableRow>
                ))}
                {meses.length > 1 && (
                  <TableRow className="font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCLP(ventasNetas)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCLP(suma('costo_ventas'))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCLP(suma('gastos_netos'))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCLP(suma('mermas'))}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', utilidad < 0 && 'text-destructive')}>{formatCLP(utilidad)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Percent className="h-4 w-4" /> Impuesto a la utilidad</CardTitle>
            <CardDescription>
              Estimación: {decimalATexto(config.tasa_impuesto_renta)}% de la utilidad del año, menos PPM de {decimalATexto(config.tasa_ppm)}% sobre las ventas netas de cada mes.
              Confírmalo con tu contador.
            </CardDescription>
          </div>
          <ConfigTasas config={config} />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Año</TableHead>
                <TableHead className="text-right">Utilidad</TableHead>
                <TableHead className="text-right">Impuesto</TableHead>
                <TableHead className="text-right">PPM</TableHead>
                <TableHead className="text-right">En abril</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {anios.map((a) => (
                <TableRow key={a.anio}>
                  <TableCell>{a.anio}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(a.utilidad)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(a.impuesto_estimado)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(a.ppm)}</TableCell>
                  <TableCell className={cn('text-right font-semibold tabular-nums', n(a.saldo_abril) < 0 && 'text-green-700')}>
                    {n(a.saldo_abril) >= 0 ? `pagar ${formatCLP(a.saldo_abril)}` : `devolución ${formatCLP(-n(a.saldo_abril))}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ConfigTasas({ config }: { config: Contabilidad['config'] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [renta, setRenta] = useState(decimalATexto(config.tasa_impuesto_renta));
  const [ppm, setPpm] = useState(decimalATexto(config.tasa_ppm));
  const [iva, setIva] = useState(decimalATexto(config.tasa_iva));
  const [anticipo, setAnticipo] = useState(decimalATexto(config.tasa_anticipo_carne));
  const [receptor, setReceptor] = useState(config.receptor_cobro);

  const guardar = async () => {
    try {
      await updateConfiguracionContable({
        tasa_impuesto_renta: parseDecimal(renta), tasa_ppm: parseDecimal(ppm),
        tasa_iva: parseDecimal(iva), tasa_anticipo_carne: parseDecimal(anticipo), receptor_cobro: receptor,
      });
      queryClient.invalidateQueries({ queryKey: ['contabilidad'] });
      queryClient.invalidateQueries({ queryKey: ['configuracion-contable'] });
      toast({ title: 'Tasas guardadas' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'No se pudo guardar', variant: 'destructive' });
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Configurar tasas"><Settings2 className="h-4 w-4" /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Impuesto primera categoría (%)</Label>
          <DecimalInput value={renta} onValueChange={setRenta} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">PPM sobre ventas netas (%)</Label>
          <DecimalInput value={ppm} onValueChange={setPpm} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">IVA (%)</Label>
          <DecimalInput value={iva} onValueChange={setIva} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Anticipo IVA carne en compras (%)</Label>
          <DecimalInput value={anticipo} onValueChange={setAnticipo} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Los cobros nuevos los recibe</Label>
          <Select value={receptor} onValueChange={(v) => setReceptor(v as 'vendedor' | 'empresa')}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="vendedor">El vendedor del pedido</SelectItem>
              <SelectItem value="empresa">La cuenta de la empresa</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="w-full" onClick={guardar}>Guardar</Button>
      </PopoverContent>
    </Popover>
  );
}
