# Plan: Pedidos — Notificación Push y Anulación Automática de Reservas Vencidas

## Objetivo
Que un pedido en estado `Reservado` que lleve más de 4 días sin avanzar dispare una notificación push al celular avisando que se anulará al quinto día, se anule automáticamente si nadie actúa, y que el usuario pueda extender el plazo una única vez por 3 días adicionales desde el menú de acciones (los "3 puntos") de cada pedido.

## Contexto
- `Pedido` ([backend/core/models.py:158-196](../backend/core/models.py)) tiene `fecha` (`auto_now_add`, no editable) y `estado` con choices `Reservado/Preparado/Anulado/Pagado`, default `Reservado`. **No existe hoy ningún campo de plazo/vencimiento** — hay que agregarlo.
- Ya existe el flujo de anulación manual: `CancelarPedido` ([backend/core/views.py:560-...](../backend/core/views.py)), `POST /pedidos/cancelar/` ([backend/core/urls.py:20](../backend/core/urls.py)), invocado desde el frontend vía `cancelarPedido(id)` ([frontend/src/services/api.ts:141](../frontend/src/services/api.ts)) y el botón "Anular Pedido" en el `DropdownMenu` de cada fila ([frontend/src/pages/Pedidos.tsx:281-293](../frontend/src/pages/Pedidos.tsx)) — este es el menú de "3 puntos" (`MoreVertical`, [Pedidos.tsx:260-265](../frontend/src/pages/Pedidos.tsx)) donde debe ir la nueva opción "Extender plazo". `CancelarPedido` revierte el stock a las entradas originales dentro de una transacción (`select_for_update` + reconciliación FIFO, [views.py:568-599+](../backend/core/views.py)) — la anulación automática por vencimiento **debe reusar exactamente esa misma lógica de reversión de stock**, no reimplementarla ni saltársela.
- **No existe infraestructura de tareas programadas en el proyecto**: no hay Celery, `django-crontab`, ni ningún cron configurado. Solo hay tres `management commands` existentes, todos de uso manual/una vez ([backend/core/management/commands/](../backend/core/management/commands/)). El comando que este plan agrega necesita un disparador diario externo (cron del host, tarea programada de la plataforma de hosting, o Task Scheduler de Windows en desarrollo) — **cuál disparador usar es una decisión de infraestructura fuera del alcance de este plan**, que solo entrega el comando (`python manage.py verificar_reservas`) listo para ser invocado.
- **No existe infraestructura de notificaciones push en absoluto**: sin `manifest.json`, sin service worker, sin `vite-plugin-pwa`, sin librería de Web Push en `requirements.txt`. El `index.html` ([frontend/index.html](../frontend/index.html)) no tiene ni siquiera las meta tags de PWA/`apple-mobile-web-app-capable`. Hay que construir esto desde cero.
- **Limitación real de iOS/Safari que el usuario ya identificó correctamente**: Safari en iOS solo entrega Web Push a una PWA instalada en la pantalla de inicio ("Agregar a inicio"), nunca a una pestaña normal del navegador (requiere iOS ≥ 16.4). Por eso este plan es, necesariamente, también un plan de "convertir el frontend en PWA instalable" — no hay forma de cumplir "notificación al teléfono" sin eso.
- `Pedido` en el frontend ([frontend/src/types/index.ts:54-62](../frontend/src/types/index.ts)) no tiene campos de plazo — hay que agregarlos al tipo.
- Autenticación ya usa JWT (`IsAuthenticated` en las vistas, `djangorestframework-simplejwt` en requirements.txt) — la suscripción push se guarda asociada al usuario autenticado (`request.user`), asumiendo que quien se suscribe desde su celular es quien debe recibir el aviso (el dueño/operador del negocio). Si en el futuro se necesita notificar a un vendedor específico por sus propios pedidos, es una extensión de este modelo, no parte de este plan.

## Funcionalidades requeridas

### 1. Plazo de anulación por pedido (backend)
- Agregar a `Pedido` ([backend/core/models.py:158-196](../backend/core/models.py)):
  - `fecha_limite_anulacion` (`DateTimeField`, null/blank): se fija en la creación del pedido (cuando `estado` inicial es `Reservado`) a `fecha + 5 días`. Requiere `override` de `save()` o una señal `post_save` (dado que `fecha` es `auto_now_add`, en el primer `save()` aún no está poblado en memoria salvo que se calcule con `timezone.now()` directamente en vez de leer `self.fecha`).
  - `notificado_anulacion` (`BooleanField`, default `False`): evita reenviar el aviso todos los días una vez notificado.
  - `plazo_extendido` (`BooleanField`, default `False`): controla que la extensión de 3 días solo pueda usarse una vez por pedido.
