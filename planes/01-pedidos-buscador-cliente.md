# Plan: Pedidos — Buscador y Orden Alfabético de Cliente

## Objetivo
Reemplazar el selector de cliente sin orden ni búsqueda en la creación de pedido (Paso 1 del wizard) por un combobox buscable, con la lista de clientes siempre en orden alfabético, para reducir el tiempo que toma encontrar un cliente cuando la lista crece.

## Contexto
- El wizard de creación de pedido vive en [PedidoNuevo.tsx](../frontend/src/pages/PedidoNuevo.tsx), routeado en `/pedidos/nuevo` ([App.tsx:101-109](../frontend/src/App.tsx)). El Paso 1 selecciona cliente.
- El picker actual no tiene orden ni búsqueda: los clientes llegan de `useQuery(['clientes'], getClientes)` ([PedidoNuevo.tsx:58-64](../frontend/src/pages/PedidoNuevo.tsx)) y se renderizan tal cual en un `<Select>` ([PedidoNuevo.tsx:234-246](../frontend/src/pages/PedidoNuevo.tsx)), sin `.sort()` ni input de texto.
- Fuente de datos: `getClientes()` ([frontend/src/services/api.ts:66](../frontend/src/services/api.ts)) → `GET /clientes/` → `ClienteListView` ([backend/core/views.py:279-284](../backend/core/views.py)), que hace `Cliente.objects.all()` sin `order_by`.
- `Cliente` ([backend/core/models.py:22-37](../backend/core/models.py)) no tiene `Meta.ordering` definido.
- Ya existe un patrón de búsqueda funcional en [Clientes.tsx](../frontend/src/pages/Clientes.tsx) (líneas 186-190, `filteredClientes` vía `useMemo` + `.toLowerCase().includes()`), aunque ahí es una lista con input de texto separado, no un combobox integrado a un selector.
- El proyecto ya tiene instalados (pero sin uso actual) los primitivos shadcn `command.tsx` y `popover.tsx` en `frontend/src/components/ui/` — es exactamente el patrón estándar de un Combobox buscable, no hace falta instalar nada nuevo.
- Existe un componente huérfano, [FormularioPedido.tsx](../frontend/src/pages/FormularioPedido.tsx), no enrutado en `App.tsx` y con lógica de cliente sin implementar (TODO en el código). No es el flujo real de creación de pedido — queda fuera de alcance.
- Hay otro dropdown con el mismo problema de fondo (sin orden ni búsqueda): el filtro "Producto" en [MovimientosInventario.tsx:113-132](../frontend/src/pages/MovimientosInventario.tsx). No fue pedido explícitamente y se deja fuera de este plan, pero es candidato a una mejora futura con el mismo patrón.

## Funcionalidades requeridas

### 1. Orden alfabético de clientes
- Backend: agregar `class Meta: ordering = ['nombre']` a `Cliente` ([backend/core/models.py:22-37](../backend/core/models.py)) y/o `.order_by('nombre')` explícito en `ClienteListView.get` ([views.py:279-284](../backend/core/views.py)), para que el orden sea consistente independiente del frontend.
- Frontend: ordenar también client-side (`.sort()`) en `PedidoNuevo.tsx` como defensa adicional, sin depender únicamente del orden que entregue el backend.

### 2. Combobox buscable en el Paso 1 de creación de pedido
- Reemplazar el `<Select>` de cliente ([PedidoNuevo.tsx:234-246](../frontend/src/pages/PedidoNuevo.tsx)) por un combobox (Popover + Command de shadcn) que filtre en tiempo real mientras se escribe.
- Mantener el mismo estado (`clienteId` / `setClienteId`) y el bloque de "Vendedor Asignado" que se muestra debajo al seleccionar ([PedidoNuevo.tsx:247-259](../frontend/src/pages/PedidoNuevo.tsx)) sin cambiar su comportamiento.
- Mostrar vendedor y/o dirección como texto secundario en cada opción del combobox, para ayudar a distinguir clientes con nombres parecidos.

## Pasos de implementación
1. Backend: agregar ordering alfabético a `Cliente` (Meta.ordering y/o `order_by` en `ClienteListView`); correr `makemigrations`/`migrate` si Django detecta el cambio de opciones del modelo.
2. Frontend: construir un combobox de cliente reutilizable (Popover + Command + CommandInput + CommandItem) alimentado por la lista ordenada de clientes.
3. Frontend: integrar el combobox en el Paso 1 de `PedidoNuevo.tsx`, reemplazando el `<Select>` actual y preservando el manejo de estado existente.
4. Verificación manual: crear un pedido nuevo, confirmar que la lista aparece ordenada A-Z, que escribir texto filtra correctamente, y que seleccionar un cliente sigue mostrando el vendedor asignado y la dirección.

## Consideraciones técnicas
- No tocar `FormularioPedido.tsx` — es un componente huérfano no enrutado, fuera de alcance.
- Construir el combobox como componente reutilizable facilita aplicar después el mismo patrón al filtro de producto de `MovimientosInventario.tsx` si se decide dar consistencia total (fuera de alcance de este plan).
- Hoy `Cliente.objects.all()` trae la lista completa sin paginación; un combobox client-side es suficiente mientras la base de clientes no crezca a un volumen que requiera búsqueda server-side.

## Complejidad: Baja-Media
## Dependencias: Ninguna

---

## Cómo ejecutar este plan

```
Implementa el Plan 01 (Pedidos — Buscador y Orden Alfabético de Cliente) de planes/01-pedidos-buscador-cliente.md

Contexto:
- Vista principal: frontend/src/pages/PedidoNuevo.tsx, Paso 1 del wizard (selección de cliente), líneas 226-262
- Fetch de clientes: PedidoNuevo.tsx líneas 58-64 (useQuery ['clientes'] -> getClientes)
- Selector actual sin orden ni búsqueda: PedidoNuevo.tsx líneas 234-246
- Backend: ClienteListView en backend/core/views.py líneas 279-284 (Cliente.objects.all() sin order_by)
- Modelo Cliente: backend/core/models.py líneas 22-37 (sin Meta.ordering)
- Patrón de búsqueda ya usado en el proyecto: frontend/src/pages/Clientes.tsx líneas 186-190
- Primitivos shadcn disponibles y sin uso: frontend/src/components/ui/command.tsx, frontend/src/components/ui/popover.tsx

Enfoque:
1. Backend: agregar orden alfabético (Meta.ordering='nombre' o order_by('nombre')) a Cliente/ClienteListView
2. Frontend: construir un combobox buscable (Popover + Command) reutilizable para seleccionar cliente
3. Frontend: reemplazar el <Select> de PedidoNuevo.tsx Paso 1 por el combobox, preservando el estado clienteId y el bloque de "Vendedor Asignado"
4. Verificar manualmente: orden alfabético, búsqueda en vivo, y que seleccionar cliente siga mostrando vendedor/dirección
```

> Skill recomendado: `/impeccable` (interacción y polish sobre un formulario existente, sin arquitectura nueva)
> Modelo recomendado: **Sonnet** (cambio acotado de UI + un ajuste simple de ordering en backend, sin lógica de negocio compleja)
