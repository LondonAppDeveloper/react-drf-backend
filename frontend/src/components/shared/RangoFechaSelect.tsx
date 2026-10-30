import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { PRESETS_RANGO, rangoDesdePreset, type PresetRango, type RangoFecha } from '@/lib/utils';

export type RangoState = { preset: PresetRango | 'custom'; rango: RangoFecha };

export const rangoInicial = (preset: PresetRango): RangoState => ({ preset, rango: rangoDesdePreset(preset) });

interface Props {
  value: RangoState;
  onChange: (v: RangoState) => void;
  className?: string;
}

// Selector de período: atajos (este mes, mes anterior...) o rango personalizado.
export function RangoFechaSelect({ value, onChange, className }: Props) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      <Select
        value={value.preset}
        onValueChange={(v) =>
          v === 'custom'
            ? onChange({ preset: 'custom', rango: value.rango })
            : onChange(rangoInicial(v as PresetRango))
        }
      >
        <SelectTrigger className="w-[170px] bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS_RANGO.map((p) => (
            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
          ))}
          <SelectItem value="custom">Personalizado…</SelectItem>
        </SelectContent>
      </Select>
      {value.preset === 'custom' && (
        <>
          <Input
            type="date"
            aria-label="Desde"
            className="w-[150px] bg-background"
            value={value.rango.desde ?? ''}
            onChange={(e) => onChange({ preset: 'custom', rango: { ...value.rango, desde: e.target.value || undefined } })}
          />
          <span className="text-muted-foreground text-sm">a</span>
          <Input
            type="date"
            aria-label="Hasta"
            className="w-[150px] bg-background"
            value={value.rango.hasta ?? ''}
            onChange={(e) => onChange({ preset: 'custom', rango: { ...value.rango, hasta: e.target.value || undefined } })}
          />
        </>
      )}
    </div>
  );
}
