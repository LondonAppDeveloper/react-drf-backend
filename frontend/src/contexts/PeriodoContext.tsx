import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPeriodos, type Periodo } from '@/services/api';
import { enRango, type RangoFecha } from '@/lib/utils';
import { useAuth } from './AuthContext';

const CLAVE = 'periodo-seleccionado';
const TODOS = 'todos';

interface PeriodoCtx {
  periodos: Periodo[];
  // null = sin filtro (se ve todo el historial).
  seleccionado: Periodo | null;
  rango: RangoFecha;
  seleccionar: (id: number | null) => void;
  // ¿La fecha cae dentro del período elegido?
  enPeriodo: (fecha: string | null | undefined) => boolean;
}

const Ctx = createContext<PeriodoCtx | null>(null);

const leer = () => {
  try { return localStorage.getItem(CLAVE); } catch { return null; }
};

export function PeriodoProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [guardado, setGuardado] = useState<string | null>(leer);

  const { data: periodos = [] } = useQuery({
    queryKey: ['periodos'],
    queryFn: async () => (await getPeriodos()).data,
    enabled: isAuthenticated,
  });

  // Sin elección guardada se muestra el período vigente (el que no tiene fecha de fin).
  const seleccionado = useMemo(() => {
    if (guardado === TODOS) return null;
    const elegido = periodos.find((p) => String(p.id) === guardado);
    return elegido ?? periodos.find((p) => !p.fecha_fin) ?? null;
  }, [periodos, guardado]);

  useEffect(() => {
    try {
      if (guardado) localStorage.setItem(CLAVE, guardado);
    } catch { /* sin almacenamiento: se usa solo en memoria */ }
  }, [guardado]);

  const rango = useMemo<RangoFecha>(
    () => (seleccionado ? { desde: seleccionado.fecha_inicio, hasta: seleccionado.fecha_fin ?? undefined } : {}),
    [seleccionado]
  );
  const seleccionar = useCallback((id: number | null) => setGuardado(id == null ? TODOS : String(id)), []);
  const enPeriodo = useCallback((fecha: string | null | undefined) => enRango(fecha, rango), [rango]);

  const valor = useMemo(
    () => ({ periodos, seleccionado, rango, seleccionar, enPeriodo }),
    [periodos, seleccionado, rango, seleccionar, enPeriodo]
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function usePeriodo() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePeriodo debe usarse dentro de PeriodoProvider');
  return v;
}
