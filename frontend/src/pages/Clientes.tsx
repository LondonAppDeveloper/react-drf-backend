import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Pencil, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { getClientes, getPedidos } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { ClienteFormDialog, formatSimplePhone } from '@/components/shared/ClienteFormDialog';
import type { Cliente, Pedido } from '@/types';
import { diasDesde, formatCLP, formatFecha } from '@/lib/utils';

// Color estable por vendedor a partir de su sigla (no depende de una lista fija).
const PALETA = [
  'bg-blue-100 text-blue-700 border-blue-200',
  'bg-emerald-100 text-emerald-700 border-emerald-200',
  'bg-amber-100 text-amber-700 border-amber-200',
  'bg-purple-100 text-purple-700 border-purple-200',
  'bg-rose-100 text-rose-700 border-rose-200',
  'bg-cyan-100 text-cyan-700 border-cyan-200',
];
const getVendedorColor = (sigla: string) => {
  let h = 0;
  for (const c of sigla.toUpperCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETA[h % PALETA.length];
};

type Orden = 'nombre' | 'total' | 'ultima';

export default function Clientes() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [vendedor, setVendedor] = useState('todos');
  const [orden, setOrden] = useState<Orden>('nombre');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null);

  const { data: clientesData, isLoading, error } = useQuery({
    queryKey: ['clientes'],
    queryFn: async () => (await getClientes()).data,
  });
  // Misma clave que Pedidos para compartir caché.
  const { data: pedidos } = useQuery({
    queryKey: ['pedidos'],
    queryFn: async () => (await getPedidos(true)).data as Pedido[],
  });

  const clientes: Cliente[] = Array.isArray(clientesData) ? clientesData : (clientesData as any)?.results ?? [];

  // Historial de compra por cliente (sin pedidos anulados).
  const historial = useMemo(() => {
    const m = new Map<number, { pedidos: number; total: number; ultima: string | null }>();
    (pedidos ?? []).forEach((p) => {
      if (p.estado === 'Anulado') return;
      const h = m.get(p.cliente.id) ?? { pedidos: 0, total: 0, ultima: null };
      h.pedidos += 1;
      h.total += Number(p.total);
      if (!h.ultima || p.fecha > h.ultima) h.ultima = p.fecha;
      m.set(p.cliente.id, h);
    });
    return m;
  }, [pedidos]);

  const vendedores = useMemo(() => {
    const m = new Map<number, { id: number; nombre: string }>();
    clientes.forEach((c) => c.vendedor && m.set(c.vendedor.id, c.vendedor));
    return Array.from(m.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [clientes]);

  const filteredClientes = useMemo(() => {
    const q = search.toLowerCase().trim();
    const qDigitos = q.replace(/\D/g, '');
    const lista = clientes.filter((c) => {
      const matchTexto =
        !q ||
        c.nombre.toLowerCase().includes(q) ||
        (c.direccion ?? '').toLowerCase().includes(q) ||
        (qDigitos.length >= 3 && (c.telefono ?? '').replace(/\D/g, '').includes(qDigitos));
      const matchVendedor = vendedor === 'todos' || String(c.vendedor?.id) === vendedor;
      return matchTexto && matchVendedor;
    });
    const h = (c: Cliente) => historial.get(c.id);
    return lista.sort((a, b) => {
      if (orden === 'total') return (h(b)?.total ?? 0) - (h(a)?.total ?? 0);
      if (orden === 'ultima') return (h(b)?.ultima ?? '').localeCompare(h(a)?.ultima ?? '');
      return a.nombre.localeCompare(b.nombre);
    });
  }, [clientes, search, vendedor, orden, historial]);

  const openDialog = (cliente: Cliente | null) => {
    setEditingCliente(cliente);
    setDialogOpen(true);
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudieron cargar los clientes" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground">{clientes.length} clientes · historial de compra y vendedor asignado</p>
        </div>
        <Button onClick={() => openDialog(null)}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo Cliente
        </Button>
        <ClienteFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          mode={editingCliente ? 'edit' : 'create'}
          cliente={editingCliente}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Nombre, teléfono o dirección..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={vendedor} onValueChange={setVendedor}>
          <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los vendedores</SelectItem>
            {vendedores.map((v) => (
              <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={orden} onValueChange={(v) => setOrden(v as Orden)}>
          <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nombre">Ordenar por nombre</SelectItem>
            <SelectItem value="total">Mayor compra total</SelectItem>
            <SelectItem value="ultima">Compra más reciente</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Cliente</TableHead>
              <TableHead className="hidden md:table-cell">Teléfono</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead className="text-right hidden sm:table-cell">Pedidos</TableHead>
              <TableHead className="text-right">Total comprado</TableHead>
              <TableHead className="hidden lg:table-cell">Última compra</TableHead>
              <TableHead className="w-[90px] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClientes.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No hay clientes con estos filtros.</TableCell>
              </TableRow>
            )}
            {filteredClientes.map((cliente) => {
              const h = historial.get(cliente.id);
              const dias = h?.ultima ? diasDesde(h.ultima) : null;
              return (
                <TableRow key={cliente.id}>
                  <TableCell>
                    <div className="font-medium">
                      {cliente.nombre}
                      {cliente.tipo_cliente === 'mayorista' && (
                        <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">Mayorista</span>
                      )}
                    </div>
                    {cliente.tipo_cliente === 'mayorista' && cliente.rut && (
                      <div className="text-xs text-muted-foreground">{cliente.razon_social} · {cliente.rut}</div>
                    )}
                    {cliente.direccion && <div className="text-xs text-muted-foreground truncate max-w-[260px]">{cliente.direccion}</div>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell whitespace-nowrap">
                    {cliente.telefono ? formatSimplePhone(cliente.telefono) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`font-bold ${getVendedorColor(cliente.vendedor.sigla)}`} title={cliente.vendedor.nombre}>
                      {cliente.vendedor.sigla}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right hidden sm:table-cell tabular-nums">{h?.pedidos ?? 0}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{h ? formatCLP(h.total) : '—'}</TableCell>
                  <TableCell className="hidden lg:table-cell text-sm">
                    {h?.ultima ? (
                      <>
                        {formatFecha(h.ultima)}
                        <span className={`ml-1 text-xs ${dias! > 30 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                          ({dias === 0 ? 'hoy' : `hace ${dias} ${dias === 1 ? 'día' : 'días'}`})
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Sin compras</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Ver pedidos"
                      disabled={!h}
                      onClick={() => navigate(`/pedidos?buscar=${encodeURIComponent(cliente.nombre)}`)}
                    >
                      <ShoppingCart className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Editar" onClick={() => openDialog(cliente)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
