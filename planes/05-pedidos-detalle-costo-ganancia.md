# Plan: Pedidos — Dialog de Detalle de Costo y Ganancia por Pedido

## Objetivo
Agregar una opción en cada pedido que abra un diálogo de solo lectura mostrando, por línea de producto, el costo total, la venta total y la ganancia (margen), más los totales del pedido completo, para que el vendedor/admin pueda ver de un vistazo qué tan rentable fue ese pedido específico sin tener que ir a Reportes.

## Contexto
- `DetallePedido` ([backend/core/models.py:177-206](../backend/core/models.py)) ya calcula y persiste `total_costo`, `total_venta` y `margen` por línea en su `save()` (líneas 191-199: `total_costo = cantidad_kilos * costo_por_kilo`, `margen = total_venta - total_costo`).
- `DetallePedidoSerializer` ([backend/core/serializers.py:58-67](../backend/core/serializers.py)) ya expone `total_venta`, `total_costo` y **también `margen`** en `fields` (línea 67) — el dato ya viaja en cada `GET /pedidos/` y `GET /pedidos/<pk>/`, no hace falta tocar el backend para tener el margen por línea.
- El tipo frontend `DetallePedido` ([frontend/src/types/index.ts:25-33](../frontend/src/types/index.ts)) **no incluye `margen`** (solo `total_venta` y `total_costo`) — hay que agregarlo al tipo para poder usarlo tipado en el nuevo dialog (o derivarlo como `total_venta - total_costo` en el frontend, ya que el valor es matemáticamente igual).
- Frontend: `Pedidos.tsx` ya tiene un dialog de edición de pedido ([frontend/src/pages/Pedidos.tsx:327-392](../frontend/src/pages/Pedidos.tsx)), abierto vía `setSelectedPedido(pedido)` desde el menú de acciones del pedido ([líneas 244-276](../frontend/src/pages/Pedidos.tsx), ítem "Editar" en línea 252-254). Ese dialog es para **editar** kilos/unidades, no para ver un desglose de costo/ganancia — no hay que tocarlo, se agrega un dialog nuevo y separado.
- El menú de acciones de cada pedido ya es un `DropdownMenu` ([Pedidos.tsx:245-275](../frontend/src/pages/Pedidos.tsx)) con ítems "Editar", "WhatsApp" y "Anular Pedido" — el nuevo ítem "Ver ganancia" / "Detalle de costo" se agrega ahí, con su propio estado de dialog independiente del de edición.
- Ojo con el bug conocido de origen: `DetallePedido.total_costo`/`margen` se calculan con el costo **sin IVA** (`costo_por_kilo` viene de `EntradaProducto`, que se ingresa neto — ver nota en `backend/core/views.py:837-843`, sección de reportes financieros). Los reportes de `ReporteGananciasView` ([views.py:863-965](../backend/core/views.py)) ya no confían en el campo persistido `margen` por esta razón, y recalculan `ganancia = ventas - (costo_neto * 1.19)`. Este dialog, al mostrar la ganancia de UN pedido puntual, debe aplicar el mismo ajuste de IVA para ser consistente con lo que ya se muestra en Reportes — de lo contrario mostraría un margen inflado respecto a la página de Reportes.
- No existe hoy ningún endpoint específico de "detalle de pedido con costos" aparte del que ya trae todo: `GET /pedidos/<pk>/` vía `PedidoDetailView`/`ObtenerPedido` ya devuelve el pedido completo con sus `detalles` anidados (usando `PedidoSerializer`, que incluye `DetallePedidoSerializer`).

## Funcionalidades requeridas

### 1. Nuevo dialog de "Análisis de Costo y Ganancia" por pedido
- En `Pedidos.tsx`, agregar un ítem de menú (ej. "Ver ganancia" con ícono `TrendingUp` o `Calculator`) en el `DropdownMenu` de cada fila ([líneas 245-275](../frontend/src/pages/Pedidos.tsx)), que abra un nuevo dialog de solo lectura con estado propio (ej. `selectedPedidoGanancia`).
- El dialog no necesita pegarle a un endpoint nuevo: el objeto `pedido` ya está disponible en memoria (viene de `useQuery(['pedidos'], getPedidos)`, línea 46-52) con todos sus `detalles`, incluido `margen` en la respuesta cruda del backend (aunque el tipo TS no lo declare todavía).

### 2. Contenido del dialog
- Tabla con una fila por `DetallePedido`: producto, kilos vendidos, costo total (línea), venta total (línea), ganancia de la línea — ajustando el costo con IVA (`costo_con_iva = total_costo * 1.19`, `ganancia_linea = total_venta - costo_con_iva`) para ser consistente con `Reportes.tsx`.
- Fila/resumen de totales del pedido: suma de costo total, suma de venta total, ganancia total del pedido y margen porcentual (`ganancia_total / venta_total * 100`).
- Indicar visualmente (color verde/rojo, igual que en `Reportes.tsx` y en la vista previa de márgenes de `Facturas.tsx`) si la ganancia de cada línea y el total son positivos o negativos.

