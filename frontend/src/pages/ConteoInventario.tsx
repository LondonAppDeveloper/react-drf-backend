import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import { createConteo, getConteos, getStockFisico } from '@/services/api';
import { formatFecha } from '@/lib/utils';

type Contado = { kilos: string; unidades: string };

const aNumero = (v: string) => Number(v.replace(',', '.'));
const vacio = (v: string) => v.trim() === '';
const fmtKg = (n: number) => `${n.toLocaleString('es-CL', { maximumFractionDigits: 2 })} kg`;
const signo = (n: number) => (n > 0 ? '+' : '');

function Diferencia({ kilos, unidades }: { kilos: number | null; unidades: number | null }) {
  const partes: string[] = [];
  if (unidades) partes.push(`${signo(unidades)}${unidades} un`);
  if (kilos) partes.push(`${signo(kilos)}${kilos.toLocaleString('es-CL', { maximumFractionDigits: 2 })} kg`);
  if (kilos === null && unidades === null) return <span className="text-muted-foreground">—</span>;
  if (!partes.length) {
    return (
      <span className="inline-flex items-center gap-1 text-green-600">
        <CheckCircle2 className="h-4 w-4" /> Calza
      </span>
    );
  }
  const faltante = (kilos ?? 0) < 0 || (unidades ?? 0) < 0;
  return <span className={faltante ? 'font-medium text-destructive' : 'font-medium text-amber-600'}>{partes.join(' · ')}</span>;
}

