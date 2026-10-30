# Plan: Facturas — Edición Post-Creación con Guardas de Stock

## Objetivo
Permitir editar una Factura de entrada ya creada (proveedor, fecha, y sus líneas de producto: cantidad y costo), con guardas automáticas que bloqueen o limiten la edición cuando el stock generado por esa línea ya fue parcial o totalmente consumido por Pedidos posteriores (FIFO), para no desincronizar costos y márgenes ya calculados en ventas pasadas.

## Contexto
- `Factura` ([backend/core/models.py:214-228](../backend/core/models.py)): `numero_factura` (CharField) es la **primary key**; no tiene campo de estado ("emitida"/"pagada"/"anulada" no existen como tal — el estado de pago se infiere en el frontend por la presencia de un `PagoFactura` relacionado).
- `DetalleFactura` ([models.py:240-262](../backend/core/models.py)): líneas de producto de la factura, registro contable/histórico.
- `EntradaProducto` ([models.py:312-323](../backend/core/models.py)): lote de stock **vivo**, creado 1:1 con cada `DetalleFactura` al crear la factura (`CrearFacturaEntrada`, [views.py:314-372](../backend/core/views.py), líneas 356-365). Este es el registro que se consume con cada venta.
- Consumo FIFO: `CrearPedido` ([views.py:56-193](../backend/core/views.py)), loop de líneas 118-144, recorre `EntradaProducto` ordenado por `fecha_entrada`, descuenta `cantidad_unidades` y borra la fila si llega a 0. Una vez que esto ocurre, la cantidad viva en `EntradaProducto` para esa factura+producto ya no coincide con lo que dice `DetalleFactura`, y puede no quedar ninguna fila de `EntradaProducto` si se vendió todo el lote.
- Trazabilidad de qué pedido consumió qué factura: `FacturaDetallePedido` ([models.py:231-237](../backend/core/models.py)), creado en `CrearPedido` líneas 178-183 y leído por `CancelarPedido` ([views.py:405-477](../backend/core/views.py)) para revertir stock al anular un pedido. Esta es la función de referencia más cercana en el código para la lógica de reconciliación de stock que necesita este plan.
- No existe hoy ningún endpoint de edición de Factura: `FacturaListView` ([views.py:374-379](../backend/core/views.py)) solo lista, `CrearFacturaEntrada` solo crea. No hay ruta en [backend/core/urls.py](../backend/core/urls.py) ni función `updateFactura` en [frontend/src/services/api.ts](../frontend/src/services/api.ts) (a diferencia de `updatePedido`/`cancelarPedido`, que sí existen para `Pedido`).
- `PagoFactura` ([models.py:264-279](../backend/core/models.py)) es `OneToOneField` con `Factura` — si el total de la factura cambia tras editar y ya existe un pago registrado, el monto pagado queda desincronizado con el nuevo total.
- Frontend: [Facturas.tsx](../frontend/src/pages/Facturas.tsx) maneja creación (líneas 169-251) y un diálogo de detalle de solo lectura (líneas 302-393, con botón "Imprimir" en 388-390 pero sin botón "Editar").

## Funcionalidades requeridas

### 1. Endpoint de edición de Factura
- Nueva vista `UpdateFacturaEntrada`, ruta `PUT /facturas/<numero_factura>/`.
- Permite editar: `proveedor`, `fecha`, y las líneas (`detalles`): producto, `cantidad_kilos`, `cantidad_unidades`, `costo_por_kilo`.

### 2. Guarda de consumo por línea (edición completa con guardas)
Por cada `DetalleFactura` de la factura, calcular cuánto de su `EntradaProducto` asociado ya fue consumido, comparando la `cantidad_unidades` original guardada en `DetalleFactura` contra lo que sigue vivo en `EntradaProducto` para ese producto+factura:
- **Línea no consumida** (nada vendido de ese lote): edición libre de cantidad y costo; el `EntradaProducto` correspondiente se actualiza in-place a los nuevos valores.
- **Línea parcialmente consumida**: el costo se puede editar libremente (no afecta lo ya vendido, solo el costo del stock restante); la cantidad no puede bajar de lo ya vendido; el `EntradaProducto` restante se ajusta a la diferencia entre la nueva cantidad y lo ya consumido.
- **Línea completamente consumida** (no queda `EntradaProducto` viva para ese producto+factura): bloquear la edición de cantidad/costo de esa línea específica. Mostrar en el frontend por qué está bloqueada (referencia al/los pedido(s) que la consumieron, vía `FacturaDetallePedido`). Solo permitir editar metadatos no relacionados a stock, con advertencia explícita de que no afecta retroactivamente el margen ya guardado en `DetallePedido`.
- Campos no ligados a líneas (proveedor, fecha) siempre editables sin restricción.

### 3. Recalcular subtotal/IVA/total
- Al editar líneas, recalcular `subtotal`, `iva` y `total` de la Factura igual que en creación (`Facturas.tsx:108-114`).

### 4. Frontend — botón "Editar" en el detalle de Factura
- En `Facturas.tsx`, agregar botón "Editar" junto al de "Imprimir" ([líneas 384-391](../frontend/src/pages/Facturas.tsx)) que abra un formulario de edición reutilizando el bloque de líneas de la creación (líneas 202-240), pre-poblado con los datos actuales.
- Cada línea debe mostrar visualmente si está bloqueada (ya vendida) o editable, con un badge o tooltip explicando el motivo cuando esté bloqueada.

