# Plan: Movimientos de Inventario — Columna Vendedor en Salidas y Exportación a Excel

## Objetivo
En la pestaña "Salidas (Pedidos)" de Movimientos de Inventario, mostrar qué vendedor generó cada salida; y agregar un botón para descargar un Excel con el detalle de entradas y salidas (con toda su información: producto, cantidades, precios, cliente/proveedor y, en salidas, vendedor), para poder llevar el registro fuera del sistema.

## Contexto
- Página: [frontend/src/pages/MovimientosInventario.tsx](../frontend/src/pages/MovimientosInventario.tsx), dos tabs: "Entradas (Facturas)" y "Salidas (Pedidos)" ([líneas 154-163](../frontend/src/pages/MovimientosInventario.tsx)), alimentadas por `getDetalleFacturas()` y `getDetallePedidos()` ([líneas 38-46](../frontend/src/pages/MovimientosInventario.tsx)).
- **El dato de vendedor ya viaja desde el backend**: `DetallePedidoSerializer` ([backend/core/serializers.py:58-67](../backend/core/serializers.py)) ya expone `vendedor_nombre = serializers.ReadOnlyField(source='pedido.vendedor.nombre')` (línea 61) — el endpoint `GET /inventario/detalle-pedidos/` (`DetallePedidosList`, [backend/core/views.py:744-749](../backend/core/views.py)) ya lo devuelve en cada fila de salida. **No hace falta ningún cambio de backend para la columna de vendedor**, solo falta pintarla en la tabla.
- La tabla actual ([MovimientosInventario.tsx:171-211](../frontend/src/pages/MovimientosInventario.tsx)) tiene columnas: ID, Cliente/Proveedor, Producto, Unidades, Kilos, Precio/Kg, Total — compartidas entre ambas tabs (la misma `<Table>` renderiza `filteredData` sea cual sea la tab activa). La columna Vendedor debe agregarse **solo quando `activeTab === 'salidas'`** (en entradas no aplica, es un dato de compra a un proveedor).
- No existe hoy ninguna librería de generación de Excel en el proyecto: `frontend/package.json` no tiene `xlsx`/`exceljs`, y no hay endpoint de exportación en el backend. Sí existen `jspdf`/`jspdf-autotable` para PDF, pero el usuario pidió explícitamente Excel.
- `filteredData` ([MovimientosInventario.tsx:60-84](../frontend/src/pages/MovimientosInventario.tsx)) ya tiene la lógica de filtrado unificada entre ambas tabs — es la fuente ideal para alimentar la exportación (exportar exactamente lo que se está viendo filtrado, no todo el dataset crudo).
- Nota de calidad de código existente (no introducida por este plan, pero visible en el archivo): hay un `console.log` de debug en el render ([línea 189](../frontend/src/pages/MovimientosInventario.tsx), dentro del `.map` de filas) y hay dos accesos inconsistentes a nombre de producto (`item.producto_nombre || item.producto.nombre`, línea 191) — no es necesario tocarlos para este plan, pero conviene no copiar ese patrón en el código nuevo.

## Funcionalidades requeridas

### 1. Columna "Vendedor" en la tabla de Salidas
- Agregar una columna `Vendedor` a la tabla ([MovimientosInventario.tsx:171-211](../frontend/src/pages/MovimientosInventario.tsx)), mostrada condicionalmente según `activeTab`: en `entradas` se puede dejar vacía esa celda o directamente no mostrar la columna (ajustar el header también condicionalmente si se opta por ocultarla en vez de dejarla en blanco).
- Leer el valor de `item.vendedor_nombre`, ya presente en la respuesta de `getDetallePedidos()`.

### 2. Exportación a Excel
- Agregar la librería `xlsx` (SheetJS) al frontend — es la opción estándar para generar `.xlsx` en el navegador sin backend, y evita tener que montar un endpoint nuevo de exportación en Django.
- Agregar un botón "Exportar a Excel" en la barra de la tabla (junto al contador "Mostrando N registros", [línea 165-167](../frontend/src/pages/MovimientosInventario.tsx)) que genere un archivo `.xlsx` a partir de `filteredData` (respetando los filtros aplicados) con las columnas visibles de la tab activa, incluyendo Vendedor en salidas.
- Nombre de archivo sugerido: `movimientos-{entradas|salidas}-{fecha}.xlsx`.
- Evaluar si el botón debe exportar solo la tab activa o generar un único archivo con dos hojas (una por "Entradas" y otra por "Salidas") — la opción de dos hojas da un archivo más útil de una sola vez sin obligar a exportar dos veces; a confirmar con el usuario cuál prefiere.

