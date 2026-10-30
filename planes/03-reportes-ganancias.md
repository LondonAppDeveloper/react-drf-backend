# Plan: Reportes — Ganancias, Márgenes y Estadísticas de Ventas/Compras

## Objetivo
Agregar una página nueva de Reportes/Ganancias que muestre ganancia total, ganancia por producto ("corte"), vista mensual, ganancia por vendedor, pérdidas (mermas) y fluctuación de precios de compra/venta; y agregar una vista previa en vivo del margen proyectado al ingresar una nueva Factura de compra, mostrando cómo queda la ganancia con el costo entrante antes de guardar.

## Contexto
- `DetallePedido.margen` ([backend/core/models.py:183](../backend/core/models.py)) ya se calcula automáticamente en `save()` (líneas 188-196: `margen = total_venta - total_costo`) por cada línea de venta, pero **no está expuesto en `DetallePedidoSerializer`** ([backend/core/serializers.py:58-66](../backend/core/serializers.py) — el campo `margen` no aparece en `fields`). `total_venta` y `total_costo` sí están expuestos, así que el margen es derivable sin tocar el serializer (`total_venta - total_costo`), aunque exponer `margen` directamente sería más limpio para las agregaciones nuevas.
- No existe un modelo `Corte` separado — "corte" se usa hoy como sinónimo de `Producto.nombre` (ver el filtro `filterCorte` en [frontend/src/pages/Pedidos.tsx](../frontend/src/pages/Pedidos.tsx), construido desde `producto.nombre`). Este plan sigue esa misma convención: **"ganancia por corte" = ganancia agrupada por `Producto`**, sin crear modelo nuevo.
- `Vendedor` está asociado a `Pedido` ([`Pedido.vendedor`, models.py:138](../backend/core/models.py)) y a `Cliente` ([`Cliente.vendedor`, models.py:25](../backend/core/models.py)) — la ganancia por vendedor se calcula agregando `DetallePedido.margen` a través de `pedido.vendedor`.
- Pérdidas: `AjusteInventario` ([models.py:108-126](../backend/core/models.py)) tiene `tipo` con choices `merma`/`exceso`/`ajuste` y `cantidad` (puede ser negativa). Es el candidato natural para representar pérdidas, pero **no tiene un costo unitario propio** — hay que valorizarlo con el último `costo_por_kilo` conocido de `EntradaProducto`/`DetalleFactura` para ese producto (decisión de negocio a documentar, no solo técnica).
- `DetallePedidosList` ([views.py:613-618](../backend/core/views.py)) hoy devuelve **todos** los `DetallePedido`, incluyendo los de pedidos `Anulado` — no tiene el `.exclude(pedido__estado="Anulado")` que sí tienen `StockProductosView` ([views.py:668-671](../backend/core/views.py)) y `PedidoListView` ([views.py:52](../backend/core/views.py)). Cualquier agregación de ganancias nueva debe excluir explícitamente pedidos anulados o el reporte quedará inflado con ventas revertidas.
- Fluctuación de precios de compra: `EntradaProducto.costo_por_kilo` + `fecha_entrada` ([models.py:312-323](../backend/core/models.py)) da una serie temporal de costos por producto. Fluctuación de precio de venta se puede leer de `DetallePedido.precio_venta` + `fecha` — no hay historial de cambios de `Producto.precio_por_kilo` en sí, solo lo registrado por línea de pedido al momento de la venta.
- No existe hoy ningún dashboard financiero: [Dashboard.tsx](../frontend/src/pages/Dashboard.tsx) es puramente de stock (búsqueda + tabla de `StockItem` + alertas de stock crítico), y no hay página de reportes en `App.tsx`.
- Creación de factura: [Facturas.tsx](../frontend/src/pages/Facturas.tsx) ya calcula `subtotal/iva/total` en vivo con un `useEffect` sobre el estado `detalles` (líneas 108-114) — ese es el punto exacto donde insertar la vista previa de margen proyectado por línea.
- `recharts` ya está instalado en el frontend (`frontend/package.json`) — no hace falta agregar ninguna librería de gráficos nueva.

