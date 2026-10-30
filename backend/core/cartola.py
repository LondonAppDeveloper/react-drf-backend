"""Lectura de cartolas bancarias en cualquier formato.

Cada banco exporta distinto (columnas, nombres, fechas, montos con puntos o
comas, cargos y abonos en una o dos columnas), así que en vez de un parser por
banco se detectan las columnas por su encabezado y, si no hay encabezado
reconocible, por su contenido.

- Planillas (xlsx/xls/csv): el frontend las convierte a una grilla de celdas
  con SheetJS y aquí se interpretan (``normalizar_filas``).
- PDF u otros: se mandan a Claude (``extraer_con_ia``), si hay ANTHROPIC_API_KEY.

Los movimientos se identifican con una ``huella`` estable (fecha, monto,
descripción normalizada y n° de ocurrencia dentro del archivo) para que subir
dos veces la misma cartola, o cartolas que se traslapan, no duplique nada.
"""
import base64
import hashlib
import json
import os
import re
import unicodedata
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

MESES = {
    'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'ago': 8, 'sep': 9, 'set': 9, 'oct': 10, 'nov': 11, 'dic': 12,
}

CLAVES = {
    'fecha': ('fecha', 'date', 'fec'),
    'descripcion': ('descripcion', 'detalle', 'glosa', 'concepto', 'movimiento', 'transaccion', 'description', 'nombre'),
    'cargo': ('cargo', 'debito', 'debe', 'giro', 'egreso', 'retiro', 'salida'),
    'abono': ('abono', 'credito', 'haber', 'deposito', 'ingreso', 'entrada'),
    'monto': ('monto', 'importe', 'valor', 'amount'),
    'saldo': ('saldo', 'balance'),
    'documento': ('documento', 'doc', 'nro', 'numero', 'serie', 'referencia', 'operacion', 'n°'),
}


