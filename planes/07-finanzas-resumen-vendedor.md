# Plan: Finanzas — Encabezado de Pagado/Adeudado al Seleccionar un Vendedor

## Objetivo
Cuando se selecciona un vendedor específico en la página de Finanzas, mostrar (además del historial de movimientos que ya se ve) un encabezado con cuánto ha pagado ese vendedor y cuánto debe — la misma información que ya se calcula para el resumen general, pero hoy no se repite cuando se entra al detalle de un vendedor puntual.

## Contexto
- La página vive en [frontend/src/pages/GestioPagosVendedor.tsx](../frontend/src/pages/GestioPagosVendedor.tsx) (ruta `/gestion-pagos`, menú "Gestión de Pagos" en [Sidebar.tsx:40](../frontend/src/components/layout/Sidebar.tsx)) y ya tiene toda la lógica de cálculo necesaria:
  - `resumenGeneral` ([líneas 65-103](../frontend/src/pages/GestioPagosVendedor.tsx)) calcula, por cada vendedor: `ventas` (suma de `Pedido.total` de ese vendedor), `pagos` (suma de `PagoVendedor` tipo `'pago'`), `adelantos` (suma tipo `'adelanto'`) y `deudaNeta = ventas - pagosRealizados`.
  - Este resumen **solo se muestra** en la vista `vendedorId === "todos"` ([líneas 187-223](../frontend/src/pages/GestioPagosVendedor.tsx)), como una tabla consolidada con columnas Vendedor/Ventas/Pagado/Deuda/Adelantos.
  - Cuando se selecciona un vendedor específico (`vendedorId !== "todos"`, [líneas 224-304](../frontend/src/pages/GestioPagosVendedor.tsx)), la pantalla muestra el formulario de registrar pago/adelanto (columna izquierda) y la tabla de movimientos filtrada por ese vendedor (columna derecha, líneas 256-301) — **pero no repite el resumen de ventas/pagado/deuda/adelantos para ese vendedor**, a pesar de que el dato ya está calculado en `resumenGeneral`.
- `PagoVendedor` ([backend/core/models.py:285-312](../backend/core/models.py)): modelo con `tipo` (`'pago'` o `'adelanto'`), `monto`, `vendedor` (FK) — es la fuente de los pagos.
- El cálculo de "ventas" del vendedor usa `Pedido.total` vía `respPedidos` ([línea 51](../frontend/src/pages/GestioPagosVendedor.tsx), `getPedidos()`) filtrado por `p.vendedor?.id === vId` ([líneas 70-76](../frontend/src/pages/GestioPagosVendedor.tsx)) — no distingue estado del pedido (incluye pedidos `Anulado`, a diferencia de los reportes de ganancia que sí los excluyen); esto ya es el comportamiento actual para el resumen general, así que el nuevo encabezado por vendedor debe mantenerlo igual para no generar números distintos entre las dos vistas.
- Backend: `PagoVendedorView` ([backend/core/views.py:700-734](../backend/core/views.py)) ya soporta filtrar por `?vendedor=<id>` en el GET, aunque el frontend hoy trae **todos** los pagos (`getPagosVendedor()` sin argumento, [línea 52](../frontend/src/pages/GestioPagosVendedor.tsx)) y filtra client-side — no hace falta tocar el backend para este plan, `resumenGeneral` ya tiene todo lo necesario por vendedor.

## Funcionalidades requeridas

### 1. Encabezado de resumen en la vista de vendedor individual
- En la rama `vendedorId !== "todos"` ([GestioPagosVendedor.tsx:224-304](../frontend/src/pages/GestioPagosVendedor.tsx)), agregar un bloque de tarjetas/encabezado (arriba del grid de formulario+movimientos) mostrando para el vendedor seleccionado: Ventas totales, Pagado, Deuda (Ventas − Pagado) y Adelantos — reutilizando `resumenGeneral.find(v => v.id.toString() === vendedorId)` en vez de recalcular nada nuevo.
- Mantener el mismo criterio visual que ya usa la tabla consolidada (verde para pagado, naranja para deuda, azul para adelantos, [líneas 205-208](../frontend/src/pages/GestioPagosVendedor.tsx)) para que el usuario reconozca de inmediato el mismo significado de cada color.

## Pasos de implementación
1. Frontend: en `GestioPagosVendedor.tsx`, dentro de la rama `vendedorId !== "todos"`, obtener el resumen del vendedor actual con `resumenGeneral.find(v => v.id.toString() === vendedorId)`.
2. Frontend: renderizar un encabezado (fila de tarjetas KPI o barra con 4 valores) con Ventas/Pagado/Deuda/Adelantos de ese vendedor, ubicado antes del `grid grid-cols-1 lg:grid-cols-3` actual (línea 225).
3. Verificación manual: seleccionar un vendedor con movimientos registrados y confirmar que los números del nuevo encabezado coinciden exactamente con la fila de ese vendedor en la tabla consolidada de "Ver Resumen General".

## Consideraciones técnicas
- No requiere cambios de backend ni de tipos nuevos: toda la data ya se trae y se calcula en el propio componente (`resumenGeneral`).
- Cambio puramente aditivo y de bajo riesgo — no toca la lógica de cálculo existente, solo la reutiliza en un lugar donde antes no se mostraba.

## Complejidad: Baja
## Dependencias: Ninguna

---

## Cómo ejecutar este plan

```
Implementa el Plan 07 (Finanzas — Encabezado de Pagado/Adeudado al Seleccionar Vendedor) de planes/07-finanzas-resumen-vendedor.md

Contexto:
- Página: frontend/src/pages/GestioPagosVendedor.tsx (ruta /gestion-pagos)
- resumenGeneral (líneas 65-103) YA calcula por vendedor: ventas, pagos, adelantos, deudaNeta -- pero solo se muestra en la vista "Ver Resumen General" (vendedorId === "todos", líneas 187-223)
- Cuando se selecciona un vendedor específico (líneas 224-304) no se repite ese resumen, solo se ve el formulario de registrar pago y el historial de movimientos
- La tabla consolidada ya usa estos colores: verde=pagado, naranja=deuda, azul=adelantos (líneas 205-208) -- mantener la misma paleta para consistencia visual

Enfoque:
1. En la rama vendedorId !== "todos", buscar el resumen de ese vendedor con resumenGeneral.find(v => v.id.toString() === vendedorId)
2. Agregar un encabezado con Ventas/Pagado/Deuda/Adelantos de ese vendedor, antes del grid de formulario+movimientos existente (línea 225)
3. Verificar que los valores coinciden con la fila correspondiente en la tabla de "Ver Resumen General"
4. Una vez verificado, marcar el Plan 07 como ✅ Completado en planes/README.md (tabla "Finanzas" y tabla "Skills y Modelos Recomendados")
```

> Skill recomendado: `/impeccable` (agregar un bloque de KPIs sobre datos ya calculados, sin lógica nueva).
> Modelo recomendado: **Sonnet** (cambio pequeño y acotado, reutiliza cálculo existente).
