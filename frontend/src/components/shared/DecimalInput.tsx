import { forwardRef } from 'react';
import { Input } from '@/components/ui/input';
import { normalizarDecimal } from '@/lib/utils';

type Props = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onValueChange: (texto: string) => void;
  /** false = solo enteros (unidades). */
  decimales?: boolean;
};

// Campo numérico que trabaja con coma decimal: un punto escrito se convierte en
// coma. Usa type="text" con inputMode para que el teclado del teléfono muestre
// números sin que el navegador rechace la coma (type="number" la rechaza).
export const DecimalInput = forwardRef<HTMLInputElement, Props>(
  ({ value, onValueChange, decimales = true, ...props }, ref) => (
    <Input
      ref={ref}
      type="text"
      inputMode={decimales ? 'decimal' : 'numeric'}
      autoComplete="off"
      value={value}
      onChange={(e) => onValueChange(normalizarDecimal(e.target.value, decimales))}
      onFocus={(e) => e.target.select()}
      {...props}
    />
  )
);
DecimalInput.displayName = 'DecimalInput';