export default function ConteoInventario() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [contado, setContado] = useState<Record<number, Contado>>({});
  const [notas, setNotas] = useState('');
  const [confirmando, setConfirmando] = useState(false);

  const stock = useQuery({
    queryKey: ['stock-fisico'],
    queryFn: async () => (await getStockFisico()).data,
    refetchOnMount: true,
  });
  const historial = useQuery({ queryKey: ['conteos'], queryFn: async () => (await getConteos()).data });

  const guardar = useMutation({
    mutationFn: createConteo,
    onSuccess: ({ data }) => {
      toast({
        title: 'Conteo registrado',
        description: data.productos_con_diferencia
          ? `${data.productos_con_diferencia} producto(s) con diferencia, stock ajustado`
          : 'Todo calzó con el sistema',
      });
      setContado({});
      setNotas('');
      setConfirmando(false);
      ['stock-fisico', 'conteos', 'stock', 'ajustes-inventario'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k] })
      );
    },
    onError: (e: any) => {
      setConfirmando(false);
      toast({ title: 'No se pudo registrar', description: e?.response?.data?.error ?? 'Error inesperado', variant: 'destructive' });
    },
  });

  const productos = stock.data ?? [];

  // Una fila queda "contada" si tiene kilos o unidades; lo que se deja vacío no se toca.
  const filas = useMemo(
    () =>
      productos.map((p) => {
        const c = contado[p.id] ?? { kilos: '', unidades: '' };
        const kilos = vacio(c.kilos) ? null : aNumero(c.kilos);
        const unidades = vacio(c.unidades) ? null : aNumero(c.unidades);
        const invalido =
          (kilos !== null && (isNaN(kilos) || kilos < 0)) ||
          (unidades !== null && (isNaN(unidades) || unidades < 0 || !Number.isInteger(unidades)));
        const sisK = Number(p.sistema_kilos);
        return {
          p,
          c,
          invalido,
          contada: !invalido && (kilos !== null || unidades !== null),
          difK: kilos !== null && !invalido ? Math.round((kilos - sisK) * 100) / 100 : null,
          difU: unidades !== null && !invalido ? unidades - p.sistema_unidades : null,
        };
      }),
    [productos, contado]
  );

  const contadas = filas.filter((f) => f.contada);
  const conDiferencia = contadas.filter((f) => f.difK || f.difU);
  const hayInvalidas = filas.some((f) => f.invalido);
  const visibles = filas.filter((f) => f.p.nombre.toLowerCase().includes(search.toLowerCase()));

  const setCampo = (id: number, campo: keyof Contado, valor: string) =>
    setContado((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { kilos: '', unidades: '' }), [campo]: valor } }));

  const registrar = () =>
    guardar.mutate({
      notas,
      lineas: contadas.map((f) => ({
        producto: f.p.id,
        contado_kilos: vacio(f.c.kilos) ? undefined : f.c.kilos,
        contado_unidades: vacio(f.c.unidades) ? undefined : f.c.unidades,
      })),
    });

  if (stock.isLoading) return <LoadingSpinner />;
  if (stock.error) return <ErrorMessage message="No se pudo cargar el inventario" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Cuadrar inventario</h1>
        <p className="text-muted-foreground">
          Ingresa lo que contaste. El sistema lo compara con lo que debería haber y registra las diferencias.
        </p>
      </div>

      <Tabs defaultValue="contar">
        <TabsList>
          <TabsTrigger value="contar">Contar</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="contar" className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar producto..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Sistema</TableHead>
                  <TableHead className="w-28">Contado (un)</TableHead>
                  <TableHead className="w-28">Contado (kg)</TableHead>
                  <TableHead>Diferencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibles.map(({ p, c, invalido, difK, difU }) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.nombre}</TableCell>
                    <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                      {p.sistema_unidades} un · {fmtKg(Number(p.sistema_kilos))}
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="numeric"
                        value={c.unidades}
                        onChange={(e) => setCampo(p.id, 'unidades', e.target.value)}
                        aria-label={`Unidades contadas de ${p.nombre}`}
                        className={invalido ? 'border-destructive' : undefined}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        value={c.kilos}
                        onChange={(e) => setCampo(p.id, 'kilos', e.target.value)}
                        aria-label={`Kilos contados de ${p.nombre}`}
                        className={invalido ? 'border-destructive' : undefined}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Diferencia kilos={difK} unidades={difU} />
                    </TableCell>
                  </TableRow>
                ))}
                {!visibles.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">Sin productos</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <Input placeholder="Notas del conteo (opcional)" value={notas} maxLength={255} onChange={(e) => setNotas(e.target.value)} />

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {contadas.length} contado(s) · {conDiferencia.length} con diferencia. Lo que dejes vacío no se modifica.
            </p>
            <Button disabled={!contadas.length || hayInvalidas || guardar.isPending} onClick={() => setConfirmando(true)}>
              <ClipboardCheck className="mr-2 h-4 w-4" /> Registrar conteo
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="historial" className="space-y-3">
          {historial.isLoading && <LoadingSpinner />}
          {historial.data?.length === 0 && <p className="text-muted-foreground">Aún no hay conteos registrados.</p>}
          {historial.data?.map((conteo) => (
            <Card key={conteo.id}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Conteo #{conteo.id}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatFecha(conteo.fecha)}{conteo.usuario ? ` · ${conteo.usuario}` : ''}
                  </span>
                  <Badge variant={conteo.productos_con_diferencia ? 'destructive' : 'secondary'}>
                    {conteo.productos_con_diferencia ? `${conteo.productos_con_diferencia} con diferencia` : 'Sin diferencias'}
                  </Badge>
                </div>
                {conteo.notas && <p className="text-sm text-muted-foreground">{conteo.notas}</p>}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Sistema</TableHead>
                      <TableHead className="text-right">Contado</TableHead>
                      <TableHead>Diferencia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conteo.detalles.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>{d.producto_nombre}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {d.sistema_unidades} un · {fmtKg(Number(d.sistema_kilos))}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {d.contado_unidades ?? '—'} un · {d.contado_kilos != null ? fmtKg(Number(d.contado_kilos)) : '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Diferencia
                            kilos={d.contado_kilos != null ? Number(d.diferencia_kilos) : null}
                            unidades={d.contado_unidades != null ? d.diferencia_unidades : null}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Registrar conteo</AlertDialogTitle>
            <AlertDialogDescription>
              {conDiferencia.length
                ? `El stock de ${conDiferencia.length} producto(s) se ajustará a lo contado y las diferencias quedarán registradas:`
                : 'Todo lo contado calza con el sistema. No se ajustará nada.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {conDiferencia.length > 0 && (
            <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
              {conDiferencia.map((f) => (
                <li key={f.p.id} className="flex justify-between gap-3">
                  <span>{f.p.nombre}</span>
                  <Diferencia kilos={f.difK} unidades={f.difU} />
                </li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={registrar} disabled={guardar.isPending}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
