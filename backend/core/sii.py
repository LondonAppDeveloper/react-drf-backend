"""Lectura del Registro de Compras y Ventas (RCV) que se descarga desde sii.cl
(Servicios online > Factura electrónica > Registro de compras y ventas >
Descargar detalles / Descargar resumen). Son CSV separados por ';'.

Tres formatos:
- ventas: una fila por documento emitido (facturas, notas). Las boletas
  normalmente no vienen aquí, solo en el resumen.
- compras: una fila por documento recibido de proveedores. El anticipo de IVA
  de la carne viene en "Otro impuesto" con código 17 o 18.
- resumen: una fila por tipo de documento con cantidad y montos del mes.

El cruce con pedidos y facturas vive aquí para que la vista solo orqueste.
"""
import csv
import io
import re
import unicodedata
from collections import Counter
from datetime import timedelta
from decimal import Decimal

from django.db.models import Sum

from .cartola import parse_fecha
from .models import DocumentoTributario, Factura, NotaCredito, Pedido, TIPOS_DTE

TIPOS_VALIDOS = {t for t, _ in TIPOS_DTE}
CODIGOS_ANTICIPO_CARNE = {17, 18}
TOLERANCIA = Decimal('2')

# Nombre normalizado de la columna en el CSV -> campo. Coincidencia exacta:
# "monto iva" no debe tomar "monto iva no recuperable".
COLUMNAS = {
    'tipo': ['tipo doc', 'tipo documento', 'tipo dte'],
    'folio': ['folio'],
    'fecha': ['fecha docto', 'fecha documento', 'fecha emision'],
    'rut': ['rut cliente', 'rut proveedor', 'rut receptor'],
    'razon_social': ['razon social'],
    'exento': ['monto exento'],
    'neto': ['monto neto'],
    'iva': ['monto iva', 'monto iva recuperable'],
    'total': ['monto total'],
    'cantidad': ['total documentos'],
    'codigo_otro': ['codigo otro impuesto', 'codigo otro imp'],
    'valor_otro': ['valor otro impuesto', 'valor otro imp'],
}


def filtro_mes(campo, mes):
    """'2026-10' -> {'campo__year': 2026, 'campo__month': 10}"""
    anio, m = mes.split('-')
    return {f'{campo}__year': int(anio), f'{campo}__month': int(m)}


