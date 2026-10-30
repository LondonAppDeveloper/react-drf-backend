import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RangoFechaSelect, rangoInicial, type RangoState } from '@/components/shared/RangoFechaSelect';
import { ResumenContable } from '@/components/tesoreria/ResumenContable';
import { MovimientosBanco } from '@/components/tesoreria/MovimientosBanco';
import { GastosEmpresa } from '@/components/tesoreria/GastosEmpresa';

const PESTANAS = ['contabilidad', 'banco', 'gastos'] as const;

export default function Tesoreria() {
  const [params, setParams] = useSearchParams();
  const pestana = PESTANAS.includes(params.get('tab') as any) ? params.get('tab')! : 'contabilidad';
  const [rango, setRango] = useState<RangoState>(rangoInicial('anio'));

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Tesorería</h1>
          <p className="text-muted-foreground">Banco, gastos e impuestos de la empresa.</p>
        </div>
        {pestana !== 'banco' && <RangoFechaSelect value={rango} onChange={setRango} />}
      </div>

      <Tabs value={pestana} onValueChange={(v) => setParams({ tab: v }, { replace: true })} className="space-y-4">
        <TabsList>
          <TabsTrigger value="contabilidad">Contabilidad</TabsTrigger>
          <TabsTrigger value="banco">Banco</TabsTrigger>
          <TabsTrigger value="gastos">Gastos</TabsTrigger>
        </TabsList>
        <TabsContent value="contabilidad">
          <ResumenContable rango={rango.rango} />
        </TabsContent>
        <TabsContent value="banco">
          <MovimientosBanco />
        </TabsContent>
        <TabsContent value="gastos">
          <GastosEmpresa rango={rango.rango} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
