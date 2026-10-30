import { forwardRef, useEffect, useState } from 'react';
import '@fontsource/josefin-sans/600.css';
import '@fontsource/josefin-sans/700.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/400-italic.css';
import '@fontsource/lato/700.css';

// Dimensiones base del flyer (proporción A4). Se exporta con pixelRatio para alta resolución.
export const FLYER_WIDTH = 720;
export const FLYER_HEIGHT = 1018;

const C = {
  fondo: '#f4ebde',
  pastilla: '#e8cbae',
  cafe: '#7e5a39',
  texto: '#3b2a1c',
};

export interface FlyerFila {
  id: number;
  nombre: string;
  precio: string;
  peso: string;
}

export type FotosFlyer = Partial<Record<keyof Imagenes, string | null>>;

export interface FlyerProps {
  titulo1: string;
  titulo2: string;
  subtitulo: string;
  telefono: string;
  filas: FlyerFila[];
  /** Fotos propias del usuario (URL). Las que falten usan las originales. */
  fotos?: FotosFlyer;
}

// Achica la letra si el texto no cabe en la pastilla (nombres largos como "Hamburguesa 125 grs").
let lienzo: HTMLCanvasElement | null = null;
const fuenteQueCabe = (texto: string, ancho: number, base: number) => {
  lienzo ??= document.createElement('canvas');
  const ctx = lienzo.getContext('2d');
  if (!ctx) return base;
  ctx.font = `400 ${base}px Lato, sans-serif`;
  const medido = ctx.measureText(texto).width;
  return medido > ancho ? Math.max(9, Math.floor(base * (ancho / medido) * 10) / 10) : base;
};

// Las imágenes se incrustan como data URL: así la exportación no depende de volver a
// descargarlas (en Safari/iPhone html-to-image a veces las deja en blanco).
const IMAGENES = { foto1: '/flyer/foto1.jpg', foto2: '/flyer/foto2.jpg', logo: '/flyer/logo.png' };
type Imagenes = typeof IMAGENES;

const aDataUrl = async (url: string) => {
  const blob = await (await fetch(url)).blob();
  return new Promise<string>((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result as string);
    lector.onerror = reject;
    lector.readAsDataURL(blob);
  });
};

// Una descarga por URL, compartida entre montajes.
const cache = new Map<string, Promise<string>>();
const cargarImagen = (url: string) => {
  if (!cache.has(url)) {
    cache.set(
      url,
      aDataUrl(url).catch((e) => {
        cache.delete(url); // reintentar en el próximo montaje
        throw e;
      })
    );
  }
  return cache.get(url)!;
};

const Cloche = () => (
  <svg width="64" height="40" viewBox="0 0 64 40" fill={C.cafe}>
    <circle cx="32" cy="5" r="3.5" />
    <path d="M6 28 C6 13 18 8 32 8 C46 8 58 13 58 28 Z" />
    <rect x="2" y="29" width="60" height="4" rx="2" />
    <path d="M10 35 h44 l-6 5 H16 Z" opacity="0.8" />
  </svg>
);

const Chevron = () => (
  <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke={C.cafe} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3 L14 13 L25 3" />
  </svg>
);

const PhoneIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="19" fill={C.fondo} />
    <path
      fill={C.cafe}
      d="M27.6 23.9l-3.1-1.3a1.4 1.4 0 0 0-1.6.4l-1.4 1.7a11 11 0 0 1-5.2-5.2l1.7-1.4a1.4 1.4 0 0 0 .4-1.6l-1.3-3.1a1.4 1.4 0 0 0-1.6-.8l-2.9.7a1.4 1.4 0 0 0-1.1 1.4A15.6 15.6 0 0 0 26.9 30a1.4 1.4 0 0 0 1.4-1.1l.7-2.9a1.4 1.4 0 0 0-.8-1.6z"
    />
  </svg>
);

