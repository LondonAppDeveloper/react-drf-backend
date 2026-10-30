# Plan: Facturas — Marcar como Pagada

## Objetivo
Agregar en la vista de Facturas la posibilidad de registrar el pago de una factura directamente desde la interfaz (fecha y monto pagado), para que el badge "Pagada"/"Pendiente" que ya se muestra hoy refleje pagos que el usuario realmente registró, en vez de ser una funcionalidad que solo existe a medias en el backend sin forma de usarla desde la UI.

## Contexto
- El modelo `PagoFactura` ([backend/core/models.py:267-282](../backend/core/models.py)) ya existe: `OneToOneField` a `Factura` (una factura tiene **como máximo un** pago registrado), con `fecha_de_pago` y `monto_del_pago`.
- El endpoint de creación ya existe y funciona: `CrearPagoFactura` ([backend/core/views.py:512-534](../backend/core/views.py)), `POST /facturas/pagar/` ([backend/core/urls.py:17](../backend/core/urls.py)), recibe `factura` (número), `fecha_de_pago`, `monto_del_pago` y crea el `PagoFactura`.
- El frontend ya tiene la función de servicio lista pero **sin usar en ningún lado**: `pagarFactura(factura, fecha_de_pago, monto_del_pago)` ([frontend/src/services/api.ts:96-101](../frontend/src/services/api.ts)).
- `FacturaSerializer` ([backend/core/serializers.py:137-154](../backend/core/serializers.py)) ya incluye `pago_factura` (línea 153) — por eso `Facturas.tsx` ya puede mostrar el badge "Pagada"/"Pendiente" ([líneas 412-414](../frontend/src/pages/Facturas.tsx)) y el filtro "Pagadas/Pendientes" ([líneas 388-395, 256-264](../frontend/src/pages/Facturas.tsx)) basándose en si `f.pago_factura` existe o no.
- El dialog de detalle de factura ([Facturas.tsx:430-524](../frontend/src/pages/Facturas.tsx)) ya tiene botones "Editar" e "Imprimir" en el footer ([líneas 512-522](../frontend/src/pages/Facturas.tsx)) — falta un botón "Marcar como pagada" ahí, o en la tarjeta de listado, que abra un pequeño formulario (fecha + monto) y llame a `pagarFactura`.
- Limitación real del modelo actual: al ser `OneToOneField`, **una factura solo puede tener un pago total registrado**, no pagos parciales — `CrearPagoFactura` no verifica si ya existe un `PagoFactura` para esa factura antes de crear uno nuevo (línea 528: `PagoFactura.objects.create(...)`), así que si se intenta "pagar" una factura que ya tiene pago, la constraint de unicidad de Django lanzará un `IntegrityError` que hoy no se maneja explícitamente (cae en el `except Exception` genérico si lo hay, o revienta con 500) — hay que decidir el comportamiento: ¿"marcar como pagada" es una acción de una sola vez (deshabilitar el botón si ya está pagada), o debe permitir editar/corregir el pago ya registrado?
- `Factura.total` ([backend/core/models.py:223](../backend/core/models.py)) es el monto de referencia — al abrir el formulario de pago, tiene sentido pre-rellenar `monto_del_pago` con `factura.total` como default (pago completo), permitiendo editarlo si el usuario paga un monto distinto.

## Funcionalidades requeridas

### 1. Botón "Marcar como pagada" en el detalle de factura
- En el dialog de detalle ([Facturas.tsx:430-524](../frontend/src/pages/Facturas.tsx)), agregar un botón junto a "Editar"/"Imprimir" que abra un pequeño formulario (puede ser otro `Dialog` anidado o un `Popover`/sección inline) pidiendo `fecha_de_pago` (default: hoy) y `monto_del_pago` (default: `selectedFactura.total`).
- Si la factura ya tiene `pago_factura`, el botón debe reflejar ese estado (ej. mostrar "Pagada el DD/MM/AAAA — $monto" en vez del botón de acción, o deshabilitar y explicar por qué) en vez de permitir crear un segundo pago que fallaría contra la constraint `OneToOneField`.

### 2. Registrar el pago
- Al confirmar el formulario, llamar a `pagarFactura(numero_factura, fecha_de_pago, monto_del_pago)` (ya existe en `api.ts`), invalidar la query `['facturas']` para refrescar el badge y el filtro de pagadas/pendientes, y mostrar confirmación (toast).