## Pasos de implementación
1. Frontend: instalar `xlsx` (`npm install xlsx` en `frontend/`).
2. Frontend: agregar la columna `Vendedor` a la tabla de `MovimientosInventario.tsx`, condicional a `activeTab === 'salidas'`.
3. Frontend: implementar la función de exportación (ej. `exportarExcel()`) usando `xlsx` para transformar `filteredData` (o `{ entradas, salidas }` completos si se opta por dos hojas) en un `workbook` y descargarlo con `XLSX.writeFile()`.
4. Frontend: agregar el botón "Exportar a Excel" en la barra superior de la tabla.
5. Verificación manual: aplicar varios filtros en ambas tabs, exportar, y confirmar que el Excel descargado refleja exactamente los datos filtrados visibles (incluida la columna Vendedor en salidas), abriendo el archivo en Excel/LibreOffice/Google Sheets para confirmar que no hay columnas corridas ni datos faltantes.

## Consideraciones técnicas
- No se necesita ningún endpoint nuevo de backend: `DetallePedidoSerializer` ya expone `vendedor_nombre`, y la generación del `.xlsx` puede hacerse enteramente en el navegador con los datos que ya se cargan hoy vía `getDetalleFacturas()`/`getDetallePedidos()`.
- Si el volumen de movimientos llega a ser muy grande en el futuro, generar el Excel client-side puede volverse lento — no es un problema hoy dado que ambos endpoints ya traen el dataset completo sin paginación para alimentar la tabla en pantalla.
- Aprovechar el trabajo de este plan para también limpiar el `console.log` de la línea 189 y 64 de `MovimientosInventario.tsx` si se está tocando ese archivo de todas formas (no es parte del alcance pedido, pero es una limpieza trivial de bajo riesgo en el mismo archivo).

## Complejidad: Baja-Media
## Dependencias: Ninguna

---

## Cómo ejecutar este plan

```
Implementa el Plan 09 (Movimientos de Inventario — Columna Vendedor en Salidas + Exportación a Excel) de planes/09-inventario-vendedor-excel.md

Contexto:
- Página: frontend/src/pages/MovimientosInventario.tsx, tabs Entradas/Salidas (líneas 154-163), tabla compartida en líneas 171-211, alimentada por filteredData (lógica de filtrado en líneas 60-84)
- El backend YA expone vendedor_nombre en cada salida: DetallePedidoSerializer en backend/core/serializers.py línea 61 (source='pedido.vendedor.nombre'), servido por GET /inventario/detalle-pedidos/ (DetallePedidosList, backend/core/views.py líneas 744-749) -- NO requiere cambios de backend
- No existe librería de Excel en el proyecto (frontend/package.json no tiene xlsx/exceljs); sí existen jspdf/jspdf-autotable para PDF pero el usuario pidió Excel específicamente
- filteredData ya respeta los filtros aplicados por el usuario -- usarlo como fuente de la exportación, no el dataset crudo sin filtrar

Enfoque:
1. npm install xlsx en frontend/
2. Agregar columna "Vendedor" a la tabla, mostrada solo cuando activeTab === 'salidas', leyendo item.vendedor_nombre
3. Implementar función de exportación con la librería xlsx que tome filteredData (o ambos datasets completos si se decide una sola descarga con 2 hojas: Entradas y Salidas) y genere un archivo movimientos-{tab}-{fecha}.xlsx
4. Agregar botón "Exportar a Excel" junto al contador de registros (línea 165-167)
5. Verificar: exportar con filtros aplicados en ambas tabs y confirmar que el archivo generado coincide con lo que se ve en pantalla, incluida la columna Vendedor en salidas
6. Una vez verificado, marcar el Plan 09 como ✅ Completado en planes/README.md (tabla "Inventario" y tabla "Skills y Modelos Recomendados")
```

> Skill recomendado: Ninguno específico — es una tarea de datos/exportación sin componente visual complejo; `/impeccable` puede pulir la ubicación del botón si se quiere.
> Modelo recomendado: **Sonnet** (integración de una librería estándar + una columna nueva sobre datos ya disponibles, sin lógica de negocio nueva).
