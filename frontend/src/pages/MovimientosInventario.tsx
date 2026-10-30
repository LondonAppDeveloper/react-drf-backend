import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { invalidarPreReservas } from '@/lib/preReservas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { Search, ArrowUpCircle, ArrowDownCircle, PackageMinus, Plus, Filter, FileSpreadsheet, FileText, Layers, Pencil, Trash2 } from 'lucide-react';
import { getDetalleFacturas, getDetallePedidos, getProductos, getAjustesInventario, createAjusteInventario, updateAjusteInventario, deleteAjusteInventario, getStock } from '@/services/api'; // Asegúrate de tener estos servicios
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { useToast } from '@/hooks/use-toast';
import type { AjusteInventario } from '@/types';
import { enRango, formatFecha, hoyISO } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Link } from 'react-router-dom';
import { RangoFechaSelect, rangoInicial, type RangoState } from '@/components/shared/RangoFechaSelect';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AjusteForm {
  producto: string;
  tipo: 'merma' | 'exceso' | 'ajuste';
  cantidad: string;
  cantidad_unidades: string;
  razon: string;
}

// Los costos de compra se ingresan sin IVA y el precio de venta lo incluye
// (ver nota en backend/core/views.py, seccion Reportes Financieros). Los costos
// se muestran CON IVA para compararlos con el precio de venta, pero la ganancia
// es NETA en ambos lados (venta / 1,19 - costo neto), igual que en Pedidos.tsx
// y Reportes.tsx; si no, la misma venta mostraría un 19% más de ganancia aquí.
const FACTOR_IVA = 1.19;

const gananciaNetaKg = (item: any) =>
  Number(item.precio_venta || 0) / FACTOR_IVA - Number(item.costo_por_kilo || 0);
const gananciaNetaTotal = (item: any) =>
  Number(item.total_venta || 0) / FACTOR_IVA - Number(item.total_costo || 0);

// Redondea a pesos enteros antes de formatear: con decimales sin redondear,
// la coma decimal de es-CL se confunde visualmente con un separador de miles
// (ej. "$12.319,475" se lee como si fuera doce millones).
const formatMonto = (val: number) => Math.round(val).toLocaleString('es-CL');