export const FlyerCanvas = forwardRef<HTMLDivElement, FlyerProps>(
  ({ titulo1, titulo2, subtitulo, telefono, filas, fotos }, ref) => {
    // Re-medir los textos cuando Lato termine de cargar.
    const [, setFuentesListas] = useState(false);
    useEffect(() => {
      document.fonts.ready.then(() => setFuentesListas(true));
    }, []);

    const fuentes: Imagenes = {
      foto1: fotos?.foto1 || IMAGENES.foto1,
      foto2: fotos?.foto2 || IMAGENES.foto2,
      logo: fotos?.logo || IMAGENES.logo,
    };
    const claveFuentes = `${fuentes.foto1}|${fuentes.foto2}|${fuentes.logo}`;
    const [imagenes, setImagenes] = useState<Imagenes>(fuentes);
    useEffect(() => {
      let vivo = true;
      setImagenes(fuentes);
      (Object.keys(fuentes) as (keyof Imagenes)[]).forEach((k) =>
        cargarImagen(fuentes[k])
          .then((d) => vivo && setImagenes((prev) => ({ ...prev, [k]: d })))
          .catch(() => {
            /* se queda la ruta normal */
          })
      );
      return () => {
        vivo = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [claveFuentes]);
    // Las filas se comprimen si hay más productos de los que caben con el espaciado original.
    const zonaFilas = 452;
    const paso = Math.min(51.5, zonaFilas / Math.max(filas.length, 1));
    const altoFila = Math.min(34, paso - 6);
    const fuenteFila = Math.min(17, altoFila * 0.5);
    const conPeso = filas.filter((f) => f.peso.trim());

    return (
      <div
        ref={ref}
        style={{
          position: 'relative',
          width: FLYER_WIDTH,
          height: FLYER_HEIGHT,
          background: C.fondo,
          overflow: 'hidden',
          fontFamily: "'Lato', sans-serif",
          color: C.texto,
        }}
      >
        {/* Foto 1 con marco */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: 445, height: 250, background: C.pastilla, borderBottomRightRadius: 28 }} />
        <img
          src={imagenes.foto1}
          alt=""
          data-flyer-img
          style={{ position: 'absolute', left: 15, top: 16, width: 412, height: 217, objectFit: 'cover', borderRadius: 14 }}
        />

        {/* Logo */}
        <img
          src={imagenes.logo}
          alt=""
          data-flyer-img
          style={{ position: 'absolute', left: 455, top: 30, width: 248, height: 80, objectFit: 'contain' }}
        />

        {/* Foto 2 con marco */}
        <div style={{ position: 'absolute', left: 342, top: 221, width: 400, height: 227, background: C.pastilla, borderRadius: 28 }} />
        <img
          src={imagenes.foto2}
          alt=""
          data-flyer-img
          style={{ position: 'absolute', left: 355, top: 240, width: 380, height: 193, objectFit: 'cover', borderRadius: 14 }}
        />

        {/* Título */}
        <div style={{ position: 'absolute', left: 37, top: 277, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 9 }}>
          {[titulo1, titulo2].filter((t) => t.trim()).map((t, i) => (
            <div
              key={i}
              style={{
                background: C.cafe,
                color: C.fondo,
                fontFamily: "'Josefin Sans', sans-serif",
                fontWeight: 700,
                fontSize: 34,
                lineHeight: 1,
                padding: '10px 9px 6px',
                marginLeft: i * 3,
                textTransform: 'uppercase',
              }}
            >
              {t}
            </div>
          ))}
        </div>

        <div style={{ position: 'absolute', left: 39, top: 412, fontSize: 21 }}>{subtitulo}</div>

        {/* Lista de precios */}
        <div style={{ position: 'absolute', left: 37, top: 458 }}>
          {filas.map((f, i) => (
            <div key={f.id} style={{ position: 'absolute', top: i * paso, display: 'flex', gap: 9 }}>
              {[
                { texto: f.nombre, ancho: 190 },
                { texto: f.precio, ancho: 119 },
              ].map((celda, j) => (
                <div
                  key={j}
                  style={{
                    width: celda.ancho,
                    height: altoFila,
                    borderRadius: 9,
                    background: C.pastilla,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: fuenteQueCabe(celda.texto, celda.ancho - 14, fuenteFila),
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    padding: '0 7px',
                  }}
                >
                  {celda.texto}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Peso aproximado por pieza */}
        {conPeso.length > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 404,
              width: 262,
              bottom: FLYER_HEIGHT - 903,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <Cloche />
            <div style={{ fontStyle: 'italic', fontSize: 15, textAlign: 'center', lineHeight: 1.35, marginTop: 6, width: 160 }}>
              Peso aproximado por pieza.
            </div>
            <div style={{ margin: '4px 0 6px' }}>
              <Chevron />
            </div>
            <div style={{ alignSelf: 'stretch', background: C.pastilla, borderRadius: 10, padding: '12px 11px', fontSize: 14.5, lineHeight: 1.45 }}>
              {conPeso.map((f) => (
                <div key={f.id}>
                  {f.nombre} — {f.peso}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pie con teléfono */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 87,
            background: C.cafe,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            paddingLeft: 42,
          }}
        >
          {telefono.trim() && (
            <>
              <PhoneIcon />
              <span style={{ color: C.fondo, fontSize: 40, letterSpacing: 0.5 }}>{telefono}</span>
            </>
          )}
        </div>
      </div>
    );
  }
);
FlyerCanvas.displayName = 'FlyerCanvas';
