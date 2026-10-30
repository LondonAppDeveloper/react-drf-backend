import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: React.ReactNode;
  // Clase de color para el valor y el ícono (ej. 'text-green-600').
  accent?: string;
  // Variación porcentual vs. un período anterior; positivo = mejor.
  trend?: { value: number; label: string };
  onClick?: () => void;
  className?: string;
}

// Tarjeta de indicador única para toda la app (Resumen, Reportes, Stock, Facturas...).
export function StatCard({ title, value, icon: Icon, description, accent, trend, onClick, className }: StatCardProps) {
  return (
    <Card
      className={cn(onClick && 'cursor-pointer transition-colors hover:border-primary/50', className)}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={cn('h-4 w-4 text-muted-foreground', accent)} />
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-bold tabular-nums', accent)}>{value}</div>
        {trend && Number.isFinite(trend.value) && (
          <p className={cn('text-xs mt-1', trend.value >= 0 ? 'text-green-600' : 'text-destructive')}>
            {trend.value >= 0 ? '▲' : '▼'} {Math.abs(trend.value).toFixed(1)}% {trend.label}
          </p>
        )}
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}
