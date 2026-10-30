# Plan: Productos — Historial/Auditoría de Cambios de Precio

## Objetivo
Registrar automáticamente cada cambio de `precio_por_kilo` de un `Producto` (precio anterior, precio nuevo, quién lo hizo y cuándo), y exponer ese historial en la UI de Productos, para poder responder "¿quién cambió este precio y cuándo?" — hoy esa pregunta no se puede responder porque el precio se sobrescribe sin dejar rastro.

## Contexto
- El modelo `Producto` ([backend/core/models.py:43-108](../backend/core/models.py)) tiene `precio_por_kilo` ([línea 47](../backend/core/models.py)) sin ningún mecanismo de auditoría: no hay `django-simple-history` instalado, ni un modelo de historial, ni señales (`signals`).
- La edición de precio ocurre en `UpdateProducto.put` ([backend/core/views.py:773-792](../backend/core/views.py)): sobrescribe `producto.precio_por_kilo = data.get('precio_por_kilo', producto.precio_por_kilo)` y guarda directo, sin comparar contra el valor previo. La vista ya tiene `permission_classes = [IsAuthenticated]` ([línea 774](../backend/core/views.py)), así que `request.user` está disponible.
- El proyecto ya tiene el patrón de usuario vinculado a `Vendedor`: `Vendedor.user` es un `OneToOneField` a `settings.AUTH_USER_MODEL` con `related_name='vendedor_profile'` ([backend/core/models.py:6-19](../backend/core/models.py)) — así que a partir de `request.user` se puede llegar al nombre del vendedor vía `request.user.vendedor_profile.nombre` (puede no existir si el usuario no tiene perfil de vendedor, ej. un superusuario).
- El frontend edita el precio en el dialog "Editar Producto" de `Productos.tsx` ([líneas 162-232](../frontend/src/pages/Productos.tsx)), mediante `updateProducto(id, payload)` ([frontend/src/services/api.ts:111-112](../frontend/src/services/api.ts)) que hace `PUT /productos/<id>/`. La tabla de productos ya tiene una columna de Acciones con el botón "Editar" ([líneas 284-288](../frontend/src/pages/Productos.tsx)) — ahí es donde conviene agregar un botón "Ver historial".
- No existe todavía ningún patrón de "diálogo de solo lectura con tabla de historial" en el proyecto para copiar 1:1, pero sí hay el patrón general de `Dialog` + `Table` usado en la misma página ([Productos.tsx:162-232](../frontend/src/pages/Productos.tsx) y [244-300](../frontend/src/pages/Productos.tsx)).

## Funcionalidades requeridas

### 1. Modelo `HistorialPrecioProducto`
- Nuevo modelo en `backend/core/models.py` (cerca de `Producto`): `producto` (FK a `Producto`, `related_name='historial_precios'`, `on_delete=CASCADE`), `precio_anterior` y `precio_nuevo` (`DecimalField`, mismos `max_digits`/`decimal_places` que `precio_por_kilo`: 10/2), `usuario` (FK a `settings.AUTH_USER_MODEL`, `null=True, blank=True, on_delete=SET_NULL` — para no perder el registro si se borra el usuario), `fecha_cambio` (`DateTimeField(auto_now_add=True)`).
- Migración correspondiente.

### 2. Registrar el cambio al editar el precio
- En `UpdateProducto.put` ([views.py:773-792](../backend/core/views.py)), capturar `precio_anterior = producto.precio_por_kilo` antes de sobrescribir. Después de `producto.save()`, comparar (`Decimal`) contra el nuevo valor; si cambió, crear un `HistorialPrecioProducto` con `usuario=request.user` (ya autenticado por el `permission_classes`).
- Solo registrar cuando el precio efectivamente cambió (evitar entradas vacías si se edita solo el nombre/estado/etc. sin tocar el precio).

### 3. Endpoint para consultar el historial
- Nueva vista `HistorialPrecioProductoView(APIView)` con `permission_classes = [IsAuthenticated]`, `GET /productos/<producto_id>/historial-precio/`, devuelve la lista de `HistorialPrecioProducto` de ese producto ordenada por `-fecha_cambio`.
- Nuevo `HistorialPrecioProductoSerializer` con `precio_anterior`, `precio_nuevo`, `fecha_cambio` y un campo calculado `usuario_nombre` (usa `usuario.vendedor_profile.nombre` si existe, si no `usuario.username`, si no hay `usuario` devuelve `"Sistema"`).
- Registrar la ruta en `backend/core/urls.py` junto a las demás rutas de `productos/`.

### 4. UI: ver historial desde la tabla de Productos
- En `Productos.tsx`, agregar un botón/ícono (ej. `History` de `lucide-react`) junto al de "Editar" en la columna Acciones ([líneas 284-288](../frontend/src/pages/Productos.tsx)) que abra un nuevo `Dialog` de solo lectura mostrando una tabla: Fecha, Usuario, Precio anterior → Precio nuevo, para el producto seleccionado.
- Nueva función de servicio `getHistorialPrecio(id: number)` en `api.ts`, y el tipo correspondiente en `frontend/src/types/index.ts`.
- Si el historial está vacío, mostrar un mensaje ("Sin cambios de precio registrados") en vez de una tabla vacía.

