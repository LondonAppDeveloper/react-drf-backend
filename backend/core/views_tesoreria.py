"""Tesorería: cartolas bancarias, conciliación con pedidos/facturas, gastos y
contabilidad (IVA, utilidad, impuesto a la renta estimado)."""
from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Count, Prefetch, Sum
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .cartola import asignar_huellas, extraer_con_ia, normalizar_filas, parse_fecha, parse_monto
from .contabilidad import factor_iva, resumen_anual, resumen_mensual
from .models import (CATEGORIAS_GASTO, CATEGORIAS_MOVIMIENTO, AsignacionMovimiento, Cartola, Cobro,
                     ConfiguracionContable, Factura, Gasto, MovimientoBancario, Pedido)

def _error(mensaje, codigo=status.HTTP_400_BAD_REQUEST):
    return Response({'error': mensaje}, status=codigo)


def _decimal(valor, nombre):
    try:
        return Decimal(str(valor).replace(',', '.'))
    except (InvalidOperation, ValueError):
        raise ValueError(f'{nombre} no es un número válido')


def _movimiento_json(m):
    asignado = sum((a.monto for a in m.asignaciones.all()), Decimal('0'))
    return {
        'id': m.id,
        'fecha': m.fecha.isoformat(),
        'descripcion': m.descripcion,
        'monto': m.monto,
        'saldo': m.saldo,
        'documento': m.documento,
        'categoria': m.categoria,
        'comentario': m.comentario,
        'cartola': m.cartola_id,
        'asignado': asignado,
        'pendiente': abs(m.monto) - asignado,
        'asignaciones': [{
            'id': a.id,
            'monto': a.monto,
            'pedido': a.pedido_id,
            'pedido_cliente': a.pedido.cliente.nombre if a.pedido_id else None,
            'pedido_total': a.pedido.total if a.pedido_id else None,
            'factura': a.factura_id,
            'factura_proveedor': a.factura.proveedor.nombre if a.factura_id else None,
        } for a in m.asignaciones.all()],
        'gastos': [g.id for g in m.gastos.all()],
    }


def _queryset_movimientos():
    return MovimientoBancario.objects.prefetch_related(
        Prefetch('asignaciones', queryset=AsignacionMovimiento.objects.select_related(
            'pedido__cliente', 'factura__proveedor')),
        'gastos',
    )


def _serializar_previa(movimientos):
    existentes = set(MovimientoBancario.objects.filter(
        huella__in=[m['huella'] for m in movimientos]).values_list('huella', flat=True))
    # Mismo día y monto pero distinta descripción: puede ser el mismo movimiento
    # exportado en otro formato (el banco abrevia distinto el PDF y el Excel).
    fechas = {m['fecha'] for m in movimientos}
    parecidos = set(MovimientoBancario.objects.filter(fecha__in=fechas)
                    .exclude(huella__in=existentes).values_list('fecha', 'monto'))
    salida = []
    for m in movimientos:
        duplicado = m['huella'] in existentes
        salida.append({
            'fecha': m['fecha'].isoformat(),
            'descripcion': m['descripcion'],
            'monto': m['monto'],
            'saldo': m['saldo'],
            'documento': m['documento'],
            'huella': m['huella'],
            'duplicado': duplicado,
            'posible_duplicado': not duplicado and (m['fecha'], Decimal(m['monto']).quantize(Decimal('0.01'))) in parecidos,
        })
    return salida


