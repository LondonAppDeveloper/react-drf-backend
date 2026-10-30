# Plan: Pedidos — Crear Cliente Rápido desde el Wizard de Nuevo Pedido

## Objetivo
Permitir crear un cliente nuevo sin salir del Paso 1 del wizard de creación de pedido, mediante un dialog pequeño accesible junto al combobox de cliente, para que el vendedor no tenga que abandonar el flujo de venta, ir a la sección Clientes, crear el cliente y volver a empezar el pedido.

## Contexto
- Paso 1 del wizard: [frontend/src/pages/PedidoNuevo.tsx:226-251](../frontend/src/pages/PedidoNuevo.tsx), usa `ClienteCombobox` ([línea 235](../frontend/src/pages/PedidoNuevo.tsx)) alimentado por `useQuery(['clientes'], getClientes)` ([líneas 59-65](../frontend/src/pages/PedidoNuevo.tsx)).
- La creación de cliente ya existe como flujo completo en [Clientes.tsx](../frontend/src/pages/Clientes.tsx): el dialog de formulario (líneas 211-328) pide `nombre`, `telefono` (con formateo automático vía `formatSimplePhone`, líneas 61-69), `direccion`, `email` (opcional) y `vendedor` (obligatorio, un `<Select>` con la lista de `Vendedor`). La mutación de creación ([líneas 112-129](../frontend/src/pages/Clientes.tsx)) llama a `createCliente()`.
- `createCliente` ([frontend/src/services/api.ts:67-73](../frontend/src/services/api.ts)) → `POST /clientes/crear/` → `CrearCliente` ([backend/core/views.py:287-313](../backend/core/views.py)), que exige `nombre`, `direccion` y `vendedor_id` (línea 297) y devuelve el `Cliente` recién creado ya serializado con su `vendedor` expandido.
- No existe hoy ninguna variante abreviada de este formulario — replicar el mismo formulario completo (con vendedor obligatorio) dentro de un dialog embebido en `PedidoNuevo.tsx` es la opción más simple y coherente con las reglas de negocio existentes (un cliente siempre necesita un vendedor asignado).

## Funcionalidades requeridas

### 1. Botón "Nuevo cliente" junto al combobox
- En el Paso 1 de `PedidoNuevo.tsx` ([líneas 232-236](../frontend/src/pages/PedidoNuevo.tsx)), agregar un botón pequeño (ícono `Plus` o `UserPlus`) junto al `ClienteCombobox` que abra un dialog de creación rápida de cliente.

### 2. Dialog de creación rápida
- Reutilizar la misma lógica de formulario que `Clientes.tsx` (nombre, teléfono con formateo, dirección, email opcional, vendedor obligatorio) — lo más simple es extraer el formulario de creación de cliente de `Clientes.tsx` a un componente compartido (ej. `frontend/src/components/shared/ClienteFormDialog.tsx`) que reciba `onSuccess(cliente)` y así se reutilice tanto en `Clientes.tsx` como en `PedidoNuevo.tsx`, evitando duplicar la validación y el formateo de teléfono.
- Al crear el cliente exitosamente: cerrar el dialog, invalidar/actualizar la query `['clientes']` (o insertar el cliente devuelto directamente en la caché de React Query) y **seleccionar automáticamente** ese cliente recién creado en el `ClienteCombobox` (`setClienteId(nuevoCliente.id.toString())`), para que el vendedor siga directo al Paso 2 sin tener que volver a buscarlo.

