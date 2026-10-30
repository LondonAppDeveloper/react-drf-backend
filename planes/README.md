# Planes de Desarrollo — Meets

12 planes organizados por área. Cada archivo detalla objetivo, contexto, funcionalidades requeridas, pasos y complejidad.

> Nota: los Planes 01, 02 y 03 ya están implementados en el working tree (sin commitear al momento de escribir los Planes 04-10) — se dejan documentados como referencia histórica y porque los planes nuevos citan su código.

## Convención de Estado

Cada plan tiene una columna **Estado** en las tablas de abajo: `⬜ Pendiente` o `✅ Completado`. El bloque "Cómo ejecutar este plan" de cada archivo (`0X-*.md`) termina con un paso explícito para marcarlo como `✅ Completado` acá en el README (en la tabla de su área **y** en la tabla de "Skills y Modelos Recomendados") una vez que la verificación manual del plan pasó — así, al correr el prompt de un plan, queda registrado automáticamente al terminar, sin depender de acordarse de volver a este archivo por separado.

---

## Autenticación

| # | Plan | Complejidad | Estado |
|---|---|---|---|
| 04 | [Refresh Token Automático y Redirección Forzada al Expirar Sesión](04-auth-refresh-token.md) | Baja-Media | ⬜ Pendiente |

## Pedidos

| # | Plan | Complejidad | Estado |
|---|---|---|---|
| 01 | [Buscador y Orden Alfabético de Cliente](01-pedidos-buscador-cliente.md) | Baja-Media | ✅ Completado |
| 05 | [Dialog de Detalle de Costo y Ganancia por Pedido](05-pedidos-detalle-costo-ganancia.md) | Baja | ⬜ Pendiente |
| 06 | [Combobox Solo-Nombre y Vendedor Correcto al Crear Pedido](06-pedidos-combobox-vendedor-cliente.md) | Media | ⬜ Pendiente |
| 08 | [Crear Cliente Rápido desde el Wizard de Nuevo Pedido](08-pedidos-crear-cliente-rapido.md) | Baja-Media | ⬜ Pendiente |
| 12 | [Notificación Push y Anulación Automática de Reservas Vencidas](12-pedidos-notificacion-anulacion-reserva.md) | Alta | ⬜ Pendiente |

## Facturas

| # | Plan | Complejidad | Estado |
|---|---|---|---|
| 02 | [Edición Post-Creación con Guardas de Stock](02-facturas-edicion.md) | Alta | ✅ Completado |
| 10 | [Marcar como Pagada](10-facturas-marcar-pagada.md) | Baja | ⬜ Pendiente |

## Finanzas

| # | Plan | Complejidad | Estado |
|---|---|---|---|
| 07 | [Encabezado de Pagado/Adeudado al Seleccionar Vendedor](07-finanzas-resumen-vendedor.md) | Baja | ⬜ Pendiente |

## Inventario

| # | Plan | Complejidad | Estado |
|---|---|---|---|
| 09 | [Columna Vendedor en Salidas y Exportación a Excel](09-inventario-vendedor-excel.md) | Baja-Media | ⬜ Pendiente |

## Productos

| # | Plan | Complejidad | Estado |
|---|---|---|---|
| 11 | [Historial/Auditoría de Cambios de Precio](11-productos-historial-precio.md) | Baja-Media | ✅ Completado |

## Reportes

| # | Plan | Complejidad | Estado |
|---|---|---|---|
| 03 | [Ganancias, Márgenes y Estadísticas de Ventas/Compras](03-reportes-ganancias.md) | Alta | ✅ Completado |

---

## Skills y Modelos Recomendados