def _norm(texto):
    texto = unicodedata.normalize('NFKD', str(texto or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', ' ', texto.lower()).strip()


def normalizar_rut(rut):
    return re.sub(r'[^0-9K]', '', str(rut or '').upper()).lstrip('0')


def _monto(valor):
    s = re.sub(r'[^\d-]', '', str(valor or '').split(',')[0])
    return Decimal(s) if s not in ('', '-') else Decimal('0')


def _entero(valor):
    m = re.findall(r'\d+', str(valor or ''))
    return int(m[-1]) if m else None


def _decodificar(contenido):
    for codificacion in ('utf-8-sig', 'latin-1'):
        try:
            return contenido.decode(codificacion)
        except UnicodeDecodeError:
            continue
    raise ValueError('No se pudo leer el archivo')


def leer_rcv(contenido, nombre_archivo=''):
    """bytes del CSV -> {'tipo': ventas|compras|resumen, 'mes': 'YYYY-MM', 'filas': [dict]}"""
    texto = _decodificar(contenido)
    separador = ';' if texto.count(';') >= texto.count(',') else ','
    filas = list(csv.reader(io.StringIO(texto), delimiter=separador))

    encabezado_idx = next((i for i, f in enumerate(filas[:20])
                           if {'folio', 'total documentos'} & {_norm(c) for c in f}), None)
    if encabezado_idx is None:
        raise ValueError('No parece un archivo del Registro de Compras y Ventas del SII '
                         '(no se encontró la columna Folio ni Total Documentos)')
    encabezado = [_norm(c) for c in filas[encabezado_idx]]
    mapa = {}
    for campo, nombres in COLUMNAS.items():
        for nombre in nombres:
            if nombre in encabezado:
                mapa[campo] = encabezado.index(nombre)
                break

    if 'cantidad' in mapa:
        tipo = 'resumen'
    elif 'rut proveedor' in encabezado:
        tipo = 'compras'
    elif 'rut cliente' in encabezado:
        tipo = 'ventas'
    else:
        raise ValueError('No se reconoce si el archivo es de ventas o de compras')
    if tipo != 'resumen' and not {'tipo', 'folio', 'total'} <= set(mapa):
        raise ValueError('Al archivo le faltan columnas (Tipo Doc, Folio o Monto Total)')

    resultado = []
    for f in filas[encabezado_idx + 1:]:
        if not any(c.strip() for c in f):
            continue
        celda = lambda campo: f[mapa[campo]] if campo in mapa and mapa[campo] < len(f) else ''
        fila = {
            'tipo': _entero(celda('tipo')),
            'folio': _entero(celda('folio')),
            'fecha': parse_fecha(celda('fecha').strip()),
            'rut': celda('rut').strip(),
            'razon_social': celda('razon_social').strip(),
            'exento': _monto(celda('exento')),
            'neto': _monto(celda('neto')),
            'iva': _monto(celda('iva')),
            'total': _monto(celda('total')),
            'cantidad': _entero(celda('cantidad')) or 0,
            'codigo_otro': _entero(celda('codigo_otro')),
            'valor_otro': _monto(celda('valor_otro')),
        }
        if fila['tipo'] is None or (tipo != 'resumen' and fila['folio'] is None):
            continue  # filas de totales o notas al pie
        resultado.append(fila)

    return {'tipo': tipo, 'mes': _mes(resultado, nombre_archivo), 'filas': resultado}


def _mes(filas, nombre_archivo):
    meses = Counter(f['fecha'].strftime('%Y-%m') for f in filas if f['fecha'])
    if meses:
        return meses.most_common(1)[0][0]
    m = re.search(r'(20\d{2})(0[1-9]|1[0-2])', nombre_archivo or '')
    return f'{m.group(1)}-{m.group(2)}' if m else ''


# --- Ventas -----------------------------------------------------------------

def buscar_pedido(doc):
    """El pedido que corresponde a un documento de venta, si hay uno solo
    candidato: mismo RUT de cliente, mismo total (±$2) y vendido entre 60 días
    antes y 3 días después de la emisión, sin otro documento ya asociado."""
    if doc.tipo not in (33, 34, 39, 41) or not doc.fecha_emision:
        return None
    desde, hasta = doc.fecha_emision - timedelta(days=60), doc.fecha_emision + timedelta(days=3)
    candidatos = (Pedido.objects.exclude(estado='Anulado')
                  .filter(fecha__date__gte=desde, fecha__date__lte=hasta,
                          total__gte=doc.total - TOLERANCIA, total__lte=doc.total + TOLERANCIA)
                  .exclude(documentos__tipo__in=[33, 34, 39, 41])
                  .select_related('cliente'))
    rut = normalizar_rut(doc.rut_receptor)
    if rut:
        candidatos = [p for p in candidatos if normalizar_rut(p.cliente.rut) == rut]
    else:
        candidatos = list(candidatos)
    return candidatos[0] if len(candidatos) == 1 else None


def importar_ventas(filas, importacion, usuario):
    nuevos = actualizados = asociados = 0
    fechas_corregidas = []
    for f in filas:
        if f['tipo'] not in TIPOS_VALIDOS:
            continue
        datos = {
            'fecha_emision': f['fecha'], 'rut_receptor': f['rut'], 'razon_social': f['razon_social'],
            'exento': f['exento'], 'neto': f['neto'], 'iva': f['iva'], 'total': f['total'],
            'origen': 'sii', 'importacion': importacion,
        }
        doc = DocumentoTributario.objects.filter(tipo=f['tipo'], folio=f['folio']).first()
        if doc:
            # El SII manda: si se había registrado a mano con otra fecha, queda la
            # del SII y se informa.
            if doc.fecha_emision != f['fecha']:
                fechas_corregidas.append({'tipo': doc.tipo, 'folio': doc.folio,
                                          'antes': str(doc.fecha_emision), 'sii': str(f['fecha'])})
            for k, v in datos.items():
                setattr(doc, k, v)
            doc.save()
            actualizados += 1
        else:
            doc = DocumentoTributario(tipo=f['tipo'], folio=f['folio'], usuario=usuario, **datos)
            nuevos += 1
        if not doc.pedido_id:
            doc.pedido = buscar_pedido(doc)
            asociados += bool(doc.pedido)
        doc.save()
    return {'nuevos': nuevos, 'actualizados': actualizados, 'asociados': asociados,
            'fechas_corregidas': fechas_corregidas}


def resumen_boletas(filas, mes):
    """Compara el resumen del SII (por tipo de documento) con lo registrado aquí."""
    tipos = []
    for f in filas:
        if f['tipo'] not in TIPOS_VALIDOS:
            continue
        registrado = DocumentoTributario.objects.filter(tipo=f['tipo'], **filtro_mes('fecha_emision', mes))
        agg = registrado.aggregate(total=Sum('total'))
        tipos.append({
            'tipo': f['tipo'], 'cantidad_sii': f['cantidad'], 'total_sii': f['total'],
            'neto_sii': f['neto'], 'iva_sii': f['iva'],
            'cantidad_registrada': registrado.count(), 'total_registrado': agg['total'] or Decimal('0'),
        })
    return {'mes': mes, 'tipos': tipos}


# --- Compras ----------------------------------------------------------------

def cruzar_compras(filas, mes):
    """Compara el registro de compras del SII con las facturas de proveedor del
    sistema. No crea nada: solo informa diferencias. Completa el RUT del
    proveedor cuando falta y la factura calza por folio."""
    encontradas = set()
    calzan = 0
    faltan_en_sistema, diferencias, ruts_completados = [], [], []
    for f in filas:
        base = {'tipo': f['tipo'], 'folio': f['folio'], 'fecha': str(f['fecha'] or ''),
                'rut': f['rut'], 'razon_social': f['razon_social'], 'total_sii': f['total']}
        anticipo_sii = f['valor_otro'] if f['codigo_otro'] in CODIGOS_ANTICIPO_CARNE else Decimal('0')

        if f['tipo'] == 61:
            nc = NotaCredito.objects.filter(numero=str(f['folio'])).first()
            if not nc:
                faltan_en_sistema.append(base)
            elif abs(nc.total - f['total']) > TOLERANCIA:
                diferencias.append({**base, 'total_sistema': nc.total, 'motivo': 'Total distinto'})
            continue
        if f['tipo'] not in (33, 34, 46):
            continue

        rut = normalizar_rut(f['rut'])
        candidatas = [fa for fa in Factura.objects.filter(numero_factura=str(f['folio'])).select_related('proveedor')
                      if not fa.proveedor.rut or normalizar_rut(fa.proveedor.rut) == rut]
        if not candidatas:
            faltan_en_sistema.append({**base, 'anticipo_sii': anticipo_sii})
            continue
        factura = candidatas[0]
        encontradas.add(factura.pk)
        if not factura.proveedor.rut and rut:
            factura.proveedor.rut = f['rut']
            factura.proveedor.save(update_fields=['rut'])
            ruts_completados.append({'proveedor': factura.proveedor.nombre, 'rut': f['rut']})
        motivos = []
        if abs(factura.total - f['total']) > TOLERANCIA:
            motivos.append('Total distinto')
        if abs(factura.anticipo_iva - anticipo_sii) > TOLERANCIA:
            motivos.append('Anticipo IVA carne distinto')
        if motivos:
            diferencias.append({**base, 'total_sistema': factura.total, 'anticipo_sii': anticipo_sii,
                                'anticipo_sistema': factura.anticipo_iva, 'motivo': ' y '.join(motivos)})
        else:
            calzan += 1

    faltan_en_sii = []
    if mes:
        for fa in Factura.objects.filter(**filtro_mes('fecha', mes)).exclude(pk__in=encontradas).select_related('proveedor'):
            faltan_en_sii.append({'folio': fa.numero_factura, 'fecha': str(fa.fecha),
                                  'proveedor': fa.proveedor.nombre, 'total_sistema': fa.total})
    return {
        'mes': mes, 'filas': len(filas), 'calzan': calzan,
        'faltan_en_sistema': faltan_en_sistema, 'faltan_en_sii': faltan_en_sii,
        'diferencias': diferencias, 'ruts_completados': ruts_completados,
    }
