import { useMemo, useState, useEffect } from 'react';
import { Search, Plus, Trash2, Package, FileText, Pencil, Lock, AlertTriangle, BadgeCheck, Camera, ReceiptText, ExternalLink } from 'lucide-react';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useForm, Controller } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resumenPreReservas } from '@/lib/preReservas';
import { getFacturas, createFactura, updateFactura, getProveedores, getProductos, getMargenProductos, pagarFactura, createNotaCredito, deleteNotaCredito, getConfiguracionContable } from '@/services/api';
import { Switch } from '@/components/ui/switch';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { totalAPagar, type Factura, type EstadoEdicionLinea } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { usePeriodo } from '@/contexts/PeriodoContext';
import { diasDesde, enRango, formatCLP, formatFecha, hoyISO, mediaUrl, parseDecimal } from '@/lib/utils';
import { useSearchParams } from 'react-router-dom';
import { StatCard } from '@/components/shared/StatCard';
import { RangoFechaSelect, rangoInicial, type RangoState } from '@/components/shared/RangoFechaSelect';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Clock, Wallet } from 'lucide-react';

interface DetalleFacturaForm {
  producto: string;
  nombre_producto: string;
  cantidad_kilos: number;
  cantidad_unidades: number;
  costo_por_kilo: number;
  costo_total: number;
}

interface FacturaForm {
  numero_factura: string;
  proveedor_id: string;
  fecha: string;
  fecha_vencimiento: string;
  subtotal: string;
  iva: string;
  total: string;
}

// Línea en el formulario de edición: arrastra el estado de consumo calculado
// por el backend para saber qué campos bloquear y por qué.
interface EditLinea {
  id?: number;
  producto: number;
  nombre_producto: string;
  cantidad_kilos: number;
  cantidad_unidades: number;
  costo_por_kilo: number;
  estado_edicion: EstadoEdicionLinea;
  unidades_consumidas: number;
  pedidos_consumidores: number[];
}