| # | Plan | Complejidad | Skill | Modelo | Razón | Estado |
|---|---|---|---|---|---|---|
| 01 | [Buscador y Orden Alfabético de Cliente](01-pedidos-buscador-cliente.md) | Baja-Media | `/impeccable` | Sonnet | Interacción y polish sobre un formulario existente, sin arquitectura nueva | ✅ Completado |
| 02 | [Edición Post-Creación con Guardas de Stock](02-facturas-edicion.md) | Alta | Ninguno específico (backend-first) | Opus 4.8 | Reconciliación de stock con reglas condicionales por línea, dentro de una transacción | ✅ Completado |
| 03 | [Ganancias, Márgenes y Estadísticas de Ventas/Compras](03-reportes-ganancias.md) | Alta | `/frontend-design` | Opus 4.8 | Agregaciones de negocio con varias dimensiones interdependientes (producto, mes, vendedor, pérdidas) | ✅ Completado |
| 04 | [Refresh Token Automático y Redirección Forzada](04-auth-refresh-token.md) | Baja-Media | Ninguno específico | Sonnet | Interceptores HTTP y contexto de auth ya existentes, sin diseño visual nuevo | ⬜ Pendiente |
| 05 | [Dialog de Detalle de Costo y Ganancia por Pedido](05-pedidos-detalle-costo-ganancia.md) | Baja | `/impeccable` | Sonnet | Dialog de presentación de datos ya disponibles, sin cambios de backend | ⬜ Pendiente |
| 06 | [Combobox Solo-Nombre y Vendedor Correcto al Crear Pedido](06-pedidos-combobox-vendedor-cliente.md) | Media | Ninguno específico | Opus 4.8 | Fix de asignación de vendedor dentro de una vista con lógica FIFO compleja alrededor | ⬜ Pendiente |
| 07 | [Encabezado de Pagado/Adeudado al Seleccionar Vendedor](07-finanzas-resumen-vendedor.md) | Baja | `/impeccable` | Sonnet | Reutiliza un cálculo ya existente en un lugar donde falta mostrarlo | ⬜ Pendiente |
| 08 | [Crear Cliente Rápido desde el Wizard](08-pedidos-crear-cliente-rapido.md) | Baja-Media | `/impeccable` | Sonnet | Extracción de formulario existente a componente reutilizable + dialog embebido | ⬜ Pendiente |
| 09 | [Columna Vendedor en Salidas y Exportación a Excel](09-inventario-vendedor-excel.md) | Baja-Media | Ninguno específico | Sonnet | Integración de librería estándar sobre datos que el backend ya expone | ⬜ Pendiente |
| 10 | [Marcar como Pagada](10-facturas-marcar-pagada.md) | Baja | `/impeccable` | Sonnet | Backend y frontend ya tienen casi todo listo, solo falta conectar la UI | ⬜ Pendiente |
| 11 | [Historial/Auditoría de Cambios de Precio](11-productos-historial-precio.md) | Baja-Media | `/impeccable` | Sonnet | Modelo y endpoint nuevos pero acotados, UI reutiliza el patrón Dialog+Table ya existente | ✅ Completado |
| 12 | [Notificación Push y Anulación Automática de Reservas Vencidas](12-pedidos-notificacion-anulacion-reserva.md) | Alta | Ninguno específico | Opus 4.8 | Infraestructura nueva de cron, Web Push y PWA que debe encajar con la reversión de stock ya existente | ⬜ Pendiente |

---

## Orden de Prioridad Sugerido

1. [**Plan 06** — Pedidos: combobox solo-nombre y vendedor correcto al crear pedido](06-pedidos-combobox-vendedor-cliente.md) — corrige un bug de integridad de datos (ventas atribuidas al vendedor equivocado), priorizar sobre lo demás.
2. [**Plan 04** — Autenticación: refresh token automático y redirección forzada](04-auth-refresh-token.md) — afecta a todos los usuarios en cada sesión larga.
3. [**Plan 10** — Facturas: marcar como pagada](10-facturas-marcar-pagada.md) — backend y frontend casi completos, cierre rápido.
4. [**Plan 07** — Finanzas: encabezado de pagado/adeudado por vendedor](07-finanzas-resumen-vendedor.md) — reutiliza cálculo existente, cierre rápido.
5. [**Plan 05** — Pedidos: dialog de detalle de costo y ganancia](05-pedidos-detalle-costo-ganancia.md) — sin dependencias de backend.
6. [**Plan 08** — Pedidos: crear cliente rápido desde el wizard](08-pedidos-crear-cliente-rapido.md)
7. [**Plan 09** — Inventario: columna vendedor en salidas + exportación a Excel](09-inventario-vendedor-excel.md)
8. [**Plan 01** — Pedidos: buscador y orden alfabético de cliente](01-pedidos-buscador-cliente.md) *(ya implementado)*
9. [**Plan 02** — Facturas: edición post-creación con guardas de stock](02-facturas-edicion.md) *(ya implementado)*
10. [**Plan 03** — Reportes: ganancias, márgenes y estadísticas](03-reportes-ganancias.md) *(ya implementado)*
11. [**Plan 11** — Productos: historial/auditoría de cambios de precio](11-productos-historial-precio.md) — sin dependencias, cierre rápido.
12. [**Plan 12** — Pedidos: notificación push y anulación automática de reservas vencidas](12-pedidos-notificacion-anulacion-reserva.md) — infraestructura nueva (cron, Web Push, PWA), más lenta de cerrar que el resto, priorizar según cuánto duela hoy que las reservas vencidas no se limpien solas.

> Los planes son mayormente independientes entre sí — pueden ejecutarse en paralelo si distintas personas los toman. Excepciones: el Plan 08 reutiliza el mismo formulario de cliente que toca el Plan 06 (revisar coherencia si ambos se implementan a la vez); si el Plan 02 se implementa antes que el Plan 03, conviene que el endpoint de fluctuación de precios de 03 lea costos ya reconciliados (ver "Dependencias" en el Plan 03); y el Plan 12 extrae a una función compartida la lógica de reversión de stock de `CancelarPedido` que el Plan 02 también referencia como patrón (ver "Contexto" del Plan 02) — revisar que ambos sigan alineados si se tocan en paralelo.
