# TO DO LIST



docker compose up --build backend
alias docker="/mnt/c/Program\ Files/Docker/Docker/resources/bin/docker.exe"

Pasos para borrar y regenerar migraciones

1️⃣ Eliminar las migraciones existentes
Ejecuta este comando para borrar todas las migraciones en la app core:


find core/migrations/ -type f -name "*.py" ! -name "__init__.py" -delete

Esto eliminará todos los archivos de migraciones, excepto __init__.py.

2️⃣ Eliminar la base de datos (opcional)
Si usas SQLite, puedes eliminar el archivo de la base de datos:


rm db.sqlite3
Si usas PostgreSQL o MySQL, puedes dropear todas las tablas manualmente desde el cliente SQL o usar


docker compose exec db psql -U usuario -d nombre_base -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"


3️⃣ Crear nuevas migraciones

docker compose exec backend python manage.py makemigrations core


4️⃣ Aplicar las migraciones desde cero


docker compose exec backend python manage.py migrate


5️⃣ (Opcional) Crear un superusuario si usas Django Admin


docker compose exec backend python manage.py createsuperuser


FALTA:

Revisar Anulacion - Fue
Al editar unidades, ver como se calcula el costo- Fue
Alerta de Peso por unidad - OK
Filtrar Pedidos
Peso Promedio por unidad en stock - OK
Editar Precios Productos - OK
Estado Producto Desactivado - OK
Vistas de Flujos Entrada-Salida - OK
Editar Clientes
Marcar Pagadas Facturas
Conexion SII
Adelantos
Pagos y Deuda
Ganancias
Ajustes de inventario - kilos tambien
Analisis de datos
Margenes por producto



