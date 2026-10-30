# Plan: Autenticación — Refresh Token Automático y Redirección Forzada al Expirar Sesión

## Objetivo
Evitar que la sesión "deje afuera" al usuario de forma silenciosa cuando el access token expira (hoy dura 1 día): renovar el access token automáticamente en background usando el refresh token ya guardado, y solo si el refresh también falla, cerrar sesión y redirigir de inmediato al login — sin dejar al usuario viendo una vista rota con peticiones fallando.

## Contexto
- Backend ya usa `rest_framework_simplejwt` con JWT: `MyTokenObtainPairView` ([backend/core/views.py:15-16](../backend/core/views.py)) emite `access` + `refresh` vía `POST /token/`, y `TokenRefreshView` de simplejwt ya está montado en `POST /token/refresh/` ([backend/core/urls.py:36](../backend/core/urls.py)) — **no falta nada en el backend**, el endpoint de refresh ya funciona.
- `SIMPLE_JWT` en `backend/backend/settings.py:199-202` solo fija `ACCESS_TOKEN_LIFETIME = timedelta(days=1)`; no define `REFRESH_TOKEN_LIFETIME` ni `ROTATE_REFRESH_TOKENS`, así que corren con los defaults de simplejwt (refresh token de 1 día también, sin rotación). Con sesiones tan largas entre usos, es fácil que ambos tokens ya estén vencidos cuando el usuario vuelve — el flujo de refresh debe manejar también ese caso (redirigir a login, no solo reintentar).
- Frontend: `AuthContext` ([frontend/src/contexts/AuthContext.tsx](../frontend/src/contexts/AuthContext.tsx)) guarda `token` y `refreshToken` en `localStorage` al hacer login (líneas 32-33), y expone `isAuthenticated`/`isLoading`/`logout`. Al cargar la app (líneas 19-27) solo verifica que exista un `token` en localStorage — nunca valida si sigue vigente.
- `frontend/src/services/api.ts`: existe `refreshToken(refresh)` (línea 49-50) que llama a `POST /token/refresh/`, **pero no se usa en ningún lado del código**. El interceptor de request (líneas 24-31) agrega el `Bearer` token a cada petición. El interceptor de response (líneas 34-43) captura 401, solo hace `localStorage.removeItem('token')` y tiene comentada la línea `window.location.href = '/login'` (línea 39) — es decir, **hoy no redirige**.
- Consecuencia del bug actual: cuando el access token expira, cada petición devuelve 401, se borra `token` de localStorage, pero `AuthContext.isAuthenticated` sigue en `true` en memoria (no se resetea) y `ProtectedRoute` ([frontend/src/App.tsx:24-40](../frontend/src/App.tsx)) no vuelve a evaluar nada hasta un remount — el usuario se queda viendo una vista con datos vacíos/errores en vez de ser mandado al login. Esto coincide con el síntoma reportado ("la sesión se cierra... no me saca al inicio de sesión").
- No existe lógica de "cola" de peticiones pendientes durante un refresh en curso; si varias peticiones fallan con 401 al mismo tiempo, hay que evitar disparar múltiples refresh en paralelo.

## Funcionalidades requeridas

### 1. Refresh automático en el interceptor de axios
- En `frontend/src/services/api.ts`, ampliar el interceptor de response (líneas 34-43): al recibir 401, en vez de solo borrar el token, intentar `POST /token/refresh/` con el `refreshToken` guardado en localStorage.
- Si el refresh tiene éxito: guardar el nuevo `access` en localStorage, reintentar automáticamente la petición original que falló (usando axios, reencolando la request con el nuevo header), y devolver esa respuesta como si nunca hubiera fallado.
- Si el refresh también falla (401/400, o no hay `refreshToken` guardado): limpiar `localStorage` completo y forzar `window.location.href = '/login'` de inmediato.
- Evitar refresh concurrentes: si ya hay un refresh en curso cuando llegan varios 401 a la vez, las peticiones subsecuentes deben esperar el resultado de ese único refresh en lugar de disparar uno cada una (patrón estándar: una promesa compartida que las demás peticiones esperan).

### 2. Sincronizar `AuthContext` con el resultado del refresh/logout
- Cuando el interceptor determina que la sesión no es recuperable (refresh falló), debe quedar coherente con `AuthContext`: no basta con `window.location.href`, porque si el usuario navega vía React Router en vez de recargar, `isAuthenticated` seguiría en `true` en memoria. La forma más simple es que el interceptor limpie `localStorage` y haga un hard redirect (`window.location.href = '/login'`), que recarga la app y hace que `AuthContext` vuelva a inicializar `isAuthenticated` desde cero (línea 19-27) — evaluar si esto es suficiente o si conviene exponer un método `forceLogout()` desde fuera de React (ej. un event emitter simple) para no depender de recargas completas.

