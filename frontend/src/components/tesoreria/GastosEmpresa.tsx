import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import { createGasto, deleteGasto, getGastos, updateGasto } from '@/services/api';
import { decimalATexto, enRango, formatCLP, formatFecha, hoyISO, parseDecimal, type RangoFecha } from '@/lib/utils';

interface Gasto {
  id: number;
  fecha: string;
  descripcion: string;
  categoria: string;
  neto: number | string;
  iva: number | string;
  total: number | string;
  con_factura: boolean;
  movimiento: number | null;
  comentario: string;
}

const VACIO = { fecha: hoyISO(), descripcion: '', categoria: 'otro', total: '', con_factura: false, comentario: '' };

export function GastosEmpresa({ rango }: { rango: RangoFecha }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editando, setEditando] = useState<Gasto | 'nuevo' | null>(null);
  const [form, setForm] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);

  const q = useQuery({
    queryKey: ['gastos'],
    queryFn: async () => (await getGastos()).data as { gastos: Gasto[]; categorias: { value: string; label: string }[] },
  });
  const categorias = q.data?.categorias ?? [];
  const gastos = useMemo(() => (q.data?.gastos ?? []).filter((g) => enRango(g.fecha, rango)), [q.data, rango]);
  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    gastos.forEach((g) => m.set(g.categoria, (m.get(g.categoria) ?? 0) + Number(g.neto)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [gastos]);
  const totalNeto = gastos.reduce((s, g) => s + Number(g.neto), 0);
  const totalIva = gastos.reduce((s, g) => s + Number(g.iva), 0);

  const abrir = (g: Gasto | 'nuevo') => {
    setEditando(g);
    setForm(g === 'nuevo' ? { ...VACIO, fecha: hoyISO() } : {
      fecha: g.fecha, descripcion: g.descripcion, categoria: g.categoria,
      total: decimalATexto(g.total), con_factura: g.con_factura, comentario: g.comentario,
    });
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      const datos = { ...form, total: parseDecimal(form.total) };
      if (editando === 'nuevo') await createGasto(datos);
      else if (editando) await updateGasto(editando.id, datos);
      queryClient.invalidateQueries({ queryKey: ['gastos'] });
      queryClient.invalidateQueries({ queryKey: ['contabilidad'] });
      queryClient.invalidateQueries({ queryKey: ['movimientos-banco'] });
      setEditando(null);
    } catch (e: any) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'No se pudo guardar', variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  };

  const nombreCategoria = (v: string) => categorias.find((c) => c.value === v)?.label ?? v;

  if (q.isLoading) return <LoadingSpinner />;

  const total = parseDecimal(form.total);

  return (
    <div className="space-y-4">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Gastos que no son mercadería (la mercadería va en Facturas de Compra). Neto del período:{' '}
          <b className="text-foreground tabular-nums">{formatCLP(totalNeto)}</b>
          {totalIva > 0 && <> · IVA recuperable {formatCLP(totalIva)}</>}
        </p>
        <Button onClick={() => abrir('nuevo')}><Plus className="mr-1 h-4 w-4" /> Nuevo gasto</Button>
      </div>

      {porCategoria.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {porCategoria.map(([cat, monto]) => (
            <span key={cat} className="rounded-full border px-3 py-1 text-xs">
              {nombreCategoria(cat)} <b className="tabular-nums">{formatCLP(monto)}</b>
            </span>
          ))}
        </div>
      )}

      <div className="divide-y rounded-xl border bg-card">
        {gastos.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Sin gastos en este período.</p>}
        {gastos.map((g) => (
          <div key={g.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{g.descripcion}</p>
              <p className="text-xs text-muted-foreground">
                {formatFecha(g.fecha)} · {nombreCategoria(g.categoria)}{g.con_factura ? ' · con factura' : ''}{g.movimiento ? ' · desde cartola' : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold tabular-nums">{formatCLP(g.total)}</p>
              {g.con_factura && <p className="text-[11px] text-muted-foreground">neto {formatCLP(g.neto)}</p>}
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Editar gasto" onClick={() => abrir(g)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Eliminar gasto"
              onClick={() => confirm({
                title: '¿Eliminar este gasto?',
                description: `${g.descripcion} · ${formatCLP(g.total)}`,
                confirmLabel: 'Eliminar',
                destructive: true,
                onConfirm: async () => {
                  await deleteGasto(g.id);
                  queryClient.invalidateQueries({ queryKey: ['gastos'] });
                  queryClient.invalidateQueries({ queryKey: ['contabilidad'] });
                },
              })}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{editando === 'nuevo' ? 'Nuevo gasto' : 'Editar gasto'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Fecha</Label>
                <Input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Total pagado</Label>
                <DecimalInput value={form.total} onValueChange={(t) => setForm({ ...form, total: t })} placeholder="$" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Input value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Ej: bencina reparto" />
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={form.categoria} onValueChange={(v) => setForm({ ...form, categoria: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categorias.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <span>
                Tiene factura
                <span className="block text-xs text-muted-foreground">
                  {form.con_factura && total > 0
                    ? `Neto ${formatCLP(total / 1.19)} + IVA ${formatCLP(total - total / 1.19)} (crédito fiscal)`
                    : 'Con factura, su IVA se descuenta del IVA a pagar'}
                </span>
              </span>
              <Switch checked={form.con_factura} onCheckedChange={(v) => setForm({ ...form, con_factura: v })} />
            </label>
            <div className="space-y-1.5">
              <Label>Comentario</Label>
              <Textarea rows={2} value={form.comentario} onChange={(e) => setForm({ ...form, comentario: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button disabled={guardando || !form.descripcion.trim() || total <= 0} onClick={guardar}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
