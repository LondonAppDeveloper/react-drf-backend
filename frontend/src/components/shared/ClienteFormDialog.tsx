import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useForm, Controller } from 'react-hook-form';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCliente, updateCliente, getVendedores } from '@/services/api';
import { Building2, Loader2 } from 'lucide-react';
import type { Cliente, DatosFacturacion, Vendedor } from '@/types';
import { useToast } from '@/hooks/use-toast';

interface ClienteForm extends Required<DatosFacturacion> {
  nombre: string;
  telefono: string;
  direccion: string;
  email?: string;
  vendedor: string;
}

export const formatSimplePhone = (value: string) => {
  let digits = value.replace(/\D/g, '');
  if (!digits) return '';
  // Si viene con código de país (+56), lo quitamos para no perder dígitos del número.
  if (digits.startsWith('56') && digits.length > 9) {
    digits = digits.substring(2);
  }
  let formatted = '9';
  const rest = digits.startsWith('9') ? digits.substring(1) : digits;
  if (rest.length > 0) formatted += ' ' + rest.substring(0, 4);
  if (rest.length > 4) formatted += ' ' + rest.substring(4, 8);
  return formatted;
};

// "123456785" -> "12.345.678-5"
export const formatRut = (value: string) => {
  const limpio = value.replace(/[^\dkK]/g, '').toUpperCase().slice(0, 9);
  if (limpio.length < 2) return limpio;
  const cuerpo = limpio.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${limpio.slice(-1)}`;
};

// Dígito verificador (módulo 11).
export const rutValido = (rut: string) => {
  const limpio = rut.replace(/[^\dkK]/g, '').toUpperCase();
  if (limpio.length < 8) return false;
  const cuerpo = limpio.slice(0, -1);
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === limpio.slice(-1);
};

const emptyValues: ClienteForm = {
  nombre: '',
  telefono: '',
  direccion: '',
  email: '',
  vendedor: '',
  tipo_cliente: 'minorista',
  rut: '',
  razon_social: '',
  giro: '',
  direccion_facturacion: '',
  comuna: '',
  ciudad: '',
  email_facturacion: '',
  contacto: '',
};

interface ClienteFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  cliente?: Cliente | null;
  onSuccess?: (cliente: Cliente) => void;
}

export function ClienteFormDialog({
  open,
  onOpenChange,
  mode,
  cliente,
  onSuccess,
}: ClienteFormDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<ClienteForm>({
    defaultValues: emptyValues,
  });
  const esMayorista = form.watch('tipo_cliente') === 'mayorista';

  const { data: vendedoresData } = useQuery({
    queryKey: ['vendedores'],
    queryFn: async () => {
      const response = await getVendedores();
      return response.data;
    },
  });

  const vendedores = Array.isArray(vendedoresData) ? vendedoresData : (vendedoresData as any)?.results ?? [];

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && cliente) {
      form.reset({
        ...emptyValues,
        ...Object.fromEntries(Object.entries(cliente).filter(([k, v]) => k in emptyValues && v != null)),
        nombre: cliente.nombre,
        telefono: formatSimplePhone(cliente.telefono || ''),
        direccion: cliente.direccion || '',
        email: cliente.email || '',
        vendedor: String(cliente.vendedor.id),
      });
    } else {
      form.reset(emptyValues);
    }
  }, [open, mode, cliente]);

  const mutation = useMutation({
    mutationFn: (values: ClienteForm) => {
      const { vendedor, telefono, email, ...resto } = values;
      const payload = {
        ...resto,
        email: email?.trim() ? email : null,
        telefono: telefono.replace(/\s/g, ''),
        vendedor_id: Number(vendedor),
      };

      return mode === 'edit' && cliente
        ? updateCliente(cliente.id, payload)
        : createCliente(payload);
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      toast({
        title: mode === 'edit' ? 'Cliente actualizado' : 'Cliente creado',
        description: 'La operación se realizó correctamente.',
      });
      onOpenChange(false);
      onSuccess?.(response.data);
    },
    onError: (error: any) => {
      console.error('Error del backend:', error.response?.data);
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Verifique los datos obligatorios',
        variant: 'destructive',
      });
    },
  });

  const onSubmit = (values: ClienteForm) => {
    if (!values.vendedor) {
      toast({ title: 'Error', description: 'Seleccione un vendedor', variant: 'destructive' });
      return;
    }
    mutation.mutate(values);
  };

  const error = (campo: keyof ClienteForm) =>
    form.formState.errors[campo] && (
      <span className="text-xs text-destructive">{form.formState.errors[campo]?.message as string}</span>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Editar Cliente' : 'Nuevo Cliente'}</DialogTitle>
          <DialogDescription>
            {mode === 'edit' ? 'Modifique los datos del cliente' : 'Agregue un nuevo cliente al sistema'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-2">
          <Controller
            name="tipo_cliente"
            control={form.control}
            render={({ field }) => (
              <ToggleGroup
                type="single"
                variant="outline"
                value={field.value}
                onValueChange={(v) => v && field.onChange(v)}
                className="grid grid-cols-2"
              >
                <ToggleGroupItem value="minorista">Minorista</ToggleGroupItem>
                <ToggleGroupItem value="mayorista">Mayorista (con factura)</ToggleGroupItem>
              </ToggleGroup>
            )}
          />

          <div className="grid gap-2">
            <Label htmlFor="nombre">{esMayorista ? 'Nombre de fantasía / local *' : 'Nombre *'}</Label>
            <Input id="nombre" {...form.register('nombre', { required: 'El nombre es obligatorio' })} />
            {error('nombre')}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="telefono">Teléfono (9 XXXX XXXX) *</Label>
              <Controller
                name="telefono"
                control={form.control}
                rules={{
                  required: 'El teléfono es obligatorio',
                  minLength: { value: 11, message: 'Teléfono incompleto' },
                }}
                render={({ field }) => (
                  <Input
                    id="telefono"
                    inputMode="tel"
                    placeholder="9 1234 5678"
                    value={field.value}
                    onChange={(e) => {
                      const formatted = formatSimplePhone(e.target.value);
                      if (formatted.length <= 11) field.onChange(formatted);
                    }}
                  />
                )}
              />
              {error('telefono')}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="ejemplo@correo.com" {...form.register('email')} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="direccion">Dirección de despacho *</Label>
            <Input id="direccion" {...form.register('direccion', { required: 'La dirección es obligatoria' })} />
            {error('direccion')}
          </div>

          {esMayorista && (
            <fieldset className="grid gap-4 rounded-lg border p-4">
              <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold">
                <Building2 className="h-4 w-4" /> Datos para facturar
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="rut">RUT empresa *</Label>
                  <Controller
                    name="rut"
                    control={form.control}
                    rules={{
                      validate: (v) => !esMayorista || rutValido(v) || 'RUT inválido',
                    }}
                    render={({ field }) => (
                      <Input id="rut" placeholder="76.123.456-7" value={field.value} onChange={(e) => field.onChange(formatRut(e.target.value))} />
                    )}
                  />
                  {error('rut')}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="razon_social">Razón social *</Label>
                  <Input
                    id="razon_social"
                    {...form.register('razon_social', { validate: (v) => !esMayorista || !!v.trim() || 'La razón social es obligatoria' })}
                  />
                  {error('razon_social')}
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="giro">Giro</Label>
                <Input id="giro" placeholder="Ej: Restaurante" {...form.register('giro')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="direccion_facturacion">Dirección de facturación</Label>
                <Input id="direccion_facturacion" placeholder="Vacío = la de despacho" {...form.register('direccion_facturacion')} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="comuna">Comuna</Label>
                  <Input id="comuna" {...form.register('comuna')} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ciudad">Ciudad</Label>
                  <Input id="ciudad" {...form.register('ciudad')} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="email_facturacion">Email para la factura</Label>
                  <Input id="email_facturacion" type="email" {...form.register('email_facturacion')} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contacto">Contacto / encargado de pagos</Label>
                  <Input id="contacto" {...form.register('contacto')} />
                </div>
              </div>
            </fieldset>
          )}

          <div className="grid gap-2">
            <Label htmlFor="vendedor">Vendedor Asignado *</Label>
            <Select
              value={form.watch('vendedor')}
              onValueChange={(val) => {
                form.setValue('vendedor', val, { shouldValidate: true });
              }}
            >
              <SelectTrigger id="vendedor">
                <SelectValue placeholder="Seleccione vendedor" />
              </SelectTrigger>
              <SelectContent>
                {vendedores.map((v: Vendedor) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.nombre} ({v.sigla})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="mt-2 gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</>
              ) : (
                mode === 'edit' ? 'Actualizar' : 'Guardar'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
