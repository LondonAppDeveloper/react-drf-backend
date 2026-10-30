import { useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProveedores, createProveedor, updateProveedor, deleteProveedor, getFacturas } from '@/services/api';
import { useNavigate } from 'react-router-dom';
import { formatCLP, formatFecha } from '@/lib/utils';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { useToast } from '@/hooks/use-toast';
import type { Factura, Proveedor } from '@/types';

export default function Proveedores() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Proveedor | null>(null);
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [toDelete, setToDelete] = useState<Proveedor | null>(null);

  const navigate = useNavigate();
  const { data: proveedores = [], isLoading, error } = useQuery({
    queryKey: ['proveedores'],
    queryFn: async () => (await getProveedores()).data,
  });
  // Misma clave que Facturas para compartir caché.
  const { data: facturas } = useQuery({
    queryKey: ['facturas'],
    queryFn: async () => (await getFacturas()).data as Factura[],
  });

  const compras = useMemo(() => {
    const m = new Map<string, { total: number; pendiente: number; ultima: string | null }>();
    (facturas ?? []).forEach((f) => {
      const key = String(f.proveedor);
      const c = m.get(key) ?? { total: 0, pendiente: 0, ultima: null };
      c.total += Number(f.total);
      if (!f.pago_factura) c.pendiente += Number(f.total);
      if (!c.ultima || f.fecha > c.ultima) c.ultima = f.fecha;
      m.set(key, c);
    });
    return m;
  }, [facturas]);

  const onError = (err: any) => {
    toast({
      title: 'Error',
      description: err.response?.data?.error || 'No se pudo completar la operación',
      variant: 'destructive',
    });
  };

  const saveMutation = useMutation({
    mutationFn: (value: string) =>
      editing ? updateProveedor(editing.id, { nombre: value, rut: rut.trim() }) : createProveedor({ nombre: value, rut: rut.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'] });
      toast({ title: editing ? 'Proveedor actualizado' : 'Proveedor creado' });
      setDialogOpen(false);
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteProveedor(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'] });
      toast({ title: 'Proveedor eliminado' });
      setToDelete(null);
    },
    onError: (err) => {
      onError(err);
      setToDelete(null);
    },
  });

  const openDialog = (proveedor: Proveedor | null) => {
    setEditing(proveedor);
    setNombre(proveedor?.nombre ?? '');
    setRut(proveedor?.rut ?? '');
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = nombre.trim();
    if (!value) {
      toast({ title: 'Error', description: 'El nombre es obligatorio', variant: 'destructive' });
      return;
    }
    saveMutation.mutate(value);
  };

  const filtered = useMemo(
    () => proveedores.filter((p) => p.nombre.toLowerCase().includes(search.toLowerCase())),
    [proveedores, search]
  );

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudieron cargar los proveedores" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Proveedores</h1>
          <p className="text-muted-foreground">Gestión de proveedores para las facturas de compra</p>
        </div>
        <Button onClick={() => openDialog(null)}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo Proveedor
        </Button>
      </div>

      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar proveedores..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Proveedor</TableHead>
              <TableHead className="text-right">Facturas</TableHead>
              <TableHead className="text-right">Total comprado</TableHead>
              <TableHead className="text-right">Por pagar</TableHead>
              <TableHead className="hidden md:table-cell">Última compra</TableHead>
              <TableHead className="w-[120px] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No hay proveedores
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((proveedor) => (
                <TableRow key={proveedor.id}>
                  <TableCell className="font-medium">
                    {proveedor.nombre}
                    {proveedor.rut && <span className="block text-xs font-normal text-muted-foreground">{proveedor.rut}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{proveedor.cantidad_facturas}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(compras.get(String(proveedor.id))?.total ?? 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(compras.get(String(proveedor.id))?.pendiente ?? 0) > 0 ? (
                      <button
                        className="font-semibold text-destructive hover:underline"
                        onClick={() => navigate(`/facturas?pago=pendientes&buscar=${encodeURIComponent(proveedor.nombre)}`)}
                      >
                        {formatCLP(compras.get(String(proveedor.id))!.pendiente)}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">Al día</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm">
                    {formatFecha(compras.get(String(proveedor.id))?.ultima) || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" onClick={() => openDialog(proveedor)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={proveedor.cantidad_facturas > 0}
                      title={proveedor.cantidad_facturas > 0 ? 'Tiene facturas asociadas' : 'Eliminar'}
                      onClick={() => setToDelete(proveedor)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? 'Editar Proveedor' : 'Nuevo Proveedor'}</DialogTitle>
              <DialogDescription>
                El RUT sirve para cruzar sus facturas con el registro de compras del SII.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="nombre-proveedor">Nombre</Label>
              <Input
                id="nombre-proveedor"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                maxLength={100}
                autoFocus
              />
              <Label htmlFor="rut-proveedor" className="block pt-2">RUT</Label>
              <Input id="rut-proveedor" value={rut} onChange={(e) => setRut(e.target.value)} maxLength={15} placeholder="76.123.456-7" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Guardando...' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar proveedor?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará "{toDelete?.nombre}". Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && deleteMutation.mutate(toDelete.id)}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
