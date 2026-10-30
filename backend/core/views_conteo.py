"""Cuadratura de inventario: se ingresa lo contado, se compara con el sistema y las
diferencias quedan registradas como ajustes que dejan el stock igual a lo contado."""
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Sum
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AjusteInventario, ConteoInventario, DetalleConteo, DetallePedido, EntradaProducto, Producto
from .views import _aplicar_ajuste_en_ledger, _error_de_validacion


def stock_fisico(producto):
    """(kilos, unidades) que debería haber en bodega. Las unidades reservadas ya salieron del
    ledger pero siguen en la repisa, igual que en la pantalla de Stock."""
    reales = EntradaProducto.objects.filter(producto=producto).aggregate(
        u=Sum('cantidad_unidades'), k=Sum('cantidad_kilos')
    )
    reservadas = DetallePedido.objects.filter(
        producto=producto, cantidad_kilos=0
    ).exclude(pedido__estado="Anulado").exclude(estado="Cancelado").aggregate(
        u=Sum('cantidad_unidades')
    )['u'] or 0
    return Decimal(reales['k'] or 0), int(reales['u'] or 0) + int(reservadas)


def _serializar(conteo):
    detalles = [{
        'id': d.id,
        'producto': d.producto_id,
        'producto_nombre': d.producto.nombre,
        'sistema_kilos': d.sistema_kilos,
        'sistema_unidades': d.sistema_unidades,
        'contado_kilos': d.contado_kilos,
        'contado_unidades': d.contado_unidades,
        'diferencia_kilos': d.diferencia_kilos,
        'diferencia_unidades': d.diferencia_unidades,
    } for d in conteo.detalles.all()]
    return {
        'id': conteo.id,
        'fecha': conteo.fecha,
        'usuario': conteo.usuario.username if conteo.usuario else None,
        'notas': conteo.notas,
        'detalles': detalles,
        'productos_con_diferencia': sum(1 for d in detalles if d['diferencia_kilos'] or d['diferencia_unidades']),
    }


def _numero(valor, entero=False):
    if valor in (None, ''):
        return None
    try:
        n = Decimal(str(valor).replace(',', '.'))
    except InvalidOperation:
        raise ValueError
    if n < 0 or not n.is_finite():
        raise ValueError
    if entero:
        if n != n.to_integral_value():
            raise ValueError
        return int(n)
    return n


class ConteoInventarioView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        conteos = ConteoInventario.objects.select_related('usuario').prefetch_related('detalles__producto')[:50]
        return Response([_serializar(c) for c in conteos])

    def post(self, request):
        lineas = request.data.get('lineas') or []
        if not lineas:
            return Response({'error': 'Ingresa al menos un producto contado'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                conteo = ConteoInventario.objects.create(
                    usuario=request.user, notas=(request.data.get('notas') or '')[:255]
                )
                for linea in lineas:
                    try:
                        producto = Producto.objects.get(id=linea.get('producto'))
                    except (Producto.DoesNotExist, ValueError, TypeError):
                        raise ValidationError('Producto no encontrado')
                    try:
                        kilos = _numero(linea.get('contado_kilos'))
                        unidades = _numero(linea.get('contado_unidades'), entero=True)
                    except ValueError:
                        raise ValidationError(f'Cantidad inválida en {producto.nombre}')
                    if kilos is None and unidades is None:
                        continue  # no se contó: no se toca

                    sis_kilos, sis_unidades = stock_fisico(producto)
                    dif_kilos = (kilos - sis_kilos) if kilos is not None else Decimal('0')
                    dif_unidades = (unidades - sis_unidades) if unidades is not None else 0

                    ajuste = None
                    if dif_kilos or dif_unidades:
                        ajuste = AjusteInventario.objects.create(
                            producto=producto, cantidad=dif_kilos, cantidad_unidades=dif_unidades,
                            tipo='ajuste', razon=f'Conteo de inventario #{conteo.id}',
                        )
                        try:
                            _aplicar_ajuste_en_ledger(producto, dif_kilos, dif_unidades)
                        except ValidationError as e:
                            detalle = e.detail[0] if isinstance(e.detail, list) and e.detail else e.detail
                            raise ValidationError(f'{producto.nombre}: {detalle}')

                    DetalleConteo.objects.create(
                        conteo=conteo, producto=producto,
                        sistema_kilos=sis_kilos, sistema_unidades=sis_unidades,
                        contado_kilos=kilos, contado_unidades=unidades,
                        diferencia_kilos=dif_kilos, diferencia_unidades=dif_unidades, ajuste=ajuste,
                    )
                if not conteo.detalles.exists():
                    raise ValidationError('Ingresa al menos un producto contado')
        except ValidationError as e:
            return _error_de_validacion(e)

        conteo = ConteoInventario.objects.prefetch_related('detalles__producto').get(pk=conteo.pk)
        return Response(_serializar(conteo), status=status.HTTP_201_CREATED)


class StockFisicoView(APIView):
    """Lo que el sistema cree que hay, para mostrarlo junto al campo de conteo."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        data = []
        for p in Producto.objects.exclude(estado="desactivado").order_by('nombre'):
            kilos, unidades = stock_fisico(p)
            data.append({'id': p.id, 'nombre': p.nombre, 'categoria': p.categoria,
                         'sistema_kilos': kilos, 'sistema_unidades': unidades})
        return Response(data)
