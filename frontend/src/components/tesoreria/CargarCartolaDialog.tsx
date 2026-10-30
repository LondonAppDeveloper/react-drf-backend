import { useState } from 'react';
import * as XLSX from 'xlsx';
import { FileUp, Loader2, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { analizarCartola, importarCartola } from '@/services/api';
import { cn, formatCLP, formatFecha } from '@/lib/utils';

interface MovimientoPrevio {
  fecha: string;
  descripcion: string;
  monto: number | string;
  saldo: number | string | null;
  documento: string;
  huella: string;
  duplicado: boolean;
  posible_duplicado: boolean;
}

interface Analisis {
  metodo: 'planilla' | 'ia';
  banco: string;
  columnas: Record<string, string>;
  movimientos: MovimientoPrevio[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const celdaATexto = (c: unknown) =>
  c instanceof Date ? `${c.getFullYear()}-${pad(c.getMonth() + 1)}-${pad(c.getDate())}` : c ?? '';

// Planilla (xlsx, xls, csv, ods) -> grilla de celdas por hoja. La detección de
// columnas la hace el backend, así funciona con el formato de cualquier banco.
async function leerHojas(archivo: File): Promise<unknown[][][]> {
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array', cellDates: true });
  return libro.SheetNames.map((nombre) =>
    XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[nombre], { header: 1, raw: true, defval: '' })
      .map((fila) => fila.map(celdaATexto))
  ).filter((hoja) => hoja.length > 1);
}

export function CargarCartolaDialog({
  open, onOpenChange, onImportada,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImportada: () => void;
}) {
  const { toast } = useToast();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [incluir, setIncluir] = useState<Record<string, boolean>>({});

  const reiniciar = () => {
    setArchivo(null);
    setAnalisis(null);
    setIncluir({});
  };

  const errorDe = (e: any) => e?.response?.data?.error || e?.message || 'No se pudo leer la cartola';

  const analizar = async (f: File) => {
    setArchivo(f);
    setAnalisis(null);
    setAnalizando(true);
    try {
      let respuesta;
      const esPlanilla = /\.(xlsx|xls|xlsm|csv|ods|txt)$/i.test(f.name);
      if (esPlanilla) {
        // Se prueba cada hoja hasta encontrar una con movimientos.
        let ultimoError: unknown = new Error('El archivo no tiene datos');
        for (const filas of await leerHojas(f)) {
          try {
            respuesta = await analizarCartola({ filas, nombre_archivo: f.name });
            break;
          } catch (e) {
            ultimoError = e;
          }
        }
        if (!respuesta) throw ultimoError;
      } else {
        const fd = new FormData();
        fd.append('archivo', f);
        respuesta = await analizarCartola(fd);
      }
      const datos = respuesta.data as Analisis;
      setAnalisis(datos);
      setIncluir(Object.fromEntries(datos.movimientos.map((m) => [m.huella, !m.duplicado && !m.posible_duplicado])));
    } catch (e) {
      toast({ title: 'No se pudo leer la cartola', description: errorDe(e), variant: 'destructive' });
    } finally {
      setAnalizando(false);
    }
  };

  const importar = async () => {
    if (!analisis || !archivo) return;
    setImportando(true);
    try {
      const { data } = await importarCartola({
        nombre_archivo: archivo.name,
        banco: analisis.banco,
        metodo: analisis.metodo,
        movimientos: analisis.movimientos.map((m) => ({ ...m, incluir: !!incluir[m.huella] && !m.duplicado })),
      });
      toast({
        title: 'Cartola cargada',
        description: `${data.nuevos} movimiento(s) nuevo(s)${data.omitidos ? ` · ${data.omitidos} omitido(s) por estar repetidos o desmarcados` : ''}.`,
      });
      reiniciar();
      onOpenChange(false);
      onImportada();
    } catch (e) {
      toast({ title: 'Error', description: errorDe(e), variant: 'destructive' });
    } finally {
      setImportando(false);
    }
  };

  const movs = analisis?.movimientos ?? [];
  const nuevos = movs.filter((m) => !m.duplicado && incluir[m.huella]);
  const repetidos = movs.filter((m) => m.duplicado).length;
  const abonos = nuevos.filter((m) => Number(m.monto) > 0).reduce((s, m) => s + Number(m.monto), 0);
  const cargos = nuevos.filter((m) => Number(m.monto) < 0).reduce((s, m) => s + Number(m.monto), 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reiniciar(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-[820px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Subir cartola</DialogTitle>
          <DialogDescription>
            Excel, CSV o PDF de cualquier banco. Los movimientos que ya estaban cargados se omiten solos, así que puedes subir cartolas que se traslapan.
          </DialogDescription>
        </DialogHeader>

        <label
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:bg-muted/50',
            analizando && 'pointer-events-none opacity-60'
          )}
        >
          {analizando ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileUp className="h-6 w-6 text-muted-foreground" />}
          <span className="text-sm font-medium">
            {analizando
              ? archivo && /\.pdf$/i.test(archivo.name) ? 'Leyendo el PDF… puede tardar un minuto' : 'Analizando…'
              : archivo ? archivo.name : 'Elegir archivo de la cartola'}
          </span>
          <Input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.ods,.txt,.pdf"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) analizar(f);
            }}
          />
        </label>

        {analisis && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {analisis.metodo === 'ia' && (
                <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" /> Leída automáticamente</Badge>
              )}
              {analisis.banco && <Badge variant="outline">{analisis.banco}</Badge>}
              <span className="text-muted-foreground">
                {movs.length} movimientos · <b className="text-foreground">{nuevos.length} a importar</b>
                {repetidos > 0 && ` · ${repetidos} ya cargados`}
              </span>
              <span className="ml-auto tabular-nums">
                <span className="text-green-700">+{formatCLP(abonos)}</span>{' '}
                <span className="text-destructive">{formatCLP(cargos)}</span>
              </span>
            </div>
            {Object.keys(analisis.columnas).length > 0 && (
              <p className="text-xs text-muted-foreground">
                Columnas detectadas: {Object.entries(analisis.columnas).map(([k, v]) => `${k} = "${v}"`).join(' · ')}
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="w-8 p-2"></th>
                    <th className="p-2 text-left">Fecha</th>
                    <th className="p-2 text-left">Descripción</th>
                    <th className="p-2 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {movs.map((m) => (
                    <tr key={m.huella} className={cn('border-t', (m.duplicado || !incluir[m.huella]) && 'opacity-50')}>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          aria-label="Importar este movimiento"
                          disabled={m.duplicado}
                          checked={!m.duplicado && !!incluir[m.huella]}
                          onChange={(e) => setIncluir((p) => ({ ...p, [m.huella]: e.target.checked }))}
                        />
                      </td>
                      <td className="whitespace-nowrap p-2">{formatFecha(m.fecha)}</td>
                      <td className="p-2">
                        {m.descripcion}
                        {m.duplicado && <Badge variant="secondary" className="ml-2 text-[10px]">Ya cargado</Badge>}
                        {m.posible_duplicado && (
                          <Badge variant="outline" className="ml-2 border-amber-500 text-[10px] text-amber-700" title="Hay otro movimiento cargado con la misma fecha y monto">
                            ¿Repetido?
                          </Badge>
                        )}
                      </td>
                      <td className={cn('whitespace-nowrap p-2 text-right font-medium tabular-nums', Number(m.monto) > 0 ? 'text-green-700' : 'text-destructive')}>
                        {Number(m.monto) > 0 ? '+' : ''}{formatCLP(m.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={importar} disabled={!analisis || nuevos.length === 0 || importando}>
            {importando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Importar {nuevos.length || ''} movimiento{nuevos.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
