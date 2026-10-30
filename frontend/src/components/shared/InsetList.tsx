import { Link } from 'react-router-dom';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Lista agrupada estilo iOS (como Ajustes): fondo gris, grupos redondeados,
// filas de 44 pt o más con separadores que empiezan en el texto.

export function InsetGroup({
  title, footer, children, className,
}: {
  title?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-1.5', className)}>
      {title && <h2 className="px-4 text-[13px] uppercase tracking-wide text-muted-foreground">{title}</h2>}
      <div className="overflow-hidden rounded-2xl bg-card">{children}</div>
      {footer && <p className="px-4 text-[13px] text-muted-foreground">{footer}</p>}
    </section>
  );
}

interface ListRowProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  to?: string;
  href?: string;
  onClick?: () => void;
  destructive?: boolean;
  /** Indicador de disclosure; por defecto solo en filas que navegan. */
  chevron?: boolean;
  className?: string;
}

export function ListRow({
  icon: Icon, title, subtitle, trailing, to, href, onClick, destructive, chevron, className,
}: ListRowProps) {
  const interactiva = !!(to || href || onClick);
  const clases = cn(
    'relative flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left',
    'after:absolute after:bottom-0 after:right-0 after:h-px after:bg-border last:after:hidden',
    Icon ? 'after:left-[60px]' : 'after:left-4',
    interactiva && 'transition-colors duration-150 active:bg-muted/70',
    className
  );
  const contenido = (
    <>
      {Icon && (
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <Icon className="h-[18px] w-[18px]" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[17px] leading-[22px]', destructive && 'text-destructive')}>{title}</span>
        {subtitle && <span className="block text-[15px] leading-5 text-muted-foreground">{subtitle}</span>}
      </span>
      {trailing}
      {(chevron ?? !!(to || href)) && <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground/60" />}
    </>
  );

  if (to) return <Link to={to} className={clases}>{contenido}</Link>;
  if (href) return <a href={href} target="_blank" rel="noreferrer" onClick={onClick} className={clases}>{contenido}</a>;
  if (onClick) return <button type="button" onClick={onClick} className={clases}>{contenido}</button>;
  return <div className={clases}>{contenido}</div>;
}
