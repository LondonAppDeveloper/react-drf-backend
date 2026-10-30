import { useEffect, useRef, useState, type RefObject } from 'react';
import { getFontEmbedCSS, toJpeg, toPng } from 'html-to-image';
import type { StockItem } from '@/types';
import type { FlyerFila } from '@/components/flyer/FlyerCanvas';

// Ajustes de cada usuario para su flyer (quedan en su navegador). El "c/u" y el peso
// fijo, en cambio, se guardan en el producto y valen para todos. El teléfono, las
// fotos y el mensaje de WhatsApp se guardan en el perfil de cada usuario.
export interface AjusteFila {
  incluir?: boolean;
  nombre?: string;
  precio?: string; // precio manual; vacío = usa el de la plataforma
}

export interface ConfigFlyer {
  titulo1: string;
  titulo2: string;
  subtitulo: string;
  categoria: string;
  orden: number[];
  filas: Record<number, AjusteFila>;
}

export const STORAGE_KEY = 'flyer-config-v1';
export const CONFIG_INICIAL: ConfigFlyer = {
  titulo1: 'Carnes',
  titulo2: 'al vacio',
  subtitulo: 'Precios por Kilo',
  categoria: 'todas',
  orden: [],
  filas: {},
};

export const MENSAJE_INICIAL =
  '¡Hola! 👋 Te comparto la lista de precios de esta semana 🥩\nCarnes al vacío, frescas y a domicilio. Pide la tuya al {telefono} 📲';

export const leerConfig = (): ConfigFlyer => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return CONFIG_INICIAL;
    const guardada = JSON.parse(raw);
    // Las configs anteriores filtraban "al vacio" por defecto y ocultaban cortes con stock.
    if (!guardada.v2) guardada.categoria = 'todas';
    return { ...CONFIG_INICIAL, ...guardada };
  } catch {
    return CONFIG_INICIAL;
  }
};

export const formatoPesos = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');

const formatoKilos = (kg: number) => {
  const r = Math.round(kg * 10) / 10;
  return `${r.toLocaleString('es-CL', { maximumFractionDigits: 1 })} kg`;
};

// Peso promedio por pieza según lo que hay en bodega (kilos / unidades disponibles).
// Los productos por unidad no lo muestran salvo que tengan un peso fijo.
export const pesoCalculado = (item: StockItem) =>
  !item.venta_por_unidad && item.disponibles > 0 && Number(item.kilos_actuales) > 0
    ? formatoKilos(Number(item.kilos_actuales) / Number(item.disponibles))
    : '';

export const pesoFlyer = (item: StockItem) => item.peso_flyer?.trim() || pesoCalculado(item);

export const disponibleParaVenta = (item: StockItem) => item.estado === 'disponible' && Number(item.disponibles) > 0;

// Productos del flyer en el orden elegido (según categoría y orden de la config).
export const productosDelFlyer = (stock: StockItem[], config: ConfigFlyer) => {
  const lista = stock.filter((p) => config.categoria === 'todas' || (p.categoria ?? '') === config.categoria);
  const pos = (id: number) => {
    const i = config.orden.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...lista].sort((a, b) => pos(a.id) - pos(b.id) || b.precio_por_kilo - a.precio_por_kilo);
};

export const incluidoEnFlyer = (item: StockItem, config: ConfigFlyer) =>
  config.filas[item.id]?.incluir ?? disponibleParaVenta(item);

export const filasDelFlyer = (productos: StockItem[], config: ConfigFlyer, pesosEditando: Record<number, string> = {}): FlyerFila[] =>
  productos
    .filter((item) => incluidoEnFlyer(item, config))
    .map((item) => {
      const a = config.filas[item.id] ?? {};
      const base = a.precio?.trim() ? a.precio.trim() : formatoPesos(Number(item.precio_por_kilo));
      return {
        id: item.id,
        nombre: a.nombre?.trim() || item.producto,
        precio: item.venta_por_unidad ? `${base} c/u` : base,
        peso: pesosEditando[item.id] ?? pesoFlyer(item),
      };
    });

const imagenLista = (img: HTMLImageElement) =>
  img.complete && img.naturalWidth > 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const listo = () => resolve();
        img.addEventListener('load', listo, { once: true });
        img.addEventListener('error', listo, { once: true });
        setTimeout(listo, 5000);
      });

export const ERROR_FOTOS = 'Las fotos aún no terminan de cargar';

