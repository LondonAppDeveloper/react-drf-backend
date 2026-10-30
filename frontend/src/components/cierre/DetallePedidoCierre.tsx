import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Landmark, Plus, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import { crearCobro, crearDocumento, eliminarCobro, eliminarDocumento, actualizarDocumento } from '@/services/api';
import { cn, decimalATexto, formatCLP, formatFecha, formatKg, hoyISO, mediaUrl, parseDecimal } from '@/lib/utils';
import {
  ETIQUETA_COBRO, ETIQUETA_TRIBUTARIO, MEDIOS_PAGO, TIPOS_DOCUMENTO,
  type PedidoCierre, type Receptor,
} from '@/lib/cierre';

interface Props {
  pedido: PedidoCierre | null;
  receptorPorDefecto: Receptor;
  onClose: () => void;
}

export function Etiqueta({ texto, clase }: { texto: string; clase: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', clase)}>{texto}</span>;
}

export function DetallePedidoCierre({ pedido, receptorPorDefecto, onClose }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['cierre-ventas'] });
  const error = (e: any) =>
    toast({ title: 'Error', description: e?.response?.data?.error || 'No se pudo guardar', variant: 'destructive' });

  const [cobro, setCobro] = useState({ monto: '', fecha: hoyISO(), medio: 'transferencia', receptor: receptorPorDefecto, comentario: '' });
  const [marcarPagado, setMarcarPagado] = useState(true);
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [doc, setDoc] = useState({ tipo: '39', folio: '', fecha_emision: hoyISO(), total: '' });

  // Al abrir otro pedido (o al cambiar su saldo) se propone cobrar lo que falta.
  useEffect(() => {
    if (!pedido) return;
    setCobro({ monto: decimalATexto(pedido.saldo), fecha: hoyISO(), medio: 'transferencia', receptor: receptorPorDefecto, comentario: '' });
    setComprobante(null);
  }, [pedido?.id, pedido?.saldo, receptorPorDefecto]); // eslint-disable-line react-hooks/exhaustive-deps

  // Y el documento que corresponde según lo que pidió el cliente.
  useEffect(() => {
    if (!pedido) return;
    setDoc({ tipo: pedido.documento_requerido === 'Factura' ? '33' : '39', folio: '', fecha_emision: hoyISO(),
      total: decimalATexto(pedido.total) });
  }, [pedido?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cobroMutation = useMutation({
    mutationFn: () => {
      const datos: Record<string, string> = {
        pedido: String(pedido!.id), monto: String(parseDecimal(cobro.monto)), fecha: cobro.fecha, medio: cobro.medio,
        receptor: cobro.receptor, comentario: cobro.comentario, marcar_pagado: String(marcarPagado),
      };
      if (!comprobante) return crearCobro(datos);
      const fd = new FormData();
      Object.entries(datos).forEach(([k, v]) => fd.append(k, v));
      fd.append('comprobante', comprobante);
      return crearCobro(fd);
    },
    onSuccess: () => { refrescar(); queryClient.invalidateQueries({ queryKey: ['pedidos'] }); toast({ title: 'Cobro registrado' }); },
    onError: error,
  });

  const docMutation = useMutation({
    mutationFn: () => crearDocumento({ pedido: pedido!.id, tipo: Number(doc.tipo), folio: Number(doc.folio),
      fecha_emision: doc.fecha_emision, total: parseDecimal(doc.total) }),
    onSuccess: () => { refrescar(); setDoc((d) => ({ ...d, folio: '' })); toast({ title: 'Documento registrado' }); },
    onError: error,
  });

  if (!pedido) return null;
  const cobroEtq = ETIQUETA_COBRO[pedido.estado_cobro];
  const tribEtq = ETIQUETA_TRIBUTARIO[pedido.estado_tributario];

  return (
    <Sheet open={!!pedido} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Pedido #{pedido.id} · {pedido.cliente.nombre}</SheetTitle>
          <SheetDescription>
            {formatFecha(pedido.fecha)} · {pedido.vendedor?.nombre ?? 'Sin vendedor'} · pidió {pedido.documento_requerido.toLowerCase()}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Total con IVA</p><p className="font-bold tabular-nums">{formatCLP(pedido.total)}</p></div>
            <div><p className="text-xs text-muted-foreground">Neto</p><p className="font-medium tabular-nums">{formatCLP(pedido.neto)}</p></div>
            <div><p className="text-xs text-muted-foreground">IVA</p><p className="font-medium tabular-nums">{formatCLP(pedido.iva)}</p></div>
            <div><p className="text-xs text-muted-foreground">Costo</p><p className="font-medium tabular-nums">{formatCLP(pedido.costo)}</p></div>
            <div><p className="text-xs text-muted-foreground">Margen</p><p className="font-medium tabular-nums">{formatCLP(pedido.margen)}{pedido.margen_pct != null && ` (${pedido.margen_pct}%)`}</p></div>
            <div><p className="text-xs text-muted-foreground">Estado</p><p className="font-medium">{pedido.estado}</p></div>
          </div>

          {pedido.alertas.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300 space-y-1">
              {pedido.alertas.map((a) => <p key={a} className="flex gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{a}</p>)}
            </div>
          )}

          <section className="space-y-2">
            <h3 className="font-semibold">Productos</h3>
            <div className="rounded-md border divide-y text-sm">
              {pedido.lineas.map((l) => (
                <div key={l.id} className="flex justify-between gap-3 p-2">
                  <div>
                    <p className="font-medium">{l.producto}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatKg(l.kilos)}{l.unidades ? ` · ${Number(l.unidades)} u.` : ''} · {formatCLP(l.precio_venta)}/kg
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p>{formatCLP(l.total)}</p>
                    <p className={cn('text-xs', Number(l.costo) === 0 ? 'text-amber-600' : 'text-muted-foreground')}>
                      costo {formatCLP(l.costo)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Cobros</h3>
              <Etiqueta {...cobroEtq} />
            </div>
            {pedido.cobros.length === 0 && <p className="text-sm text-muted-foreground">No hay cobros registrados.</p>}
            {pedido.cobros.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm">
                <div>
                  <p className="font-medium tabular-nums">{formatCLP(c.monto)} · {MEDIOS_PAGO.find((m) => m.value === c.medio)?.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFecha(c.fecha)} · recibió {c.receptor === 'empresa' ? 'la empresa' : (c.vendedor_nombre ?? 'el vendedor')}
                    {c.usuario && ` · registró ${c.usuario}`}
                  </p>
                  {c.comentario && <p className="text-xs">{c.comentario}</p>}
                  {c.comprobante && <a className="text-xs text-primary hover:underline" href={mediaUrl(c.comprobante)} target="_blank" rel="noreferrer">Ver comprobante</a>}
                </div>
                {c.desde_banco ? (
                  <span title="Viene de la cartola; se quita desde Tesorería"><Landmark className="h-4 w-4 text-muted-foreground" /></span>
                ) : (
                  <Button variant="ghost" size="icon" aria-label="Borrar cobro" onClick={() => confirm({
                    title: 'Borrar cobro', description: `Se borrará el cobro de ${formatCLP(c.monto)}.`, destructive: true,
                    onConfirm: () => eliminarCobro(c.id).then(refrescar).catch(error),
                  })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                )}
              </div>
            ))}
            {Number(pedido.saldo) > 0 && (
              <div className="rounded-md border border-dashed p-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs">Monto</Label>
                    <DecimalInput value={cobro.monto} onValueChange={(v) => setCobro({ ...cobro, monto: v })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Fecha del pago</Label>
                    <Input type="date" value={cobro.fecha} max={hoyISO()} onChange={(e) => setCobro({ ...cobro, fecha: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Medio</Label>
                    <Select value={cobro.medio} onValueChange={(v) => setCobro({ ...cobro, medio: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{MEDIOS_PAGO.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div className="space-y-1"><Label className="text-xs">Quién recibió la plata</Label>
                    <Select value={cobro.receptor} onValueChange={(v) => setCobro({ ...cobro, receptor: v as Receptor })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="vendedor">{pedido.vendedor?.nombre ?? 'El vendedor'}</SelectItem>
                        <SelectItem value="empresa">Cuenta de la empresa</SelectItem>
                      </SelectContent>
                    </Select></div>
                </div>
                <Input placeholder="Comentario (opcional)" value={cobro.comentario} onChange={(e) => setCobro({ ...cobro, comentario: e.target.value })} />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Input type="file" accept="image/*,application/pdf" className="max-w-[220px] text-xs"
                    onChange={(e) => setComprobante(e.target.files?.[0] ?? null)} />
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Switch checked={marcarPagado} onCheckedChange={setMarcarPagado} />
                    Marcar pedido Pagado si queda saldado
                  </label>
                </div>
                <Button size="sm" className="w-full" disabled={cobroMutation.isPending || parseDecimal(cobro.monto) <= 0}
                  onClick={() => cobroMutation.mutate()}><Plus className="h-4 w-4 mr-1" />Registrar cobro</Button>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Documento tributario</h3>
              <Etiqueta {...tribEtq} />
            </div>
            {pedido.documentos.map((d) => (
              <div key={d.id} className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm">
                <div>
                  <p className="font-medium">{d.tipo_nombre} N° {d.folio}</p>
                  <p className="text-xs text-muted-foreground">
                    Emitida el {formatFecha(d.fecha_emision)} · {formatCLP(d.total)} · {d.origen === 'sii' ? 'del registro SII' : `ingresada a mano${d.usuario ? ` por ${d.usuario}` : ''}`}
                  </p>
                </div>
                <Button variant="ghost" size="icon" aria-label={d.origen === 'sii' ? 'Desasociar' : 'Borrar documento'}
                  onClick={() => confirm({
                    title: d.origen === 'sii' ? 'Desasociar documento' : 'Borrar documento',
                    description: d.origen === 'sii'
                      ? 'El documento sigue registrado (viene del SII), pero deja de estar asociado a este pedido.'
                      : `Se borrará ${d.tipo_nombre.toLowerCase()} N° ${d.folio}.`,
                    destructive: true,
                    onConfirm: () => (d.origen === 'sii' ? actualizarDocumento(d.id, { pedido: null }) : eliminarDocumento(d.id))
                      .then(refrescar).catch(error),
                  })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            ))}
            <div className="rounded-md border border-dashed p-3 space-y-3">
              <p className="text-xs text-muted-foreground">Ingresa el documento tal como se emitió en el SII: folio y fecha real de emisión.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2"><Label className="text-xs">Tipo</Label>
                  <Select value={doc.tipo} onValueChange={(v) => setDoc({ ...doc, tipo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TIPOS_DOCUMENTO.map((t) => <SelectItem key={t.value} value={String(t.value)}>{t.label}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="space-y-1"><Label className="text-xs">Folio</Label>
                  <DecimalInput decimales={false} value={doc.folio} onValueChange={(v) => setDoc({ ...doc, folio: v })} /></div>
                <div className="space-y-1"><Label className="text-xs">Fecha de emisión</Label>
                  <Input type="date" value={doc.fecha_emision} max={hoyISO()} onChange={(e) => setDoc({ ...doc, fecha_emision: e.target.value })} /></div>
                <div className="space-y-1 col-span-2"><Label className="text-xs">Total del documento (con IVA)</Label>
                  <DecimalInput value={doc.total} onValueChange={(v) => setDoc({ ...doc, total: v })} /></div>
              </div>
              <Button size="sm" variant="secondary" className="w-full" disabled={docMutation.isPending || !doc.folio}
                onClick={() => docMutation.mutate()}><Plus className="h-4 w-4 mr-1" />Registrar documento</Button>
            </div>
          </section>
        </div>
        {dialog}
      </SheetContent>
    </Sheet>
  );
}
