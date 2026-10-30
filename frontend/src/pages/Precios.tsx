import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, MessageCircle, Search, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FlyerCanvas } from '@/components/flyer/FlyerCanvas';
import { useToast } from '@/hooks/use-toast';
import { getPerfil, getStock, updateProducto } from '@/services/api';
import { formatKg, mediaUrl } from '@/lib/utils';
import {
  ERROR_FOTOS,
  MENSAJE_INICIAL,
  compartirFlyer,
  descargarArchivo,
  filasDelFlyer,
  generarImagen,
  leerConfig,
  nombreArchivoFlyer,
  productosDelFlyer,
  useImagenFlyer,
} from '@/lib/flyer';
import type { StockItem } from '@/types';

const CLAVE_STOCK = ['stock', 'precios'];

// Vista rápida para consultar qué hay y a cuánto: solo productos disponibles,
// con stock, ordenados de mayor a menor existencia. El precio se edita ahí mismo
// y el flyer (con la configuración de la pantalla Flyer) se comparte o descarga al toque.
export default function Precios() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busqueda, setBusqueda] = useState('');
  const [editando, setEditando] = useState<Record<number, string>>({});
  const [exportando, setExportando] = useState(false);
  const flyerRef = useRef<HTMLDivElement>(null);
  const [config] = useState(leerConfig);

  const { data, isLoading, error } = useQuery({
    // Clave propia: otras pantallas guardan bajo ['stock'] la respuesta completa de axios.
    queryKey: CLAVE_STOCK,
    queryFn: async () => {
      const response = await getStock();
      return Array.isArray(response.data) ? (response.data as StockItem[]) : [];
    },
  });

  const { data: perfil } = useQuery({
    queryKey: ['perfil'],
    queryFn: async () => (await getPerfil()).data,
  });

  const productos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (data ?? [])
      .filter((p) => p.estado === 'disponible' && Number(p.disponibles) > 0 && p.producto.toLowerCase().includes(q))
      .sort((a, b) => b.disponibles - a.disponibles || a.producto.localeCompare(b.producto));
  }, [data, busqueda]);

  const telefono = perfil?.telefono || '';
  const fotos = useMemo(
    () => ({ foto1: mediaUrl(perfil?.foto1), foto2: mediaUrl(perfil?.foto2), logo: mediaUrl(perfil?.logo) }),
    [perfil?.foto1, perfil?.foto2, perfil?.logo]
  );
  const filas = useMemo(() => filasDelFlyer(productosDelFlyer(data ?? [], config), config), [data, config]);
  const firma = JSON.stringify([filas, config.titulo1, config.titulo2, config.subtitulo, telefono, fotos]);
  const { lista, obtenerLista } = useImagenFlyer(flyerRef, firma, filas.length > 0);

  const mensajeFinal = (perfil?.mensaje_whatsapp || MENSAJE_INICIAL)
    .replace(/\{telefono\}/g, telefono.trim() || 'este número')
    .trim();

  const guardarPrecio = async (item: StockItem) => {
    const texto = editando[item.id];
    if (texto === undefined) return;
    setEditando(({ [item.id]: _, ...resto }) => resto);
    const precio = Number(texto.replace(/[^\d]/g, ''));
    if (!texto.trim() || precio === Number(item.precio_por_kilo)) return;
    if (precio <= 0) {
      toast({ title: 'Precio inválido', description: 'El precio debe ser mayor a 0.', variant: 'destructive' });
      return;
    }
    const actualizar = (valor: number) =>
      queryClient.setQueryData<StockItem[]>(CLAVE_STOCK, (l) =>
        l?.map((p) => (p.id === item.id ? { ...p, precio_por_kilo: valor } : p))
      );
    actualizar(precio);
    try {
      await updateProducto(item.id, { precio_por_kilo: precio });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['productos'] });
    } catch {
      actualizar(Number(item.precio_por_kilo));
      toast({ title: 'Error', description: `No se pudo guardar el precio de ${item.producto}`, variant: 'destructive' });
    }
  };

  const manejarError = (e: any) => {
    if (e?.name === 'AbortError') return;
    toast({
      title: 'Error',
      description: e?.message === ERROR_FOTOS ? 'Las fotos aún se están cargando, intenta en unos segundos.' : 'No se pudo generar el flyer',
      variant: 'destructive',
    });
  };

  // Si la imagen ya está generada se comparte de inmediato, dentro del mismo toque.
  const compartir = async (conMensaje: boolean) => {
    const datos = lista;
    setExportando(true);
    try {
      const resultado = await compartirFlyer(datos ?? (await obtenerLista()), conMensaje ? mensajeFinal : undefined);
      if (resultado === 'copiado') toast({ title: 'Imagen copiada', description: 'Pégala en el chat de WhatsApp junto al mensaje.' });
      if (resultado === 'descargado' && conMensaje) toast({ title: 'Imagen descargada', description: 'Adjúntala en el chat de WhatsApp.' });
    } catch (e: any) {
      manejarError(e);
    } finally {
      setExportando(false);
    }
  };

  const descargar = async () => {
    setExportando(true);
    try {
      const dataUrl = await generarImagen(flyerRef.current, 'png');
      descargarArchivo(dataUrl, `${nombreArchivoFlyer()}.png`);
    } catch (e: any) {
      manejarError(e);
    } finally {
      setExportando(false);
    }
  };

  const sinFilas = exportando || filas.length === 0;

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudieron cargar los productos" />;

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Precios</h1>
          <p className="text-sm text-muted-foreground">Productos disponibles y su precio actual. Toca un precio para cambiarlo.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="bg-[#25D366] text-white hover:bg-[#1ebe5b]" onClick={() => compartir(true)} disabled={sinFilas}>
            {exportando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
            WhatsApp
          </Button>
          <Button variant="outline" onClick={() => compartir(false)} disabled={sinFilas}>
            <Share2 className="mr-2 h-4 w-4" /> Compartir flyer
          </Button>
          <Button variant="outline" onClick={descargar} disabled={sinFilas}>
            <Download className="mr-2 h-4 w-4" /> Descargar
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar producto..."
          aria-label="Buscar producto"
          className="h-10 bg-background pl-10"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[50%] text-xs uppercase">Producto</TableHead>
              <TableHead className="text-center text-xs uppercase">Stock</TableHead>
              <TableHead className="text-right text-xs uppercase">Precio</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {productos.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  {busqueda ? 'Ningún producto coincide con la búsqueda.' : 'No hay productos disponibles.'}
                </TableCell>
              </TableRow>
            )}
            {productos.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="py-3">
                  <div className="text-sm font-semibold">{p.producto}</div>
                  <div className="text-xs text-muted-foreground">{formatKg(p.kilos_actuales, 1)} disponibles</div>
                </TableCell>
                <TableCell className="text-center">
                  <span className="text-sm font-bold tabular-nums">{p.disponibles}</span>
                  <span className="block text-[10px] uppercase text-muted-foreground">unid.</span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="relative ml-auto w-28">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input
                      inputMode="numeric"
                      aria-label={`Precio de ${p.producto}`}
                      className="h-9 pl-6 text-right text-sm font-bold tabular-nums"
                      value={editando[p.id] ?? Math.round(Number(p.precio_por_kilo)).toLocaleString('es-CL')}
                      onFocus={(e) => {
                        setEditando((s) => ({ ...s, [p.id]: String(Math.round(Number(p.precio_por_kilo))) }));
                        e.target.select();
                      }}
                      onChange={(e) => setEditando((s) => ({ ...s, [p.id]: e.target.value }))}
                      onBlur={() => guardarPrecio(p)}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                  </div>
                  <span className="mt-0.5 block text-[10px] uppercase text-muted-foreground">{p.venta_por_unidad ? 'c/u' : 'por kilo'}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Lienzo fuera de pantalla: de aquí sale la imagen del flyer. */}
      <div aria-hidden className="pointer-events-none fixed top-0" style={{ left: -10000 }}>
        <FlyerCanvas
          ref={flyerRef}
          titulo1={config.titulo1}
          titulo2={config.titulo2}
          subtitulo={config.subtitulo}
          telefono={telefono}
          filas={filas}
          fotos={fotos}
        />
      </div>
    </div>
  );
}