class AnalizarCartolaView(APIView):
    """Lee una cartola sin guardar nada y devuelve los movimientos detectados,
    marcando los que ya están cargados. Acepta:
      - JSON {filas: [[...], ...], nombre_archivo}: planilla ya convertida a grilla.
      - multipart con 'archivo' (PDF u otro): se analiza con IA."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        archivo = request.FILES.get('archivo')
        try:
            if archivo:
                if archivo.size > 20 * 1024 * 1024:
                    return _error('El archivo pesa más de 20 MB')
                movimientos, banco = extraer_con_ia(
                    archivo.read(), archivo.content_type or '', archivo.name)
                return Response({'metodo': 'ia', 'banco': banco, 'columnas': {},
                                 'movimientos': _serializar_previa(movimientos)})
            filas = request.data.get('filas')
            if not isinstance(filas, list) or not filas:
                return _error('No se recibió el contenido de la cartola')
            movimientos, columnas = normalizar_filas(filas)
            return Response({'metodo': 'planilla', 'banco': '', 'columnas': columnas,
                             'movimientos': _serializar_previa(movimientos)})
        except (ValueError, RuntimeError) as e:
            return _error(str(e))


class ImportarCartolaView(APIView):
    """Guarda los movimientos confirmados de la vista previa. La huella se
    recalcula aquí (no se confía en la del cliente) y la restricción única de la
    base de datos garantiza que no queden duplicados aunque se suba dos veces."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        crudos = request.data.get('movimientos') or []
        movimientos = []
        try:
            for m in crudos:
                fecha = parse_fecha(m.get('fecha'))
                monto = parse_monto(m.get('monto'))
                if not fecha or not monto:
                    raise ValueError('Hay un movimiento sin fecha o monto válido')
                movimientos.append({
                    'fecha': fecha,
                    'descripcion': str(m.get('descripcion') or '')[:255] or '(sin descripción)',
                    'monto': monto,
                    'saldo': parse_monto(m.get('saldo')),
                    'documento': str(m.get('documento') or '')[:60],
                    'incluir': m.get('incluir', True),
                })
        except ValueError as e:
            return _error(str(e))
        if not movimientos:
            return _error('No hay movimientos para importar')

        # Las huellas se asignan sobre TODOS los movimientos del archivo (también
        # los no incluidos) para que el n° de ocurrencia sea el mismo de la previa.
        asignar_huellas(movimientos)
        incluir = [m for m in movimientos if m['incluir'] not in (False, 'false', 0)]

        with transaction.atomic():
            cartola = Cartola.objects.create(
                nombre_archivo=str(request.data.get('nombre_archivo') or 'cartola')[:255],
                banco=str(request.data.get('banco') or '')[:100],
                metodo='ia' if request.data.get('metodo') == 'ia' else 'planilla',
                usuario=request.user,
            )
            existentes = set(MovimientoBancario.objects.filter(
                huella__in=[m['huella'] for m in incluir]).values_list('huella', flat=True))
            nuevos = [MovimientoBancario(
                cartola=cartola, fecha=m['fecha'], descripcion=m['descripcion'], monto=m['monto'],
                saldo=m['saldo'], documento=m['documento'], huella=m['huella'],
            ) for m in incluir if m['huella'] not in existentes]
            MovimientoBancario.objects.bulk_create(nuevos, ignore_conflicts=True)
            creados = MovimientoBancario.objects.filter(cartola=cartola).count()
            cartola.movimientos_nuevos = creados
            cartola.movimientos_duplicados = len(movimientos) - creados
            cartola.save()

        return Response({'cartola': cartola.id, 'nuevos': creados,
                         'omitidos': len(movimientos) - creados}, status=status.HTTP_201_CREATED)


class CartolaListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response([{
            'id': c.id, 'nombre_archivo': c.nombre_archivo, 'banco': c.banco,
            'subida': c.subida, 'metodo': c.metodo,
            'movimientos_nuevos': c.movimientos_nuevos,
            'movimientos_duplicados': c.movimientos_duplicados,
            'movimientos_actuales': c.n,
        } for c in Cartola.objects.annotate(n=Count('movimientos'))])


