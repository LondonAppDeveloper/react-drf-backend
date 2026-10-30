import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Las fechas sin hora del backend ("2026-10-20", DateField) se leen como
// medianoche LOCAL. new Date("2026-10-20") las interpreta como UTC, y en
// Chile (UTC-3/-4) se mostrarían como el día anterior.
export function parseFecha(val: string | Date): Date {
  if (val instanceof Date) return val;
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
  if (soloFecha) {
    const [, y, m, d] = soloFecha;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  return new Date(val);
}

export function formatFecha(val?: string | Date | null): string {
  if (!val) return '';
  const d = parseFecha(val);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CL');
}

// Fecha de hoy como "YYYY-MM-DD" en hora local (para <input type="date">).
// toISOString() usa UTC: desde las 21:00 en Chile ya devolvería mañana.
export function hoyISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Moneda chilena sin decimales: "$12.345". Un solo formato para toda la app.
export function formatCLP(val: number | string | null | undefined): string {
  return `$${Math.round(Number(val ?? 0) || 0).toLocaleString('es-CL')}`;
}

// --- Números con coma decimal ---
// En toda la app se escribe con coma ("2,5 kg"). Si alguien escribe un punto se
// toma como coma, así que NO hay separador de miles al tipear.
export function normalizarDecimal(texto: string, decimales = true): string {
  let s = texto.replace(/\./g, ',').replace(decimales ? /[^\d,]/g : /[^\d]/g, '');
  const i = s.indexOf(',');
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/,/g, '');
  return s;
}

export function parseDecimal(texto: string | number | null | undefined): number {
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : 0;
  const n = parseFloat(String(texto ?? '').replace(/\./g, ',').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// 2.5 -> "2,5" para mostrar un número guardado dentro de un input de texto.
export function decimalATexto(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!v) return '';
  return String(Math.round(v * 1000) / 1000).replace('.', ',');
}

// Archivos subidos (fotos de facturas, del flyer...). El backend responde
// "/media/x.jpg" y los sirve en su mismo dominio, sin el /api de la API.
export function mediaUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  const base = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api').replace(/\/+$/, '').replace(/\/api$/, '');
  return path.startsWith('/media/') ? `${base}${path}` : `${base}/media/${path.replace(/^\/+/, '')}`;
}

export function formatKg(val: number | string | null | undefined, decimales = 2): string {
  return `${(Number(val ?? 0) || 0).toLocaleString('es-CL', { maximumFractionDigits: decimales })} kg`;
}

// --- Rangos de fecha (filtros de Dashboard, Pedidos y Reportes) ---
export type RangoFecha = { desde?: string; hasta?: string };
export type PresetRango = 'hoy' | '7d' | 'mes' | 'mes_anterior' | '3m' | 'anio' | 'todo';

export const PRESETS_RANGO: { value: PresetRango; label: string }[] = [
  { value: 'hoy', label: 'Hoy' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: 'mes', label: 'Este mes' },
  { value: 'mes_anterior', label: 'Mes anterior' },
  { value: '3m', label: 'Últimos 3 meses' },
  { value: 'anio', label: 'Este año' },
  { value: 'todo', label: 'Todo' },
];

const isoLocal = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function rangoDesdePreset(preset: PresetRango): RangoFecha {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  switch (preset) {
    case 'hoy': return { desde: isoLocal(hoy), hasta: isoLocal(hoy) };
    case '7d': return { desde: isoLocal(new Date(y, m, hoy.getDate() - 6)), hasta: isoLocal(hoy) };
    case 'mes': return { desde: isoLocal(new Date(y, m, 1)), hasta: isoLocal(hoy) };
    case 'mes_anterior': return { desde: isoLocal(new Date(y, m - 1, 1)), hasta: isoLocal(new Date(y, m, 0)) };
    case '3m': return { desde: isoLocal(new Date(y, m - 2, 1)), hasta: isoLocal(hoy) };
    case 'anio': return { desde: isoLocal(new Date(y, 0, 1)), hasta: isoLocal(hoy) };
    default: return {};
  }
}

// ¿La fecha (DateField o DateTimeField) cae dentro del rango? Compara en hora local.
export function enRango(val: string | null | undefined, rango: RangoFecha): boolean {
  if (!rango.desde && !rango.hasta) return true;
  if (!val) return false;
  const dia = isoLocal(parseFecha(val));
  return (!rango.desde || dia >= rango.desde) && (!rango.hasta || dia <= rango.hasta);
}

// Días completos transcurridos desde una fecha hasta hoy.
export function diasDesde(val: string): number {
  const d = parseFecha(val);
  const hoy = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}
