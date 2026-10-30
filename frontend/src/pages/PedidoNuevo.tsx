import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, Check, MoreVertical, Plus, UserPlus, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ClienteCombobox } from '@/components/shared/ClienteCombobox';
import { ClienteFormDialog } from '@/components/shared/ClienteFormDialog';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPedido, getClientes, getProductos, getStock } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import type { Cliente, ModoPrecio, Producto, StockItem } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { cn, formatCLP, parseDecimal } from '@/lib/utils';
import { MODOS_PRECIO, costoFifo, gananciaPorKilo, pisoSinPerdida, precioSegunModo } from '@/lib/precios';

interface DetalleProducto {
  producto_id: number;
  producto_nombre: string;
  kilosTexto: string;
  unidadesTexto: string;
  precio_lista: number;
  modo: ModoPrecio;
  descuentoTexto: string;
  precioTexto: string;
  stock_normal: number;
  stock_congelado: number;
  peso_minimo: number;
  lotes_normal: StockItem['lotes'];
  lotes_congelado: StockItem['lotes'];
  congelado: boolean;
}

const disponibleDe = (d: DetalleProducto) => (d.congelado ? d.stock_congelado : d.stock_normal);

// Valores calculados de una línea (todo deriva del texto que escribe el usuario).
function calcular(d: DetalleProducto) {
  const kilos = parseDecimal(d.kilosTexto);
  const unidades = Math.trunc(parseDecimal(d.unidadesTexto));
  const costoNeto = costoFifo(d.congelado ? d.lotes_congelado : d.lotes_normal, unidades);
  const disponibles = disponibleDe(d);
  // Solo Inventario admite pre-reserva; esas unidades sin stock no se pueden pesar.
  const pendientes = !d.congelado && unidades > disponibles ? unidades - Math.max(disponibles, 0) : 0;
  const excedeCongelado = d.congelado && unidades > disponibles;
  const precio = precioSegunModo(d.modo, d.precio_lista, {
    descuento: parseDecimal(d.descuentoTexto),
    personalizado: parseDecimal(d.precioTexto),
    costoNeto,
  });
  const piso = costoNeto != null ? pisoSinPerdida(costoNeto) : null;
  const bajoCosto = piso != null && precio < piso;
  const pesoInvalido = unidades > 0 && kilos > 0 && kilos / unidades < d.peso_minimo;
  const pesoConPendientes = pendientes > 0 && kilos > 0;
  return { kilos, unidades, pendientes, excedeCongelado, costoNeto, precio, piso, bajoCosto, pesoInvalido, pesoConPendientes, subtotal: kilos * precio };
}

