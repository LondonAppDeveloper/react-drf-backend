FROM python:3.13.0-alpine3.20

ENV PYTHONUNBUFFERED 1
ENV PATH="/py/bin:$PATH"

# Instalación de dependencias del sistema
RUN python -m venv /py && \
    /py/bin/pip install --upgrade pip && \
    apk add --update --upgrade --no-cache postgresql-client && \
    apk add --update --upgrade --no-cache --virtual .tmp \
        build-base postgresql-dev

# Instalación de requerimientos
COPY ./requirements.txt /requirements.txt
RUN /py/bin/pip install -r /requirements.txt && apk del .tmp

# --- AQUÍ ESTÁ EL CAMBIO DE RUTAS ---
# Nos paramos en la raíz del contenedor
WORKDIR /app

# Copiamos el contenido de la carpeta backend de tu PC a la raíz /app del contenedor
COPY ./backend/ .

# Exponemos el puerto dinámico
EXPOSE 8000

# El primer 'backend' es la carpeta, el segundo 'wsgi' es el archivo
# Usamos rutas completas al entorno virtual para evitar fallos de PATH
CMD ["sh", "-c", "/py/bin/python manage.py migrate --noinput ; exec /py/bin/gunicorn backend.wsgi:application --bind 0.0.0.0:$PORT --log-level debug --access-logfile -"]