def _norm(texto):
    texto = unicodedata.normalize('NFKD', str(texto or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', texto).strip().lower()


def normalizar_descripcion(texto):
    return re.sub(r'[^A-Z0-9]', '', _norm(texto).upper())


def parse_monto(valor):
    """'1.234.567' / '-1.234' / '$ 1.234,50' / '(5.000)' / 12345.0 -> Decimal o None."""
    if valor is None or valor == '':
        return None
    if isinstance(valor, (int, float, Decimal)):
        return Decimal(str(valor))
    s = str(valor).strip()
    negativo = (s.startswith('(') and s.endswith(')')) or bool(re.match(r'^[^\d]*-', s)) or s.endswith('-')
    s = re.sub(r'[^\d.,]', '', s)
    if not s or not re.search(r'\d', s):
        return None
    if '.' in s and ',' in s:
        # El último separador es el decimal.
        if s.rfind(',') > s.rfind('.'):
            s = s.replace('.', '').replace(',', '.')
        else:
            s = s.replace(',', '')
    elif ',' in s:
        partes = s.split(',')
        s = s.replace(',', '.') if len(partes) == 2 and len(partes[1]) <= 2 else s.replace(',', '')
    elif '.' in s:
        partes = s.split('.')
        # "1.234.567" o "12.345" son miles en Chile; "12.5" es decimal.
        if not (len(partes) == 2 and len(partes[1]) <= 2):
            s = s.replace('.', '')
    try:
        monto = Decimal(s)
    except InvalidOperation:
        return None
    return -monto if negativo else monto


def parse_fecha(valor, anio_por_defecto=None):
    if valor is None or valor == '':
        return None
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    if isinstance(valor, (int, float)) and 20000 < float(valor) < 80000:
        # Número de serie de Excel.
        return date(1899, 12, 30) + timedelta(days=int(valor))
    s = _norm(valor)
    m = re.match(r'^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})', s)
    if m:
        a, mes, d = map(int, m.groups())
    else:
        m = re.match(r'^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b', s)
        if m:
            d, mes = int(m.group(1)), int(m.group(2))
            a = int(m.group(3)) if m.group(3) else anio_por_defecto
        else:
            m = re.match(r'^(\d{1,2})[ -/]?([a-z]{3})[a-z]*[ -/]?(\d{2,4})?', s)
            if not m or m.group(2) not in MESES:
                return None
            d, mes = int(m.group(1)), MESES[m.group(2)]
            a = int(m.group(3)) if m.group(3) else anio_por_defecto
    if a is None:
        a = date.today().year
    if a < 100:
        a += 2000
    try:
        return date(a, mes, d)
    except ValueError:
        return None


def _detectar_encabezado(filas):
    mejor, mejor_puntaje, mejor_mapa = None, 0, {}
    for i, fila in enumerate(filas[:40]):
        mapa = {}
        for j, celda in enumerate(fila):
            texto = _norm(celda)
            if not texto or len(texto) > 40:
                continue
            for campo, claves in CLAVES.items():
                if campo in mapa:
                    continue
                if any(texto == c or texto.startswith(c) or f' {c}' in f' {texto}' for c in claves):
                    mapa[campo] = j
                    break
        puntaje = len(mapa)
        if 'fecha' in mapa and puntaje >= 2 and puntaje > mejor_puntaje:
            mejor, mejor_puntaje, mejor_mapa = i, puntaje, mapa
    return mejor, mejor_mapa


def _inferir_columnas(filas):
    """Sin encabezado: la columna con más fechas es la fecha, la de texto más
    variado la descripción, y las numéricas cargo/abono/saldo o monto/saldo."""
    ancho = max((len(f) for f in filas), default=0)
    fechas, numeros, textos = [0] * ancho, [0] * ancho, [set() for _ in range(ancho)]
    for fila in filas:
        for j, celda in enumerate(fila):
            if celda in (None, ''):
                continue
            if parse_fecha(celda):
                fechas[j] += 1
            elif parse_monto(celda) is not None and not re.search(r'[a-zA-Z]{3}', str(celda)):
                numeros[j] += 1
            else:
                textos[j].add(_norm(celda))
    if not ancho or max(fechas) == 0:
        return {}
    mapa = {'fecha': fechas.index(max(fechas))}
    candidatas_texto = [j for j in range(ancho) if j != mapa['fecha']]
    if candidatas_texto:
        mapa['descripcion'] = max(candidatas_texto, key=lambda j: len(textos[j]))
    umbral = max(1, len(filas) // 5)
    num = [j for j in range(ancho) if numeros[j] >= umbral and j not in mapa.values()]
    if len(num) >= 3:
        mapa.update(cargo=num[-3], abono=num[-2], saldo=num[-1])
    elif len(num) == 2:
        mapa.update(monto=num[0], saldo=num[1])
    elif len(num) == 1:
        mapa['monto'] = num[0]
    return mapa


def huella(fecha, monto, descripcion, ocurrencia):
    base = f"{fecha.isoformat()}|{Decimal(monto).quantize(Decimal('0.01'))}|{normalizar_descripcion(descripcion)}|{ocurrencia}"
    return hashlib.sha256(base.encode()).hexdigest()


def asignar_huellas(movimientos):
    """Agrega 'huella' a cada movimiento. Dos movimientos idénticos el mismo día
    (dos transferencias iguales) se distinguen por su orden de aparición."""
    vistos = {}
    for m in movimientos:
        clave = (m['fecha'], Decimal(m['monto']), normalizar_descripcion(m['descripcion']))
        vistos[clave] = vistos.get(clave, 0) + 1
        m['huella'] = huella(m['fecha'], m['monto'], m['descripcion'], vistos[clave])
    return movimientos


def normalizar_filas(filas):
    """Grilla de celdas -> (movimientos, columnas_detectadas). Lanza ValueError
    si no se reconoce la estructura."""
    filas = [list(f) for f in filas if any(c not in (None, '') for c in f)]
    idx, mapa = _detectar_encabezado(filas)
    datos = filas[idx + 1:] if idx is not None else filas
    if idx is None or not ({'monto', 'cargo', 'abono'} & set(mapa)):
        mapa = {**_inferir_columnas(datos), **(mapa if idx is not None else {})}
    if 'fecha' not in mapa or not ({'monto', 'cargo', 'abono'} & set(mapa)):
        raise ValueError('No se reconocieron las columnas de fecha y monto de la cartola')

    def celda(fila, campo):
        j = mapa.get(campo)
        return fila[j] if j is not None and j < len(fila) else None

    # Año para fechas sin año ("12/03"): el más común entre las que sí lo traen.
    anios = [f.year for f in (parse_fecha(celda(r, 'fecha')) for r in datos) if f]
    anio = max(set(anios), key=anios.count) if anios else None

    movimientos = []
    for fila in datos:
        fecha = parse_fecha(celda(fila, 'fecha'), anio)
        if not fecha:
            continue
        descripcion = str(celda(fila, 'descripcion') or '').strip()
        if 'monto' in mapa and 'cargo' not in mapa and 'abono' not in mapa:
            monto = parse_monto(celda(fila, 'monto'))
        else:
            cargo = parse_monto(celda(fila, 'cargo')) or Decimal('0')
            abono = parse_monto(celda(fila, 'abono')) or Decimal('0')
            monto = abs(abono) - abs(cargo) if (cargo or abono) else parse_monto(celda(fila, 'monto'))
        if not monto:
            continue  # filas de saldo inicial, totales, etc.
        if re.search(r'\bsaldo (inicial|anterior|final)\b|^total', _norm(descripcion)):
            continue
        saldo = parse_monto(celda(fila, 'saldo'))
        movimientos.append({
            'fecha': fecha,
            'descripcion': descripcion[:255] or '(sin descripción)',
            'monto': monto,
            'saldo': saldo,
            'documento': str(celda(fila, 'documento') or '').strip()[:60],
        })
    if not movimientos:
        raise ValueError('La cartola no tiene movimientos reconocibles')
    columnas = {campo: _norm(filas[idx][j]) if idx is not None and j < len(filas[idx]) else f'columna {j + 1}'
                for campo, j in mapa.items()}
    return asignar_huellas(movimientos), columnas


ESQUEMA_IA = {
    "type": "object",
    "properties": {
        "banco": {"type": "string"},
        "movimientos": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "fecha": {"type": "string", "description": "YYYY-MM-DD"},
                    "descripcion": {"type": "string"},
                    "monto": {"type": "number", "description": "Positivo si es abono/depósito, negativo si es cargo/giro"},
                    "saldo": {"type": ["number", "null"]},
                    "documento": {"type": "string"},
                },
                "required": ["fecha", "descripcion", "monto", "saldo", "documento"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["banco", "movimientos"],
    "additionalProperties": False,
}

INSTRUCCIONES_IA = (
    "Esta es una cartola (estado de cuenta) de un banco chileno. Extrae TODOS los movimientos, "
    "en el orden en que aparecen, sin inventar ni omitir ninguno. Montos en pesos chilenos: en la "
    "cartola los puntos son separadores de miles. monto positivo = abono/depósito/transferencia "
    "recibida; negativo = cargo/giro/pago/transferencia enviada. No incluyas saldo inicial, saldo "
    "final ni filas de totales. documento = n° de documento u operación, o cadena vacía."
)


def extraer_con_ia(contenido, media_type, nombre_archivo):
    """Manda el archivo a Claude y devuelve (movimientos, banco). Lanza
    RuntimeError si no hay API key configurada o la respuesta no sirve."""
    if not (os.environ.get('ANTHROPIC_API_KEY') or os.environ.get('ANTHROPIC_AUTH_TOKEN')):
        raise RuntimeError(
            'Para leer cartolas en PDF configura ANTHROPIC_API_KEY en el servidor, '
            'o descarga la cartola en Excel/CSV desde el banco.')
    import anthropic

    if media_type == 'application/pdf':
        bloque = {"type": "document", "source": {
            "type": "base64", "media_type": "application/pdf",
            "data": base64.standard_b64encode(contenido).decode()}}
    else:
        texto = contenido.decode('utf-8', errors='replace')
        bloque = {"type": "text", "text": f"Archivo {nombre_archivo}:\n\n{texto}"}

    client = anthropic.Anthropic()
    # Streaming: una cartola larga genera mucha salida. fallbacks="default"
    # reintenta en otro modelo si el primero declina la solicitud.
    with client.beta.messages.stream(
        model="claude-opus-5-5",
        max_tokens=64000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": ESQUEMA_IA}},
        messages=[{"role": "user", "content": [bloque, {"type": "text", "text": INSTRUCCIONES_IA}]}],
    ) as stream:
        respuesta = stream.get_final_message()

    if respuesta.stop_reason == "refusal":
        raise RuntimeError('El análisis automático rechazó el archivo')
    if respuesta.stop_reason == "max_tokens":
        raise RuntimeError('La cartola es demasiado larga para analizarla de una vez; súbela por partes')
    texto = next((b.text for b in respuesta.content if b.type == "text"), '')
    try:
        datos = json.loads(texto)
    except json.JSONDecodeError:
        raise RuntimeError('No se pudo interpretar la respuesta del análisis automático')

    movimientos = []
    for m in datos.get('movimientos', []):
        fecha = parse_fecha(m.get('fecha'))
        monto = parse_monto(m.get('monto'))
        if not fecha or not monto:
            continue
        movimientos.append({
            'fecha': fecha,
            'descripcion': str(m.get('descripcion') or '').strip()[:255] or '(sin descripción)',
            'monto': monto,
            'saldo': parse_monto(m.get('saldo')),
            'documento': str(m.get('documento') or '').strip()[:60],
        })
    if not movimientos:
        raise RuntimeError('No se encontraron movimientos en el archivo')
    return asignar_huellas(movimientos), datos.get('banco', '')