## Funcionalidades requeridas

### 1. Backend — endpoint(s) de agregación de ganancias
- Nueva vista (ej. `ReporteGananciasView`) que agregue `DetallePedido` **excluyendo pedidos `Anulado`**, con soporte de agrupación por: total general, por producto, por mes, por vendedor.
- Exponer `margen` en `DetallePedidoSerializer` o calcularlo directamente en la agregación con `annotate`/`Sum` de Django, evitando repetir la resta `total_venta - total_costo` en el frontend.

### 2. Backend — endpoint de pérdidas
- Agregación de `AjusteInventario` tipo `merma`, valorizada con el costo promedio o último costo conocido del producto (definir y documentar el criterio elegido).

### 3. Backend — fluctuación de precios
- Endpoint que devuelva serie temporal de `costo_por_kilo` (desde `EntradaProducto`, agrupado por producto y fecha) y de `precio_venta` (desde `DetallePedido`, agrupado por producto y fecha), para graficar evolución de precios de compra/venta por producto.

### 4. Backend — margen actual por producto (para la vista previa de Facturas)
- Endpoint liviano que devuelva, por producto, el margen histórico/promedio actual (`Producto.precio_por_kilo` vs. costo de compra reciente), para comparar contra el costo que se está por ingresar en una nueva factura.

### 5. Frontend — página nueva "Reportes" / "Ganancias"
- Nueva ruta (ej. `/reportes`), agregada a `App.tsx` y al menú de navegación (ubicar el componente de navegación en `frontend/src/components/layout/`).
- Tarjetas de resumen: ganancia total (mes actual / histórico), pérdidas totales, margen promedio.
- Vista por producto/corte: tabla o gráfico de ganancia agrupada por `Producto.nombre`.
- Vista mensual: gráfico de ganancia por mes con `recharts`.
- Vista por vendedor: tabla de ganancia agrupada por `Vendedor`.
- Vista de fluctuación de precios: gráfico de línea de costo de compra y precio de venta a través del tiempo, por producto seleccionable.

### 6. Frontend — vista previa de margen al crear una Factura
- En el formulario de creación de `Facturas.tsx` (junto al `useEffect` de líneas 108-114), por cada línea agregada al estado `detalles`, calcular en vivo: `margen_proyectado = Producto.precio_por_kilo - costo_por_kilo_ingresado` y su porcentaje.
- Mostrar esto junto a cada línea en la tabla del formulario (líneas 218-239), con color (verde/rojo) según si el margen proyectado es mejor o peor que el margen actual/promedio de ese producto (consume el endpoint del punto 4).

## Pasos de implementación
1. Backend: exponer `margen` (o derivarlo) y excluir pedidos `Anulado` de forma consistente en cualquier agregación nueva.
2. Backend: implementar `ReporteGananciasView` con parámetros de agrupación (total, por producto, por mes, por vendedor) usando `annotate`/`Sum` de Django sobre `DetallePedido`.
3. Backend: implementar endpoint de pérdidas sobre `AjusteInventario` (tipo `merma`).
4. Backend: implementar endpoint de fluctuación de precios (series de `EntradaProducto.costo_por_kilo` y `DetallePedido.precio_venta` en el tiempo).
5. Backend: implementar endpoint de margen actual por producto, para alimentar la vista previa en `Facturas.tsx`.
6. Frontend: crear página `Reportes.tsx`, ruta `/reportes` en `App.tsx`, entrada en el menú de navegación.
7. Frontend: construir las vistas (total/por producto/mensual/por vendedor/pérdidas/fluctuación de precios) consumiendo los endpoints anteriores vía React Query, con gráficos en `recharts`.
8. Frontend: agregar el cálculo de margen proyectado en vivo al formulario de `Facturas.tsx`.
9. Verificación manual: crear varios pedidos y facturas de prueba con distintos meses/vendedores/productos, anular uno de los pedidos y confirmar que no infla la ganancia reportada, y verificar que la vista previa de margen en `Facturas.tsx` reacciona en tiempo real al cambiar el costo ingresado.