### 5. Advertencia si hay un pago asociado
- Si la factura tiene `PagoFactura` y el total cambia al editar, mostrar una advertencia clara de que el monto pagado ya no coincide con el nuevo total. No bloquear el guardado — la reconciliación del pago queda fuera de alcance de este plan.

## Pasos de implementación
1. Backend: crear un helper que, dado un `numero_factura`, determine por línea cuánto se ha consumido (comparando `DetalleFactura.cantidad_unidades` original contra la suma viva de `EntradaProducto` para ese producto+factura) — reutilizable también para exponer el estado editable/bloqueado al frontend.
2. Backend: implementar `UpdateFacturaEntrada` con la lógica de guardas descrita, dentro de `transaction.atomic()`, siguiendo el patrón de reconciliación de `CancelarPedido` ([views.py:405-477](../backend/core/views.py)).
3. Backend: agregar ruta `PUT /facturas/<numero_factura>/` en [backend/core/urls.py](../backend/core/urls.py).
4. Frontend: agregar `updateFactura` en [frontend/src/services/api.ts](../frontend/src/services/api.ts).
5. Frontend: agregar botón "Editar" y formulario de edición en `Facturas.tsx`, marcando cada línea como editable/bloqueada según la respuesta del backend.
6. Verificación manual: (a) crear una factura y editarla sin vender nada — debe permitir edición libre; (b) vender parte de una línea vía un Pedido y volver a editar — debe permitir editar costo pero no bajar la cantidad bajo lo ya vendido; (c) vender toda una línea y volver a editar — esa línea debe quedar bloqueada para cantidad/costo.

## Consideraciones técnicas
- Toda la lógica de reconciliación de stock debe vivir en el backend dentro de una transacción atómica — el frontend solo refleja el estado que el backend indica (qué línea es editable), no decide localmente qué se puede tocar.
- `Factura.numero_factura` es la PK. Se recomienda **no** permitir cambiarla en la edición (cambiarla implicaría recrear la fila y todas sus relaciones); si se necesita corregir un número mal ingresado, tratarlo como caso excepcional documentado, no como parte de la edición estándar.
- Esta funcionalidad es distinta de "Anular factura" (revertir la factura completa) — no está en el alcance de este plan; se evaluó como alternativa durante el diseño pero se optó por edición con guardas. Puede ser un plan futuro si se necesita revertir en vez de corregir.
- Los márgenes (`DetallePedido.margen`) ya calculados y guardados en pedidos pasados **no se recalculan retroactivamente** al editar una factura — son un snapshot histórico. Esto debe quedar explícito en la UI para que el usuario no espere que cambien solos.

## Complejidad: Alta
## Dependencias: Ninguna directa, pero comparte lógica de reconciliación de stock con `CancelarPedido` ([views.py:405-477](../backend/core/views.py)) — conviene revisar esa función antes de implementar.

---

## Cómo ejecutar este plan

```
Implementa el Plan 02 (Facturas — Edición Post-Creación con Guardas de Stock) de planes/02-facturas-edicion.md

Contexto:
- Modelos relevantes: backend/core/models.py -> Factura (214-228), DetalleFactura (240-262), EntradaProducto (312-323), FacturaDetallePedido (231-237), PagoFactura (264-279)
- Creación actual de factura: CrearFacturaEntrada en backend/core/views.py líneas 314-372
- Consumo FIFO de stock al vender: CrearPedido en backend/core/views.py líneas 56-193 (loop de consumo en 118-144)
- Reversión de stock de referencia (patrón a replicar para reconciliación): CancelarPedido en backend/core/views.py líneas 405-477
- No existe hoy ruta de edición de Factura en backend/core/urls.py ni updateFactura en frontend/src/services/api.ts
- Frontend de facturas: frontend/src/pages/Facturas.tsx (creación: 169-251, detalle de solo lectura: 302-393)

Enfoque:
1. Backend: helper para calcular, por línea de factura, cuánto de su EntradaProducto sigue vivo vs. lo originalmente registrado en DetalleFactura
2. Backend: UpdateFacturaEntrada (PUT /facturas/<numero_factura>/) con guardas: línea no consumida = edición libre, parcialmente consumida = costo libre y cantidad con piso en lo vendido, completamente consumida = bloqueada para cantidad/costo
3. Backend: recalcular subtotal/iva/total tras editar líneas, todo dentro de transaction.atomic()
4. Frontend: updateFactura en services/api.ts, botón "Editar" en Facturas.tsx con formulario que refleje qué líneas están bloqueadas y por qué
5. Frontend: advertencia (no bloqueo) si la factura ya tiene PagoFactura y el total cambia
6. Verificar manualmente los 3 escenarios de consumo (nada vendido / parcial / total) antes de dar por cerrado el plan
```

> Skill recomendado: Ninguno específico — es una tarea backend-first de lógica de negocio; una vez la API esté lista, `/impeccable` puede pulir el formulario de edición en el frontend.
> Modelo recomendado: **Opus 4.8** (reconciliación de stock con reglas condicionales por línea, dentro de una transacción — mismo tipo de riesgo que `CancelarPedido`)