export default function PedidoNuevo() {
  const [step, setStep] = useState(1);
  const [clienteId, setClienteId] = useState('');
  const [clienteDialogOpen, setClienteDialogOpen] = useState(false);
  const [observaciones, setObservaciones] = useState('');
  const [tipoRecibo, setTipoRecibo] = useState<'Boleta' | 'Factura'>('Boleta');
  const [detalles, setDetalles] = useState<DetalleProducto[]>([]);
  const [productoSeleccionado, setProductoSeleccionado] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const { data: clientesData, isLoading: loadingClientes, error: errorClientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: async () => (await getClientes()).data as Cliente[],
  });
  const { data: productosData, isLoading: loadingProductos, error: errorProductos } = useQuery({
    queryKey: ['productos'],
    queryFn: async () => (await getProductos()).data as Producto[],
  });
  // Clave propia: el Dashboard guarda bajo ['stock'] la respuesta en otra forma.
  const { data: stockData, isLoading: loadingStock, error: errorStock } = useQuery({
    queryKey: ['stock', 'pedido-nuevo'],
    queryFn: async () => (await getStock()).data as StockItem[],
  });

  const clientes = clientesData ?? [];
  const productos = productosData ?? [];
  const stock = stockData ?? [];

  const clienteSeleccionado = useMemo(
    () => clientes.find((cliente) => cliente.id.toString() === clienteId),
    [clientes, clienteId]
  );

  // A un mayorista se le factura por defecto.
  useEffect(() => {
    if (clienteSeleccionado) setTipoRecibo(clienteSeleccionado.tipo_cliente === 'mayorista' ? 'Factura' : 'Boleta');
  }, [clienteSeleccionado]);

  const productosDisponibles = useMemo(
    () => productos.filter((p) => p.estado !== 'desactivado' && !detalles.some((d) => d.producto_id === p.id)),
    [productos, detalles]
  );

  const stockDe = (producto: Producto) => stock.find((item) => item.id === producto.id);

  const agregarProducto = () => {
    const producto = productos.find((p) => p.id.toString() === productoSeleccionado);
    if (!producto) return;
    const item = stockDe(producto);
    const disponibles = item?.disponibles ?? 0;
    const congelados = Math.max((item?.congelado_unidades ?? 0) - (item?.congelado_reservas ?? 0), 0);
    setDetalles((prev) => [
      ...prev,
      {
        producto_id: producto.id,
        producto_nombre: producto.nombre,
        kilosTexto: '',
        unidadesTexto: '1',
        precio_lista: Number(producto.precio_por_kilo) || 0,
        modo: 'lista',
        descuentoTexto: '',
        precioTexto: '',
        stock_normal: disponibles,
        stock_congelado: congelados,
        peso_minimo: Number(producto.peso_minimo) || 0,
        lotes_normal: item?.lotes,
        lotes_congelado: item?.lotes_congelado,
        congelado: false,
      },
    ]);
    setProductoSeleccionado('');
  };

  const actualizar = (index: number, cambios: Partial<DetalleProducto>) =>
    setDetalles((prev) => prev.map((d, i) => (i === index ? { ...d, ...cambios } : d)));

  const calculados = detalles.map(calcular);
  const total = calculados.reduce((s, c) => s + c.subtotal, 0);
  const totalLista = detalles.reduce((s, d, i) => s + calculados[i].kilos * d.precio_lista, 0);
  const lineasBajoCosto = detalles.filter((_, i) => calculados[i].bajoCosto);
  const lineaConPesoInvalido = detalles.findIndex((_, i) => calculados[i].pesoInvalido);
  const excedeStock = detalles.find((_, i) => calculados[i].excedeCongelado);
  const lineasPendientes = detalles.filter((_, i) => calculados[i].pendientes > 0);
  const lineaPesoPendiente = detalles.findIndex((_, i) => calculados[i].pesoConPendientes);

  const pedidoMutation = useMutation({
    mutationFn: () => {
      if (!clienteSeleccionado) throw new Error('Debe seleccionar un cliente');
      if (detalles.length === 0) throw new Error('Debe agregar al menos un producto');
      return createPedido({
        cliente: clienteSeleccionado.id,
        vendedor: clienteSeleccionado.vendedor.id,
        tipo_recibo: tipoRecibo,
        detalles: detalles.map((d, i) => ({
          producto: d.producto_id,
          cantidad_kilos: calculados[i].kilos,
          cantidad_unidades: calculados[i].unidades,
          modo_precio: d.modo,
          congelado: d.congelado,
          descuento_por_kilo: d.modo === 'descuento' ? parseDecimal(d.descuentoTexto) : 0,
          precio_personalizado: d.modo === 'personalizado' ? parseDecimal(d.precioTexto) : undefined,
        })),
        observaciones: observaciones.trim(),
        ...(lineasPendientes.length > 0 ? { permitir_pre_reserva: true } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast({
        title: lineasPendientes.length > 0 ? 'Pre-reserva creada' : 'Pedido creado',
        description: lineasPendientes.length > 0
          ? 'Las unidades sin stock quedan pendientes y se asignarán cuando ingrese una factura.'
          : 'El pedido se registró correctamente.',
      });
      navigate('/pedidos');
    },
    onError: (error: any) => {
      toast({
        title: 'No se pudo crear el pedido',
        description: error?.response?.data?.error || error?.message || 'Verifique la información e intente nuevamente.',
        variant: 'destructive',
      });
    },
  });

  const confirmarPedido = () => {
    if (lineasBajoCosto.length === 0) return pedidoMutation.mutate();
    confirm({
      title: 'Hay productos bajo costo',
      description: `${lineasBajoCosto.map((d) => d.producto_nombre).join(', ')} se venderían con pérdida. ¿Crear el pedido igual?`,
      confirmLabel: 'Crear con pérdida',
      destructive: true,
      onConfirm: () => pedidoMutation.mutate(),
    });
  };

  const handleNext = () => {
    if (step === 1 && !clienteId) {
      toast({ title: 'Seleccione un cliente', description: 'Debe elegir un cliente antes de continuar.', variant: 'destructive' });
      return;
    }
    if (step === 2) {
      if (detalles.length === 0) {
        toast({ title: 'Agregue productos', description: 'Debe agregar al menos un producto al pedido.', variant: 'destructive' });
        return;
      }
      if (excedeStock) {
        toast({ title: 'Sin stock suficiente', description: `${excedeStock.producto_nombre}: hay ${excedeStock.stock_congelado} unidades congeladas.`, variant: 'destructive' });
        return;
      }
      if (lineaPesoPendiente !== -1) {
        const d = detalles[lineaPesoPendiente];
        toast({ title: 'No se puede pesar', description: `${d.producto_nombre} tiene unidades en pre-reserva: deja los kilos vacíos.`, variant: 'destructive' });
        return;
      }
      if (lineaConPesoInvalido !== -1) {
        const d = detalles[lineaConPesoInvalido];
        toast({ title: 'Peso inconsistente', description: `${d.producto_nombre} promedia menos de ${d.peso_minimo.toLocaleString('es-CL')} kg por unidad.`, variant: 'destructive' });
        return;
      }
    }
    setStep((prev) => Math.min(prev + 1, 3));
  };

  if (loadingClientes || loadingProductos || loadingStock) return <LoadingSpinner />;
  if (errorClientes || errorProductos || errorStock) return <ErrorMessage message="No se pudo cargar la información necesaria" />;

  const pasos = ['Cliente', 'Productos', 'Resumen'];

  return (
    <div className="space-y-6 pb-24 md:pb-0">
      {confirmDialog}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Nuevo Pedido</h1>
        <p className="text-muted-foreground">Complete los pasos para registrar un nuevo pedido</p>
      </div>

      <ol className="grid grid-cols-3 gap-2">
        {pasos.map((nombre, i) => (
          <li key={nombre} className="flex items-center gap-2 text-sm">
            <Badge variant={step === i + 1 ? 'default' : 'outline'}>{i + 1}</Badge>
            <span className={step === i + 1 ? 'font-semibold' : 'text-muted-foreground'}>{nombre}</span>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <ClienteCombobox clientes={clientes} value={clienteId} onChange={setClienteId} />
              </div>
              <Button type="button" variant="outline" size="icon" aria-label="Nuevo cliente" onClick={() => setClienteDialogOpen(true)}>
                <UserPlus className="h-4 w-4" />
              </Button>
            </div>
            <ClienteFormDialog
              open={clienteDialogOpen}
              onOpenChange={setClienteDialogOpen}
              mode="create"
              onSuccess={(nuevo) => {
                queryClient.invalidateQueries({ queryKey: ['clientes'] });
                setClienteId(nuevo.id.toString());
              }}
            />
            {clienteSeleccionado && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-muted p-4">
                  <p className="text-sm text-muted-foreground">Vendedor asignado</p>
                  <p className="font-semibold">{clienteSeleccionado.vendedor.nombre} ({clienteSeleccionado.vendedor.sigla})</p>
                  {clienteSeleccionado.direccion && <p className="mt-1 text-sm text-muted-foreground">{clienteSeleccionado.direccion}</p>}
                </div>
                <div className="rounded-lg border p-4 space-y-2">
                  <Label>Documento</Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={tipoRecibo}
                    onValueChange={(v) => v && setTipoRecibo(v as 'Boleta' | 'Factura')}
                    className="justify-start"
                  >
                    <ToggleGroupItem value="Boleta">Boleta</ToggleGroupItem>
                    <ToggleGroupItem value="Factura">Factura</ToggleGroupItem>
                  </ToggleGroup>
                  {tipoRecibo === 'Factura' && <DatosFactura cliente={clienteSeleccionado} />}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Productos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <Select value={productoSeleccionado} onValueChange={setProductoSeleccionado}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione un producto" />
                  </SelectTrigger>
                  <SelectContent>
                    {productosDisponibles.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.nombre} · {formatCLP(p.precio_por_kilo)}/kg · {stockDe(p)?.disponibles ?? 0} disp.{(stockDe(p)?.congelado_unidades ?? 0) > 0 ? ` · ${stockDe(p)?.congelado_unidades} cong.` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={agregarProducto} disabled={!productoSeleccionado}>
                <Plus className="mr-1 h-4 w-4" /> Agregar
              </Button>
            </div>

            {detalles.length === 0 && (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Agrega los productos del pedido. El precio normal viene por defecto y se puede cambiar por producto.
              </p>
            )}

            <div className="space-y-3">
              {detalles.map((d, index) => (
                <LineaProducto
                  key={d.producto_id}
                  detalle={d}
                  calc={calculados[index]}
                  onChange={(c) => actualizar(index, c)}
                  onRemove={() => setDetalles((prev) => prev.filter((_, i) => i !== index))}
                />
              ))}
            </div>

            {detalles.length > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
                <span className="text-sm text-muted-foreground">Total pesado</span>
                <span className="text-lg font-bold tabular-nums">{formatCLP(total)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Revisar y confirmar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border p-4 bg-muted/30">
                <p className="text-xs uppercase text-muted-foreground font-bold">Cliente · {tipoRecibo}</p>
                <p className="text-lg font-bold">{clienteSeleccionado?.nombre}</p>
                <p className="text-sm">{clienteSeleccionado?.direccion}</p>
              </div>
              <div className="rounded-lg border p-4 bg-primary/5 border-primary/20">
                <p className="text-xs uppercase text-primary font-bold">Total a pagar</p>
                <p className="text-3xl font-black text-primary tabular-nums">{formatCLP(total)}</p>
                {totalLista > total && (
                  <p className="text-xs text-muted-foreground">
                    Precio normal: {formatCLP(totalLista)} · Rebaja: {formatCLP(totalLista - total)}
                  </p>
                )}
              </div>
            </div>

            {lineasPendientes.length > 0 && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                El pedido quedará en Pre-reserva: hay unidades sin stock ({lineasPendientes.map((d) => d.producto_nombre).join(', ')}).
              </p>
            )}

            {lineasBajoCosto.length > 0 && (
              <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {lineasBajoCosto.map((d) => d.producto_nombre).join(', ')} queda{lineasBajoCosto.length > 1 ? 'n' : ''} bajo el costo: se vende con pérdida.
              </p>
            )}

            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Unid.</TableHead>
                    <TableHead className="text-right">Kilos</TableHead>
                    <TableHead className="text-right">Precio/kg</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detalles.map((d, i) => {
                    const c = calculados[i];
                    return (
                      <TableRow key={d.producto_id}>
                        <TableCell className="font-medium">
                          {d.producto_nombre}
                          {d.congelado && <Badge variant="outline" className="ml-2 text-[10px] text-sky-700 border-sky-200 bg-sky-50">Congelado</Badge>}
                          {c.pendientes > 0 && <span className="block text-xs text-amber-700">{c.pendientes} en pre-reserva (sin stock)</span>}
                          {d.modo !== 'lista' && (
                            <span className="block text-xs text-muted-foreground">{MODOS_PRECIO.find((m) => m.value === d.modo)?.label}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{c.unidades}</TableCell>
                        <TableCell className="text-right">
                          {c.kilos > 0 ? `${c.kilos.toLocaleString('es-CL')} kg` : <span className="text-muted-foreground">por pesar</span>}
                        </TableCell>
                        <TableCell className={cn('text-right', c.bajoCosto && 'text-destructive font-semibold')}>{formatCLP(c.precio)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCLP(c.subtotal)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2">
              <Label htmlFor="observaciones">Observaciones / notas de entrega</Label>
              <Textarea
                id="observaciones"
                placeholder="Ej: Entregar después de las 15:00, portón azul..."
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep((p) => Math.max(p - 1, 1))} disabled={step === 1}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Anterior
        </Button>
        {step < 3 ? (
          <Button onClick={handleNext}>
            Siguiente <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={confirmarPedido} disabled={pedidoMutation.isPending}>
            {pedidoMutation.isPending ? 'Registrando...' : 'Confirmar pedido'}
            <Check className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function DatosFactura({ cliente }: { cliente: Cliente }) {
  if (!cliente.rut) {
    return <p className="text-xs text-muted-foreground">Este cliente no tiene RUT ni razón social. Edítalo en Clientes para facturarle.</p>;
  }
  return (
    <div className="flex gap-2 text-xs text-muted-foreground">
      <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        <p className="font-medium text-foreground">{cliente.razon_social}</p>
        <p>RUT {cliente.rut}{cliente.giro ? ` · ${cliente.giro}` : ''}</p>
        {(cliente.direccion_facturacion || cliente.comuna) && (
          <p>{[cliente.direccion_facturacion, cliente.comuna, cliente.ciudad].filter(Boolean).join(', ')}</p>
        )}
      </div>
    </div>
  );
}

function LineaProducto({
  detalle: d, calc: c, onChange, onRemove,
}: {
  detalle: DetalleProducto;
  calc: ReturnType<typeof calcular>;
  onChange: (cambios: Partial<DetalleProducto>) => void;
  onRemove: () => void;
}) {
  const margen = c.costoNeto != null ? gananciaPorKilo(c.precio, c.costoNeto) : null;
  const modoActual = MODOS_PRECIO.find((m) => m.value === d.modo);
  return (
    <div className={cn('rounded-xl border p-3 space-y-2', (c.pesoInvalido || c.bajoCosto || c.excedeCongelado) && 'border-destructive/50 bg-destructive/5', c.pendientes > 0 && 'border-amber-300 bg-amber-50/50')}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{d.producto_nombre}</p>
          <p className="truncate text-xs text-muted-foreground">
            {disponibleDe(d)} disp.{d.congelado ? ' (congelado)' : ''} · normal {formatCLP(d.precio_lista)}/kg
            {d.modo !== 'lista' && <span className="font-medium text-primary"> · {modoActual?.corto}</span>}
          </p>
        </div>
        <DecimalInput
          decimales={false}
          value={d.unidadesTexto}
          onValueChange={(t) => onChange({ unidadesTexto: t })}
          placeholder="Unid."
          className={cn('h-10 w-16 shrink-0 px-1 text-center font-semibold', c.excedeCongelado && 'border-destructive')}
          aria-label={`Unidades de ${d.producto_nombre}`}
        />
        <DecimalInput
          value={d.kilosTexto}
          onValueChange={(t) => onChange({ kilosTexto: t })}
          placeholder="Kilos"
          className={cn('h-10 w-24 shrink-0 px-1 text-center font-semibold', (c.pesoInvalido || c.pesoConPendientes) && 'border-destructive')}
          aria-label={`Kilos de ${d.producto_nombre} (vacío = por pesar)`}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Opciones de precio de ${d.producto_nombre}`}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={d.modo} onValueChange={(v) => onChange({ modo: v as ModoPrecio })}>
              {MODOS_PRECIO.map((m) => (
                <DropdownMenuRadioItem key={m.value} value={m.value}>{m.label}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onRemove}>
              <XCircle className="mr-2 h-4 w-4" /> Quitar producto
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {d.stock_congelado > 0 && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Origen</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={d.congelado ? 'congelado' : 'inventario'}
            onValueChange={(v) => v && onChange({ congelado: v === 'congelado', kilosTexto: '' })}
            className="justify-start"
          >
            <ToggleGroupItem value="inventario" className="text-xs">Inventario ({d.stock_normal})</ToggleGroupItem>
            <ToggleGroupItem value="congelado" className="text-xs">Congelado ({d.stock_congelado})</ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}
      {c.pendientes > 0 && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {c.pendientes} {c.pendientes === 1 ? 'unidad queda' : 'unidades quedan'} en pre-reserva (sin stock). Esta línea no se puede pesar hasta que llegue stock.
        </p>
      )}
      {c.excedeCongelado && (
        <p className="text-xs font-semibold text-destructive">Solo hay {disponibleDe(d)} unidades congeladas disponibles.</p>
      )}
      {c.pesoInvalido && (
        <p className="text-xs font-semibold text-destructive">Peso bajo el mínimo ({d.peso_minimo.toLocaleString('es-CL')} kg por unidad)</p>
      )}

      {d.modo === 'descuento' && (
        <DecimalInput
          value={d.descuentoTexto}
          onValueChange={(t) => onChange({ descuentoTexto: t })}
          placeholder="Descuento en $ por kilo"
          aria-label={`Descuento por kilo de ${d.producto_nombre}`}
          autoFocus
        />
      )}
      {d.modo === 'personalizado' && (
        <DecimalInput
          value={d.precioTexto}
          onValueChange={(t) => onChange({ precioTexto: t })}
          placeholder="Precio por kilo con IVA"
          aria-label={`Precio por kilo de ${d.producto_nombre}`}
          autoFocus
        />
      )}
      {d.modo === 'costo' && c.costoNeto == null && (
        <p className="text-xs text-muted-foreground">Sin costo de compra registrado: se usa el precio normal.</p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-2 border-t border-dashed pt-2 text-sm">
        <div className="space-y-0.5">
          <p>
            <span className="font-semibold tabular-nums">{formatCLP(c.precio)}</span>
            <span className="text-muted-foreground">/kg</span>
            {c.precio < d.precio_lista && (
              <span className="ml-2 text-xs text-muted-foreground line-through">{formatCLP(d.precio_lista)}</span>
            )}
          </p>
          {c.piso != null && (
            <p className={cn('text-xs', c.bajoCosto ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
              {c.bajoCosto
                ? `Bajo costo: pierdes ${formatCLP(-(margen ?? 0))} por kilo (mínimo ${formatCLP(c.piso)})`
                : `Costo con IVA ${formatCLP(c.piso)}/kg · ganas ${formatCLP(margen ?? 0)}/kg neto`}
            </p>
          )}
        </div>
        <span className="font-bold text-primary tabular-nums">{c.kilos > 0 ? formatCLP(c.subtotal) : 'por pesar'}</span>
      </div>
    </div>
  );
}
