"""Cálculos contables compartidos por Reportes y Tesorería.

Convenciones (las mismas de todo el sistema):
- Precios de venta (DetallePedido.total_venta) CON IVA incluido (precio de boleta).
- Costos de compra (DetalleFactura, DetallePedido.total_costo) NETOS, sin IVA.

IVA (como en el Formulario 29): el débito sale de las VENTAS del mes y el
crédito de las COMPRAS del mes (facturas de proveedor, menos sus notas de
crédito, más el anticipo de IVA de la carne, más el IVA de gastos con factura). No del costo de lo vendido: la
mercadería comprada este mes da crédito este mes aunque se venda el próximo.
Si el crédito supera al débito queda remanente para el mes siguiente.
"""
from decimal import Decimal

from django.db.models import DecimalField, OuterRef, Subquery, Sum
from django.db.models.functions import Coalesce, TruncMonth

from .models import (AjusteInventario, ConfiguracionContable, DetalleFactura,
                     DetallePedido, Factura, Gasto, NotaCredito)

CERO = Decimal('0')


def factor_iva(config=None):
    """1 + tasa de IVA configurada (1,19 con el 19%)."""
    config = config or ConfiguracionContable.actual()
    return 1 + Decimal(str(config.tasa_iva)) / 100


def _rango(qs, campo, desde=None, hasta=None):
    if desde:
        qs = qs.filter(**{f'{campo}__gte': desde})
    if hasta:
        qs = qs.filter(**{f'{campo}__lte': hasta})
    return qs


def lineas_venta(desde=None, hasta=None):
    """Líneas que cuentan como venta: sin pedidos Anulados ni líneas Canceladas."""
    qs = DetallePedido.objects.exclude(pedido__estado="Anulado").exclude(estado="Cancelado")
    return _rango(qs, 'fecha', desde, hasta)


def mermas_valorizadas(desde=None, hasta=None):
    """Itera (merma, kilos, valor_neto).

    Valor = kilos * costo/kg NETO de la última compra del producto. Las mermas
    registradas solo en piezas se estiman con el peso promedio por pieza de esa
    misma compra (antes valían $0)."""
    ultima_compra = DetalleFactura.objects.filter(
        producto=OuterRef('producto')).order_by('-factura__fecha', '-id')
    mermas = (
        AjusteInventario.objects.filter(tipo='merma')
        .annotate(
            costo_unit=Coalesce(
                Subquery(ultima_compra.values('costo_por_kilo')[:1],
                         output_field=DecimalField(max_digits=10, decimal_places=2)),
                CERO,
            ),
            compra_kilos=Subquery(ultima_compra.values('cantidad_kilos')[:1],
                                  output_field=DecimalField(max_digits=10, decimal_places=2)),
            compra_unidades=Subquery(ultima_compra.values('cantidad_unidades')[:1],
                                     output_field=DecimalField(max_digits=10, decimal_places=0)),
        )
        .select_related('producto')
    )
    for m in _rango(mermas, 'fecha', desde, hasta):
        kilos = abs(m.cantidad or CERO)
        if kilos == 0 and m.cantidad_unidades and m.compra_unidades:
            kilos = abs(Decimal(m.cantidad_unidades)) * (m.compra_kilos or CERO) / m.compra_unidades
        yield m, kilos, kilos * m.costo_unit


def _por_mes(qs, campo_fecha, **sumas):
    filas = (qs.annotate(mes=TruncMonth(campo_fecha)).values('mes')
             .annotate(**{k: Coalesce(Sum(v), CERO) for k, v in sumas.items()}))
    return {f['mes'].strftime('%Y-%m'): f for f in filas if f['mes']}


