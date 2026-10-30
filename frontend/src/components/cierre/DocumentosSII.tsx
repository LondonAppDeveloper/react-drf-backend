import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { actualizarDocumento, getImportacionesSII, importarArchivoSII } from '@/services/api';
import { formatCLP, formatFecha } from '@/lib/utils';
import { TIPOS_DOCUMENTO, type DocumentoCierre, type PedidoCierre } from '@/lib/cierre';

interface Importacion {
  id: number; nombre_archivo: string; tipo: 'ventas' | 'compras' | 'resumen'; mes: string; filas: number;
  nuevos: number; actualizados: number; resultado: any; usuario: string | null; subida: string;
}

const nombreTipo = (t: number) => TIPOS_DOCUMENTO.find((x) => x.value === t)?.label ?? `Tipo ${t}`;

export function DocumentosSII({ mes, pedidos, sinPedido }: { mes: string; pedidos: PedidoCierre[]; sinPedido: DocumentoCierre[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const archivo = useRef<HTMLInputElement>(null);
  const [ultima, setUltima] = useState<Importacion | null>(null);

  const { data: importaciones = [] } = useQuery({
    queryKey: ['importaciones-sii'],
    queryFn: async () => (await getImportacionesSII()).data as Importacion[],
  });

  const subir = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('archivo', file);
      fd.append('mes', mes);
      return importarArchivoSII(fd);
    },
    onSuccess: (r) => {
      setUltima(r.data);
      queryClient.invalidateQueries({ queryKey: ['importaciones-sii'] });
      queryClient.invalidateQueries({ queryKey: ['cierre-ventas'] });
      queryClient.invalidateQueries({ queryKey: ['proveedores'] });
      toast({ title: 'Archivo procesado' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.error || 'No se pudo leer el archivo', variant: 'destructive' }),
    onSettled: () => { if (archivo.current) archivo.current.value = ''; },
  });

  const asociar = (doc: DocumentoCierre, pedido: string) =>
    actualizarDocumento(doc.id, { pedido: Number(pedido) })
      .then(() => queryClient.invalidateQueries({ queryKey: ['cierre-ventas'] }))
      .catch((e) => toast({ title: 'Error', description: e?.response?.data?.error, variant: 'destructive' }));

  const disponibles = pedidos.filter((p) => p.estado_tributario === 'pendiente');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subir registro del SII</CardTitle>
          <CardDescription>
            En sii.cl: Servicios online › Factura electrónica › Registro de compras y ventas. Elige el mes y descarga
            el <b>detalle de ventas</b>, el <b>detalle de compras</b> o el <b>resumen</b> (CSV). Puedes subir el mismo archivo varias veces: no se duplica.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input ref={archivo} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => e.target.files?.[0] && subir.mutate(e.target.files[0])} />
          <Button onClick={() => archivo.current?.click()} disabled={subir.isPending}>
            <FileUp className="h-4 w-4 mr-2" />{subir.isPending ? 'Procesando...' : 'Elegir archivo CSV'}
          </Button>
          <p className="flex gap-2 text-xs text-muted-foreground">
            <Info className="h-4 w-4 shrink-0" />
            Las boletas del portal gratuito llegan solo como totales en el resumen; el folio de cada boleta se ingresa en el pedido.
          </p>
          {ultima && <ResultadoImportacion imp={ultima} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documentos del mes sin pedido ({sinPedido.length})</CardTitle>
          <CardDescription>Vinieron del SII o se ingresaron sin pedido. Asócialos para que la venta quede documentada.</CardDescription>
        </CardHeader>
        <CardContent>
          {sinPedido.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-green-600" />Todos los documentos del mes tienen pedido.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Documento</TableHead><TableHead>Receptor</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Pedido</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {sinPedido.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell><p className="font-medium">{d.tipo_nombre} N° {d.folio}</p><p className="text-xs text-muted-foreground">{formatFecha(d.fecha_emision)}</p></TableCell>
                    <TableCell className="text-sm">{d.razon_social || '—'}<p className="text-xs text-muted-foreground">{d.rut_receptor}</p></TableCell>
                    <TableCell className="text-right tabular-nums">{formatCLP(d.total)}</TableCell>
                    <TableCell className="min-w-[200px]">
                      <Select onValueChange={(v) => asociar(d, v)}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Asociar a pedido" /></SelectTrigger>
                        <SelectContent>
                          {disponibles.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>#{p.id} · {p.cliente.nombre} · {formatCLP(p.total)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {importaciones.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Archivos subidos</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Archivo</TableHead><TableHead>Tipo</TableHead><TableHead>Mes</TableHead><TableHead className="text-right">Filas</TableHead><TableHead>Subido</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {importaciones.map((i) => (
                  <TableRow key={i.id} className="cursor-pointer" onClick={() => setUltima(i)}>
                    <TableCell className="text-sm font-medium">{i.nombre_archivo}</TableCell>
                    <TableCell className="text-sm capitalize">{i.tipo}</TableCell>
                    <TableCell className="text-sm">{i.mes}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.filas}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatFecha(i.subida)}{i.usuario && ` · ${i.usuario}`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResultadoImportacion({ imp }: { imp: Importacion }) {
  const r = imp.resultado ?? {};
  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-sm">
      <p className="font-semibold">{imp.nombre_archivo} <span className="font-normal text-muted-foreground">· {imp.tipo} · {imp.mes}</span></p>

      {imp.tipo === 'ventas' && (
        <>
          <p>{r.nuevos} documento(s) nuevo(s), {r.actualizados} ya estaban. {r.asociados} se asociaron solos a su pedido.</p>
          {r.fechas_corregidas?.length > 0 && (
            <p className="text-amber-700 dark:text-amber-400">
              {r.fechas_corregidas.length} documento(s) tenían otra fecha ingresada a mano; quedó la fecha del SII.
            </p>
          )}
        </>
      )}

      {imp.tipo === 'resumen' && (
        <Table>
          <TableHeader><TableRow>
            <TableHead>Tipo</TableHead><TableHead className="text-right">En SII</TableHead><TableHead className="text-right">Registrados aquí</TableHead>
            <TableHead className="text-right">Total SII</TableHead><TableHead className="text-right">Total aquí</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {r.tipos?.map((t: any) => {
              const distinto = t.cantidad_sii !== t.cantidad_registrada || Math.abs(Number(t.total_sii) - Number(t.total_registrado)) > 2;
              return (
                <TableRow key={t.tipo} className={distinto ? 'bg-amber-500/10' : undefined}>
                  <TableCell>{nombreTipo(t.tipo)}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.cantidad_sii}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.cantidad_registrada}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(t.total_sii)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(t.total_registrado)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {imp.tipo === 'compras' && (
        <div className="space-y-3">
          <p>{r.calzan} factura(s) calzan con el sistema.</p>
          {r.ruts_completados?.length > 0 && (
            <p className="text-muted-foreground">Se completó el RUT de: {r.ruts_completados.map((x: any) => x.proveedor).join(', ')}.</p>
          )}
          <ListaCompras titulo="Con diferencias" filas={r.diferencias} detalle={(d) => `${d.motivo}: SII ${formatCLP(d.total_sii)} / aquí ${formatCLP(d.total_sistema)}${d.anticipo_sii != null ? ` · anticipo SII ${formatCLP(d.anticipo_sii)} / aquí ${formatCLP(d.anticipo_sistema)}` : ''}`} />
          <ListaCompras titulo="En el SII pero no ingresadas aquí" filas={r.faltan_en_sistema} detalle={(d) => `${d.razon_social} · ${formatCLP(d.total_sii)}`} />
          <ListaCompras titulo="Ingresadas aquí pero no están en el SII" filas={r.faltan_en_sii} detalle={(d) => `${d.proveedor} · ${formatCLP(d.total_sistema)}`} />
        </div>
      )}
    </div>
  );
}

function ListaCompras({ titulo, filas, detalle }: { titulo: string; filas?: any[]; detalle: (f: any) => string }) {
  if (!filas?.length) return null;
  return (
    <div>
      <p className="font-medium text-amber-700 dark:text-amber-400">{titulo} ({filas.length})</p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {filas.map((f, i) => <li key={i}>Folio {f.folio} · {formatFecha(f.fecha)} · {detalle(f)}</li>)}
      </ul>
    </div>
  );
}