## Consideraciones técnicas
- Toda agregación de ganancias debe excluir `Pedido.estado == "Anulado"` de forma consistente — es el bug más fácil de introducir por accidente, dado que `DetallePedidosList` ([views.py:613-618](../backend/core/views.py)) ya no lo hace hoy para el listado crudo.
- "Ganancia por corte" = ganancia agrupada por `Producto` (confirmado) — no se crea modelo `Corte` nuevo en este plan.
- `recharts` ya está disponible en el proyecto; usarlo en vez de construir visualizaciones nuevas a mano.
- La vista previa de margen en `Facturas.tsx` depende de tener listo el endpoint de "margen actual por producto" (paso 5) — implementar ese backend antes que esta parte del frontend.
- Los kilos/costos en pérdidas (`AjusteInventario`) no tienen un costo unitario propio en el modelo — decidir explícitamente qué costo usar para valorizarlas y documentarlo, ya que es una decisión de negocio.

## Complejidad: Alta
## Dependencias: Ninguna directa con los Planes 01/02, aunque si el Plan 02 (edición de facturas) se implementa primero, conviene que el endpoint de fluctuación de precios de este plan lea costos ya reconciliados en vez de datos que luego podrían cambiar.

---

## Cómo ejecutar este plan

```
Implementa el Plan 03 (Reportes — Ganancias, Márgenes y Estadísticas de Ventas/Compras) de planes/03-reportes-ganancias.md

Contexto:
- Margen ya calculado pero no expuesto: DetallePedido.margen en backend/core/models.py línea 183 (save() en líneas 188-196); no está en DetallePedidoSerializer (backend/core/serializers.py líneas 58-66)
- "Corte" = Producto.nombre (sin modelo Corte separado); ver convención en frontend/src/pages/Pedidos.tsx (filterCorte)
- Vendedor asociado a Pedido (backend/core/models.py línea 138) y a Cliente (línea 25)
- Pérdidas: AjusteInventario en backend/core/models.py líneas 108-126 (tipo 'merma'), sin costo unitario propio -> hay que valorizarlo
- OJO: DetallePedidosList (backend/core/views.py líneas 613-618) NO excluye pedidos Anulado -> cualquier agregación nueva debe excluirlos explícitamente
- Fluctuación de precios: EntradaProducto.costo_por_kilo + fecha_entrada (models.py líneas 312-323) y DetallePedido.precio_venta + fecha
- No existe dashboard financiero hoy: frontend/src/pages/Dashboard.tsx es solo de stock
- Punto de inserción de vista previa de margen: frontend/src/pages/Facturas.tsx, useEffect de líneas 108-114 y tabla de líneas 218-239
- recharts ya está instalado en frontend/package.json, usarlo para los gráficos

Enfoque:
1. Backend: ReporteGananciasView con agregación por total/producto/mes/vendedor sobre DetallePedido, excluyendo pedidos Anulado
2. Backend: endpoint de pérdidas sobre AjusteInventario (merma), endpoint de fluctuación de precios, endpoint de margen actual por producto
3. Frontend: página nueva Reportes.tsx en ruta /reportes con tarjetas de resumen + vistas por producto/mes/vendedor/pérdidas/fluctuación usando recharts
4. Frontend: vista previa de margen en vivo en el formulario de creación de Facturas.tsx, comparando costo ingresado vs. Producto.precio_por_kilo y vs. margen histórico del producto
5. Verificar que un pedido Anulado no infle ninguna cifra de ganancia reportada
```

> Skill recomendado: `/frontend-design` (página nueva con varias vistas de datos y gráficos)
> Modelo recomendado: **Opus 4.8** (agregaciones de negocio con varias dimensiones interdependientes: producto, mes, vendedor, pérdidas)
