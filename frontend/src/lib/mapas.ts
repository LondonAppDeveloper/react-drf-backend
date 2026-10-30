// Enlaces para abrir una dirección en las apps de mapas. Son enlaces universales:
// en el teléfono abren la app si está instalada y, si no, el sitio web.

export interface EnlaceMapa {
  id: 'google' | 'waze' | 'apple';
  nombre: string;
  url: string;
}

const esDispositivoApple = () =>
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) || navigator.platform?.startsWith('Mac'));

// Las direcciones del cliente no traen país; agregarlo ayuda al geocodificador.
export const direccionParaMapa = (direccion: string) => {
  const d = direccion.trim().replace(/\s+/g, ' ');
  return /chile/i.test(d) ? d : `${d}, Chile`;
};

export function enlacesMapa(direccion: string): EnlaceMapa[] {
  const q = encodeURIComponent(direccionParaMapa(direccion));
  const enlaces: EnlaceMapa[] = [
    { id: 'google', nombre: 'Google Maps', url: `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving` },
    { id: 'waze', nombre: 'Waze', url: `https://waze.com/ul?q=${q}&navigate=yes` },
  ];
  if (esDispositivoApple()) {
    enlaces.push({ id: 'apple', nombre: 'Mapas de Apple', url: `https://maps.apple.com/?daddr=${q}&dirflg=d` });
  }
  return enlaces;
}
