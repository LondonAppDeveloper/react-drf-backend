# Plan: Pedidos — Combobox de Cliente Solo-Nombre y Vendedor Correcto al Crear Pedido

## Objetivo
Dos ajustes al Paso 1 de creación de pedido: (1) que el combobox de cliente muestre **solo el nombre** en vez de nombre + vendedor + dirección; y (2) corregir un bug real en el backend donde, si un vendedor X (no-admin) crea un pedido para un cliente que pertenece a otro vendedor Y, el pedido queda asignado a X en vez de a Y — el pedido debe guardarse siempre con el vendedor **dueño del cliente**, no con el vendedor que hizo clic en "Confirmar".

## Contexto
- `ClienteCombobox` ([frontend/src/components/shared/ClienteCombobox.tsx](../frontend/src/components/shared/ClienteCombobox.tsx)) hoy muestra, por cada opción, nombre + vendedor + dirección como texto secundario (líneas 79-87: `<span>{cliente.nombre}</span>` y debajo `{cliente.vendedor.nombre}{cliente.direccion ? ' · ' + cliente.direccion : ''}`). El botón trigger (línea 47) ya muestra solo `clienteSeleccionado.nombre`, pero la lista desplegada no.
- **Bug confirmado en backend**: `CrearPedido` ([backend/core/views.py:57-194](../backend/core/views.py)), bloque de asignación de vendedor (líneas 67-83):
  ```python
  if request.user.is_staff:
      vendedor = Vendedor.objects.get(id=vendedor_id)  # usa el que mande el frontend
  else:
      vendedor = request.user.vendedor_profile  # SIEMPRE el vendedor logueado, ignora el cliente
  ```
  El frontend ([frontend/src/pages/PedidoNuevo.tsx:191-199](../frontend/src/pages/PedidoNuevo.tsx)) sí envía `vendedor: clienteSeleccionado.vendedor.id` (el vendedor dueño del cliente elegido), pero el backend **lo ignora por completo** para usuarios no-staff y fuerza el vendedor del usuario logueado (línea 81: `request.user.vendedor_profile`). Este es exactamente el bug reportado: si el vendedor X (no-admin) crea el pedido para un cliente de Y, el pedido queda con X, no con Y.
- `Cliente.vendedor` ([backend/core/models.py:25-31](../backend/core/models.py)) es la fuente de verdad de "a quién pertenece este cliente" — el pedido debería heredar siempre ese vendedor, sin importar quién esté logueado al crearlo (salvo que un admin/staff decida explícitamente reasignarlo).
- `Vendedor.user` ([backend/core/models.py:10-16](../backend/core/models.py)) es un `OneToOneField` a `settings.AUTH_USER_MODEL` con `related_name='vendedor_profile'` — así es como el backend hoy obtiene "el vendedor logueado" (`request.user.vendedor_profile`).
- El paso 1 del wizard ([PedidoNuevo.tsx:226-251](../frontend/src/pages/PedidoNuevo.tsx)) ya usa `ClienteCombobox` (línea 235) y, tras seleccionar, muestra un bloque "Vendedor Asignado" (líneas 237-248) con el nombre/sigla del vendedor del cliente — este bloque es justamente donde el usuario puede confirmar visualmente a qué vendedor quedará asociado el pedido, así que debe seguir mostrando el vendedor real del cliente una vez corregido el backend.

## Funcionalidades requeridas

### 1. Combobox de cliente — solo nombre
- En `ClienteCombobox.tsx`, quitar el texto secundario de vendedor/dirección de cada `CommandItem` (líneas 79-87), dejando solo `cliente.nombre`.
- Mantener el filtro de búsqueda como está (`Command filter`, líneas 52-58) — sigue permitiendo buscar por vendedor/dirección aunque ya no se muestren en pantalla, salvo que se decida limitar el filtro a que solo matchee por nombre también (a definir con el usuario si el filtro debe reducirse igual que la vista, o si buscar por vendedor sigue siendo útil aunque no se vea).

### 2. Backend — el pedido siempre hereda el vendedor del cliente
- En `CrearPedido` ([backend/core/views.py:57-194](../backend/core/views.py)), cambiar la lógica de asignación de vendedor (líneas 67-83): en vez de depender de si el usuario logueado es staff o no para decidir "vendedor del payload" vs "vendedor del usuario", el vendedor del pedido debe derivarse **siempre** del `Cliente.vendedor` del cliente seleccionado (`cliente.vendedor`), ignorando cualquier `vendedor_id` que mande el frontend para el caso estándar.
- Caso admin/staff: decidir explícitamente si un admin puede seguir forzando un vendedor distinto al del cliente (ej. para correcciones manuales) — si se mantiene esa capacidad, debe ser una excepción documentada y clara en el código (ej. un parámetro explícito `forzar_vendedor` en el payload, no el comportamiento por defecto), no la ruta silenciosa que existe hoy.
- Ajustar/simplificar el frontend en consecuencia: como el backend pasa a derivar el vendedor del cliente por sí mismo, el payload de `createPedido` en `PedidoNuevo.tsx:191-199` ya no necesita enviar `vendedor: clienteSeleccionado.vendedor.id` como dato autoritativo (puede seguir enviándose como referencia, pero el backend no debe confiar en él para el caso estándar).