### 3. Manejo del caso "ya tiene pago"
- Definir explícitamente el comportamiento cuando se intenta pagar una factura que ya tiene `pago_factura`: la opción más simple y consistente con el modelo `OneToOneField` actual es que "Marcar como pagada" solo esté disponible mientras no haya pago registrado, y que corregir un pago ya hecho sea una acción separada (fuera de alcance de este plan, ya que implicaría exponer un endpoint de actualización/borrado de `PagoFactura` que hoy no existe).

## Pasos de implementación
1. Backend: en `CrearPagoFactura` ([views.py:512-534](../backend/core/views.py)), agregar una validación explícita: si la factura ya tiene un `PagoFactura` asociado, devolver un 400 con un mensaje claro (`'Esta factura ya tiene un pago registrado'`) en vez de dejar que reviente por la constraint de unicidad sin control.
2. Frontend: en `Facturas.tsx`, agregar el botón/formulario de "Marcar como pagada" en el dialog de detalle ([líneas 430-524](../frontend/src/pages/Facturas.tsx)), con los defaults de fecha (hoy) y monto (`selectedFactura.total`) descritos arriba, usando la mutación `pagarFactura` ya existente en `api.ts`.
3. Frontend: condicionar la UI para que, si `selectedFactura.pago_factura` ya existe, se muestre el pago registrado en vez de la opción de volver a pagar.
4. Verificación manual: (a) marcar como pagada una factura pendiente, confirmar que el badge y el filtro "Pagadas" la reflejan de inmediato; (b) intentar marcar como pagada una factura que ya tiene pago y confirmar que el backend responde con un error claro (400, no 500) y que el frontend no ofrece la opción de duplicar el pago.

## Consideraciones técnicas
- No hace falta tocar `FacturaSerializer` ni el modelo `PagoFactura` — todo lo necesario ya existe, este plan es principalmente de UI más una validación defensiva en el backend.
- Si en el futuro se necesitan pagos parciales o corrección de pagos ya registrados, eso requeriría cambiar `PagoFactura` de `OneToOneField` a `ForeignKey` (permitiendo múltiples pagos por factura) y sumar montos para determinar el estado "pagada" — está fuera de alcance de este plan, que asume "pagada" = existe exactamente un `PagoFactura` cubriendo el total.

## Complejidad: Baja
## Dependencias: Ninguna

---

## Cómo ejecutar este plan

```
Implementa el Plan 10 (Facturas — Marcar como Pagada) de planes/10-facturas-marcar-pagada.md

Contexto:
- El backend YA tiene todo el modelo y endpoint: PagoFactura (backend/core/models.py líneas 267-282, OneToOneField con Factura), CrearPagoFactura (backend/core/views.py líneas 512-534, POST /facturas/pagar/)
- El frontend YA tiene la función de servicio sin usar: pagarFactura() en frontend/src/services/api.ts líneas 96-101
- FacturaSerializer ya incluye pago_factura (backend/core/serializers.py línea 153) -> el badge "Pagada"/"Pendiente" y el filtro en Facturas.tsx (líneas 412-414, 388-395) ya funcionan en base a esto, solo falta la UI para CREAR el pago
- Dialog de detalle de factura: frontend/src/pages/Facturas.tsx líneas 430-524, footer con botones Editar/Imprimir en líneas 512-522 -> agregar botón "Marcar como pagada" ahí
- OJO: PagoFactura es OneToOneField -> CrearPagoFactura (views.py línea 528) no valida si ya existe un pago antes de crear otro, así que reventaría con un IntegrityError sin manejar si se intenta pagar dos veces

Enfoque:
1. Backend: en CrearPagoFactura, validar explícitamente si la factura ya tiene pago_factura antes de crear uno nuevo, devolver 400 con mensaje claro en ese caso
2. Frontend: agregar botón "Marcar como pagada" en el dialog de detalle de Facturas.tsx, con formulario de fecha (default hoy) y monto (default selectedFactura.total), usando pagarFactura() ya existente
3. Frontend: si selectedFactura.pago_factura ya existe, mostrar el pago registrado en vez de ofrecer la opción de pagar de nuevo
4. Verificar: marcar como pagada actualiza el badge/filtro de inmediato; intentar pagar una factura ya pagada da un error claro, no un 500
5. Una vez verificado, marcar el Plan 10 como ✅ Completado en planes/README.md (tabla "Facturas" y tabla "Skills y Modelos Recomendados")
```

> Skill recomendado: `/impeccable` (formulario/acción nueva sobre un dialog ya existente, reutilizando un endpoint que ya funciona).
> Modelo recomendado: **Sonnet** (cambio acotado, backend y frontend ya tienen casi todo listo, solo falta conectar la UI y una validación defensiva).
