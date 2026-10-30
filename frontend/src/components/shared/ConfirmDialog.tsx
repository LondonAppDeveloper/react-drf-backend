import { useState } from 'react';
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

type Pedido = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
};

// Reemplazo del confirm() del navegador con el mismo estilo que el resto de
// los diálogos. Uso: const { confirm, dialog } = useConfirm(); ... {dialog}
export function useConfirm() {
  const [pedido, setPedido] = useState<Pedido | null>(null);

  const dialog = (
    <AlertDialog open={!!pedido} onOpenChange={(open) => !open && setPedido(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pedido?.title}</AlertDialogTitle>
          {pedido?.description && <AlertDialogDescription>{pedido.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className={pedido?.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
            onClick={() => {
              pedido?.onConfirm();
              setPedido(null);
            }}
          >
            {pedido?.confirmLabel ?? 'Confirmar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm: setPedido, dialog };
}
