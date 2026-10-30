import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle, ChevronRight, FileText, HandCoins, Landmark, Plus, Scale, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import {
  getStock, getPedidos, getFacturas, getReporteGanancias, getVendedores, getPagosVendedor, getContabilidad,
} from '@/services/api';
import { totalAPagar, type Factura, type Pedido, type StockItem, type Vendedor } from '@/types';
import { cn, diasDesde, enRango, formatCLP, formatFecha, rangoDesdePreset } from '@/lib/utils';
import { usePeriodo } from '@/contexts/PeriodoContext';
import { calcularSaldosVendedores, pagosDesdeRespuesta } from '@/lib/saldos';

// Bajo este número de unidades disponibles un corte aparece en "Stock bajo".
const UMBRAL_STOCK_BAJO = 10;

type Tono = 'urgente' | 'atencion' | 'normal';

interface Pendiente {
  clave: string;
  icono: LucideIcon;
  titulo: string;
  detalle: string;
  monto?: number;
  tono: Tono;
  ir: string;
}

const TONO: Record<Tono, string> = {
  urgente: 'bg-destructive/10 text-destructive',
  atencion: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  normal: 'bg-muted text-muted-foreground',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { enPeriodo } = usePeriodo();
  const [lista, setLista] = useState<'pesar' | 'cobrar'>('pesar');

  // Mismas claves y formas que las páginas de detalle para compartir caché.
  const pedidosQ = useQuery({ queryKey: ['pedidos'], queryFn: async () => (await getPedidos(true)).data as Pedido[] });
  const stockQ = useQuery({ queryKey: ['stock'], queryFn: async () => (await getStock()).data });
  const facturasQ = useQuery({ queryKey: ['facturas'], queryFn: async () => (await getFacturas()).data as Factura[] });
  const mes = rangoDesdePreset('mes');
  const gananciaQ = useQuery({ queryKey: ['reporte-ganancias', mes], queryFn: async () => (await getReporteGanancias(mes)).data });
  const contaQ = useQuery({ queryKey: ['contabilidad', mes], queryFn: async () => (await getContabilidad(mes)).data });
  const vendedoresQ = useQuery({ queryKey: ['vendedores'], queryFn: async () => (await getVendedores()).data as Vendedor[] });
  const pagosQ = useQuery({ queryKey: ['pagos-vendedor'], queryFn: async () => pagosDesdeRespuesta((await getPagosVendedor()).data) });

  const pedidos = useMemo(() => (pedidosQ.data ?? []).filter((p) => p.estado !== 'Anulado' && enPeriodo(p.fecha)), [pedidosQ.data, enPeriodo]);
  const stock: StockItem[] = Array.isArray(stockQ.data) ? stockQ.data : [];
  const facturas = useMemo(() => (facturasQ.data ?? []).filter((f) => enPeriodo(f.fecha)), [facturasQ.data, enPeriodo]);

  // Ventas del mes vs. el mismo tramo del mes anterior (1 al día de hoy).
  const ventas = useMemo(() => {
    const hoy = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const finMesAnterior = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    const tramoAnterior = {
      desde: iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)),
      hasta: iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, Math.min(hoy.getDate(), finMesAnterior.getDate()))),
    };
    const delMes = pedidos.filter((p) => enRango(p.fecha, mes));
    const actual = delMes.reduce((s, p) => s + Number(p.total), 0);
    const anterior = pedidos.filter((p) => enRango(p.fecha, tramoAnterior)).reduce((s, p) => s + Number(p.total), 0);
    return { actual, cantidad: delMes.length, variacion: anterior > 0 ? ((actual - anterior) / anterior) * 100 : NaN };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos]);

  const porPesar = pedidos.filter((p) => p.estado === 'Reservado').sort((a, b) => a.id - b.id);
  const preReservas = pedidos.filter((p) => p.estado === 'Pre-reserva').sort((a, b) => a.id - b.id);
  const porCobrar = pedidos.filter((p) => p.estado === 'Preparado').sort((a, b) => a.id - b.id);
  const montoPorCobrar = porCobrar.reduce((s, p) => s + Number(p.total), 0);

  const facturasPendientes = facturas.filter((f) => !f.pago_factura);
  const montoPorPagar = facturasPendientes.reduce((s, f) => s + totalAPagar(f), 0);
  // Vencidas o que vencen en los próximos 7 días; sin vencimiento, las de más de 30 días.
  const facturasUrgentes = facturasPendientes.filter((f) =>
    f.fecha_vencimiento ? -diasDesde(f.fecha_vencimiento) <= 7 : diasDesde(f.fecha) > 30
  );
  const facturasVencidas = facturasUrgentes.filter((f) => f.fecha_vencimiento && diasDesde(f.fecha_vencimiento) > 0);

  const stockBajo = stock
    .filter((s) => s.estado === 'disponible' && s.disponibles < UMBRAL_STOCK_BAJO)
    .sort((a, b) => a.disponibles - b.disponibles);

  const saldos = useMemo(
    () => calcularSaldosVendedores(vendedoresQ.data ?? [], pedidos, (pagosQ.data ?? []).filter((p) => enPeriodo(p.fecha))),
    [vendedoresQ.data, pedidos, pagosQ.data, enPeriodo]
  );
  const saldoTotal = saldos.reduce((s, v) => s + v.saldo, 0);

  const ganancia = gananciaQ.data?.total;
  const banco = contaQ.data?.estado;

  // Lo que hay que hacer hoy, de lo más urgente a lo menos.
  const pendientes: Pendiente[] = [
    facturasUrgentes.length > 0 && {
      clave: 'facturas',
      icono: FileText,
      titulo: facturasVencidas.length
        ? `${facturasVencidas.length} factura${facturasVencidas.length === 1 ? '' : 's'} vencida${facturasVencidas.length === 1 ? '' : 's'}`
        : `${facturasUrgentes.length} factura${facturasUrgentes.length === 1 ? '' : 's'} por vencer`,
      detalle: 'Pagos a proveedores de esta semana',
      monto: facturasUrgentes.reduce((s, f) => s + totalAPagar(f), 0),
      tono: facturasVencidas.length ? 'urgente' : 'atencion',
      ir: '/facturas?pago=pendientes',
    },
    porPesar.length > 0 && {
      clave: 'pesar',
      icono: Scale,
      titulo: `${porPesar.length} pedido${porPesar.length === 1 ? '' : 's'} por pesar`,
      detalle: `El más antiguo es el #${porPesar[0].id} de ${porPesar[0].cliente.nombre}`,
      tono: 'atencion',
      ir: '/pedidos?estado=Reservado',
    },
    preReservas.length > 0 && {
      clave: 'prereserva',
      icono: AlertCircle,
      titulo: `${preReservas.length} pre-reserva${preReservas.length === 1 ? '' : 's'} esperando stock`,
      detalle: `La más antigua es el #${preReservas[0].id} de ${preReservas[0].cliente.nombre}`,
      tono: 'atencion',
      ir: '/pedidos?estado=Pre-reserva',
    },
    porCobrar.length > 0 && {
      clave: 'cobrar',
      icono: HandCoins,
      titulo: `${porCobrar.length} pedido${porCobrar.length === 1 ? '' : 's'} por cobrar`,
      detalle: 'Pesados y entregados, falta el pago',
      monto: montoPorCobrar,
      tono: 'normal',
      ir: '/pedidos?estado=Preparado',
    },
    banco && banco.movimientos_sin_clasificar > 0 && {
      clave: 'banco',
      icono: Landmark,
      titulo: `${banco.movimientos_sin_clasificar} movimiento${banco.movimientos_sin_clasificar === 1 ? '' : 's'} del banco por revisar`,
      detalle: 'Asócialos a pedidos, facturas o gastos',
      tono: 'normal',
      ir: '/tesoreria?tab=banco',
    },
    stockBajo.length > 0 && {
      clave: 'stock',
      icono: AlertCircle,
      titulo: `${stockBajo.length} corte${stockBajo.length === 1 ? '' : 's'} con poco stock`,
      detalle: stockBajo.slice(0, 3).map((s) => `${s.producto} (${s.disponibles})`).join(', '),
      tono: stockBajo.some((s) => s.disponibles === 0) ? 'atencion' : 'normal',
      ir: '/stock',
    },
  ].filter(Boolean) as Pendiente[];

  if (pedidosQ.error) return <ErrorMessage message="Error al cargar el resumen" />;
  const cargando = pedidosQ.isLoading || stockQ.isLoading;
  const listaPedidos = lista === 'pesar' ? porPesar : porCobrar;

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-24 md:pb-0">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground first-letter:uppercase">
            {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {cargando ? 'Resumen' : pendientes.length ? `${pendientes.length} cosa${pendientes.length === 1 ? '' : 's'} por atender` : 'Todo al día'}
          </h1>
        </div>
        <Button onClick={() => navigate('/pedidos/nuevo')} className="hidden md:flex">
          <Plus className="mr-2 h-4 w-4" /> Nuevo pedido
        </Button>
      </header>

      {/* Cifras del mes: una sola franja, no tarjetas sueltas */}
      <section aria-label="Cifras del mes" className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card lg:grid-cols-4">
        <Cifra
          etiqueta="Ventas del mes"
          valor={cargando ? null : formatCLP(ventas.actual)}
          nota={
            Number.isFinite(ventas.variacion)
              ? <span className={ventas.variacion >= 0 ? 'text-green-700 dark:text-green-400' : 'text-destructive'}>
                  {ventas.variacion >= 0 ? '+' : ''}{ventas.variacion.toFixed(0)}% vs. mes anterior
                </span>
              : `${ventas.cantidad} pedidos`
          }
          onClick={() => navigate('/pedidos')}
        />
        <Cifra
          etiqueta="Ganancia neta"
          valor={ganancia ? formatCLP(ganancia.ganancia) : null}
          nota={ganancia ? `margen ${Number(ganancia.margen_pct).toFixed(1).replace('.', ',')}%, sin IVA` : ' '}
          negativo={ganancia && Number(ganancia.ganancia) < 0}
          onClick={() => navigate('/reportes')}
        />
        <Cifra
          etiqueta="Por cobrar"
          valor={cargando ? null : formatCLP(montoPorCobrar)}
          nota={`${porCobrar.length} pedidos pesados`}
          onClick={() => navigate('/pedidos?estado=Preparado')}
        />
        <Cifra
          etiqueta="Por pagar a proveedores"
          valor={facturasQ.isLoading ? null : formatCLP(montoPorPagar)}
          nota={facturasPendientes.length ? `${facturasPendientes.length} facturas pendientes` : 'nada pendiente'}
          onClick={() => navigate('/facturas?pago=pendientes')}
        />
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-8">
          {/* Por atender */}
          <section aria-labelledby="pendientes-titulo" className="space-y-3">
            <h2 id="pendientes-titulo" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Por atender</h2>
            {cargando ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
            ) : pendientes.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No hay pedidos por pesar ni por cobrar, ni facturas por vencer. Buen momento para registrar compras o mirar los reportes.
              </p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {pendientes.map((p) => (
                  <li key={p.clave}>
                    <button
                      onClick={() => navigate(p.ir)}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                    >
                      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', TONO[p.tono])}>
                        <p.icono className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{p.titulo}</span>
                        <span className="block truncate text-sm text-muted-foreground">{p.detalle}</span>
                      </span>
                      {p.monto != null && <span className="font-semibold tabular-nums">{formatCLP(p.monto)}</span>}
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Pedidos abiertos */}
          <section aria-labelledby="pedidos-titulo" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 id="pedidos-titulo" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Pedidos abiertos</h2>
              <div role="tablist" className="flex rounded-lg bg-muted p-0.5 text-sm">
                {([['pesar', 'Por pesar', porPesar.length], ['cobrar', 'Por cobrar', porCobrar.length]] as const).map(([k, label, n]) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={lista === k}
                    onClick={() => setLista(k)}
                    className={cn(
                      'rounded-md px-3 py-1 transition-colors duration-150',
                      lista === k ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label} <span className="tabular-nums text-muted-foreground">{n}</span>
                  </button>
                ))}
              </div>
            </div>
            {listaPedidos.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">{lista === 'pesar' ? 'Nada por pesar.' : 'Nada por cobrar.'}</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {listaPedidos.slice(0, 8).map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => navigate(`/pedidos?buscar=${p.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors duration-150 hover:bg-muted/50"
                    >
                      <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">#{p.id}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{p.cliente.nombre}</span>
                      <span className="hidden text-xs text-muted-foreground sm:inline">{formatFecha(p.fecha)}</span>
                      <span className="w-24 shrink-0 text-right tabular-nums">{lista === 'pesar' ? `${p.detalles.filter((d) => d.estado !== 'Cancelado').length} prod.` : formatCLP(p.total)}</span>
                    </button>
                  </li>
                ))}
                {listaPedidos.length > 8 && (
                  <li>
                    <button
                      onClick={() => navigate(`/pedidos?estado=${lista === 'pesar' ? 'Reservado' : 'Preparado'}`)}
                      className="w-full px-4 py-2.5 text-left text-sm text-primary hover:underline"
                    >
                      Ver los {listaPedidos.length} pedidos
                    </button>
                  </li>
                )}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-8">
          {banco?.saldo_banco != null && (
            <section className="space-y-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Saldo en banco</h2>
              <button onClick={() => navigate('/tesoreria?tab=banco')} className="text-2xl font-semibold tabular-nums hover:text-primary">
                {formatCLP(banco.saldo_banco)}
              </button>
              <p className="text-xs text-muted-foreground">Según la última cartola subida</p>
            </section>
          )}

          <section aria-labelledby="vendedores-titulo" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="vendedores-titulo" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Por rendir de vendedores</h2>
              <button onClick={() => navigate('/gestion-pagos')} className="text-xs text-primary hover:underline">Pagos</button>
            </div>
            <dl className="space-y-2 text-sm">
              {saldos.map((v) => (
                <div key={v.id} className="flex items-baseline justify-between gap-3">
                  <dt className="truncate">{v.nombre}</dt>
                  <dd className={cn('tabular-nums', v.saldo > 0 ? 'font-semibold' : 'text-muted-foreground')}>
                    {v.saldo >= 0 ? formatCLP(v.saldo) : `${formatCLP(-v.saldo)} a favor`}
                  </dd>
                </div>
              ))}
              {saldos.length > 1 && (
                <div className="flex items-baseline justify-between border-t pt-2 font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{formatCLP(saldoTotal)}</dd>
                </div>
              )}
            </dl>
          </section>

          <section aria-labelledby="stock-titulo" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="stock-titulo" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Stock bajo</h2>
              <button onClick={() => navigate('/stock')} className="text-xs text-primary hover:underline">Stock</button>
            </div>
            {stockBajo.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ningún corte bajo {UMBRAL_STOCK_BAJO} unidades.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {stockBajo.slice(0, 8).map((s) => (
                  <li key={s.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate">{s.producto}</span>
                    {/* Barra de disponibilidad respecto del umbral */}
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span
                        className={cn('block h-full rounded-full', s.disponibles === 0 ? 'bg-destructive' : 'bg-foreground/40')}
                        style={{ width: `${Math.max(4, (s.disponibles / UMBRAL_STOCK_BAJO) * 100)}%` }}
                      />
                    </span>
                    <span className={cn('w-10 text-right tabular-nums', s.disponibles === 0 && 'font-semibold text-destructive')}>
                      {s.disponibles} u
                    </span>
                  </li>
                ))}
                {stockBajo.length > 8 && <li className="text-xs text-muted-foreground">y {stockBajo.length - 8} más</li>}
              </ul>
            )}
          </section>
        </aside>
      </div>

    </div>
  );
}

function Cifra({
  etiqueta, valor, nota, negativo, onClick,
}: {
  etiqueta: string;
  valor: string | null;
  nota: React.ReactNode;
  negativo?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-1 border-b border-r p-4 text-left transition-colors duration-150 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:p-5 [&:nth-child(2n)]:border-r-0 lg:border-b-0 lg:[&:nth-child(2n)]:border-r lg:last:border-r-0 [&:nth-child(n+3)]:border-b-0"
    >
      <span className="text-xs font-medium text-muted-foreground">{etiqueta}</span>
      {valor == null ? (
        <Skeleton className="h-7 w-28" />
      ) : (
        <span className={cn('text-xl font-semibold tabular-nums sm:text-2xl', negativo && 'text-destructive')}>{valor}</span>
      )}
      <span className="text-xs text-muted-foreground">{nota}</span>
    </button>
  );
}