## Pasos de implementación
1. Backend: modificar `CrearPedido` ([views.py:67-83](../backend/core/views.py)) para que, salvo el caso admin explícito (a definir), el vendedor del pedido se obtenga siempre de `Cliente.objects.get(id=cliente_id).vendedor`, no de `request.user.vendedor_profile` ni del payload del frontend.
2. Backend: decidir y documentar el comportamiento para usuarios `is_staff` (mantener la posibilidad de reasignar manualmente vía un campo explícito, o quitarla y que también hereden siempre del cliente — más simple y consistente).
3. Frontend: en `ClienteCombobox.tsx`, quitar el bloque de vendedor/dirección de cada opción (líneas 79-87), dejando solo el nombre.
4. Frontend: revisar que el bloque "Vendedor Asignado" en `PedidoNuevo.tsx:237-248` siga funcionando igual (sigue leyendo `clienteSeleccionado.vendedor`, que no cambia).
5. Verificación manual: (a) iniciar sesión como un vendedor X no-admin, crear un pedido para un cliente que pertenece a otro vendedor Y, y confirmar en la lista de Pedidos que el pedido quedó asignado a Y, no a X; (b) confirmar que el combobox de cliente en el wizard ya no muestra vendedor/dirección en las opciones, solo el nombre.

## Consideraciones técnicas
- Este cambio de backend es de **seguridad/integridad de datos**, no solo de UI — hoy cualquier vendedor puede, sin darse cuenta o intencionalmente, "robar" la autoría de una venta de otro vendedor simplemente creando el pedido desde su propia sesión. Priorizar este fix sobre el cambio cosmético del combobox si hay que partir el plan en dos entregas.
- Verificar que no haya otro flujo que dependa del comportamiento actual (ej. algún reporte o filtro que asuma que "el pedido pertenece al usuario que lo creó" en vez de "al vendedor del cliente") antes de aplicar el cambio — revisar usos de `pedido.vendedor` en `ReporteGananciasView` ([views.py:934-952](../backend/core/views.py)) y en `Pedidos.tsx` (filtro por vendedor, líneas 110-111 y 186-195) para confirmar que ya asumen "vendedor = dueño del cliente" y no se rompen con el fix.

## Complejidad: Media
## Dependencias: Ninguna directa, pero toca la misma vista (`CrearPedido`) que ya tiene lógica compleja de FIFO — revisar con cuidado para no introducir una regresión en el cálculo de stock al modificar solo el bloque de asignación de vendedor (líneas 67-83, fuera del loop de FIFO).

---

## Cómo ejecutar este plan

```
Implementa el Plan 06 (Pedidos — Combobox Solo-Nombre y Vendedor Correcto al Crear Pedido) de planes/06-pedidos-combobox-vendedor-cliente.md

Contexto:
- BUG DE BACKEND CONFIRMADO en CrearPedido (backend/core/views.py líneas 67-83): para usuarios no-staff, el vendedor del pedido se fuerza SIEMPRE a request.user.vendedor_profile (el vendedor logueado), ignorando el vendedor real del cliente (Cliente.vendedor, backend/core/models.py líneas 25-31)
- El frontend YA envía el vendedor correcto (clienteSeleccionado.vendedor.id) en PedidoNuevo.tsx líneas 191-199, pero el backend lo descarta
- Combobox de cliente: frontend/src/components/shared/ClienteCombobox.tsx líneas 79-87 muestran nombre + vendedor + dirección en cada opción; el usuario quiere que se muestre SOLO el nombre
- Vendedor.user es OneToOneField con related_name='vendedor_profile' (backend/core/models.py líneas 10-16), así obtiene el backend "el vendedor logueado" hoy

Enfoque:
1. Backend: en CrearPedido, derivar el vendedor del pedido SIEMPRE de Cliente.objects.get(id=cliente_id).vendedor, no de request.user.vendedor_profile ni ciegamente del payload -- decidir si se mantiene una vía explícita para que un admin reasigne manualmente
2. Frontend: en ClienteCombobox.tsx, quitar el texto secundario de vendedor/dirección de cada opción (líneas 79-87), dejar solo el nombre
3. Verificar: un vendedor X no-admin crea un pedido para un cliente de otro vendedor Y -> el pedido debe quedar asignado a Y en la lista de Pedidos, no a X
4. Verificar que el combobox del wizard de PedidoNuevo.tsx ya solo muestra nombres en las opciones
5. Una vez verificado, marcar el Plan 06 como ✅ Completado en planes/README.md (tabla "Pedidos" y tabla "Skills y Modelos Recomendados")
```

> Skill recomendado: Ninguno específico — el fix de backend es lógica de negocio/seguridad, el cambio de combobox es un ajuste de UI trivial; `/impeccable` puede usarse solo para la parte visual si se separa la entrega.
> Modelo recomendado: **Opus 4.8** (el fix de asignación de vendedor toca una vista con lógica FIFO compleja alrededor; conviene un modelo más cuidadoso para no introducir una regresión, aunque el cambio en sí sea acotado).

---

## Nota sobre orden alfabético de clientes
El pedido del usuario de "que los clientes se ordenen alfabéticamente" **ya está resuelto**: `Cliente.Meta.ordering = ['nombre']` ([backend/core/models.py:36-37](../backend/core/models.py)), `ClienteListView.get` hace `.order_by('nombre')` explícito ([views.py:283](../backend/core/views.py)), y `ClienteCombobox` además ordena client-side con `.sort()` ([ClienteCombobox.tsx:31-34](../frontend/src/components/shared/ClienteCombobox.tsx)) — esto corresponde al Plan 01 (`planes/01-pedidos-buscador-cliente.md`), que ya está implementado en el working tree. No se requiere trabajo adicional para ese punto.