def resumen_mensual(desde=None, hasta=None):
    """Una fila por mes con ventas, costo, IVA (con remanente), gastos, mermas,
    utilidad y la estimación de impuesto a la renta y PPM.

    El remanente de IVA arrastra desde el primer mes con movimiento aunque se
    pida un rango, para que el IVA a pagar de cada mes sea el real."""
    config = ConfiguracionContable.actual()
    tasa_renta = Decimal(str(config.tasa_impuesto_renta)) / 100
    tasa_ppm = Decimal(str(config.tasa_ppm)) / 100
    iva_rate = factor_iva(config)

    ventas = _por_mes(lineas_venta(), 'fecha', ventas='total_venta', costo='total_costo')
    compras = _por_mes(Factura.objects.all(), 'fecha', neto='subtotal', iva='iva', anticipo='anticipo_iva')
    notas = _por_mes(NotaCredito.objects.all(), 'fecha', neto='neto', iva='iva')
    gastos = _por_mes(Gasto.objects.all(), 'fecha', neto='neto', iva='iva', total='total')
    mermas = {}
    for m, kilos, valor in mermas_valorizadas():
        clave = m.fecha.strftime('%Y-%m')
        mermas[clave] = mermas.get(clave, CERO) + valor

    meses = sorted(set(ventas) | set(compras) | set(notas) | set(gastos) | set(mermas))
    filas = []
    remanente = CERO
    for mes in meses:
        v = ventas.get(mes, {})
        ventas_brutas = v.get('ventas', CERO)
        ventas_netas = ventas_brutas / iva_rate
        iva_debito = ventas_brutas - ventas_netas
        costo = v.get('costo', CERO)

        c, n, g = compras.get(mes, {}), notas.get(mes, {}), gastos.get(mes, {})
        iva_compras = c.get('iva', CERO) - n.get('iva', CERO)
        iva_anticipo = c.get('anticipo', CERO)
        iva_gastos = g.get('iva', CERO)
        iva_credito = iva_compras + iva_anticipo + iva_gastos

        remanente_anterior = remanente
        saldo = iva_debito - iva_credito - remanente_anterior
        iva_a_pagar = max(saldo, CERO)
        remanente = max(-saldo, CERO)

        gastos_netos = g.get('neto', CERO)
        merma = mermas.get(mes, CERO)
        ganancia_bruta = ventas_netas - costo
        utilidad = ganancia_bruta - gastos_netos - merma

        filas.append({
            'mes': mes,
            'ventas_brutas': ventas_brutas,
            'ventas_netas': ventas_netas,
            'costo_ventas': costo,
            'ganancia_bruta': ganancia_bruta,
            'compras_netas': c.get('neto', CERO) - n.get('neto', CERO),
            'notas_credito_neto': n.get('neto', CERO),
            'gastos_netos': gastos_netos,
            'mermas': merma,
            'utilidad': utilidad,
            'iva_debito': iva_debito,
            'iva_credito_compras': iva_compras,
            'iva_credito_anticipo': iva_anticipo,
            'iva_credito_gastos': iva_gastos,
            'iva_credito': iva_credito,
            'remanente_anterior': remanente_anterior,
            'iva_a_pagar': iva_a_pagar,
            'remanente': remanente,
            'ppm': ventas_netas * tasa_ppm,
            'impuesto_renta_mes': max(utilidad, CERO) * tasa_renta,
        })

    def en_rango(mes):
        return (not desde or mes >= desde[:7]) and (not hasta or mes <= hasta[:7])

    return [f for f in filas if en_rango(f['mes'])], config


def resumen_anual(filas, config):
    """Acumulado de las filas por año comercial: el impuesto de primera
    categoría se calcula sobre la utilidad del año, menos los PPM pagados."""
    tasa_renta = Decimal(str(config.tasa_impuesto_renta)) / 100
    anios = {}
    for f in filas:
        a = anios.setdefault(f['mes'][:4], {'anio': f['mes'][:4], 'utilidad': CERO, 'ppm': CERO,
                                             'ventas_netas': CERO, 'gastos_netos': CERO})
        a['utilidad'] += f['utilidad']
        a['ppm'] += f['ppm']
        a['ventas_netas'] += f['ventas_netas']
        a['gastos_netos'] += f['gastos_netos']
    for a in anios.values():
        a['impuesto_estimado'] = max(a['utilidad'], CERO) * tasa_renta
        # Positivo = falta pagar en abril; negativo = devolución.
        a['saldo_abril'] = a['impuesto_estimado'] - a['ppm']
    return sorted(anios.values(), key=lambda a: a['anio'])
