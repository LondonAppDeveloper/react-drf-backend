import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import jsPDF from 'jspdf';
import { ArrowDown, ArrowUp, Check, Copy, Download, FileDown, ImagePlus, Loader2, MessageCircle, RotateCcw, Share2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { useToast } from '@/hooks/use-toast';
import { getPerfil, getStock, updatePerfil, updateProducto, type Perfil } from '@/services/api';
import type { StockItem } from '@/types';
import { mediaUrl } from '@/lib/utils';
import {
  ERROR_FOTOS,
  MENSAJE_INICIAL,
  STORAGE_KEY,
  compartirFlyer,
  copiarImagen,
  descargarArchivo,
  disponibleParaVenta,
  filasDelFlyer,
  formatoPesos,
  generarImagen,
  incluidoEnFlyer,
  leerConfig,
  nombreArchivoFlyer,
  pesoCalculado,
  productosDelFlyer,
  useImagenFlyer,
  type AjusteFila,
  type ConfigFlyer,
} from '@/lib/flyer';
import { FlyerCanvas, FLYER_HEIGHT, FLYER_WIDTH, type FotosFlyer } from '@/components/flyer/FlyerCanvas';

const FOTOS: { campo: keyof FotosFlyer; label: string }[] = [
  { campo: 'foto1', label: 'Foto principal' },
  { campo: 'foto2', label: 'Foto secundaria' },
  { campo: 'logo', label: 'Logo' },
];

export default function Flyer() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pesosEditando, setPesosEditando] = useState<Record<number, string>>({});
  const flyerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<ConfigFlyer>(leerConfig);
  const [telefono, setTelefono] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [guardado, setGuardado] = useState<'telefono' | 'mensaje' | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [escala, setEscala] = useState(0.6);

  const { data: stock, isLoading, error } = useQuery({
    // Clave propia: el Dashboard guarda bajo ['stock'] la respuesta completa de axios, no la lista.
    // Sigue bajo el prefijo 'stock', así que los invalidateQueries(['stock']) también la refrescan.
    queryKey: ['stock', 'flyer'],
    queryFn: async () => {
      const response = await getStock();
      return Array.isArray(response.data) ? response.data : [];
    },
  });

  const { data: perfil } = useQuery({
    queryKey: ['perfil'],
    queryFn: async () => (await getPerfil()).data,
  });

  useEffect(() => {
    if (!perfil) return;
    setTelefono(perfil.telefono || '');
    setMensaje(perfil.mensaje_whatsapp || MENSAJE_INICIAL);
  }, [perfil]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...config, v2: true }));
    } catch {
      /* sin almacenamiento: la config solo dura la sesión */
    }
  }, [config]);

  // Ajusta la vista previa al ancho disponible.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setEscala(Math.min(1, entry.contentRect.width / FLYER_WIDTH)));
    obs.observe(el);
    return () => obs.disconnect();
  }, [isLoading]);

  const fotos: FotosFlyer = useMemo(
    () => ({ foto1: mediaUrl(perfil?.foto1), foto2: mediaUrl(perfil?.foto2), logo: mediaUrl(perfil?.logo) }),
    [perfil?.foto1, perfil?.foto2, perfil?.logo]
  );

  const productos = useMemo(() => productosDelFlyer(stock ?? [], config), [stock, config]);

  // Cortes con stock que el filtro de categoría está dejando fuera.
  const ocultosConStock = (stock ?? []).filter(
    (p) => disponibleParaVenta(p) && !productos.some((x) => x.id === p.id)
  );

  const incluido = (item: StockItem) => incluidoEnFlyer(item, config);

  const filas = filasDelFlyer(productos, config, pesosEditando);

  const ajustar = (id: number, cambios: AjusteFila) =>
    setConfig((c) => ({ ...c, filas: { ...c.filas, [id]: { ...c.filas[id], ...cambios } } }));

  // Guarda en el producto (para todos los usuarios) y actualiza la lista sin recargar.
  const guardarEnProducto = async (item: StockItem, cambios: { venta_por_unidad?: boolean; peso_flyer?: string }) => {
    const actualizar = (valores: Partial<StockItem>) =>
      queryClient.setQueryData<StockItem[]>(['stock', 'flyer'], (lista) =>
        lista?.map((p) => (p.id === item.id ? { ...p, ...valores } : p))
      );
    actualizar(cambios);
    try {
      await updateProducto(item.id, cambios);
    } catch {
      actualizar({ venta_por_unidad: item.venta_por_unidad, peso_flyer: item.peso_flyer });
      toast({ title: 'Error', description: `No se pudo guardar ${item.producto}`, variant: 'destructive' });
    }
  };

  const guardarPeso = (item: StockItem) => {
    const texto = pesosEditando[item.id];
    if (texto === undefined) return;
    setPesosEditando(({ [item.id]: _, ...resto }) => resto);
    // Si el texto coincide con el calculado no se fija: así sigue actualizándose con el stock.
    const nuevo = texto.trim() === pesoCalculado(item) ? '' : texto.trim();
    if (nuevo !== (item.peso_flyer ?? '')) guardarEnProducto(item, { peso_flyer: nuevo });
  };

  const mover = (id: number, dir: -1 | 1) => {
    const ids = productos.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setConfig((c) => ({ ...c, orden: [...ids, ...c.orden.filter((x) => !ids.includes(x))] }));
  };

  // El teléfono y el mensaje se guardan solos al salir del campo, en el perfil de cada usuario.
  const guardarPerfil = async (campo: 'telefono' | 'mensaje_whatsapp', valor: string) => {
    if (!perfil || valor === (perfil[campo] || '')) return;
    try {
      const { data } = await updatePerfil({ [campo]: valor });
      queryClient.setQueryData(['perfil'], data);
      setGuardado(campo === 'telefono' ? 'telefono' : 'mensaje');
      setTimeout(() => setGuardado(null), 2000);
    } catch (e: any) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'No se pudo guardar', variant: 'destructive' });
    }
  };

  const cambiarFoto = async (campo: keyof FotosFlyer, archivo: File | null) => {
    const fd = new FormData();
    if (archivo) fd.append(campo, archivo);
    else fd.append(`quitar_${campo}`, 'true');
    setSubiendo(campo);
    try {
      const { data } = await updatePerfil(fd);
      queryClient.setQueryData<Perfil>(['perfil'], data);
    } catch (e: any) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'No se pudo cambiar la foto', variant: 'destructive' });
    } finally {
      setSubiendo(null);
    }
  };

  const firmaFlyer = JSON.stringify([filas, config.titulo1, config.titulo2, config.subtitulo, telefono, fotos]);
  const { lista, obtenerLista } = useImagenFlyer(flyerRef, firmaFlyer, filas.length > 0);

  const mensajeFinal = mensaje.replace(/\{telefono\}/g, telefono.trim() || 'este número').trim();

  const manejarError = (e: any) => {
    if (e?.name === 'AbortError') return;
    toast({
      title: 'Error',
      description: e?.message === ERROR_FOTOS ? 'Las fotos aún se están cargando, intenta en unos segundos.' : 'No se pudo generar el flyer',
      variant: 'destructive',
    });
  };

  const exportar = async (tipo: 'png' | 'pdf') => {
    setExportando(true);
    try {
      const dataUrl = await generarImagen(flyerRef.current, 'png');
      if (tipo === 'png') {
        descargarArchivo(dataUrl, `${nombreArchivoFlyer()}.png`);
      } else {
        const pdf = new jsPDF({ unit: 'px', format: [FLYER_WIDTH, FLYER_HEIGHT], hotfixes: ['px_scaling'] });
        pdf.addImage(dataUrl, 'PNG', 0, 0, FLYER_WIDTH, FLYER_HEIGHT);
        pdf.save(`${nombreArchivoFlyer()}.pdf`);
      }
    } catch (e: any) {
      manejarError(e);
    } finally {
      setExportando(false);
    }
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

  const copiar = async () => {
    try {
      await copiarImagen((await obtenerLista()).dataUrl);
      toast({ title: 'Imagen copiada' });
    } catch (e: any) {
      manejarError(e);
    }
  };

  const sinFilas = exportando || filas.length === 0;

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudieron cargar los productos" />;

  return (
    <div className="space-y-6 pb-28 sm:pb-0">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Flyer de Precios</h1>
          <p className="text-muted-foreground">Se arma con los productos y precios actuales de la plataforma.</p>
        </div>
        <div className="hidden flex-wrap gap-2 sm:flex">
          <Button className="bg-[#25D366] text-white hover:bg-[#1ebe5b]" onClick={() => compartir(true)} disabled={sinFilas}>
            {exportando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
            Enviar por WhatsApp
          </Button>
          <Button variant="outline" onClick={() => exportar('png')} disabled={sinFilas}>
            <Download className="mr-2 h-4 w-4" /> PNG
          </Button>
          <Button variant="outline" onClick={() => exportar('pdf')} disabled={sinFilas}>
            <FileDown className="mr-2 h-4 w-4" /> PDF
          </Button>
          <Button variant="outline" onClick={copiar} disabled={sinFilas}>
            <Copy className="mr-2 h-4 w-4" /> Copiar
          </Button>
          <Button variant="outline" onClick={() => compartir(false)} disabled={sinFilas}>
            <Share2 className="mr-2 h-4 w-4" /> Compartir
          </Button>
        </div>
      </div>

      {/* En teléfono: WhatsApp es la acción principal */}
      <div className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-30 grid grid-cols-[1fr_auto_auto] gap-2 border-t bg-background p-3 sm:hidden">
        <Button className="bg-[#25D366] text-white hover:bg-[#1ebe5b]" onClick={() => compartir(true)} disabled={sinFilas}>
          {exportando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
          WhatsApp
        </Button>
        <Button variant="outline" size="icon" aria-label="Compartir imagen" onClick={() => compartir(false)} disabled={sinFilas}>
          <Share2 className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" aria-label="Descargar" onClick={() => exportar('png')} disabled={sinFilas}>
          <Download className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Datos del flyer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="t1">Título (línea 1)</Label>
                <Input id="t1" value={config.titulo1} onChange={(e) => setConfig({ ...config, titulo1: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t2">Título (línea 2)</Label>
                <Input id="t2" value={config.titulo2} onChange={(e) => setConfig({ ...config, titulo2: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub">Subtítulo</Label>
                <Input id="sub" value={config.subtitulo} onChange={(e) => setConfig({ ...config, subtitulo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select value={config.categoria} onValueChange={(v) => setConfig({ ...config, categoria: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="al vacio">Al vacío</SelectItem>
                    <SelectItem value="congelado">Congelado</SelectItem>
                    <SelectItem value="todas">Todas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="tel" className="flex items-center justify-between">
                  Mi teléfono
                  {guardado === 'telefono' && <span className="flex items-center gap-1 text-xs font-normal text-green-600"><Check className="h-3 w-3" /> Guardado</span>}
                </Label>
                <Input
                  id="tel"
                  inputMode="tel"
                  placeholder="+56 9 1234 5678"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  onBlur={() => guardarPerfil('telefono', telefono.trim())}
                />
                <p className="text-xs text-muted-foreground">Es solo tuyo: cada usuario tiene su teléfono en su flyer.</p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="msg" className="flex items-center justify-between">
                  Mensaje para WhatsApp
                  {guardado === 'mensaje' && <span className="flex items-center gap-1 text-xs font-normal text-green-600"><Check className="h-3 w-3" /> Guardado</span>}
                </Label>
                <Textarea
                  id="msg"
                  rows={3}
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  onBlur={() => guardarPerfil('mensaje_whatsapp', mensaje)}
                />
                <p className="text-xs text-muted-foreground">
                  Se envía junto al flyer. <code className="rounded bg-muted px-1">{'{telefono}'}</code> se reemplaza por tu teléfono.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Mis fotos</CardTitle>
              <CardDescription>Reemplaza las fotos del flyer por las tuyas. Solo cambian tu flyer.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              {FOTOS.map(({ campo, label }) => {
                const propia = perfil?.[campo];
                return (
                  <div key={campo} className="space-y-1.5">
                    <div className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted">
                      <img
                        src={propia ? mediaUrl(propia) : `/flyer/${campo === 'logo' ? 'logo.png' : `${campo}.jpg`}`}
                        alt={label}
                        className={`h-full w-full ${campo === 'logo' ? 'object-contain p-2' : 'object-cover'}`}
                      />
                      {subiendo === campo && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                      )}
                    </div>
                    <p className="truncate text-xs font-medium">{label}</p>
                    <div className="flex gap-1">
                      <label className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md border text-xs hover:bg-muted">
                        <ImagePlus className="h-3.5 w-3.5" /> Cambiar
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          disabled={!!subiendo}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f) cambiarFoto(campo, f);
                          }}
                        />
                      </label>
                      {propia && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Volver a la ${label.toLowerCase()} original`} onClick={() => cambiarFoto(campo, null)}>
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">
                Cortes <span className="text-sm font-normal text-muted-foreground">({filas.length} en el flyer)</span>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfig((c) => ({ ...c, filas: {}, orden: [] }))}
                title="Volver a los valores de la plataforma"
              >
                <RotateCcw className="mr-1 h-4 w-4" /> Restablecer
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {ocultosConStock.length > 0 && (
                <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  Hay {ocultosConStock.length} corte(s) con stock en otra categoría (
                  {ocultosConStock.map((p) => p.producto).join(', ')}).{' '}
                  <button className="font-medium text-primary underline" onClick={() => setConfig({ ...config, categoria: 'todas' })}>
                    Ver todas
                  </button>
                </p>
              )}
              {productos.length === 0 && <p className="text-sm text-muted-foreground">No hay productos en esta categoría.</p>}
              {productos.map((item, i) => {
                const a = config.filas[item.id] ?? {};
                const activo = incluido(item);
                return (
                  <div key={item.id} className={`rounded-lg border p-3 ${activo ? '' : 'opacity-60'}`}>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id={`inc-${item.id}`}
                        checked={activo}
                        onCheckedChange={(v) => ajustar(item.id, { incluir: v === true })}
                      />
                      <label htmlFor={`inc-${item.id}`} className="min-w-0 flex-1 cursor-pointer font-medium">
                        {item.producto}
                        <span className="block text-sm font-normal text-muted-foreground sm:ml-2 sm:inline">
                          {formatoPesos(Number(item.precio_por_kilo))}/kg · {item.disponibles} u.
                        </span>
                      </label>
                      {!disponibleParaVenta(item) && <Badge variant="secondary">Sin stock</Badge>}
                      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 sm:h-7 sm:w-7" disabled={i === 0} onClick={() => mover(item.id, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 sm:h-7 sm:w-7"
                        disabled={i === productos.length - 1}
                        onClick={() => mover(item.id, 1)}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                    {activo && (
                      <div className="mt-3 grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                        <Input
                          placeholder={item.producto}
                          value={a.nombre ?? ''}
                          onChange={(e) => ajustar(item.id, { nombre: e.target.value })}
                          aria-label="Nombre en el flyer"
                        />
                        <Input
                          placeholder={formatoPesos(Number(item.precio_por_kilo))}
                          value={a.precio ?? ''}
                          onChange={(e) => ajustar(item.id, { precio: e.target.value })}
                          aria-label="Precio en el flyer"
                        />
                        <Input
                          placeholder={pesoCalculado(item) || 'Peso por pieza'}
                          value={pesosEditando[item.id] ?? item.peso_flyer ?? ''}
                          onChange={(e) => setPesosEditando((p) => ({ ...p, [item.id]: e.target.value }))}
                          onBlur={() => guardarPeso(item)}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                          aria-label="Peso aproximado por pieza"
                          title="Se guarda en el producto. Vacío = se calcula desde el stock"
                        />
                        <label className="flex items-center gap-2 text-sm whitespace-nowrap" title="Se guarda en el producto">
                          <Switch
                            checked={!!item.venta_por_unidad}
                            onCheckedChange={(v) => guardarEnProducto(item, { venta_por_unidad: v })}
                          />
                          c/u
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="order-first lg:order-none lg:sticky lg:top-4 lg:self-start">
          <div ref={previewRef} className="w-full">
            <div
              className="overflow-hidden rounded-lg shadow-lg"
              style={{ width: FLYER_WIDTH * escala, height: FLYER_HEIGHT * escala }}
            >
              <div style={{ transform: `scale(${escala})`, transformOrigin: 'top left' }}>
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
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {lista ? 'Listo para compartir.' : filas.length ? 'Preparando la imagen…' : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