- Migración correspondiente (`makemigrations`/`migrate`).
- "Más de 4 días" se traduce como: cuando faltan ≤ 1 día para `fecha_limite_anulacion` (es decir, ya pasaron > 4 días desde `fecha`) y `notificado_anulacion=False`, se dispara el aviso de que el pedido se anula al día 5.

### 2. Comando de verificación diaria (`verificar_reservas`)
- Nuevo `management command` en `backend/core/management/commands/verificar_reservas.py`, siguiendo el patrón de los comandos ya existentes en esa carpeta.
- Dos pasadas sobre `Pedido.objects.filter(estado='Reservado')`:
  1. **Anulación**: pedidos con `fecha_limite_anulacion <= timezone.now()` → anular reusando la misma lógica de reversión de stock que `CancelarPedido` ([views.py:560-...](../backend/core/views.py)) — extraer esa lógica a una función compartida (p. ej. `core/services/pedidos.py::anular_pedido(pedido)`) invocada tanto desde `CancelarPedido.post()` como desde este comando, para no duplicar ni desincronizar el flujo de reversión de stock.
  2. **Notificación**: pedidos con `notificado_anulacion=False` y `fecha_limite_anulacion - timezone.now() <= 1 día` → enviar push (ver funcionalidad 3) y marcar `notificado_anulacion=True`.
- Idempotente: correrlo dos veces el mismo día no debe reenviar avisos ni intentar anular dos veces (el primer filtro ya excluye `estado != 'Reservado'`).

### 3. Notificaciones push al celular (Web Push + PWA)
- **Backend**:
  - Agregar `pywebpush` a `requirements.txt`, generar par de claves VAPID y guardarlas en `backend/.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CLAIMS_EMAIL`).
  - Nuevo modelo `PushSubscription` (usuario, `endpoint`, `p256dh`, `auth`, `creado`) — un usuario puede tener varias suscripciones (varios dispositivos).
  - Endpoint `POST /notificaciones/suscribir/` que reciba el objeto `PushSubscription` que entrega el `PushManager` del navegador y lo guarde asociado a `request.user`.
  - Función `enviar_push(usuario, titulo, cuerpo)` que itere las suscripciones del usuario y llame a `pywebpush.webpush(...)`, eliminando la suscripción si la respuesta indica que expiró/fue revocada (410/404).
