import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Cliente } from '@/types';

interface ClienteComboboxProps {
  clientes: Cliente[];
  value: string;
  onChange: (clienteId: string) => void;
  placeholder?: string;
}

export function ClienteCombobox({
  clientes,
  value,
  onChange,
  placeholder = 'Seleccione un cliente',
}: ClienteComboboxProps) {
  const [open, setOpen] = useState(false);

  const clientesOrdenados = useMemo(
    () => [...clientes].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [clientes]
  );

  const clienteSeleccionado = clientes.find((cliente) => cliente.id.toString() === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {clienteSeleccionado ? clienteSeleccionado.nombre : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command
          filter={(itemValue, search) => {
            const cliente = clientes.find((c) => c.id.toString() === itemValue);
            if (!cliente) return 0;
            const haystack = `${cliente.nombre} ${cliente.vendedor?.nombre ?? ''}`.toLowerCase();
            return haystack.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Buscar cliente..." />
          <CommandList>
            <CommandEmpty>No se encontró ningún cliente.</CommandEmpty>
            <CommandGroup>
              {clientesOrdenados.map((cliente) => (
                <CommandItem
                  key={cliente.id}
                  value={cliente.id.toString()}
                  onSelect={(currentValue) => {
                    onChange(currentValue === value ? '' : currentValue);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4 shrink-0',
                      value === cliente.id.toString() ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span>{cliente.nombre}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