## Pasos de implementación
1. Frontend: agregar `margen` al tipo `DetallePedido` en `frontend/src/types/index.ts:25-33` (el backend ya lo envía, solo falta declararlo) — o, si se prefiere no depender de un campo con el bug de IVA conocido, derivar la ganancia ajustada directamente en el componente a partir de `total_costo`/`total_venta` como se describe arriba.
2. Frontend: crear el nuevo dialog dentro de `Pedidos.tsx` (o extraerlo a un componente, ej. `frontend/src/components/shared/PedidoGananciaDialog.tsx`, si se prefiere mantener `Pedidos.tsx` más corto), con la tabla de líneas + resumen de totales descritos arriba.
3. Frontend: agregar el ítem de menú "Ver ganancia" en el `DropdownMenu` de cada fila ([Pedidos.tsx:251-273](../frontend/src/pages/Pedidos.tsx)) que abra el nuevo dialog con el pedido correspondiente.
4. Verificación manual: abrir el detalle de ganancia de un pedido con varias líneas, confirmar que la suma de las ganancias de línea coincide con el total mostrado, y que el margen porcentual coincide (dentro de redondeo) con lo que reporta la sección "Por Producto"/"Por Vendedor" de `Reportes.tsx` para ese mismo pedido si es el único de ese producto/vendedor en el período.

## Consideraciones técnicas
- No se necesita ningún cambio de backend: todos los datos ya viajan en `GET /pedidos/`. Este es un plan 100% frontend.
- Aplicar el ajuste de IVA (`* 1.19`) al costo es importante para que el número mostrado no contradiga lo que ya ve el usuario en la pestaña "Por Corte"/"Por Vendedor" de Reportes — mostrar cifras distintas para la "misma" ganancia en dos pantallas distintas sería confuso y parecería un bug.
- Pedidos con estado `Anulado` siguen apareciendo en el listado con estado marcado (aunque `PedidoListView` los excluye del listado general — ver `views.py:52-55` — así que en la práctica un pedido Anulado no debería llegar a este dialog vía el listado normal); si se decide mostrar pedidos anulados en algún filtro futuro, el dialog debe dejar claro que esas cifras no cuentan para las ganancias reales.

## Complejidad: Baja
## Dependencias: Ninguna

---

## Cómo ejecutar este plan

```
Implementa el Plan 05 (Pedidos — Dialog de Detalle de Costo y Ganancia) de planes/05-pedidos-detalle-costo-ganancia.md

Contexto:
- DetallePedido ya calcula y persiste total_costo/total_venta/margen en su save() (backend/core/models.py líneas 191-199)
- DetallePedidoSerializer ya expone margen (backend/core/serializers.py línea 67) -> no requiere cambios de backend, GET /pedidos/ ya trae todo lo necesario
- Tipo frontend DetallePedido (frontend/src/types/index.ts líneas 25-33) no declara margen todavía -> agregarlo o derivarlo
- OJO: el margen persistido usa costo SIN IVA (bug de origen documentado en backend/core/views.py líneas 837-843); para ser consistente con Reportes.tsx, el dialog debe recalcular ganancia = total_venta - (total_costo * 1.19), igual que hace ReporteGananciasView
- Punto de inserción: menú de acciones de cada pedido en frontend/src/pages/Pedidos.tsx líneas 245-275 (DropdownMenu con Editar/WhatsApp/Anular) -> agregar ítem "Ver ganancia"
- El pedido completo con sus detalles ya está en memoria (useQuery ['pedidos'], líneas 46-52), no hace falta pedir nada nuevo al backend

Enfoque:
1. Agregar margen (o el cálculo ajustado por IVA) al tipo DetallePedido en types/index.ts
2. Crear un dialog nuevo (dentro de Pedidos.tsx o como componente separado) con tabla de líneas (producto, costo, venta, ganancia por línea) + resumen de totales del pedido y margen %, con color verde/rojo según signo
3. Agregar ítem de menú "Ver ganancia" en el DropdownMenu de cada fila de Pedidos.tsx que abra el dialog
4. Verificar que la suma de ganancias de línea coincide con el total, y que el margen % es coherente con lo que muestra Reportes.tsx para ese producto/vendedor
5. Una vez verificado, marcar el Plan 05 como ✅ Completado en planes/README.md (tabla "Pedidos" y tabla "Skills y Modelos Recomendados")
```

> Skill recomendado: `/impeccable` (dialog nuevo de presentación de datos sobre una página ya existente, sin lógica de negocio nueva).
> Modelo recomendado: **Sonnet** (composición de UI + un cálculo derivado simple, sin cambios de backend).