export default function MovimientosInventario() {
  const [activeTab, setActiveTab] = useState<'entradas' | 'salidas' | 'ajustes' | 'resumen'>('entradas');
  const [filter, setFilter] = useState({
    search: '',
    cliente: '',
    producto: 'todos',
    minKilos: '',
    minUnidades: '',
    numDocumento: ''
  });
  // El período filtra Entradas, Salidas y Ajustes; el Resumen por producto
  // siempre usa el histórico completo porque cuadra contra el stock actual.
  const [periodo, setPeriodo] = useState<RangoState>(rangoInicial('todo'));
  const [selectedFacturas, setSelectedFacturas] = useState<any | null>(null);
  const [ajusteDialogOpen, setAjusteDialogOpen] = useState(false);
  const [ajusteEditando, setAjusteEditando] = useState<AjusteInventario | null>(null);
  const [ajusteAEliminar, setAjusteAEliminar] = useState<AjusteInventario | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 1. Carga de datos simultánea (o podrías condicionar según la tab)
  const { data: entradas, isLoading: loadingE } = useQuery({
    queryKey: ['detalle-facturas'],
    queryFn: async () => (await getDetalleFacturas()).data
  });

  const { data: salidas, isLoading: loadingS } = useQuery({
    queryKey: ['detalle-pedidos'],
    queryFn: async () => (await getDetallePedidos()).data
  });

  const { data: ajustes, isLoading: loadingA } = useQuery({
    queryKey: ['ajustes-inventario'],
    queryFn: async () => (await getAjustesInventario()).data
  });

  const { data: stock } = useQuery({
    queryKey: ['stock'],
    queryFn: async () => (await getStock()).data
  });

  // 2. Carga de Productos para el desplegable
  const { data: productosResponse } = useQuery({
    queryKey: ['productos-lista'],
    queryFn: getProductos
  });

  const listaProductos = useMemo(() => {
    return productosResponse?.data || [];
  }, [productosResponse]);

  const ajusteForm = useForm<AjusteForm>({
    defaultValues: { producto: '', tipo: 'merma', cantidad: '', cantidad_unidades: '', razon: '' },
  });

  // El mismo diálogo sirve para crear y para corregir: si hay un ajuste en
  // edición se hace PUT sobre él, si no se crea uno nuevo.
  const ajusteMutation = useMutation({
    mutationFn: (values: AjusteForm) => {
      const payload = {
        producto: Number(values.producto),
        tipo: values.tipo,
        cantidad: Number(values.cantidad || 0),
        cantidad_unidades: Number(values.cantidad_unidades || 0),
        razon: values.razon || undefined,
      };
      return ajusteEditando
        ? updateAjusteInventario(ajusteEditando.id, payload)
        : createAjusteInventario(payload);
    },
    onSuccess: () => {
      // El backend revierte y vuelve a aplicar el movimiento en el ledger, así
      // que el stock cambia igual que al crear: hay que refrescar ambas listas.
      queryClient.invalidateQueries({ queryKey: ['ajustes-inventario'] });
      invalidarPreReservas(queryClient);
      toast({
        title: ajusteEditando ? 'Ajuste actualizado' : 'Ajuste registrado',
        description: 'El movimiento de inventario se guardó con éxito.',
      });
      cerrarDialogoAjuste();
    },
    onError: (err: any) => {
      toast({
        title: ajusteEditando ? 'Error al actualizar' : 'Error al registrar',
        description: err.response?.data?.error || 'Verifica los datos ingresados.',
        variant: 'destructive',
      });
    },
  });

  const eliminarAjusteMutation = useMutation({
    mutationFn: (id: number) => deleteAjusteInventario(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ajustes-inventario'] });
      invalidarPreReservas(queryClient);
      toast({ title: 'Ajuste eliminado', description: 'El stock volvió a su valor anterior.' });
      setAjusteAEliminar(null);
    },
    onError: (err: any) => {
      toast({
        title: 'No se pudo eliminar',
        description: err.response?.data?.error || 'Intenta nuevamente.',
        variant: 'destructive',
      });
    },
  });

  const abrirNuevoAjuste = () => {
    setAjusteEditando(null);
    ajusteForm.reset({ producto: '', tipo: 'merma', cantidad: '', cantidad_unidades: '', razon: '' });
    setAjusteDialogOpen(true);
  };

  const abrirEdicionAjuste = (a: AjusteInventario) => {
    setAjusteEditando(a);
    // Mermas y excesos se guardan firmados, pero el formulario pide la
    // magnitud en positivo (el signo lo pone el tipo). El ajuste manual sí
    // conserva su signo, porque ahí lo elige el usuario.
    const aMagnitud = (v: number) => (a.tipo === 'ajuste' ? v : Math.abs(v));
    const kilos = aMagnitud(Number(a.cantidad || 0));
    const unidades = aMagnitud(Number(a.cantidad_unidades || 0));
    ajusteForm.reset({
      producto: String(a.producto),
      tipo: a.tipo,
      cantidad: kilos ? String(kilos) : '',
      cantidad_unidades: unidades ? String(unidades) : '',
      razon: a.razon || '',
    });
    setAjusteDialogOpen(true);
  };

  const cerrarDialogoAjuste = () => {
    setAjusteDialogOpen(false);
    setAjusteEditando(null);
    ajusteForm.reset({ producto: '', tipo: 'merma', cantidad: '', cantidad_unidades: '', razon: '' });
  };

  const filteredAjustes = useMemo(() => {
    const data: AjusteInventario[] = Array.isArray(ajustes) ? ajustes : [];
    return data.filter((a) => {
      const matchProducto = filter.producto === 'todos' ||
        a.producto_nombre.toLowerCase() === filter.producto.toLowerCase();
      const matchSearch = (a.razon || '').toLowerCase().includes(filter.search.toLowerCase()) ||
        a.producto_nombre.toLowerCase().includes(filter.search.toLowerCase());
      return matchProducto && matchSearch && enRango(a.fecha, periodo.rango);
    });
  }, [ajustes, filter.producto, filter.search, periodo]);

  // 2. Lógica de filtrado unificada (misma lógica para entradas y salidas,
  // reutilizable tanto para lo que se ve en pantalla como para el export)
  const filtrarEntradasSalidas = (data: any[]) => {
    return (data || []).filter((item: any) => {
      // Normalización de valores para evitar errores si el campo no existe
      const clienteProv = (item.cliente_nombre || item.proveedor_nombre || '').toString().toLowerCase();
      const producto = (item.producto_nombre || item.producto?.nombre || '').toString().toLowerCase();
      const numDoc = (item.pedido || item.factura || '').toString().toLowerCase();

      // Filtros
      const matchCliente = clienteProv.includes(filter.cliente.toLowerCase());
      const matchProducto = filter.producto === 'todos' ||
                            producto === filter.producto.toLowerCase();
      const matchNum = numDoc.includes(filter.numDocumento.toLowerCase());

      const kilos = Number(item.cantidad_kilos || 0);
      const unidades = Number(item.cantidad_unidades || 0);

      const matchKilos = filter.minKilos === '' || kilos >= Number(filter.minKilos);
      const matchUnidades = filter.minUnidades === '' || unidades >= Number(filter.minUnidades);

      return matchCliente && matchProducto && matchNum && matchKilos && matchUnidades && enRango(item.fecha, periodo.rango);
    });
  };

  const filteredEntradas = useMemo(() => filtrarEntradasSalidas(entradas || []), [entradas, filter, periodo]);
  const filteredSalidas = useMemo(() => filtrarEntradasSalidas(salidas || []), [salidas, filter, periodo]);
  const filteredData = activeTab === 'entradas' ? filteredEntradas : filteredSalidas;

  const filaEntradaSalida = (item: any, tab: 'entradas' | 'salidas') => {
    const base: Record<string, any> = {
      'Fecha': formatFecha(item.fecha),
      '#': item.pedido || item.factura,
      'Cliente / Proveedor': item.cliente_nombre || item.proveedor_nombre || 'N/A',
      'Producto': item.producto_nombre || item.producto?.nombre || 'N/A',
      'Unidades': Number(item.cantidad_unidades || 0),
      'Kilos': Number(item.cantidad_kilos || 0),
      'Precio/Kg': Number(tab === 'entradas' ? item.costo_por_kilo : item.precio_venta) || 0,
      'Total': Number(item.cantidad_kilos) * Number(tab === 'entradas' ? item.costo_por_kilo : item.precio_venta) || 0,
    };
    if (tab === 'salidas') {
      const costoConIva = Number(item.costo_por_kilo || 0) * FACTOR_IVA;
      const costoTotalConIva = Number(item.total_costo || 0) * FACTOR_IVA;
      base['Vendedor'] = item.vendedor_nombre || 'N/A';
      base['Costo/Kg'] = costoConIva;
      base['Costo Total'] = costoTotalConIva;
      base['Ganancia neta/Kg'] = gananciaNetaKg(item);
      base['Ganancia neta Total'] = gananciaNetaTotal(item);
    }
    return base;
  };

  // Hoja "Stock" (cuadre): reconstruye, por producto, el mismo Sum que
  // Stock real usa (EntradaProducto, ver backend/core/views.py StockProductos)
  // pero partiendo de las hojas Entradas/Salidas/Ajustes: Calculado = Entradas
  // - Salidas +/- Ajustes. Usa el histórico COMPLETO (sin los filtros de
  // pantalla) porque el cuadre es por producto a nivel global, no por lo que
  // esté filtrado en ese momento. Si "Diferencia" no da 0, ahí está el punto
  // exacto (producto) que hay que revisar.
  type ResumenProducto = {
    producto: string;
    entradasKg: number; entradasUn: number;
    salidasKg: number; salidasUn: number;
    ajustesKg: number; ajustesUn: number;
    saldoKg: number; saldoUn: number;
    stockRealKg: number | null; stockRealUn: number | null;
    diferenciaKg: number | null; diferenciaUn: number | null;
  };

  const resumenProductos = useMemo<ResumenProducto[]>(() => {
    type Acc = { entradasKg: number; entradasUn: number; salidasKg: number; salidasUn: number; ajustesKg: number; ajustesUn: number };
    const porProducto = new Map<string, Acc>();
    const vacio = (): Acc => ({ entradasKg: 0, entradasUn: 0, salidasKg: 0, salidasUn: 0, ajustesKg: 0, ajustesUn: 0 });
    const get = (nombre: string) => {
      if (!porProducto.has(nombre)) porProducto.set(nombre, vacio());
      return porProducto.get(nombre)!;
    };

    (entradas || []).forEach((item: any) => {
      const nombre = item.producto_nombre || item.producto?.nombre || 'N/A';
      const acc = get(nombre);
      acc.entradasKg += Number(item.cantidad_kilos || 0);
      acc.entradasUn += Number(item.cantidad_unidades || 0);
    });
    (salidas || []).forEach((item: any) => {
      const nombre = item.producto_nombre || item.producto?.nombre || 'N/A';
      const acc = get(nombre);
      acc.salidasKg += Number(item.cantidad_kilos || 0);
      acc.salidasUn += Number(item.cantidad_unidades || 0);
    });
    (Array.isArray(ajustes) ? ajustes : []).forEach((a: AjusteInventario) => {
      const acc = get(a.producto_nombre);
      // a.cantidad / a.cantidad_unidades ya vienen con signo (merma resta, exceso suma).
      acc.ajustesKg += Number(a.cantidad || 0);
      acc.ajustesUn += Number(a.cantidad_unidades || 0);
    });

    const stockPorProducto = new Map((Array.isArray(stock) ? stock : []).map((s) => [s.producto, s]));

    return Array.from(porProducto.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([producto, acc]) => {
        const saldoKg = acc.entradasKg - acc.salidasKg + acc.ajustesKg;
        const saldoUn = acc.entradasUn - acc.salidasUn + acc.ajustesUn;
        const real = stockPorProducto.get(producto);
        const stockRealKg = real ? Number(real.kilos_actuales) : null;
        const stockRealUn = real ? Number(real.disponibles) : null;
        return {
          producto,
          entradasKg: acc.entradasKg, entradasUn: acc.entradasUn,
          salidasKg: acc.salidasKg, salidasUn: acc.salidasUn,
          ajustesKg: acc.ajustesKg, ajustesUn: acc.ajustesUn,
          saldoKg, saldoUn,
          stockRealKg, stockRealUn,
          diferenciaKg: stockRealKg !== null ? stockRealKg - saldoKg : null,
          diferenciaUn: stockRealUn !== null ? stockRealUn - saldoUn : null,
        };
      });
  }, [entradas, salidas, ajustes, stock]);

  const filasStockCalculado = () => resumenProductos.map((r) => ({
    'Producto': r.producto,
    'Entradas (kg)': Number(r.entradasKg.toFixed(2)),
    'Entradas (un)': r.entradasUn,
    'Salidas (kg)': Number(r.salidasKg.toFixed(2)),
    'Salidas (un)': r.salidasUn,
    'Ajustes (kg)': Number(r.ajustesKg.toFixed(2)),
    'Ajustes (un)': r.ajustesUn,
    'Stock Calculado (kg)': Number(r.saldoKg.toFixed(2)),
    'Stock Calculado (un)': r.saldoUn,
    'Stock Real (kg)': r.stockRealKg !== null ? Number(r.stockRealKg.toFixed(2)) : 'N/A',
    'Stock Real (un)': r.stockRealUn !== null ? r.stockRealUn : 'N/A',
    'Diferencia (kg)': r.diferenciaKg !== null ? Number(r.diferenciaKg.toFixed(2)) : 'N/A',
    'Diferencia (un)': r.diferenciaUn !== null ? r.diferenciaUn : 'N/A',
  }));

  // El export siempre incluye Entradas, Salidas y Ajustes (con los filtros
  // aplicados a cada una) más una hoja Stock con el cuadre por producto,
  // para que la planilla se pueda reconciliar contra Stock:
  // Stock = Entradas - Salidas +/- Ajustes. Los pedidos Anulados ya vienen
  // excluidos desde el backend (DetallePedidosList), así que nunca se
  // descargan como salida.
  const exportarExcel = () => {
    const filasEntradas = filteredEntradas.map((item: any) => filaEntradaSalida(item, 'entradas'));
    const filasSalidas = filteredSalidas.map((item: any) => filaEntradaSalida(item, 'salidas'));
    const filasAjustes = filteredAjustes.map((a) => ({
      'Fecha': formatFecha(a.fecha),
      'Producto': a.producto_nombre,
      'Tipo': a.tipo === 'ajuste' ? 'Ajuste manual' : a.tipo,
      'Kilos': Number(a.cantidad || 0),
      'Unidades': Number(a.cantidad_unidades || 0),
      'Razón': a.razon || '',
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filasEntradas), 'Entradas');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filasSalidas), 'Salidas');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filasAjustes), 'Ajustes');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filasStockCalculado()), 'Stock');

    const fecha = hoyISO();
    XLSX.writeFile(workbook, `movimientos-inventario-${fecha}.xlsx`);
  };

  if (loadingE || loadingS) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Movimientos de Inventario</h1>
          <p className="text-muted-foreground">Entradas (facturas), salidas (pedidos) y mermas o ajustes.</p>
        </div>
        <RangoFechaSelect value={periodo} onChange={setPeriodo} />
      </div>

      {/* Panel de Filtros */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Pedido / Factura #</Label>
            <Input 
              placeholder="Ej: 1024" 
              value={filter.numDocumento}
              onChange={(e) => setFilter({...filter, numDocumento: e.target.value})}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Cliente / Proveedor</Label>
            <Input 
              placeholder="Buscar cliente..." 
              value={filter.cliente}
              onChange={(e) => setFilter({...filter, cliente: e.target.value})}
            />
          </div>
          {/* FILTRO DE PRODUCTO DESPLEGABLE */}
          <div className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Producto</Label>
            <Select 
              value={filter.producto} 
              onValueChange={(v) => setFilter({...filter, producto: v})}
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Seleccionar producto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los productos</SelectItem>
                {listaProductos.map((p: any) => (
                  <SelectItem key={p.id} value={p.nombre}>
                    {p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Min. Kilos</Label>
            <Input 
              type="number"
              placeholder="0.00" 
              value={filter.minKilos}
              onChange={(e) => setFilter({...filter, minKilos: e.target.value})}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Min. Unidades</Label>
            <Input 
              type="number"
              placeholder="0" 
              value={filter.minUnidades}
              onChange={(e) => setFilter({...filter, minUnidades: e.target.value})}
            />
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="entradas" className="gap-2">
              <ArrowUpCircle className="h-4 w-4 text-green-600" /> Entradas (Facturas)
            </TabsTrigger>
            <TabsTrigger value="salidas" className="gap-2">
              <ArrowDownCircle className="h-4 w-4 text-blue-600" /> Salidas (Pedidos)
            </TabsTrigger>
            <TabsTrigger value="ajustes" className="gap-2">
              <PackageMinus className="h-4 w-4 text-destructive" /> Mermas / Ajustes
            </TabsTrigger>
            <TabsTrigger value="resumen" className="gap-2">
              <Layers className="h-4 w-4 text-amber-600" /> Resumen por Producto
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-4">
            {activeTab === 'ajustes' && (
              <Button size="sm" className="gap-2" onClick={abrirNuevoAjuste}>
                <Plus className="h-4 w-4" />
                Registrar Merma / Ajuste
              </Button>
            )}
            {activeTab !== 'ajustes' && activeTab !== 'resumen' && (
              <div className="text-sm text-muted-foreground">
                Mostrando <b>{filteredData.length}</b> registros
              </div>
            )}
            {activeTab === 'resumen' && (
              <div className="text-sm text-muted-foreground">
                <b>{resumenProductos.length}</b> productos
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={exportarExcel}
              disabled={filteredEntradas.length === 0 && filteredSalidas.length === 0 && filteredAjustes.length === 0}
              title="Descarga entradas, salidas y ajustes en un solo Excel (con los filtros aplicados)"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Exportar a Excel
            </Button>
          </div>
        </div>

        {activeTab === 'resumen' ? (
          <Card>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Entradas</TableHead>
                  <TableHead className="text-right">Salidas</TableHead>
                  <TableHead className="text-right">Ajustes</TableHead>
                  <TableHead className="text-right">Saldo calculado</TableHead>
                  <TableHead className="text-right">Stock real</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resumenProductos.map((r) => {
                  const difKg = r.diferenciaKg !== null && Math.abs(r.diferenciaKg) > 0.01;
                  const difUn = !!r.diferenciaUn;
                  return (
                    <TableRow key={r.producto}>
                      <TableCell className="font-semibold">{r.producto}</TableCell>
                      <TableCell className="text-right text-green-600 tabular-nums"><KgUn kg={r.entradasKg} un={r.entradasUn} /></TableCell>
                      <TableCell className="text-right text-blue-600 tabular-nums"><KgUn kg={r.salidasKg} un={r.salidasUn} /></TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums"><KgUn kg={r.ajustesKg} un={r.ajustesUn} /></TableCell>
                      <TableCell className="text-right font-bold tabular-nums"><KgUn kg={r.saldoKg} un={r.saldoUn} /></TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {r.stockRealKg !== null ? <KgUn kg={r.stockRealKg} un={r.stockRealUn ?? 0} /> : 'N/A'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {difKg || difUn ? (
                          <span className="font-semibold text-destructive"><KgUn kg={r.diferenciaKg ?? 0} un={r.diferenciaUn ?? 0} /></span>
                        ) : (
                          <span className="text-green-600">Cuadra</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {resumenProductos.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      Sin movimientos registrados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <p className="px-4 py-3 text-xs text-muted-foreground border-t">
              Saldo calculado = entradas − salidas ± ajustes, con todo el historial (no aplica el período).
              Stock real en unidades = disponibles.
            </p>
          </Card>
        ) : activeTab === 'ajustes' ? (
          loadingA ? (
            <LoadingSpinner />
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Fecha</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-center">Tipo</TableHead>
                    <TableHead className="text-right">Kilos</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead>Razón</TableHead>
                    <TableHead className="w-[100px] text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAjustes.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{formatFecha(a.fecha)}</TableCell>
                      <TableCell className="font-semibold">{a.producto_nombre}</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={a.tipo === 'merma' ? 'destructive' : a.tipo === 'exceso' ? 'default' : 'secondary'}
                          className="capitalize"
                        >
                          {a.tipo === 'ajuste' ? 'Ajuste manual' : a.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-right font-mono font-medium ${Number(a.cantidad) < 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {Number(a.cantidad) > 0 ? '+' : ''}{Number(a.cantidad).toFixed(2)} kg
                      </TableCell>
                      <TableCell className={`text-right font-mono font-medium ${Number(a.cantidad_unidades) < 0 ? 'text-destructive' : Number(a.cantidad_unidades) > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                        {Number(a.cantidad_unidades) > 0 ? '+' : ''}{Number(a.cantidad_unidades || 0)} un
                      </TableCell>
                      <TableCell className="text-muted-foreground">{a.razon || '—'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Editar"
                            onClick={() => abrirEdicionAjuste(a)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            title="Eliminar"
                            onClick={() => setAjusteAEliminar(a)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredAjustes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                        Sin mermas o ajustes registrados.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          )
        ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Fecha</TableHead>
                <TableHead>{activeTab === 'salidas' ? 'Pedido' : 'Factura'}</TableHead>
                <TableHead>{activeTab === 'salidas' ? 'Cliente' : 'Proveedor'}</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">{activeTab === 'salidas' ? 'Precio/Kg' : 'Costo/Kg neto'}</TableHead>
                <TableHead className="text-right">Total</TableHead>
                {activeTab === 'salidas' && <TableHead className="text-right" title="Costo de lo vendido, con IVA">Costo</TableHead>}
                {activeTab === 'salidas' && <TableHead className="text-right" title="Neta de IVA: venta sin IVA − costo sin IVA">Ganancia neta</TableHead>}
                {activeTab === 'salidas' && <TableHead className="text-center">Facturas</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.map((item: any, index: number) => {
                const costoTotalConIva = Number(item.total_costo || 0) * FACTOR_IVA;
                const gananciaTotal = gananciaNetaTotal(item);
                const precio = Number(activeTab === 'entradas' ? item.costo_por_kilo : item.precio_venta);
                return (
                <TableRow key={`${activeTab}-${index}`}>
                  <TableCell className="whitespace-nowrap text-sm">{formatFecha(item.fecha)}</TableCell>
                  <TableCell className="font-mono font-medium">
                    {activeTab === 'salidas' ? (
                      <Link to={`/pedidos?buscar=${item.pedido}`} className="text-primary hover:underline">#{item.pedido}</Link>
                    ) : (
                      `#${item.factura}`
                    )}
                  </TableCell>
                  <TableCell>
                    <div>{item.cliente_nombre || item.proveedor_nombre || 'N/A'}</div>
                    {activeTab === 'salidas' && item.vendedor_nombre && (
                      <div className="text-xs text-muted-foreground">{item.vendedor_nombre}</div>
                    )}
                  </TableCell>
                  <TableCell className="font-semibold">{item.producto_nombre || item.producto?.nombre || 'N/A'}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    <span className="font-medium text-blue-600">{Number(item.cantidad_kilos).toFixed(2)} kg</span>
                    <span className="block text-xs text-muted-foreground">{Number(item.cantidad_unidades).toFixed(0)} un</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">${formatMonto(precio)}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">${formatMonto(Number(item.cantidad_kilos) * precio)}</TableCell>
                  {activeTab === 'salidas' && (
                    <TableCell className="text-right tabular-nums">${formatMonto(costoTotalConIva)}</TableCell>
                  )}
                  {activeTab === 'salidas' && (
                    <TableCell className={`text-right font-bold tabular-nums ${gananciaTotal >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                      ${formatMonto(gananciaTotal)}
                    </TableCell>
                  )}
                  {activeTab === 'salidas' && (
                    <TableCell className="text-center">
                      {item.facturas_detalle?.length > 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 h-7 px-2"
                          onClick={() => setSelectedFacturas(item)}
                        >
                          <FileText className="h-3 w-3" />
                          {item.facturas_detalle.length}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
                );
              })}
              {filteredData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={activeTab === 'salidas' ? 10 : 7} className="h-32 text-center text-muted-foreground">
                    No se encontraron movimientos con los filtros aplicados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
        )}
      </Tabs>

      {/* DIÁLOGO: REGISTRAR MERMA / EXCESO / AJUSTE MANUAL */}
      <Dialog open={ajusteDialogOpen} onOpenChange={(open) => (open ? setAjusteDialogOpen(true) : cerrarDialogoAjuste())}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{ajusteEditando ? 'Editar Merma / Ajuste' : 'Registrar Merma / Ajuste'}</DialogTitle>
            <DialogDescription>
              {ajusteEditando
                ? 'Al guardar se revierte el movimiento de stock anterior y se aplica el nuevo.'
                : 'Registra una pérdida de inventario (merma), un excedente encontrado, o una corrección manual.'}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={ajusteForm.handleSubmit((v) => ajusteMutation.mutate(v))}
            className="space-y-4 py-2"
          >
            <div className="grid gap-2">
              <Label htmlFor="ajuste-producto">Producto</Label>
              <Select
                value={ajusteForm.watch('producto')}
                onValueChange={(v) => ajusteForm.setValue('producto', v)}
              >
                <SelectTrigger id="ajuste-producto">
                  <SelectValue placeholder="Seleccione un producto" />
                </SelectTrigger>
                <SelectContent>
                  {listaProductos.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ajuste-tipo">Tipo</Label>
              <Select
                value={ajusteForm.watch('tipo')}
                onValueChange={(v: any) => ajusteForm.setValue('tipo', v)}
              >
                <SelectTrigger id="ajuste-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="merma">Merma (pérdida)</SelectItem>
                  <SelectItem value="exceso">Exceso (encontrado)</SelectItem>
                  <SelectItem value="ajuste">Ajuste manual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="ajuste-cantidad">Kilos</Label>
                <Input
                  id="ajuste-cantidad"
                  type="number"
                  step="any"
                  placeholder="0.00"
                  {...ajusteForm.register('cantidad')}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ajuste-unidades">Unidades</Label>
                <Input
                  id="ajuste-unidades"
                  type="number"
                  step="1"
                  placeholder="0"
                  {...ajusteForm.register('cantidad_unidades')}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              {ajusteForm.watch('tipo') === 'ajuste'
                ? 'Se guarda con el signo ingresado (negativo resta stock, positivo suma). Completa kilos, unidades o ambos.'
                : 'Ingresa las cantidades como valores positivos; el signo se ajusta automáticamente según el tipo. Completa kilos, unidades o ambos.'}
            </p>

            <div className="grid gap-2">
              <Label htmlFor="ajuste-razon">Razón (opcional)</Label>
              <Textarea
                id="ajuste-razon"
                placeholder="Ej: Producto vencido, error de conteo, etc."
                {...ajusteForm.register('razon')}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={cerrarDialogoAjuste}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  ajusteMutation.isPending ||
                  !ajusteForm.watch('producto') ||
                  (!Number(ajusteForm.watch('cantidad') || 0) && !Number(ajusteForm.watch('cantidad_unidades') || 0))
                }
              >
                {ajusteMutation.isPending ? 'Guardando...' : ajusteEditando ? 'Guardar cambios' : 'Registrar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* CONFIRMACIÓN: ELIMINAR MERMA / AJUSTE */}
      <AlertDialog open={!!ajusteAEliminar} onOpenChange={(open) => !open && setAjusteAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este movimiento?</AlertDialogTitle>
            <AlertDialogDescription>
              {ajusteAEliminar && (
                <>
                  Se eliminará el registro de{' '}
                  <strong>{ajusteAEliminar.tipo === 'ajuste' ? 'ajuste manual' : ajusteAEliminar.tipo}</strong> de{' '}
                  <strong>{ajusteAEliminar.producto_nombre}</strong> (
                  {Number(ajusteAEliminar.cantidad || 0).toFixed(2)} kg /{' '}
                  {Number(ajusteAEliminar.cantidad_unidades || 0)} un) y el stock volverá a su valor anterior.
                  Esta acción no se puede deshacer.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={eliminarAjusteMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={eliminarAjusteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (ajusteAEliminar) eliminarAjusteMutation.mutate(ajusteAEliminar.id);
              }}
            >
              {eliminarAjusteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* DIÁLOGO: DESGLOSE DE FACTURAS QUE ABASTECIERON ESTA SALIDA */}
      <Dialog open={!!selectedFacturas} onOpenChange={() => setSelectedFacturas(null)}>
        <DialogContent className="max-w-2xl w-[95vw]">
          <DialogHeader>
            <DialogTitle>
              Facturas asociadas — Pedido #{selectedFacturas?.pedido} / {selectedFacturas?.producto_nombre || selectedFacturas?.producto?.nombre}
            </DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Factura</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead className="text-right">Unidades</TableHead>
                <TableHead className="text-right">Kilos atribuidos</TableHead>
                <TableHead className="text-right">Costo/Kg (con IVA)</TableHead>
                <TableHead className="text-right">Costo atribuido (con IVA)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(selectedFacturas?.facturas_detalle || []).map((f: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono">{f.numero_factura}</TableCell>
                  <TableCell>{f.proveedor_nombre || 'N/A'}</TableCell>
                  <TableCell className="text-right">{f.unidades_consumidas}</TableCell>
                  <TableCell className="text-right">{f.kilos_atribuidos != null ? Number(f.kilos_atribuidos).toFixed(2) + ' kg' : '—'}</TableCell>
                  <TableCell className="text-right">{f.costo_por_kilo != null ? `$${formatMonto(Number(f.costo_por_kilo) * FACTOR_IVA)}` : '—'}</TableCell>
                  <TableCell className="text-right font-semibold">{f.costo_atribuido != null ? `$${formatMonto(Number(f.costo_atribuido) * FACTOR_IVA)}` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground px-1">
            Los kilos vendidos se reparten entre las facturas en proporción a las unidades tomadas de cada una,
            por eso pueden no coincidir con el peso de compra. Montos con IVA.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// "10,5 kg · 4 un" en una sola celda para no duplicar columnas.
function KgUn({ kg, un }: { kg: number; un: number }) {
  return (
    <span className="whitespace-nowrap">
      {kg.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
      <span className="text-xs text-muted-foreground"> · {un} un</span>
    </span>
  );
}
