import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarRange } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { usePeriodo } from '@/contexts/PeriodoContext';
import { crearPeriodo } from '@/services/api';
import { formatFecha, hoyISO } from '@/lib/utils';

const NUEVO = 'nuevo';
const TODOS = 'todos';

// Elige qué período se ve en pedidos, pagos y facturas. Un período nuevo cierra el vigente
// el día anterior y empieza el conteo de lo pagado y lo por pagar desde cero.
export function PeriodoSelector({ className }: { className?: string }) {
  const { periodos, seleccionado, seleccionar } = usePeriodo();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [inicio, setInicio] = useState(hoyISO());

  const crear = useMutation({
    mutationFn: () => crearPeriodo({ nombre: nombre.trim(), fecha_inicio: inicio }),
    onSuccess: async ({ data }) => {
      await queryClient.invalidateQueries({ queryKey: ['periodos'] });
      seleccionar(data.id);
      setAbierto(false);
      setNombre('');
      toast({ title: 'Período creado', description: `Desde ${formatFecha(data.fecha_inicio)} se cuenta desde cero.` });
    },
    onError: (e: any) =>
      toast({ title: 'No se pudo crear', description: e?.response?.data?.error ?? 'Revisa los datos', variant: 'destructive' }),
  });

  return (
    <>
      <Select
        value={seleccionado ? String(seleccionado.id) : TODOS}
        onValueChange={(v) => {
          if (v === NUEVO) {
            setAbierto(true);
            return;
          }
          seleccionar(v === TODOS ? null : Number(v));
        }}
      >
        <SelectTrigger className={`w-[210px] bg-background ${className ?? ''}`} aria-label="Período">
          <CalendarRange className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {periodos.map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>
              {p.nombre}{!p.fecha_fin && ' (vigente)'}
            </SelectItem>
          ))}
          <SelectItem value={TODOS}>Todo el historial</SelectItem>
          <SelectSeparator />
          <SelectItem value={NUEVO}>Nuevo período…</SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo período</DialogTitle>
            <DialogDescription>
              Cierra el período vigente el día anterior y empieza a contar lo pagado y lo por pagar desde esta fecha.
              Los datos anteriores no se borran: siguen en su período.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="periodo-nombre">Nombre</Label>
              <Input id="periodo-nombre" placeholder="Ej. Formalizado 2026" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="periodo-inicio">Empieza el</Label>
              <Input id="periodo-inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
            <Button disabled={!nombre.trim() || !inicio || crear.isPending} onClick={() => crear.mutate()}>Crear período</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