export const generarImagen = async (nodo: HTMLElement | null, formato: 'png' | 'jpeg') => {
  if (!nodo) throw new Error('Flyer no disponible');
  await document.fonts.ready;
  // Esperar a que las fotos estén decodificadas (ya como data URL, ver FlyerCanvas).
  const imgs = [...nodo.querySelectorAll<HTMLImageElement>('img[data-flyer-img]')];
  // (img.decode() puede quedar colgado en algunos navegadores; se revisa complete/naturalWidth).
  await Promise.all(imgs.map(imagenLista));
  if (imgs.some((img) => !img.src.startsWith('data:'))) {
    throw new Error(ERROR_FOTOS);
  }
  // Safari pinta las imágenes en blanco en la primera pasada de html-to-image:
  // una pasada previa barata las deja listas para la definitiva.
  const fontEmbedCSS = await getFontEmbedCSS(nodo);
  await toPng(nodo, { pixelRatio: 0.2, fontEmbedCSS });
  return formato === 'png'
    ? toPng(nodo, { pixelRatio: 3, fontEmbedCSS })
    : toJpeg(nodo, { pixelRatio: 2.5, quality: 0.92, fontEmbedCSS, backgroundColor: '#f4ebde' });
};

export const nombreArchivoFlyer = () => `flyer-${new Date().toISOString().slice(0, 10)}`;

export const descargarArchivo = (dataUrl: string, nombre: string) => {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = nombre;
  a.click();
};

// JPEG -> PNG (el portapapeles solo acepta PNG).
const aPng = (dataUrl: string) =>
  new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo convertir'))), 'image/png');
    };
    img.onerror = reject;
    img.src = dataUrl;
  });

export interface ImagenFlyer {
  file: File;
  dataUrl: string;
}

const crearImagen = async (nodo: HTMLElement | null): Promise<ImagenFlyer> => {
  const dataUrl = await generarImagen(nodo, 'jpeg');
  const blob = await (await fetch(dataUrl)).blob();
  return { dataUrl, file: new File([blob], `${nombreArchivoFlyer()}.jpg`, { type: 'image/jpeg' }) };
};

// Genera la imagen por adelantado cada vez que cambia el flyer: hacerlo al tocar
// "Compartir" tarda y el navegador deja de considerarlo un toque del usuario, así
// que el share salía sin imagen.
export function useImagenFlyer(nodoRef: RefObject<HTMLElement>, firma: string, hayFilas: boolean) {
  const [lista, setLista] = useState<ImagenFlyer | null>(null);
  const generacion = useRef(0);

  useEffect(() => {
    setLista(null);
    if (!hayFilas) return;
    const n = ++generacion.current;
    const t = setTimeout(async () => {
      try {
        const img = await crearImagen(nodoRef.current);
        if (n === generacion.current) setLista(img);
      } catch {
        /* se genera al momento de compartir */
      }
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);

  const obtenerLista = () => (lista ? Promise.resolve(lista) : crearImagen(nodoRef.current));
  return { lista, obtenerLista };
}

export const copiarImagen = async (dataUrl: string) => {
  // El blob va como promesa: Safari exige crear el ClipboardItem dentro del toque.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': aPng(dataUrl) })]);
};

export type ResultadoCompartir = 'compartido' | 'copiado' | 'descargado' | 'cancelado';

// Compartir con la hoja del sistema (WhatsApp, Instagram...). Sin hoja para compartir
// archivos (computador): con mensaje se copia la imagen y se abre WhatsApp para pegarla
// en el chat; sin mensaje se descarga.
export async function compartirFlyer(d: ImagenFlyer, mensaje?: string): Promise<ResultadoCompartir> {
  const payload: ShareData = mensaje ? { files: [d.file], text: mensaje } : { files: [d.file] };
  if (navigator.canShare?.(payload)) {
    try {
      await navigator.share(payload);
      return 'compartido';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelado';
      if (e?.name !== 'NotAllowedError') throw e;
    }
  }
  if (!mensaje) {
    descargarArchivo(d.dataUrl, `${nombreArchivoFlyer()}.jpg`);
    return 'descargado';
  }
  let resultado: ResultadoCompartir = 'copiado';
  try {
    await copiarImagen(d.dataUrl);
  } catch {
    descargarArchivo(d.dataUrl, `${nombreArchivoFlyer()}.jpg`);
    resultado = 'descargado';
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank');
  return resultado;
}