class CartolaDetailView(APIView):
    """Borrar una cartola borra los movimientos que trajo (y sus asociaciones)."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        cartola = Cartola.objects.filter(pk=pk).first()
        if not cartola:
            return _error('Cartola no encontrada', status.HTTP_404_NOT_FOUND)
        with transaction.atomic():
            cartola.movimientos.all().delete()
            cartola.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MovimientoListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _queryset_movimientos()
        p = request.query_params
        if p.get('desde'):
            qs = qs.filter(fecha__gte=p['desde'])
        if p.get('hasta'):
            qs = qs.filter(fecha__lte=p['hasta'])
        if p.get('categoria'):
            qs = qs.filter(categoria=p['categoria'])
        if p.get('tipo') == 'abonos':
            qs = qs.filter(monto__gt=0)
        elif p.get('tipo') == 'cargos':
            qs = qs.filter(monto__lt=0)
        return Response({
            'movimientos': [_movimiento_json(m) for m in qs],
            'categorias': [{'value': v, 'label': l} for v, l in CATEGORIAS_MOVIMIENTO],
        })


class MovimientoDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        m = _queryset_movimientos().filter(pk=pk).first()
        if not m:
            return _error('Movimiento no encontrado', status.HTTP_404_NOT_FOUND)
        if 'categoria' in request.data:
            if request.data['categoria'] not in dict(CATEGORIAS_MOVIMIENTO):
                return _error('Categoría inválida')
            m.categoria = request.data['categoria']
        if 'comentario' in request.data:
            m.comentario = str(request.data.get('comentario') or '')[:2000]
        m.save()
        return Response(_movimiento_json(m))


class AsignarMovimientoView(APIView):
    """Asocia (parte de) un movimiento a un pedido o a una factura de compra.
    Los abonos van a pedidos (cobros) y los cargos a facturas (pagos)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        m = _queryset_movimientos().filter(pk=pk).first()
        if not m:
            return _error('Movimiento no encontrado', status.HTTP_404_NOT_FOUND)
        pedido_id, factura_id = request.data.get('pedido'), request.data.get('factura')
        if bool(pedido_id) == bool(factura_id):
            return _error('Indica un pedido o una factura')
        try:
            monto = _decimal(request.data.get('monto'), 'El monto')
        except ValueError as e:
            return _error(str(e))
        if monto <= 0:
            return _error('El monto debe ser mayor a 0')
        disponible = abs(m.monto) - m.monto_asignado()
        if monto > disponible + Decimal('0.5'):
            return _error(f'Al movimiento solo le quedan ${disponible:,.0f} sin asociar'.replace(',', '.'))

        with transaction.atomic():
            if pedido_id:
                if m.monto < 0:
                    return _error('Un cargo no puede ser el pago de un pedido')
                pedido = Pedido.objects.filter(pk=pedido_id).first()
                if not pedido or pedido.estado == 'Anulado':
                    return _error('Pedido no encontrado o anulado')
                asignacion = AsignacionMovimiento.objects.create(movimiento=m, pedido=pedido, monto=monto)
                config = ConfiguracionContable.actual()
                Cobro.objects.create(
                    pedido=pedido, fecha=m.fecha, monto=monto, medio='transferencia',
                    receptor=config.receptor_cobro,
                    vendedor=pedido.vendedor if config.receptor_cobro == 'vendedor' else None,
                    asignacion=asignacion, comentario='Desde cartola bancaria', usuario=request.user,
                )
                if m.categoria == 'sin_clasificar':
                    m.categoria = 'venta'
                    m.save(update_fields=['categoria'])
                cobrado = pedido.asignaciones_banco.aggregate(t=Sum('monto'))['t'] or 0
                if request.data.get('marcar_pagado') and cobrado >= pedido.total - Decimal('1'):
                    pedido.estado = 'Pagado'
                    pedido.save(update_fields=['estado'])
            else:
                if m.monto > 0:
                    return _error('Un abono no puede ser el pago a un proveedor')
                factura = Factura.objects.filter(pk=factura_id).first()
                if not factura:
                    return _error('Factura no encontrada')
                AsignacionMovimiento.objects.create(movimiento=m, factura=factura, monto=monto)
                if m.categoria == 'sin_clasificar':
                    m.categoria = 'proveedor'
                    m.save(update_fields=['categoria'])
                if request.data.get('marcar_pagado') and not hasattr(factura, 'pago_factura'):
                    from .models import PagoFactura
                    PagoFactura.objects.create(factura=factura, fecha_de_pago=m.fecha, monto_del_pago=monto)

        m = _queryset_movimientos().get(pk=pk)
        return Response(_movimiento_json(m), status=status.HTTP_201_CREATED)


class AsignacionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        a = AsignacionMovimiento.objects.filter(pk=pk).first()
        if not a:
            return _error('Asociación no encontrada', status.HTTP_404_NOT_FOUND)
        a.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _gasto_json(g):
    return {
        'id': g.id, 'fecha': g.fecha.isoformat(), 'descripcion': g.descripcion,
        'categoria': g.categoria, 'neto': g.neto, 'iva': g.iva, 'total': g.total,
        'con_factura': g.con_factura, 'movimiento': g.movimiento_id, 'comentario': g.comentario,
    }


def _datos_gasto(data, actual=None):
    """Valida un gasto. Se ingresa el TOTAL pagado; si trae factura se separa el
    IVA (crédito fiscal), si no todo el total es gasto."""
    def campo(k, defecto=None):
        return data[k] if k in data else (getattr(actual, k) if actual else defecto)

    fecha = parse_fecha(campo('fecha'))
    if not fecha:
        raise ValueError('Fecha inválida')
    descripcion = str(campo('descripcion', '') or '').strip()
    if not descripcion:
        raise ValueError('La descripción es obligatoria')
    categoria = campo('categoria', 'otro')
    if categoria not in dict(CATEGORIAS_GASTO):
        raise ValueError('Categoría inválida')
    total = _decimal(campo('total'), 'El total')
    if total <= 0:
        raise ValueError('El total debe ser mayor a 0')
    con_factura = campo('con_factura', False) in (True, 'true', '1', 1)
    neto = (total / factor_iva()).quantize(Decimal('1')) if con_factura else total
    return {
        'fecha': fecha, 'descripcion': descripcion[:255], 'categoria': categoria,
        'total': total, 'neto': neto, 'iva': total - neto, 'con_factura': con_factura,
        'comentario': str(campo('comentario', '') or ''),
        'movimiento_id': campo('movimiento', None) if 'movimiento' in data else (actual.movimiento_id if actual else None),
    }


class GastoListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Gasto.objects.all()
        if request.query_params.get('desde'):
            qs = qs.filter(fecha__gte=request.query_params['desde'])
        if request.query_params.get('hasta'):
            qs = qs.filter(fecha__lte=request.query_params['hasta'])
        return Response({
            'gastos': [_gasto_json(g) for g in qs],
            'categorias': [{'value': v, 'label': l} for v, l in CATEGORIAS_GASTO],
        })

    def post(self, request):
        try:
            datos = _datos_gasto(request.data)
        except ValueError as e:
            return _error(str(e))
        with transaction.atomic():
            g = Gasto.objects.create(**datos)
            if g.movimiento_id:
                MovimientoBancario.objects.filter(pk=g.movimiento_id, categoria='sin_clasificar').update(categoria='gasto')
        return Response(_gasto_json(g), status=status.HTTP_201_CREATED)


class GastoDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, pk):
        g = Gasto.objects.filter(pk=pk).first()
        if not g:
            return _error('Gasto no encontrado', status.HTTP_404_NOT_FOUND)
        try:
            datos = _datos_gasto(request.data, g)
        except ValueError as e:
            return _error(str(e))
        for k, v in datos.items():
            setattr(g, k, v)
        g.save()
        return Response(_gasto_json(g))

    def delete(self, request, pk):
        Gasto.objects.filter(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ContabilidadView(APIView):
    """Resumen contable mensual y anual (ver contabilidad.resumen_mensual)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        filas, config = resumen_mensual(request.query_params.get('desde'), request.query_params.get('hasta'))
        todas, _ = resumen_mensual()
        hoy = date.today()
        # Por cobrar / por pagar a la fecha (no depende del rango).
        pedidos_abiertos = Pedido.objects.filter(estado__in=['Preparado', 'Reservado']).aggregate(t=Sum('total'))['t'] or 0
        facturas_pendientes = Factura.objects.filter(pago_factura__isnull=True)
        por_pagar = sum((f.total - f.total_notas_credito() for f in facturas_pendientes), Decimal('0'))
        vencidas = facturas_pendientes.filter(fecha_vencimiento__lt=hoy).count()
        saldo_banco = MovimientoBancario.objects.exclude(saldo__isnull=True).order_by('-fecha', '-id').values_list('saldo', flat=True).first()
        sin_clasificar = MovimientoBancario.objects.filter(categoria='sin_clasificar').count()
        abonos_sin_asociar = MovimientoBancario.objects.filter(monto__gt=0, categoria__in=['venta', 'sin_clasificar']).annotate(
            asig=Sum('asignaciones__monto')).filter(asig__isnull=True).count()
        return Response({
            'meses': filas,
            'anios': resumen_anual(todas, config),
            'config': config_json(config),
            'estado': {
                'por_cobrar': pedidos_abiertos,
                'por_pagar': por_pagar,
                'facturas_vencidas': vencidas,
                'saldo_banco': saldo_banco,
                'movimientos_sin_clasificar': sin_clasificar,
                'abonos_sin_asociar': abonos_sin_asociar,
            },
        })


def config_json(config):
    return {
        'tasa_impuesto_renta': config.tasa_impuesto_renta,
        'tasa_ppm': config.tasa_ppm,
        'tasa_iva': config.tasa_iva,
        'tasa_anticipo_carne': config.tasa_anticipo_carne,
        'receptor_cobro': config.receptor_cobro,
    }


class ConfiguracionContableView(APIView):
    permission_classes = [IsAuthenticated]

    TASAS = {
        'tasa_impuesto_renta': ('La tasa de impuesto', 60),
        'tasa_ppm': ('La tasa de PPM', 10),
        'tasa_iva': ('La tasa de IVA', 30),
        'tasa_anticipo_carne': ('La tasa de anticipo', 30),
    }

    def get(self, request):
        return Response(config_json(ConfiguracionContable.actual()))

    def put(self, request):
        config = ConfiguracionContable.actual()
        try:
            for campo, (nombre, maximo) in self.TASAS.items():
                if campo in request.data:
                    valor = _decimal(request.data[campo], nombre)
                    if not 0 <= valor <= maximo:
                        return _error(f'{nombre} está fuera de rango')
                    setattr(config, campo, valor)
        except ValueError as e:
            return _error(str(e))
        if 'receptor_cobro' in request.data:
            if request.data['receptor_cobro'] not in ('vendedor', 'empresa'):
                return _error('Receptor de cobros inválido')
            config.receptor_cobro = request.data['receptor_cobro']
        config.save()
        return Response(config_json(config))