## Pasos de implementación
1. Backend: agregar el modelo `HistorialPrecioProducto` en `models.py` y generar la migración (`python manage.py makemigrations`).
2. Backend: en `UpdateProducto.put`, capturar el precio anterior, guardar el producto, y crear el registro de historial si el precio cambió, asociando `request.user`.
3. Backend: agregar `HistorialPrecioProductoSerializer`, la vista `HistorialPrecioProductoView` y la ruta `productos/<int:producto_id>/historial-precio/` en `urls.py`.
4. Frontend: agregar `getHistorialPrecio` en `api.ts` y el tipo `HistorialPrecio` en `types/index.ts`.
5. Frontend: en `Productos.tsx`, agregar el botón "Ver historial" (ícono `History`) por fila, con estado (`historialProducto`, `historialDialogOpen`) y un `useQuery` (`queryKey: ['historial-precio', id]`) que dispare al abrir el dialog; renderizar la tabla de cambios.
6. Verificación manual: (a) editar el precio de un producto y confirmar que se crea una entrada en el historial con el usuario logueado, precio anterior y nuevo correctos; (b) editar el producto sin tocar el precio y confirmar que NO se crea ninguna entrada; (c) abrir "Ver historial" de un producto sin cambios previos y confirmar el mensaje de vacío.
7. Una vez verificado, marcar el Plan 11 como ✅ Completado en `planes/README.md` (agregar tabla "Productos" si no existe, y la tabla de "Skills y Modelos Recomendados").

## Consideraciones técnicas
- Comparar los precios como `Decimal` (no como float/string) para evitar falsos positivos de "cambio" por diferencias de representación (ej. `"10.50"` vs `Decimal('10.50')`).
- `usuario` debe ser `null=True, blank=True` con `on_delete=SET_NULL`: el historial debe sobrevivir aunque se borre la cuenta del usuario que hizo el cambio.
- No es necesario tocar `ProductoSerializer` ([serializers.py:55-58](../backend/core/serializers.py)) — el historial se consulta en un endpoint aparte, no como campo anidado en cada producto, para no traer datos innecesarios en el listado principal (`GET /productos/`).
- Fuera de alcance: exportar el historial a Excel/PDF, o auditar otros campos además de `precio_por_kilo` (nombre, estado, etc.) — si se necesita más adelante, este mismo modelo podría generalizarse a un `HistorialCambioProducto` con un campo `campo` genérico, pero eso es sobre-ingeniería para lo que se pide ahora.

## Complejidad: Baja-Media
## Dependencias: Ninguna

---

## Cómo ejecutar este plan

```
Implementa el Plan 11 (Productos — Historial/Auditoría de Cambios de Precio) de planes/11-productos-historial-precio.md

Contexto:
- Producto.precio_por_kilo (backend/core/models.py línea 47) se edita en UpdateProducto.put (backend/core/views.py líneas 773-792) sin dejar ningún registro del valor anterior
- UpdateProducto ya tiene permission_classes = [IsAuthenticated] -> request.user está disponible
- Vendedor.user es OneToOneField a settings.AUTH_USER_MODEL con related_name='vendedor_profile' (backend/core/models.py líneas 6-19) -> para mostrar el nombre del usuario que hizo el cambio, usar request.user.vendedor_profile.nombre si existe, si no username
- Frontend edita el precio en el dialog de Productos.tsx (líneas 162-232) vía updateProducto() en frontend/src/services/api.ts líneas 111-112
- Columna de Acciones en Productos.tsx líneas 284-288 (botón Editar) es donde agregar el botón "Ver historial"

Enfoque:
1. Backend: modelo HistorialPrecioProducto (producto FK, precio_anterior, precio_nuevo, usuario FK nullable a AUTH_USER_MODEL con SET_NULL, fecha_cambio auto_now_add) + migración
2. Backend: en UpdateProducto.put, capturar precio_anterior antes de sobrescribir, y tras guardar, si el precio (comparado como Decimal) cambió, crear el HistorialPrecioProducto con usuario=request.user
3. Backend: HistorialPrecioProductoSerializer (con usuario_nombre calculado) + vista HistorialPrecioProductoView (GET, IsAuthenticated, ordenado por -fecha_cambio) + ruta productos/<int:producto_id>/historial-precio/ en urls.py
4. Frontend: getHistorialPrecio(id) en api.ts, tipo HistorialPrecio en types/index.ts
5. Frontend: botón "Ver historial" (ícono History de lucide-react) junto a Editar en Productos.tsx, abre un Dialog con tabla Fecha/Usuario/Precio anterior→nuevo, mensaje de vacío si no hay cambios
6. Verificar: cambiar el precio genera una entrada correcta; editar otro campo sin tocar el precio NO genera entrada; el dialog de historial muestra los datos esperados
```

> Skill recomendado: `/impeccable` (nuevo dialog de solo lectura sobre una tabla ya existente).
> Modelo recomendado: **Sonnet** (modelo + endpoint nuevos pero acotados, sin lógica de negocio compleja; el patrón de UI ya existe en la misma página).
