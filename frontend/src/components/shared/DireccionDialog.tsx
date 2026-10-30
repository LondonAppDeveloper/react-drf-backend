import { Copy, MapPin, Navigation } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InsetGroup, ListRow } from '@/components/shared/InsetList';
import { useToast } from '@/hooks/use-toast';
import { enlacesMapa } from '@/lib/mapas';

// Dirección de despacho de un pedido con opciones para abrirla en la app de mapas
// preferida (Google Maps, Waze, Mapas de Apple) o copiarla. En teléfono es una
// hoja inferior, como las hojas de acciones de iOS.
export function DireccionDialog({
  cliente, direccion, open, onOpenChange,
}: {
  cliente: string;
  direccion?: string | null;
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
}) {
  const { toast } = useToast();
  const texto = (direccion ?? '').trim();

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      toast({ title: 'Dirección copiada' });
    } catch {
      toast({ title: 'No se pudo copiar', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader className="pt-3 sm:pt-0">
          <DialogTitle>Dirección de entrega</DialogTitle>
          <DialogDescription>{cliente}</DialogDescription>
        </DialogHeader>

        {texto ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-[17px] leading-snug">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 break-words">{texto}</span>
            </p>
            <InsetGroup title="Abrir en" className="[&>div]:border">
              {enlacesMapa(texto).map((m) => (
                <ListRow key={m.id} icon={Navigation} title={m.nombre} href={m.url} onClick={() => onOpenChange(false)} chevron />
              ))}
              <ListRow icon={Copy} title="Copiar dirección" onClick={copiar} />
            </InsetGroup>
          </div>
        ) : (
          <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
            Este cliente no tiene dirección registrada. Agrégala en Clientes.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