### 3. Validación de sesión al cargar la app
- Hoy `AuthContext` solo verifica que exista *algún* token en localStorage (línea 21-22), no que sea válido. Añadir una verificación real al montar la app: si hay `token`, intentar decodificarlo (JWT trae `exp` en el payload, se puede leer sin librerías extra con un `atob` sobre la segunda parte del token) y si ya expiró, intentar un refresh inmediato antes de marcar `isAuthenticated = true`; si el refresh falla, ir a `/login` directamente en vez de mostrar la app y fallar en la primera petición.

## Pasos de implementación
1. Backend: opcionalmente fijar `REFRESH_TOKEN_LIFETIME` explícito en `SIMPLE_JWT` ([backend/backend/settings.py:199-202](../backend/backend/settings.py)) para que la duración de la sesión completa sea una decisión consciente y no el default de la librería (ej. 7 días), documentando la elección.
2. Frontend: en `frontend/src/services/api.ts`, implementar el interceptor de refresh-y-reintento descrito en el punto 1, con manejo de concurrencia (una sola llamada a refresh compartida entre 401 simultáneos).
3. Frontend: en el mismo interceptor, al fallar el refresh, limpiar `localStorage` y redirigir a `/login` de forma dura.
4. Frontend: en `AuthContext.tsx`, añadir la validación de expiración del token al montar la app (punto 3 de Funcionalidades), reutilizando la misma función de refresh si el token ya venció.
5. Verificación manual: (a) loguearse, esperar a que expire el access token (o forzar manualmente cambiando `ACCESS_TOKEN_LIFETIME` a unos segundos en un entorno de prueba) y confirmar que las peticiones siguen funcionando sin que el usuario note nada; (b) borrar manualmente el `refreshToken` de localStorage y confirmar que la siguiente petición fallida manda al usuario a `/login` de inmediato; (c) recargar la app con un token ya vencido y confirmar que no se ve ninguna vista protegida con datos rotos antes de ir a login.

## Consideraciones técnicas
- No hace falta ninguna librería nueva para decodificar el JWT: el payload es la segunda parte del token separada por `.`, decodificable con `JSON.parse(atob(...))` — evitar añadir dependencias solo para leer `exp`.
- El backend ya soporta todo lo necesario (`/token/refresh/` ya existe y funciona) — este plan es enteramente de frontend salvo el ajuste opcional de `REFRESH_TOKEN_LIFETIME`.
- Cuidado con loops infinitos: si el propio endpoint `/token/refresh/` devuelve 401, el interceptor no debe intentar refrescar de nuevo sobre esa misma petición (excluir explícitamente la URL de refresh del interceptor de reintento).

## Complejidad: Baja-Media
## Dependencias: Ninguna

---

## Cómo ejecutar este plan

```
Implementa el Plan 04 (Autenticación — Refresh Token Automático y Redirección Forzada) de planes/04-auth-refresh-token.md

Contexto:
- Backend YA tiene todo lo necesario: TokenRefreshView en backend/core/urls.py línea 36 (POST /token/refresh/), login en MyTokenObtainPairView (backend/core/views.py líneas 15-16)
- SIMPLE_JWT en backend/backend/settings.py líneas 199-202 solo define ACCESS_TOKEN_LIFETIME=1 día
- Frontend: AuthContext.tsx guarda token+refreshToken en localStorage al login (líneas 32-33) pero solo revisa "existe token" al cargar (líneas 19-27), sin validar expiración
- frontend/src/services/api.ts ya tiene una función refreshToken() (línea 49-50) sin usar en ningún lado
- El interceptor de response actual (api.ts líneas 34-43) en un 401 solo borra el token de localStorage; la redirección a /login está comentada (línea 39) -> por eso el usuario se queda "atascado" viendo una vista rota en vez de ser mandado al login
- ProtectedRoute en frontend/src/App.tsx líneas 24-40 depende de isAuthenticated de React state, que no se actualiza cuando el interceptor borra el token

Enfoque:
1. Interceptor de response en api.ts: al recibir 401, intentar POST /token/refresh/ con el refreshToken guardado; si funciona, guardar el nuevo access y reintentar la petición original; si falla, limpiar localStorage y hacer window.location.href = '/login' de inmediato
2. Manejar concurrencia: si varias peticiones fallan con 401 a la vez, que compartan una sola llamada de refresh en curso en vez de disparar varias
3. AuthContext.tsx: al montar la app, si hay token pero ya expiró (decodificar el JWT localmente, campo exp), intentar refresh antes de marcar isAuthenticated=true; si falla, ir a /login sin mostrar ninguna vista protegida
4. Verificar: sesión se renueva sola sin que el usuario note nada; si el refresh token también está vencido/inválido, se redirige a /login de inmediato sin vistas rotas intermedias
5. Una vez verificado, marcar el Plan 04 como ✅ Completado en planes/README.md (tabla "Autenticación" y tabla "Skills y Modelos Recomendados")
```

> Skill recomendado: Ninguno específico — es lógica de interceptores HTTP y contexto de auth, sin componente visual nuevo.
> Modelo recomendado: **Sonnet** (cambio acotado y bien definido sobre un flujo de auth ya existente, sin diseño de arquitectura nueva).
