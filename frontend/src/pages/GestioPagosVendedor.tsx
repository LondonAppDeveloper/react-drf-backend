import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  History, Image as ImageIcon, ExternalLink, Trash2, ShoppingCart, BadgeCheck, HandCoins, Scale,
} from 'lucide-react';
import { getVendedores, getPedidos, getPagosVendedor, createPagoVendedor, deletePagoVendedor } from '@/services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatCard } from '@/components/shared/StatCard';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import { usePeriodo } from '@/contexts/PeriodoContext';
import { formatCLP, formatFecha } from '@/lib/utils';
import { calcularSaldosVendedores, pagosDesdeRespuesta, type PagoVendedor } from '@/lib/saldos';
import type { Pedido, Vendedor } from '@/types';

const getImageUrl = (path: string | null | undefined) => {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  // El backend devuelve "comprobantes_pagos/aa.jpg" y Django lo sirve bajo /media/.
  const fileName = path.split('/').pop();
  return `${cleanBase}/media/${fileName}`;
};

const saldoTexto = (saldo: number) => (saldo >= 0 ? formatCLP(saldo) : `${formatCLP(-saldo)} a favor`);

export default function GestionPagosVendedor() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [vendedorId, setVendedorId] = useState<string>('todos');
  const [tipoMovimiento, setTipoMovimiento] = useState<'pago' | 'adelanto'>('pago');
  const [form, setForm] = useState({ monto: '', comentario: '' });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  // Mismas claves que el Resumen y Pedidos para compartir caché.
  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: async () => (await getVendedores()).data as Vendedor[],
  });
  const { enPeriodo } = usePeriodo();
  const { data: todosPedidos } = useQuery({
    queryKey: ['pedidos'],
    queryFn: async () => (await getPedidos(true)).data as Pedido[],
  });
  const { data: pagosTodos = [] } = useQuery({
    queryKey: ['pagos-vendedor'],
    queryFn: async () => pagosDesdeRespuesta((await getPagosVendedor()).data),
  });

  const todosPagos = useMemo(() => pagosTodos.filter((p) => enPeriodo(p.fecha)), [pagosTodos, enPeriodo]);
  const pedidosVigentes = useMemo(
    () => (todosPedidos ?? []).filter((p) => p.estado !== 'Anulado' && enPeriodo(p.fecha)),
    [todosPedidos, enPeriodo]
  );
  const resumen = useMemo(
    () => calcularSaldosVendedores(vendedores, pedidosVigentes, todosPagos),
    [vendedores, pedidosVigentes, todosPagos]
  );
  const totales = resumen.reduce(
    (acc, v) => ({
      ventas: acc.ventas + v.ventas,
      pagos: acc.pagos + v.pagos,
      adelantos: acc.adelantos + v.adelantos,
      saldo: acc.saldo + v.saldo,
    }),
    { ventas: 0, pagos: 0, adelantos: 0, saldo: 0 }
  );

  const seleccionado = resumen.find((v) => String(v.id) === vendedorId);
  const movimientos = todosPagos
    .filter((p) => String(p.vendedor) === vendedorId)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  const crearMutation = useMutation({
    mutationFn: createPagoVendedor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pagos-vendedor'] });
      toast({ title: `${tipoMovimiento === 'pago' ? 'Pago' : 'Adelanto'} registrado` });
      setForm({ monto: '', comentario: '' });
      setArchivo(null);
    },
    onError: (err: any) =>
      toast({ title: 'Error al registrar', description: err?.response?.data?.error, variant: 'destructive' }),
  });

  const borrarMutation = useMutation({
    mutationFn: (id: number) => deletePagoVendedor(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pagos-vendedor'] });
      toast({ title: 'Movimiento eliminado' });
    },
    onError: (err: any) =>
      toast({ title: 'No se pudo eliminar', description: err?.response?.data?.error, variant: 'destructive' }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (vendedorId === 'todos' || !Number(form.monto)) {
      toast({ title: 'Faltan datos', description: 'Ingresa un monto mayor a cero.', variant: 'destructive' });
      return;
    }
    const formData = new FormData();
    formData.append('vendedor', vendedorId);
    formData.append('monto', form.monto);
    formData.append('comentario', form.comentario);
    formData.append('tipo', tipoMovimiento);
    if (archivo) formData.append('comprobante', archivo);
    crearMutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      {confirmDialog}

      <Dialog open={!!imgUrl} onOpenChange={(o) => !o && setImgUrl(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Comprobante adjunto</DialogTitle></DialogHeader>
          <div className="flex justify-center bg-muted/40 p-2 rounded-lg border min-h-[300px] items-center">
            {imgUrl && <img src={imgUrl} alt="Comprobante" className="max-h-[70vh] object-contain shadow-md" />}
          </div>
          <Button variant="outline" onClick={() => imgUrl && window.open(imgUrl, '_blank')} className="w-full">
            <ExternalLink className="h-4 w-4 mr-2" /> Abrir en pestaña nueva
          </Button>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Pagos de Vendedores</h1>
          <p className="text-muted-foreground">Lo que cada vendedor ha vendido, rendido y adelantado.</p>
        </div>
        <Select value={vendedorId} onValueChange={setVendedorId}>
          <SelectTrigger className="w-full md:w-72">
            <SelectValue placeholder="Seleccionar vendedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Resumen de todos</SelectItem>
            {vendedores.map((v) => (
              <SelectItem key={v.id} value={v.id.toString()}>{v.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {vendedorId === 'todos' ? (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Vendedor</TableHead>
                <TableHead className="text-right">Ventas</TableHead>
                <TableHead className="text-right">Pagado</TableHead>
                <TableHead className="text-right">Adelantos</TableHead>
                <TableHead className="text-right">Saldo por rendir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resumen.map((v) => (
                <TableRow key={v.id} className="cursor-pointer" onClick={() => setVendedorId(v.id.toString())}>
                  <TableCell className="font-semibold">{v.nombre}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(v.ventas)}</TableCell>
                  <TableCell className="text-right tabular-nums text-green-600">{formatCLP(v.pagos)}</TableCell>
                  <TableCell className="text-right tabular-nums text-blue-600">{formatCLP(v.adelantos)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-bold ${v.saldo > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                    {saldoTexto(v.saldo)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{formatCLP(totales.ventas)}</TableCell>
                <TableCell className="text-right tabular-nums text-green-600">{formatCLP(totales.pagos)}</TableCell>
                <TableCell className="text-right tabular-nums text-blue-600">{formatCLP(totales.adelantos)}</TableCell>
                <TableCell className="text-right tabular-nums text-orange-600">{saldoTexto(totales.saldo)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <p className="px-4 py-3 text-xs text-muted-foreground border-t">
            Ventas = pedidos no anulados (con IVA). Saldo = ventas − pagos − adelantos. Toca un vendedor para ver su detalle.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {seleccionado && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Ventas" value={formatCLP(seleccionado.ventas)} icon={ShoppingCart} />
              <StatCard title="Pagado" value={formatCLP(seleccionado.pagos)} icon={BadgeCheck} accent="text-green-600" />
              <StatCard title="Adelantos" value={formatCLP(seleccionado.adelantos)} icon={HandCoins} accent="text-blue-600" />
              <StatCard
                title="Saldo por rendir"
                value={saldoTexto(seleccionado.saldo)}
                icon={Scale}
                accent={seleccionado.saldo > 0 ? 'text-orange-600' : 'text-green-600'}
              />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardContent className="pt-6">
                <Tabs value={tipoMovimiento} onValueChange={(v) => setTipoMovimiento(v as 'pago' | 'adelanto')}>
                  <TabsList className="grid grid-cols-2 mb-4">
                    <TabsTrigger value="pago">Pago</TabsTrigger>
                    <TabsTrigger value="adelanto">Adelanto</TabsTrigger>
                  </TabsList>
                </Tabs>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="pago-monto">Monto</Label>
                    <Input
                      id="pago-monto"
                      type="number"
                      min={1}
                      required
                      value={form.monto}
                      onChange={(e) => setForm({ ...form, monto: e.target.value })}
                      className="text-xl font-bold text-center"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pago-comentario">Comentario</Label>
                    <Input
                      id="pago-comentario"
                      value={form.comentario}
                      onChange={(e) => setForm({ ...form, comentario: e.target.value })}
                      placeholder="Referencia de pago..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pago-comprobante">Comprobante (opcional)</Label>
                    <Input id="pago-comprobante" type="file" accept="image/*" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
                  </div>
                  <Button type="submit" className="w-full" disabled={crearMutation.isPending}>
                    {crearMutation.isPending ? 'Guardando...' : `Registrar ${tipoMovimiento === 'pago' ? 'pago' : 'adelanto'}`}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="py-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4" /> Movimientos de {seleccionado?.nombre}
                </CardTitle>
              </CardHeader>
              <div className="max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Detalle</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead className="w-20 text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movimientos.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">Sin movimientos.</TableCell>
                      </TableRow>
                    )}
                    {movimientos.map((p: PagoVendedor) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs whitespace-nowrap">{formatFecha(p.fecha)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={p.tipo === 'pago' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}>
                            {p.tipo === 'pago' ? 'Pago' : 'Adelanto'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm max-w-[220px] truncate">{p.comentario || '—'}</TableCell>
                        <TableCell className="text-right font-bold tabular-nums">{formatCLP(p.monto)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {p.comprobante && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Ver comprobante" onClick={() => setImgUrl(getImageUrl(p.comprobante))}>
                              <ImageIcon className="h-4 w-4 text-primary" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            title="Eliminar"
                            onClick={() =>
                              confirm({
                                title: '¿Eliminar este movimiento?',
                                description: `${p.tipo === 'pago' ? 'Pago' : 'Adelanto'} de ${formatCLP(p.monto)} del ${formatFecha(p.fecha)}. Esta acción no se puede deshacer.`,
                                confirmLabel: 'Eliminar',
                                destructive: true,
                                onConfirm: () => borrarMutation.mutate(p.id),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