export default function Facturas() {
  // ?pago=pendientes&buscar=Proveedor llegan desde el Resumen y Proveedores.
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('buscar') ?? '');
  const [pagoFilter, setPagoFilter] = useState<'todas' | 'pagadas' | 'pendientes'>(
    (searchParams.get('pago') as 'pendientes' | null) ?? 'todas'
  );
  const [proveedorFilter, setProveedorFilter] = useState('todos');
  const [rango, setRango] = useState<RangoState>(rangoInicial('todo'));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFactura, setSelectedFactura] = useState<Factura | null>(null);
  const [detalles, setDetalles] = useState<DetalleFacturaForm[]>([]);
  // Estado del diálogo de EDICIÓN de una factura existente.
  const [editFactura, setEditFactura] = useState<Factura | null>(null);
  const [editProveedor, setEditProveedor] = useState('');
  const [editFecha, setEditFecha] = useState('');
  const [editDetalles, setEditDetalles] = useState<EditLinea[]>([]);
  const [pagoFecha, setPagoFecha] = useState('');
  const [pagoMonto, setPagoMonto] = useState('');
  const [editVencimiento, setEditVencimiento] = useState('');
  const [fotoNueva, setFotoNueva] = useState<File | null>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [nc, setNc] = useState({ numero: '', fecha: hoyISO(), neto: '', motivo: '' });
  const [ncFoto, setNcFoto] = useState<File | null>(null);
  const [ncAbierta, setNcAbierta] = useState(false);
  // Anticipo de IVA de la carne (5% del neto) que suman los frigoríficos.
  const [conAnticipo, setConAnticipo] = useState(false);
  const [editConAnticipo, setEditConAnticipo] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [nuevoItem, setNuevoItem] = useState({
    producto_id: '',
    cantidad_kilos: '',
    cantidad_unidades: '0',
    costo_por_kilo: ''
  });

  const form = useForm<FacturaForm>({
    defaultValues: {
      numero_factura: '',
      proveedor_id: '',
      fecha: hoyISO(),
      fecha_vencimiento: '',
      subtotal: '0',
      iva: '0',
      total: '0',
    },
  });

  const { data: proveedores } = useQuery({ queryKey: ['proveedores'], queryFn: async () => (await getProveedores()).data });
  const { data: productos } = useQuery({ queryKey: ['productos'], queryFn: async () => (await getProductos()).data });
  const { data: config } = useQuery({ queryKey: ['configuracion-contable'], queryFn: async () => (await getConfiguracionContable()).data });
  const tasaIva = Number(config?.tasa_iva ?? 19) / 100;
  const tasaAnticipo = Number(config?.tasa_anticipo_carne ?? 5) / 100;
  // Margen actual/histórico por producto para la vista previa en vivo (Plan 03)
  const { data: margenProductos } = useQuery({
    queryKey: ['margen-productos'],
    queryFn: async () => (await getMargenProductos()).data as any[],
  });

  const margenMap = useMemo(() => {
    const m = new Map<string, any>();
    (margenProductos ?? []).forEach((r) => m.set(String(r.producto_id), r));
    return m;
  }, [margenProductos]);

  // El costo_por_kilo ingresado en este formulario es SIN IVA (el IVA se
  // calcula aparte para el total de la factura, ver useEffect de subtotal/iva
  // más abajo). precio_por_kilo, en cambio, es precio de boleta CON IVA
  // incluido, así que el margen proyectado se calcula neto de IVA en ambos
  // lados (precio sin IVA - costo neto), igual que en el backend.
  const IVA_RATE = 1.19;

  // Peso promedio por pieza (kg/unidad) de una línea; null si no hay unidades para dividir.
  const pesoPromedio = (kilos: number, unidades: number) =>
    unidades > 0 ? kilos / unidades : null;

  // Margen proyectado de una línea: precio de venta vigente (sin IVA) vs. costo neto.
  const calcMargen = (item: DetalleFacturaForm) => {
    const info = margenMap.get(String(item.producto));
    const precio = Number(info?.precio_por_kilo ?? 0);
    const precioNeto = precio / IVA_RATE;
    const costoNeto = Number(item.costo_por_kilo || 0);
    const margenUnit = precioNeto - costoNeto;
    const pct = precioNeto ? (margenUnit / precioNeto) * 100 : 0;
    const hist = info?.margen_pct_historico;
    // Verde si el margen proyectado supera (o iguala) el margen histórico del
    // producto; si no hay histórico, verde cuando el margen es positivo.
    const mejor = hist == null ? margenUnit >= 0 : pct >= Number(hist);
    return { precio, margenUnit, pct, hist, mejor, tieneInfo: !!info };
  };
  const { enPeriodo } = usePeriodo();
  const { data: facturasTodas, isLoading, error } = useQuery({
    queryKey: ['facturas'],
    queryFn: async () => (await getFacturas()).data as Factura[],
  });
  const facturasData = useMemo(() => facturasTodas?.filter((f) => enPeriodo(f.fecha)), [facturasTodas, enPeriodo]);

  const agregarItem = () => {
    const prod = productos?.find(p => p.id.toString() === nuevoItem.producto_id);
    const kilos = parseDecimal(nuevoItem.cantidad_kilos);
    const unidades = Math.trunc(parseDecimal(nuevoItem.cantidad_unidades));
    const costo = parseDecimal(nuevoItem.costo_por_kilo);

    if (!prod || kilos <= 0 || costo <= 0) {
      toast({ title: "Datos incompletos", description: "Verifica los datos del producto.", variant: "destructive" });
      return;
    }

    const item: DetalleFacturaForm = {
      producto: nuevoItem.producto_id,
      nombre_producto: prod.nombre,
      cantidad_kilos: kilos,
      cantidad_unidades: unidades,
      costo_por_kilo: costo,
      costo_total: kilos * costo
    };

    setDetalles([...detalles, item]);
    setNuevoItem({ producto_id: '', cantidad_kilos: '', cantidad_unidades: '0', costo_por_kilo: '' });
  };

  // Al elegir proveedor se propone el anticipo si su última factura lo traía.
  const proveedorElegido = form.watch('proveedor_id');
  useEffect(() => {
    if (!proveedorElegido) return;
    const ultima = facturasTodas?.find((f) => String(f.proveedor) === proveedorElegido);
    setConAnticipo(Number(ultima?.anticipo_iva ?? 0) > 0);
  }, [proveedorElegido, facturasTodas]);

  const anticipo = conAnticipo ? Math.round(Number(form.watch('subtotal')) * tasaAnticipo) : 0;
  useEffect(() => {
    const subtotal = Math.round(detalles.reduce((acc, curr) => acc + curr.costo_total, 0));
    const iva = Math.round(subtotal * tasaIva);
    const ant = conAnticipo ? Math.round(subtotal * tasaAnticipo) : 0;
    form.setValue('subtotal', String(subtotal));
    form.setValue('iva', String(iva));
    form.setValue('total', String(subtotal + iva + ant));
  }, [detalles, form, conAnticipo, tasaIva, tasaAnticipo]);

  
  const createMutation = useMutation({
    mutationFn: (values: FacturaForm) => {
      const datos = {
        numero_factura: values.numero_factura,
        proveedor: values.proveedor_id,
        fecha: values.fecha,
        fecha_vencimiento: values.fecha_vencimiento || null,
        subtotal: Number(values.subtotal),
        iva: Number(values.iva),
        anticipo_iva: anticipo,
        total: Number(values.total),
        detalles: detalles.map(d => ({
          producto: d.producto, // ID del producto
          cantidad_kilos: d.cantidad_kilos,
          cantidad_unidades: d.cantidad_unidades,
          costo_por_kilo: d.costo_por_kilo,
          costo_total: d.costo_total
        }))
      };
      if (!fotoNueva) return createFactura(datos);
      // Con foto: multipart, y los detalles viajan como JSON en texto.
      const fd = new FormData();
      Object.entries(datos).forEach(([k, v]) => {
        if (v == null) return;
        fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      });
      fd.append('foto', fotoNueva);
      return createFactura(fd);
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['facturas'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      queryClient.invalidateQueries({ queryKey: ['auditoria-pre-reservas'] });
      const asignadas = resumenPreReservas(response?.data?.pre_reservas_asignadas);
      toast({
        title: 'Éxito',
        description: asignadas ? `Factura registrada.\n${asignadas}` : 'Factura registrada.',
        className: 'whitespace-pre-line',
      });
      form.reset({ ...form.formState.defaultValues, fecha: hoyISO() });
      setDetalles([]);
      setFotoNueva(null);
      setDialogOpen(false);
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.response?.data?.error || 'Error al guardar', variant: 'destructive' });
    }
  });

  // Abrir el diálogo de edición pre-poblado con la factura seleccionada.
  const openEdit = (f: Factura) => {
    setEditFactura(f);
    setEditProveedor(f.proveedor != null ? String(f.proveedor) : '');
    setEditFecha(f.fecha ? String(f.fecha).split('T')[0] : '');
    setEditVencimiento(f.fecha_vencimiento ?? '');
    setEditConAnticipo(Number(f.anticipo_iva ?? 0) > 0);
    setEditDetalles((f.detalles || []).map((d: any) => ({
      id: d.id,
      producto: Number(d.producto),
      nombre_producto: d.producto_nombre || '',
      cantidad_kilos: Number(d.cantidad_kilos) || 0,
      cantidad_unidades: Number(d.cantidad_unidades) || 0,
      costo_por_kilo: Number(d.costo_por_kilo) || 0,
      estado_edicion: (d.estado_edicion || 'libre') as EstadoEdicionLinea,
      unidades_consumidas: Number(d.unidades_consumidas) || 0,
      pedidos_consumidores: d.pedidos_consumidores || [],
    })));
    setSelectedFactura(null);
  };

  const updateLinea = (idx: number, patch: Partial<EditLinea>) =>
    setEditDetalles(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  // Totales proyectados de la edición (mismo cálculo que en creación: subtotal + IVA + anticipo).
  const editSubtotal = editDetalles.reduce((acc, l) => acc + l.cantidad_kilos * l.costo_por_kilo, 0);
  const editAnticipo = editConAnticipo ? Math.round(editSubtotal * tasaAnticipo) : 0;
  const editTotal = Math.round(editSubtotal) + Math.round(editSubtotal * tasaIva) + editAnticipo;
  // Una línea parcial no puede quedar por debajo de lo ya vendido.
  const editTieneError = editDetalles.some(
    l => l.estado_edicion === 'parcial' && l.cantidad_unidades < l.unidades_consumidas
  );
  // Advertencia (no bloqueo) si ya hay un pago y el total cambia.
  const totalOriginal = Number(editFactura?.total ?? 0);
  const totalCambia = Math.round(editTotal) !== Math.round(totalOriginal);
  const advertirPago = Boolean(editFactura?.pago_factura) && totalCambia;

  const updateMutation = useMutation({
    mutationFn: () =>
      updateFactura(editFactura!.numero_factura, {
        proveedor: editProveedor,
        fecha: editFecha,
        fecha_vencimiento: editVencimiento || null,
        con_anticipo: editConAnticipo,
        detalles: editDetalles.map(l => ({
          id: l.id,
          producto: l.producto,
          cantidad_kilos: l.cantidad_kilos,
          cantidad_unidades: l.cantidad_unidades,
          costo_por_kilo: l.costo_por_kilo,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facturas'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['margen-productos'] });
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      queryClient.invalidateQueries({ queryKey: ['auditoria-pre-reservas'] });
      toast({ title: 'Éxito', description: 'Factura actualizada.' });
      setEditFactura(null);
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.response?.data?.error || 'Error al actualizar', variant: 'destructive' });
    },
  });

  const pagarMutation = useMutation({
    mutationFn: () =>
      pagarFactura(selectedFactura!.numero_factura, pagoFecha, parseDecimal(pagoMonto)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facturas'] });
      toast({ title: 'Éxito', description: 'Pago registrado.' });
      setSelectedFactura(null);
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.response?.data?.error || 'Error al registrar el pago', variant: 'destructive' });
    },
  });

  // Refresca la lista y el detalle abierto con la factura recién guardada.
  const refrescarFactura = async (numero: string) => {
    await queryClient.invalidateQueries({ queryKey: ['facturas'] });
    const lista = queryClient.getQueryData<Factura[]>(['facturas']);
    const f = lista?.find(x => x.numero_factura === numero);
    if (f) setSelectedFactura(f);
  };

  const subirFoto = async (archivo: File) => {
    if (!selectedFactura) return;
    setSubiendoFoto(true);
    try {
      const fd = new FormData();
      fd.append('foto', archivo);
      await updateFactura(selectedFactura.numero_factura, fd);
      await refrescarFactura(selectedFactura.numero_factura);
      toast({ title: 'Foto guardada' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.response?.data?.error || 'No se pudo subir la foto', variant: 'destructive' });
    } finally {
      setSubiendoFoto(false);
    }
  };

  const ncMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('numero', nc.numero.trim());
      fd.append('fecha', nc.fecha);
      fd.append('neto', String(parseDecimal(nc.neto)));
      fd.append('motivo', nc.motivo);
      if (ncFoto) fd.append('foto', ncFoto);
      return createNotaCredito(selectedFactura!.numero_factura, fd);
    },
    onSuccess: async () => {
      toast({ title: 'Nota de crédito registrada' });
      setNc({ numero: '', fecha: hoyISO(), neto: '', motivo: '' });
      setNcFoto(null);
      setNcAbierta(false);
      await refrescarFactura(selectedFactura!.numero_factura);
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.response?.data?.error || 'No se pudo registrar', variant: 'destructive' });
    },
  });

  const borrarNc = (id: number) => confirm({
    title: '¿Eliminar la nota de crédito?',
    confirmLabel: 'Eliminar',
    destructive: true,
    onConfirm: async () => {
      await deleteNotaCredito(id);
      if (selectedFactura) await refrescarFactura(selectedFactura.numero_factura);
    },
  });

  // Días hasta el vencimiento (negativo = vencida). Sin vencimiento se usa la antigüedad.
  const diasParaVencer = (f: Factura) => (f.fecha_vencimiento ? -diasDesde(f.fecha_vencimiento) : null);

  // Al abrir el detalle de una factura sin pago, precarga fecha de hoy y el total como default.
  useEffect(() => {
    if (selectedFactura && !selectedFactura.pago_factura) {
      setPagoFecha(hoyISO());
      setPagoMonto(String(Math.round(totalAPagar(selectedFactura))));
      setNc({ numero: '', fecha: hoyISO(), neto: '', motivo: '' });
      setNcFoto(null);
      setNcAbierta(false);
    }
  }, [selectedFactura]);

  const filteredFacturas = useMemo(() => {
    return (facturasData ?? []).filter((f) => {
      const matchesSearch = (f.proveedor_nombre || '').toLowerCase().includes(search.toLowerCase()) || 
                            f.numero_factura.toLowerCase().includes(search.toLowerCase());
      const pagado = Boolean(f.pago_factura);
      const matchesPago = pagoFilter === 'todas' || (pagoFilter === 'pagadas' && pagado) || (pagoFilter === 'pendientes' && !pagado);
      const matchesProveedor = proveedorFilter === 'todos' || String(f.proveedor) === proveedorFilter;
      return matchesSearch && matchesPago && matchesProveedor && enRango(f.fecha, rango.rango);
    }).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.numero_factura.localeCompare(a.numero_factura));
  }, [facturasData, search, pagoFilter, proveedorFilter, rango]);

  // Totales de lo que se está viendo (respeta los filtros).
  const resumen = useMemo(() => {
    const pendientes = filteredFacturas.filter((f) => !f.pago_factura);
    return {
      compras: filteredFacturas.reduce((s, f) => s + totalAPagar(f), 0),
      pendiente: pendientes.reduce((s, f) => s + totalAPagar(f), 0),
      cantidadPendientes: pendientes.length,
      vencidas: pendientes.filter(f => (diasParaVencer(f) ?? 1) < 0).length,
      masAntigua: pendientes.reduce<number | null>((max, f) => {
        const d = diasDesde(f.fecha);
        return max == null || d > max ? d : max;
      }, null),
    };
  }, [filteredFacturas]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Error al cargar facturas" />;

  return (
    <div className="space-y-6">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Facturas de Compra</h1>
          <p className="text-muted-foreground">Cada factura registrada suma su mercadería al stock.</p>
        </div>
        
        {/* DIÁLOGO NUEVA FACTURA */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Nueva Factura</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[800px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><FileText className="text-primary" /> Registrar Compra</DialogTitle>
            </DialogHeader>
            <div className="grid gap-6 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Proveedor</Label>
                  <Controller
                    control={form.control}
                    name="proveedor_id"
                    rules={{ required: true }}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger><SelectValue placeholder="Seleccione proveedor" /></SelectTrigger>
                        <SelectContent>
                          {proveedores?.map((p: any) => (
                            <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label>N° Factura</Label>
                  <Input {...form.register('numero_factura', { required: true })} placeholder="0001" />
                </div>
                <div className="space-y-2">
                  <Label>Fecha de la factura</Label>
                  <Input type="date" {...form.register('fecha', { required: true })} />
                </div>
                <div className="space-y-2">
                  <Label>Fecha de vencimiento</Label>
                  <Input type="date" {...form.register('fecha_vencimiento')} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="foto-factura">Foto o PDF de la factura (opcional)</Label>
                  <Input id="foto-factura" type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFotoNueva(e.target.files?.[0] ?? null)} />
                </div>
              </div>

              <div className="border rounded-xl p-4 bg-muted/30 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-12 gap-2">
                  <div className="col-span-2 sm:col-span-4">
                    <Select value={nuevoItem.producto_id} onValueChange={(v) => setNuevoItem({ ...nuevoItem, producto_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Producto" /></SelectTrigger>
                      <SelectContent>
                        {productos?.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1 sm:col-span-2"><DecimalInput aria-label="Kilos" placeholder="Kg" value={nuevoItem.cantidad_kilos} onValueChange={t => setNuevoItem({ ...nuevoItem, cantidad_kilos: t })} /></div>
                  <div className="col-span-1 sm:col-span-2"><DecimalInput decimales={false} aria-label="Unidades" placeholder="Unid." value={nuevoItem.cantidad_unidades} onValueChange={t => setNuevoItem({ ...nuevoItem, cantidad_unidades: t })} /></div>
                  <div className="col-span-1 sm:col-span-3"><DecimalInput aria-label="Costo por kilo sin IVA" placeholder="Costo/Kg neto" value={nuevoItem.costo_por_kilo} onValueChange={t => setNuevoItem({ ...nuevoItem, costo_por_kilo: t })} /></div>
                  <div className="col-span-1"><Button type="button" onClick={agregarItem} className="w-full" aria-label="Agregar línea"><Plus className="h-4 w-4" /></Button></div>
                </div>

                <div className="bg-background rounded-md border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b text-xs uppercase text-muted-foreground font-medium">
                      <tr>
                        <th className="p-2 text-left">Producto</th>
                        <th className="p-2 text-right">Cant.</th>
                        <th className="p-2 text-right">Peso Prom./Pieza</th>
                        <th className="p-2 text-right">Total</th>
                        <th className="p-2 text-right">Margen Proy.</th>
                        <th className="p-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalles.map((item, i) => {
                        const m = calcMargen(item);
                        const peso = pesoPromedio(item.cantidad_kilos, item.cantidad_unidades);
                        return (
                        <tr key={i} className="border-b last:border-0">
                          <td className="p-2">{item.nombre_producto}</td>
                          <td className="p-2 text-right">{item.cantidad_kilos.toLocaleString('es-CL')} Kg</td>
                          <td className="p-2 text-right text-muted-foreground">{peso != null ? `${peso.toFixed(2)} Kg` : '—'}</td>
                          <td className="p-2 text-right font-semibold">{formatCLP(item.costo_total)}</td>
                          <td className="p-2 text-right">
                            {m.tieneInfo ? (
                              <div className={m.mejor ? 'text-green-600' : 'text-destructive'}>
                                <div className="font-bold leading-tight">${Math.round(m.margenUnit).toLocaleString('es-CL')}/kg</div>
                                <div className="text-[10px] leading-tight">
                                  {m.pct.toFixed(1)}%
                                  {m.hist != null && (
                                    <span className="text-muted-foreground"> (hist {Number(m.hist).toFixed(1)}%)</span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-2"><Button variant="ghost" size="icon" onClick={() => setDetalles(detalles.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button></td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap items-end justify-between border-t pt-4 gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Switch checked={conAnticipo} onCheckedChange={setConAnticipo} />
                  <span>Trae anticipo IVA carne ({Math.round(tasaAnticipo * 1000) / 10}%)</span>
                </label>
                <div className="flex gap-8">
                  <div className="text-right"><p className="text-xs text-muted-foreground uppercase">Subtotal</p><p className="font-bold">{formatCLP(form.watch('subtotal'))}</p></div>
                  <div className="text-right"><p className="text-xs text-muted-foreground uppercase">IVA</p><p className="font-bold">{formatCLP(form.watch('iva'))}</p></div>
                  {conAnticipo && <div className="text-right"><p className="text-xs text-muted-foreground uppercase">Anticipo</p><p className="font-bold">{formatCLP(anticipo)}</p></div>}
                  <div className="text-right"><p className="text-xs text-muted-foreground uppercase">Total Factura</p><p className="font-black text-xl text-primary">{formatCLP(form.watch('total'))}</p></div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={form.handleSubmit(
                  (v) => createMutation.mutate(v),
                  () => toast({ title: 'Datos incompletos', description: 'Indica proveedor, número y fecha de la factura.', variant: 'destructive' })
                )} disabled={createMutation.isPending || detalles.length === 0}>Guardar Factura</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* RESUMEN (respeta los filtros) */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        <StatCard title="Compras" value={formatCLP(resumen.compras)} icon={FileText} description={`${filteredFacturas.length} facturas · con IVA`} />
        <StatCard
          title="Por pagar"
          value={formatCLP(resumen.pendiente)}
          icon={Wallet}
          accent={resumen.cantidadPendientes ? 'text-destructive' : 'text-green-600'}
          description={resumen.cantidadPendientes ? `${resumen.cantidadPendientes} facturas pendientes` : 'Todo pagado'}
          onClick={() => setPagoFilter('pendientes')}
        />
        <StatCard
          title="Vencidas"
          value={String(resumen.vencidas)}
          icon={Clock}
          accent={resumen.vencidas ? 'text-destructive' : undefined}
          description={resumen.masAntigua != null ? `La pendiente más antigua es de hace ${resumen.masAntigua} días` : 'Sin pendientes'}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      {/* FILTROS */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por número o proveedor..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={proveedorFilter} onValueChange={setProveedorFilter}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los proveedores</SelectItem>
              {proveedores?.map((p: any) => (
                <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={pagoFilter} onValueChange={(v) => setPagoFilter(v as any)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Pagadas y pendientes</SelectItem>
              <SelectItem value="pagadas">Pagadas</SelectItem>
              <SelectItem value="pendientes">Pendientes</SelectItem>
            </SelectContent>
          </Select>
          <RangoFechaSelect value={rango} onChange={setRango} />
        </div>
      </div>

      {/* LISTADO DE FACTURAS */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Factura</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead className="hidden sm:table-cell">Fecha</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredFacturas.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No hay facturas con estos filtros.</TableCell>
              </TableRow>
            )}
            {filteredFacturas.map((f) => {
              const dias = diasDesde(f.fecha);
              const vence = diasParaVencer(f);
              return (
                <TableRow key={f.numero_factura} className="cursor-pointer" onClick={() => setSelectedFactura(f)}>
                  <TableCell className="font-mono font-semibold text-primary">#{f.numero_factura}</TableCell>
                  <TableCell>
                    <div className="font-medium">{f.proveedor_nombre}</div>
                    <div className="text-xs text-muted-foreground sm:hidden">{formatFecha(f.fecha)}</div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm">{formatFecha(f.fecha)}</TableCell>
                  <TableCell>
                    {f.pago_factura ? (
                      <Badge variant="outline" className="border-green-500 text-green-600">Pagada</Badge>
                    ) : (
                      <div className="flex flex-col items-start gap-0.5">
                        <Badge variant="outline" className={`border-none ${(vence != null ? vence < 0 : dias > 30) ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {vence != null && vence < 0 ? 'Vencida' : 'Pendiente'}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {vence == null
                            ? (dias === 0 ? 'hoy' : `hace ${dias} ${dias === 1 ? 'día' : 'días'}`)
                            : vence < 0 ? `venció hace ${-vence} ${vence === -1 ? 'día' : 'días'}`
                            : vence === 0 ? 'vence hoy' : `vence en ${vence} ${vence === 1 ? 'día' : 'días'}`}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {formatCLP(totalAPagar(f))}
                    {Number(f.total_notas_credito) > 0 && <div className="text-[10px] font-normal text-muted-foreground">con NC</div>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* DIÁLOGO DETALLE DE FACTURA EXISTENTE */}
      <Dialog open={!!selectedFactura} onOpenChange={() => setSelectedFactura(null)}>
        <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" /> 
              Factura #{selectedFactura?.numero_factura}
            </DialogTitle>
            <DialogDescription>
              Detalle completo de la entrada de mercadería.
            </DialogDescription>
          </DialogHeader>
          
          {selectedFactura && (
            <div className="space-y-6">
              {/* Info Cabecera */}
              <div className="grid grid-cols-2 gap-4 text-sm bg-muted/50 p-4 rounded-xl border">
                <div>
                  <Label className="text-muted-foreground uppercase text-[10px] font-bold">Proveedor</Label>
                  <p className="font-semibold text-base">{selectedFactura.proveedor_nombre || 'No especificado'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground uppercase text-[10px] font-bold">Fecha de Ingreso</Label>
                  <p className="font-semibold text-base">{formatFecha(selectedFactura.fecha)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground uppercase text-[10px] font-bold">Vencimiento</Label>
                  <p className="font-semibold text-base">{selectedFactura.fecha_vencimiento ? formatFecha(selectedFactura.fecha_vencimiento) : '—'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground uppercase text-[10px] font-bold">Documento</Label>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {selectedFactura.foto && (
                      <a href={mediaUrl(selectedFactura.foto)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline">
                        Ver foto <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <label className="inline-flex cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                      <Camera className="h-4 w-4" />
                      {subiendoFoto ? 'Subiendo…' : selectedFactura.foto ? 'Cambiar' : 'Subir foto'}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="sr-only"
                        disabled={subiendoFoto}
                        onChange={(e) => e.target.files?.[0] && subirFoto(e.target.files[0])}
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Tabla de Productos */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2"><Package className="h-4 w-4" /> Productos Recibidos</Label>
                <div className="rounded-xl border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b">
                      <tr>
                        <th className="p-3 text-left">Producto</th>
                        <th className="p-3 text-right">Cantidad</th>
                        <th className="p-3 text-right">Peso Prom./Pieza</th>
                        <th className="p-3 text-right">Costo/Kg neto</th>
                        <th className="p-3 text-right">Subtotal</th>
                        <th className="p-3 text-left">Vendido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Intentamos leer de 'detalles' o 'entradas' según tu modelo de Django */}
                      {(selectedFactura.detalles || []).length > 0 ? (
                        selectedFactura.detalles?.map((d: any, i: number) => {
                          const peso = pesoPromedio(Number(d.cantidad_kilos) || 0, Number(d.cantidad_unidades) || 0);
                          return (
                          <tr key={i} className="border-b last:border-0 hover:bg-muted/10">
                            <td className="p-3 font-medium">{d.producto_nombre}</td>
                            <td className="p-3 text-right">{d.cantidad_kilos} Kg / {d.cantidad_unidades} Un.</td>
                            <td className="p-3 text-right text-muted-foreground">{peso != null ? `${peso.toFixed(2)} Kg` : '—'}</td>
                            <td className="p-3 text-right">${Number(d.costo_por_kilo).toLocaleString('es-CL')}</td>
                            <td className="p-3 text-right font-bold text-primary">
                              ${Number(d.costo_total).toLocaleString('es-CL')}
                            </td>
                            <td className="p-3 text-xs">
                              {Number(d.unidades_consumidas) > 0 ? (
                                <>
                                  <span className="font-medium">{d.unidades_consumidas} de {d.cantidad_unidades} un.</span>
                                  {d.pedidos_consumidores?.length > 0 && (
                                    <span className="block text-muted-foreground">Pedidos {d.pedidos_consumidores.map((id: number) => `#${id}`).join(', ')}</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted-foreground">Sin ventas</span>
                              )}
                            </td>
                          </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-muted-foreground italic">
                            No hay detalles registrados para esta factura en la base de datos.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Resumen de Totales */}
              <div className="bg-primary/5 p-4 rounded-xl border border-primary/10 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal Neto:</span>
                  <span className="font-medium">${Number(selectedFactura.subtotal).toLocaleString('es-CL')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">IVA:</span>
                  <span className="font-medium">${Number(selectedFactura.iva).toLocaleString('es-CL')}</span>
                </div>
                {Number(selectedFactura.anticipo_iva) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Anticipo IVA carne:</span>
                    <span className="font-medium">{formatCLP(selectedFactura.anticipo_iva)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xl font-black text-primary border-t pt-2">
                  <span>TOTAL:</span>
                  <span>${Number(selectedFactura.total).toLocaleString('es-CL')}</span>
                </div>
                {Number(selectedFactura.total_notas_credito) > 0 && (
                  <>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Notas de crédito:</span>
                      <span>−{formatCLP(selectedFactura.total_notas_credito)}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>A pagar:</span>
                      <span>{formatCLP(totalAPagar(selectedFactura))}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Notas de crédito */}
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2"><ReceiptText className="h-4 w-4" /> Notas de crédito</Label>
                  {!ncAbierta && (
                    <Button variant="outline" size="sm" onClick={() => setNcAbierta(true)}>
                      <Plus className="mr-1 h-4 w-4" /> Agregar
                    </Button>
                  )}
                </div>
                {(selectedFactura.notas_credito ?? []).length === 0 && !ncAbierta && (
                  <p className="text-sm text-muted-foreground">Sin notas de crédito.</p>
                )}
                {(selectedFactura.notas_credito ?? []).map((n) => (
                  <div key={n.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">NC {n.numero}</span>
                      <span className="text-muted-foreground"> · {formatFecha(n.fecha)}{n.motivo ? ` · ${n.motivo}` : ''}</span>
                      {n.foto && (
                        <a href={mediaUrl(n.foto)} target="_blank" rel="noreferrer" className="ml-2 text-primary underline">foto</a>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-semibold tabular-nums">−{formatCLP(n.total)}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Eliminar nota de crédito" onClick={() => borrarNc(n.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                {ncAbierta && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">N° nota de crédito</Label>
                      <Input value={nc.numero} onChange={(e) => setNc({ ...nc, numero: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Fecha</Label>
                      <Input type="date" value={nc.fecha} onChange={(e) => setNc({ ...nc, fecha: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Monto neto (sin IVA)</Label>
                      <DecimalInput value={nc.neto} onValueChange={(t) => setNc({ ...nc, neto: t })} />
                      {parseDecimal(nc.neto) > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          + IVA {formatCLP(Math.round(parseDecimal(nc.neto) * 0.19))} = {formatCLP(Math.round(parseDecimal(nc.neto) * 1.19))}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Motivo</Label>
                      <Input placeholder="Devolución, diferencia de peso…" value={nc.motivo} onChange={(e) => setNc({ ...nc, motivo: e.target.value })} />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs text-muted-foreground">Foto (opcional)</Label>
                      <Input type="file" accept="image/*,application/pdf" onChange={(e) => setNcFoto(e.target.files?.[0] ?? null)} />
                    </div>
                    <div className="flex gap-2 sm:col-span-2">
                      <Button variant="ghost" onClick={() => setNcAbierta(false)}>Cancelar</Button>
                      <Button
                        className="flex-1"
                        disabled={ncMutation.isPending || !nc.numero.trim() || parseDecimal(nc.neto) <= 0}
                        onClick={() => ncMutation.mutate()}
                      >
                        Guardar nota de crédito
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Estado de pago */}
              {selectedFactura.pago_factura ? (
                <div className="flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700">
                  <BadgeCheck className="h-4 w-4 shrink-0" />
                  <span>
                    Pagada el {formatFecha(selectedFactura.pago_factura.fecha_de_pago)} —
                    ${Number(selectedFactura.pago_factura.monto_del_pago).toLocaleString('es-CL')}
                  </span>
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
                  <Label className="flex items-center gap-2"><BadgeCheck className="h-4 w-4" /> Marcar como pagada</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Fecha de pago</Label>
                      <Input type="date" value={pagoFecha} onChange={(e) => setPagoFecha(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Monto pagado</Label>
                      <DecimalInput value={pagoMonto} onValueChange={setPagoMonto} />
                    </div>
                  </div>
                  <Button
                    className="w-full gap-2"
                    onClick={() => pagarMutation.mutate()}
                    disabled={pagarMutation.isPending || !pagoFecha || !pagoMonto}
                  >
                    <BadgeCheck className="h-4 w-4" /> Registrar pago
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="sm:justify-start">
            <Button variant="secondary" onClick={() => setSelectedFactura(null)}>
              Cerrar Detalle
            </Button>
            <Button variant="default" onClick={() => selectedFactura && openEdit(selectedFactura)} className="ml-auto gap-2">
              <Pencil className="h-4 w-4" /> Editar
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO EDICIÓN DE FACTURA */}
      <Dialog open={!!editFactura} onOpenChange={(o) => !o && setEditFactura(null)}>
        <DialogContent className="sm:max-w-[820px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <Pencil className="h-6 w-6 text-primary" /> Editar Factura #{editFactura?.numero_factura}
            </DialogTitle>
            <DialogDescription>
              Los cambios de cantidad/costo están limitados según cuánto stock de cada línea ya se vendió.
              Los márgenes de ventas pasadas no se recalculan.
            </DialogDescription>
          </DialogHeader>

          {editFactura && (
            <div className="space-y-6">
              {/* Cabecera editable */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Proveedor</Label>
                  <Select value={editProveedor} onValueChange={setEditProveedor}>
                    <SelectTrigger><SelectValue placeholder="Seleccione proveedor" /></SelectTrigger>
                    <SelectContent>
                      {proveedores?.map((p: any) => (
                        <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fecha</Label>
                  <Input type="date" value={editFecha} onChange={(e) => setEditFecha(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Vencimiento</Label>
                  <Input type="date" value={editVencimiento} onChange={(e) => setEditVencimiento(e.target.value)} />
                </div>
              </div>

              {/* Líneas con guardas de stock */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2"><Package className="h-4 w-4" /> Líneas de la factura</Label>
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b text-xs uppercase text-muted-foreground font-medium">
                      <tr>
                        <th className="p-2 text-left">Producto</th>
                        <th className="p-2 text-right w-24">Kg</th>
                        <th className="p-2 text-right w-24">Unid.</th>
                        <th className="p-2 text-right w-28">Costo/Kg</th>
                        <th className="p-2 text-left w-40">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editDetalles.map((l, i) => {
                        const bloqueada = l.estado_edicion === 'bloqueada';
                        const parcial = l.estado_edicion === 'parcial';
                        const errorLinea = parcial && l.cantidad_unidades < l.unidades_consumidas;
                        return (
                          <tr key={l.id ?? i} className="border-b last:border-0 align-top">
                            <td className="p-2 font-medium">{l.nombre_producto}</td>
                            <td className="p-2">
                              <Input
                                type="number"
                                className="text-right h-8"
                                disabled={bloqueada}
                                value={l.cantidad_kilos}
                                onChange={(e) => updateLinea(i, { cantidad_kilos: parseFloat(e.target.value) || 0 })}
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                type="number"
                                className={`text-right h-8 ${errorLinea ? 'border-destructive' : ''}`}
                                disabled={bloqueada}
                                min={parcial ? l.unidades_consumidas : 0}
                                value={l.cantidad_unidades}
                                onChange={(e) => updateLinea(i, { cantidad_unidades: parseInt(e.target.value) || 0 })}
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                type="number"
                                className="text-right h-8"
                                disabled={bloqueada}
                                value={l.costo_por_kilo}
                                onChange={(e) => updateLinea(i, { costo_por_kilo: parseFloat(e.target.value) || 0 })}
                              />
                            </td>
                            <td className="p-2">
                              {bloqueada ? (
                                <div
                                  className="space-y-1"
                                  title={l.pedidos_consumidores.length ? `Vendida en pedido(s): ${l.pedidos_consumidores.join(', ')}` : 'Stock totalmente consumido'}
                                >
                                  <Badge variant="destructive" className="gap-1"><Lock className="h-3 w-3" /> Vendida</Badge>
                                  <p className="text-[10px] text-muted-foreground leading-tight">
                                    {l.pedidos_consumidores.length
                                      ? `Pedido(s): ${l.pedidos_consumidores.join(', ')}`
                                      : 'Sin stock disponible'}
                                  </p>
                                </div>
                              ) : parcial ? (
                                <div className="space-y-1">
                                  <Badge variant="outline" className="border-amber-500 text-amber-600 gap-1">
                                    <AlertTriangle className="h-3 w-3" /> Parcial
                                  </Badge>
                                  <p className={`text-[10px] leading-tight ${errorLinea ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                                    {l.unidades_consumidas} unid. ya vendidas (mínimo)
                                  </p>
                                </div>
                              ) : (
                                <Badge variant="secondary">Editable</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Advertencia de pago desincronizado */}
              {advertirPago && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Esta factura ya tiene un pago registrado. El nuevo total (${Math.round(editTotal).toLocaleString('es-CL')})
                    no coincide con el monto pagado; deberás reconciliar el pago manualmente.
                  </span>
                </div>
              )}

              {/* Totales proyectados */}
              <div className="flex flex-wrap items-end justify-end border-t pt-4 gap-8">
                <label className="flex items-center gap-2 text-sm cursor-pointer mr-auto">
                  <Switch checked={editConAnticipo} onCheckedChange={setEditConAnticipo} />
                  <span>Anticipo IVA carne{editAnticipo > 0 && `: ${formatCLP(editAnticipo)}`}</span>
                </label>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground uppercase">Subtotal</p>
                  <p className="font-bold">${Math.round(editSubtotal).toLocaleString('es-CL')}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground uppercase">Total</p>
                  <p className="font-black text-xl text-primary">${Math.round(editTotal).toLocaleString('es-CL')}</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditFactura(null)}>Cancelar</Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || editTieneError}
            >
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}