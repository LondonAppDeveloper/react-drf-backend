import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/40 sm:bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// En teléfono el diálogo es una hoja inferior (como las de iOS): sube desde abajo,
// tiene grabber y se cierra arrastrándola hacia abajo.
function useSheetDrag(contentRef: React.RefObject<HTMLElement>, close: () => void) {
  const gesto = React.useRef<{ y: number; t: number; dy: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      gesto.current = { y: e.clientY, t: performance.now(), dy: 0 };
      e.currentTarget.setPointerCapture(e.pointerId);
      if (contentRef.current) contentRef.current.style.transition = "none";
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const g = gesto.current;
      if (!g || !contentRef.current) return;
      g.dy = Math.max(0, e.clientY - g.y);
      contentRef.current.style.transform = `translateY(${g.dy}px)`;
    },
    onPointerUp: () => {
      const g = gesto.current;
      gesto.current = null;
      const el = contentRef.current;
      if (!g || !el) return;
      el.style.transition = "transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)";
      const velocidad = g.dy / Math.max(performance.now() - g.t, 1);
      if (g.dy > 110 || velocidad > 0.6) {
        el.style.transform = "translateY(100%)";
        close();
      } else {
        el.style.transform = "";
        window.setTimeout(() => {
          if (contentRef.current) contentRef.current.style.transition = "";
        }, 260);
      }
    },
  };
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const contenido = React.useRef<HTMLDivElement>(null);
  const cerrar = React.useRef<HTMLButtonElement>(null);
  React.useImperativeHandle(ref, () => contenido.current as HTMLDivElement);
  const arrastre = useSheetDrag(contenido, () => cerrar.current?.click());

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={contenido}
        data-sheet
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          "max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-[28px] max-sm:border-x-0 max-sm:border-b-0 max-sm:max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]",
          className,
        )}
        {...props}
      >
        {/* Grabber: zona de arrastre para cerrar la hoja */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 z-10 flex h-6 touch-none cursor-grab justify-center pt-2 sm:hidden"
          {...arrastre}
        >
          <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        </div>
        {children}
        <DialogPrimitive.Close
          ref={cerrar}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none max-sm:right-3 max-sm:top-3 max-sm:z-20 max-sm:flex max-sm:h-8 max-sm:w-8 max-sm:items-center max-sm:justify-center max-sm:rounded-full max-sm:bg-muted max-sm:opacity-100 max-sm:after:absolute max-sm:after:-inset-1.5 max-sm:after:content-['']"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Cerrar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