## Pasos de implementación
1. Frontend: extraer el formulario de creación/edición de cliente de `Clientes.tsx` (líneas 39-45 interfaz `ClienteForm`, 79-198 lógica de formulario y mutación, 217-327 JSX del dialog) a un componente reutilizable que acepte `mode: 'create' | 'edit'`, un cliente inicial opcional, y un callback `onSuccess`.
2. Frontend: actualizar `Clientes.tsx` para usar ese componente extraído en vez de tener el formulario inline, verificando que el comportamiento de editar/crear no cambie.
3. Frontend: en `PedidoNuevo.tsx`, agregar el botón junto al combobox (Paso 1) que abra el componente extraído en modo `create`, con `onSuccess` que invalide `['clientes']` y llame `setClienteId(nuevoCliente.id.toString())`.
4. Verificación manual: desde el wizard de nuevo pedido, crear un cliente nuevo sin salir de la pantalla, confirmar que queda seleccionado automáticamente y que el bloque "Vendedor Asignado" se actualiza con el vendedor recién elegido; luego confirmar que el cliente también aparece correctamente en la sección Clientes.

## Consideraciones técnicas
- No crear un formulario "simplificado" con menos campos que el de `Clientes.tsx` — el backend exige los mismos campos obligatorios (`nombre`, `direccion`, `vendedor_id`) sin importar desde dónde se cree el cliente, así que duplicar una versión reducida solo generaría inconsistencia entre ambos puntos de entrada.
- Extraer el formulario a un componente compartido es preferible a copiar/pegar el JSX en `PedidoNuevo.tsx`, para no mantener dos copias de la lógica de formateo de teléfono y validación.
- Si el vendedor logueado (no-admin) solo puede/debe crear clientes para sí mismo, evaluar si el `<Select>` de vendedor debe venir pre-seleccionado y bloqueado a su propio perfil en este contexto — a definir con el usuario si aplica la misma regla que en la creación de pedidos (Plan 06).

## Complejidad: Baja-Media
## Dependencias: Ninguna directa, aunque comparte el mismo componente `Vendedor`/`Cliente` que el [Plan 06](06-pedidos-combobox-vendedor-cliente.md) — si ambos se implementan, revisar que el nuevo dialog de creación rápida sea coherente con la regla de "el vendedor lo define el cliente, no quien está logueado".

---

## Cómo ejecutar este plan

```
Implementa el Plan 08 (Pedidos — Crear Cliente Rápido desde el Wizard) de planes/08-pedidos-crear-cliente-rapido.md

Contexto:
- Formulario de creación de cliente ya existe completo en frontend/src/pages/Clientes.tsx: interfaz ClienteForm (líneas 39-45), lógica de formulario/mutación (líneas 79-198), JSX del dialog (líneas 211-327)
- createCliente en frontend/src/services/api.ts líneas 67-73 -> POST /clientes/crear/ -> CrearCliente en backend/core/views.py líneas 287-313, exige nombre, direccion, vendedor_id
- Paso 1 del wizard de pedido: frontend/src/pages/PedidoNuevo.tsx líneas 226-251, usa ClienteCombobox (línea 235) alimentado por useQuery ['clientes']
- No hay una versión "simplificada" del formulario de cliente -- el backend exige los mismos campos obligatorios sin importar desde dónde se cree

Enfoque:
1. Extraer el formulario de creación/edición de cliente de Clientes.tsx a un componente reutilizable (ej. frontend/src/components/shared/ClienteFormDialog.tsx) con modo create/edit y callback onSuccess
2. Actualizar Clientes.tsx para usar el componente extraído sin cambiar su comportamiento actual
3. En PedidoNuevo.tsx, agregar un botón junto al ClienteCombobox del Paso 1 que abra el componente en modo create; al crear exitosamente, invalidar la query ['clientes'] y seleccionar automáticamente el cliente recién creado (setClienteId)
4. Verificar: crear cliente sin salir del wizard, queda seleccionado automáticamente, el bloque "Vendedor Asignado" se actualiza, y el cliente aparece también en la sección Clientes
5. Una vez verificado, marcar el Plan 08 como ✅ Completado en planes/README.md (tabla "Pedidos" y tabla "Skills y Modelos Recomendados")
```

> Skill recomendado: `/impeccable` (extracción de un formulario existente a componente reutilizable + dialog embebido, sin lógica de negocio nueva).
> Modelo recomendado: **Sonnet** (refactor de UI acotado, patrón ya usado en el proyecto).