- **Frontend** (requiere convertir la app en PWA instalable, condición dura de iOS para recibir push):
  - `manifest.json` en `frontend/public/` (`name`, `short_name`, `icons`, `display: "standalone"`, `start_url`) + íconos (192px/512px).
  - Meta tags de PWA en [frontend/index.html](../frontend/index.html): `<link rel="manifest">`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-touch-icon`.
  - Service worker (`frontend/public/sw.js` o vía `vite-plugin-pwa`) con listener de evento `push` que muestre la notificación del sistema.
  - Registro del service worker + flujo de suscripción (`Notification.requestPermission()` → `registration.pushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY })` → `POST /notificaciones/suscribir/`) — disparado desde algún punto de la UI (p. ej. un banner o botón en el dashboard), no automáticamente al cargar, porque el permiso de notificaciones debe pedirse en respuesta a una interacción del usuario.
  - Banner/aviso visible cuando `window.matchMedia('(display-mode: standalone)').matches === false` en iOS, indicando "Agrega esta app a tu pantalla de inicio desde Safari (Compartir → Agregar a inicio) para recibir notificaciones" — sin esto, el usuario nunca sabrá por qué no le llegan avisos si sigue usándola como pestaña normal.

### 4. Extender plazo desde el menú de "3 puntos" de cada pedido
- Backend: endpoint `POST /pedidos/extender-plazo/` (`pedido_id`) que:
  - Valide `estado == 'Reservado'` y `plazo_extendido == False` (si no, 400 con mensaje claro — ya extendido o pedido no vigente).
  - Sume 3 días a `fecha_limite_anulacion`, marque `plazo_extendido = True`, y resetee `notificado_anulacion = False` (para que, si se acerca el nuevo límite, se vuelva a avisar una vez antes de la anulación definitiva — después de esa segunda anulación no hay más extensiones posibles).
- Frontend: en el `DropdownMenu` de cada fila de `Pedidos.tsx` ([líneas 260-295](../frontend/src/pages/Pedidos.tsx)), agregar un ítem "Extender plazo (+3 días)" visible solo cuando `pedido.estado === 'Reservado' && !pedido.plazo_extendido`, que llame a la nueva mutación y luego invalide `['pedidos']`.
- Mostrar el vencimiento de forma visible junto al badge de estado "Reservado" ([getStatusColor / badge, Pedidos.tsx:86-94](../frontend/src/pages/Pedidos.tsx)) — p. ej. "Vence en 2 días" o "Vence el DD/MM" — para que el usuario sepa cuándo usar la opción de extender antes de que sea tarde.

## Pasos de implementación
1. Backend: agregar campos `fecha_limite_anulacion`, `notificado_anulacion`, `plazo_extendido` a `Pedido`, con `save()`/señal que fije el límite inicial en 5 días desde la creación. Migración.
2. Backend: extraer la lógica de reversión de stock de `CancelarPedido` ([views.py:560-...](../backend/core/views.py)) a una función compartida reusable, y hacer que `CancelarPedido` la use.
3. Backend: `management command verificar_reservas.py` que anula vencidos (vía la función compartida) y notifica próximos a vencer.
4. Backend: modelo `PushSubscription`, endpoint de suscripción, función `enviar_push`, claves VAPID en `.env`, `pywebpush` en `requirements.txt`.
5. Backend: endpoint `POST /pedidos/extender-plazo/`.
6. Frontend: `manifest.json`, íconos, meta tags PWA en `index.html`, service worker con listener de `push`.
7. Frontend: flujo de suscripción (pedir permiso, `pushManager.subscribe`, `POST /notificaciones/suscribir/`) y banner de "agregar a inicio" para iOS cuando no está en modo standalone.
8. Frontend: tipo `Pedido` actualizado con los nuevos campos ([types/index.ts:54-62](../frontend/src/types/index.ts)); ítem "Extender plazo" en el `DropdownMenu` de `Pedidos.tsx`; indicador de vencimiento junto al badge "Reservado".
9. Documentar en el README o en `docs/` cómo/dónde programar la ejecución diaria de `verificar_reservas` en el entorno de despliegue real (cron del host, tarea programada de la plataforma, o Task Scheduler en Windows para desarrollo) — este plan no elige el disparador porque depende de dónde se hostee el backend.
10. Verificación manual: (a) crear un pedido, adelantar `fecha_limite_anulacion` manualmente en la base para simular "más de 4 días" y correr `verificar_reservas`, confirmar que llega la notificación push al dispositivo con la PWA instalada; (b) extender el plazo desde el menú de 3 puntos y confirmar que la opción desaparece después de usarla una vez; (c) simular el vencimiento final y correr el comando de nuevo, confirmar que el pedido pasa a `Anulado` y el stock se revierte igual que con "Anular Pedido" manual; (d) probar en un iPhone real: instalar la PWA desde Safari ("Agregar a inicio"), aceptar notificaciones, y confirmar que una notificación de prueba llega al teléfono estando la app cerrada.

## Consideraciones técnicas
- Este plan **no** implementa el disparador del cron en sí (fuera de alcance porque depende de la plataforma de hosting) — entrega el comando de Django listo para ser invocado por lo que sea que el entorno de producción use para tareas programadas.
- La notificación push a iOS **solo funciona si el usuario instaló la PWA desde Safari** ("Agregar a inicio"); en una pestaña normal de Safari no hay push, sin excepción, es una limitación del sistema operativo, no del código. El banner de instalación mencionado en la funcionalidad 3 es la única forma de comunicarle esto al usuario dentro de la propia app.
- La reversión de stock al anular automáticamente por vencimiento debe ser *exactamente* la misma que la anulación manual — cualquier divergencia entre ambos caminos dejaría el stock inconsistente según por qué vía se anuló el pedido. Por eso el paso 2 de implementación (extraer la lógica compartida) es un prerrequisito real del paso 3, no un nice-to-have.
- Al resetear `notificado_anulacion=False` tras una extensión, el usuario recibirá un segundo aviso antes de la anulación definitiva de los 3 días extra — comportamiento deliberado (consistente con avisar siempre antes de anular), pero after esa segunda anulación no hay más extensiones posibles (`plazo_extendido` ya quedó en `True` permanentemente).
- Las claves VAPID y la librería de push son sensibles/nuevas dependencias de infraestructura — no confundir con secretos de negocio, pero sí deben ir a variables de entorno (`backend/.env`, ya en `.gitignore`) y nunca comitearse.

## Complejidad: Alta
## Dependencias: Ninguna (pero introduce una refactorización de `CancelarPedido` que otros planes de facturación/anulación deberían tener en cuenta si tocan ese código en paralelo)

---

## Cómo ejecutar este plan

```
Implementa el Plan 12 (Pedidos — Notificación Push y Anulación Automática de Reservas Vencidas) de planes/12-pedidos-notificacion-anulacion-reserva.md

Contexto:
- Modelo Pedido: backend/core/models.py líneas 158-196 (fecha auto_now_add, estado con choices Reservado/Preparado/Anulado/Pagado) — no tiene campos de plazo, hay que agregarlos
- Anulación manual ya existe y revierte stock: CancelarPedido en backend/core/views.py líneas 560+ (POST /pedidos/cancelar/, urls.py línea 20), invocada desde el DropdownMenu de "3 puntos" en frontend/src/pages/Pedidos.tsx líneas 260-295 (botón "Anular Pedido" en líneas 281-293)
- NO existe infraestructura de cron/Celery en el proyecto — solo management commands manuales en backend/core/management/commands/
- NO existe infraestructura de push/PWA en absoluto — sin manifest.json, sin service worker, sin vite-plugin-pwa, sin pywebpush en requirements.txt
- iOS Safari solo entrega push a una PWA instalada en pantalla de inicio ("Agregar a inicio"), nunca a una pestaña normal — condición dura del sistema operativo
- Tipo Pedido en frontend: frontend/src/types/index.ts líneas 54-62, sin campos de plazo

Enfoque:
1. Backend: agregar fecha_limite_anulacion (fecha creación + 5 días), notificado_anulacion, plazo_extendido a Pedido + migración
2. Backend: extraer la lógica de reversión de stock de CancelarPedido a una función compartida, reusarla desde el comando de anulación automática
3. Backend: management command verificar_reservas.py — anula vencidos (fecha_limite_anulacion <= ahora) y notifica próximos a vencer (falta ≤1 día, notificado_anulacion=False)
4. Backend: modelo PushSubscription, endpoint POST /notificaciones/suscribir/, función enviar_push con pywebpush, claves VAPID en .env
5. Backend: endpoint POST /pedidos/extender-plazo/ — solo si estado='Reservado' y plazo_extendido=False, suma 3 días, marca plazo_extendido=True, resetea notificado_anulacion=False
6. Frontend: manifest.json + íconos + meta tags PWA en index.html + service worker con listener de push (o vite-plugin-pwa)
7. Frontend: flujo de suscripción push (pedir permiso en respuesta a interacción del usuario, pushManager.subscribe, POST al backend) + banner de "agregar a inicio" para iOS cuando no está en display-mode standalone
8. Frontend: actualizar tipo Pedido, agregar ítem "Extender plazo (+3 días)" en el DropdownMenu de Pedidos.tsx (visible solo si Reservado y no extendido aún), mostrar vencimiento junto al badge "Reservado"
9. Documentar dónde programar la ejecución diaria de verificar_reservas en el entorno real de despliegue (no elegir el disparador, solo dejar el comando listo)
10. Verificar manualmente todo el ciclo: aviso a los 4+ días, extensión única de 3 días, anulación automática con reversión de stock idéntica a la manual, y prueba real en iPhone con la PWA instalada
11. Una vez verificado, marcar el Plan 12 como ✅ Completado en planes/README.md
```

> Skill recomendado: Ninguno específico (infraestructura backend nueva — modelos, cron, Web Push — más PWA en frontend, no es principalmente trabajo de UI/polish).
> Modelo recomendado: **Opus 4.8** (varias piezas de infraestructura nueva que deben encajar exactamente: reversión de stock compartida entre dos caminos de anulación, ciclo de vida de notificaciones con reseteo tras extensión, y limitaciones reales de iOS/Safari que hay que diseñar correctamente, no solo conectar UI a un endpoint que ya existe).
