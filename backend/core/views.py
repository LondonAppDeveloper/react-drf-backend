from rest_framework.views import APIView, PermissionDenied
from rest_framework.response import Response
from rest_framework import status
from .models import Producto, Pedido, FacturaDetallePedido, Vendedor, DetallePedido, Cliente, Factura, DetalleFactura, PagoFactura, EntradaProducto,Proveedor, PagoVendedor, AjusteInventario, HistorialPrecioProducto, PerfilUsuario, NotaCredito, MovimientoCongelado, RegistroPreReserva
from .serializers import RegistroPreReservaSerializer, MovimientoCongeladoSerializer, NotaCreditoSerializer, MyTokenObtainPairSerializer, ProductoSerializer, PedidoSerializer,ProveedorSerializer, ClienteSerializer, FacturaSerializer, PagoFacturaSerializer, VendedorSerializer, HistorialPrecioProductoSerializer, AjusteInventarioSerializer
from .contabilidad import mermas_valorizadas, resumen_mensual, resumen_anual
from .models import ConfiguracionContable
from .utils import estado_consumo_detalle, consumir_fifo, costo_por_kilo_ponderado, descontar_kilos_fifo, restituir_kilos_fifo, restituir_unidades_fifo, revertir_stock_detalle, agregar_exceso_fifo, unidades_en_stock, vincular_lotes, actualizar_estado_pre_reserva, asignar_pre_reservas, mover_stock_congelado, registrar_pre_reserva
from rest_framework.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from decimal import Decimal, InvalidOperation, ROUND_CEILING

from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework.permissions import IsAuthenticated

class MyTokenObtainPairView(TokenObtainPairView):
    serializer_class = MyTokenObtainPairSerializer

class ProductosView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        productos = Producto.objects.all()
        serializer = ProductoSerializer(productos, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

class CrearProducto(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, *args, **kwargs):
        data = request.data
        nombre = data.get('nombre')
        descripcion = data.get('descripcion')
        precio_por_kilo = data.get('precio_por_kilo')
        categoria = data.get('categoria')
        estado = data.get('estado')

        if not nombre or not precio_por_kilo:
            return Response({'error': 'Faltan datos obligatorios'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            producto = Producto.objects.create(
                nombre=nombre,
                descripcion=descripcion,
                precio_por_kilo=precio_por_kilo,
                categoria=categoria,
                estado=estado
            )
            return Response(ProductoSerializer(producto).data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class PedidoListView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        pedidos = Pedido.objects.select_related('cliente__vendedor', 'vendedor').prefetch_related(
            'detalles__producto', 'asignaciones_banco').order_by('-fecha')
        if request.query_params.get('incluir_anulados') != '1':
            pedidos = pedidos.exclude(estado="Anulado")
        serializer = PedidoSerializer(pedidos, many=True)
        return Response(serializer.data)

def parse_descuento_por_kilo(valor):
    """Descuento por kilo de UNA linea: vacio -> 0; invalido o negativo -> ValidationError."""
    try:
        descuento = Decimal(str(valor or 0).replace(',', '.'))
    except (InvalidOperation, ValueError):
        raise ValidationError("El descuento por kilo no es válido")
    if descuento < 0:
        raise ValidationError("El descuento por kilo no puede ser negativo")
    return descuento


MODOS_PRECIO = ('lista', 'descuento', 'personalizado', 'costo')


def parse_precio_linea(d):
    """Lee cómo quiere fijarse el precio de UNA línea del pedido. El precio del
    producto es el default; además se puede vender a costo, con un precio
    escrito a mano o con un descuento en pesos POR KILO (no %, no al total)."""
    descuento = parse_descuento_por_kilo(d.get('descuento_por_kilo'))
    modo = d.get('modo_precio') or ('descuento' if descuento > 0 else 'lista')
    if modo not in MODOS_PRECIO:
        raise ValidationError("Modo de precio inválido")
    personalizado = None
    if modo == 'personalizado':
        try:
            personalizado = Decimal(str(d.get('precio_personalizado') or '').replace(',', '.'))
        except (InvalidOperation, ValueError):
            raise ValidationError("El precio personalizado no es válido")
        if personalizado <= 0:
            raise ValidationError("El precio personalizado debe ser mayor a 0")
    return {'modo': modo, 'descuento': descuento, 'personalizado': personalizado}


def precio_segun_modo(producto, cfg, costo_por_kilo, lista=None):
    """Precio por kilo (CON IVA, como todo precio de venta) según el modo.

    'costo' = costo neto ponderado de los lotes * 1,19: el precio de venta trae
    IVA y el costo de compra no, así que vender exactamente al costo neto ya
    sería perder el IVA. Se redondea al peso hacia arriba."""
    if lista is None:
        lista = producto.precio_por_kilo
    modo = cfg['modo']
    if modo == 'costo':
        if costo_por_kilo is None:
            raise ValidationError(f"'{producto.nombre}' no tiene costo de compra para venderlo a costo")
        return (Decimal(costo_por_kilo) * IVA_RATE).quantize(Decimal('1'), rounding=ROUND_CEILING)
    if modo == 'personalizado':
        return cfg['personalizado']
    if modo == 'descuento':
        return max(lista - cfg['descuento'], Decimal('0.00'))
    return lista


def crear_linea_pedido(pedido, producto, unidades, kilos, cfg, congelado=False, permitir_pre_reserva=False,
                       origen='creacion_pedido', usuario=None):
    """Crea una línea de venta consumiendo stock FIFO. La usan CrearPedido y
    AgregarProductoPedido para que ambas queden idénticas.

    ``congelado`` saca las unidades del stock congelado en vez del inventario.

    Con ``permitir_pre_reserva`` las unidades que no alcanzan a cubrirse con
    stock quedan como pre-reserva (unidades_pendientes): se toma lo que haya y
    el resto se asigna al entrar la próxima factura (asignar_pre_reservas).
    Solo para el inventario normal y sin pesar: no se puede pesar carne que
    todavía no llega.

    El precio se fija DESPUÉS de vincular los lotes, porque el modo 'costo'
    necesita el costo/kg ponderado de esos lotes."""
    stock_producto = unidades_en_stock(producto, congelado)
    pendientes = 0
    if unidades > stock_producto:
        if not permitir_pre_reserva or congelado:
            donde = " congelado" if congelado else ""
            raise ValidationError(f"No hay suficiente stock{donde} disponible de '{producto.nombre}'")
        if kilos > 0:
            raise ValidationError(
                f"'{producto.nombre}' no tiene stock suficiente: una pre-reserva no se puede pesar")
        pendientes = unidades - int(stock_producto)

    _c, _k, facturas_usadas, facturas_cantidades = consumir_fifo(
        producto, unidades - pendientes, congelado=congelado)

    detalle = DetallePedido.objects.create(
        pedido=pedido,
        producto=producto,
        cantidad_kilos=kilos,
        cantidad_unidades=unidades,
        unidades_pendientes=pendientes,
        congelado=congelado,
        precio_venta=producto.precio_por_kilo,
        precio_lista=producto.precio_por_kilo,
        modo_precio=cfg['modo'],
    )
    vincular_lotes(detalle, facturas_usadas, facturas_cantidades)
    registrar_pre_reserva(detalle, 'creada', origen, pendientes,
                          referencia=f"Pedido #{pedido.id}", usuario=usuario)

    cpk = costo_por_kilo_ponderado(detalle)
    if cpk is not None:
        detalle.costo_por_kilo = cpk
    if cfg['modo'] == 'costo' and cpk is None and pendientes:
        # Pre-reserva sin ningún lote todavía: el costo se conoce al asignarle
        # la factura (asignar_pre_reservas fija ahí el precio a costo).
        detalle.precio_venta = producto.precio_por_kilo
    else:
        detalle.precio_venta = precio_segun_modo(producto, cfg, cpk)
    detalle.descuento_por_kilo = max(producto.precio_por_kilo - detalle.precio_venta, Decimal('0.00'))
    detalle.total_venta = kilos * detalle.precio_venta

    if kilos > 0:
        # Pedido pesado: los kilos REALES salen ahora del ledger. Sin pesar
        # (Reservado) no se descuenta nada todavía: lo hará la edición del
        # pedido cuando se registre la báscula.
        descontar_kilos_fifo(producto, kilos, permitir_faltante=True, congelado=congelado)

    detalle.save()
    return detalle


def anular_pedido(pedido, usuario=None):
    """Anula el pedido devolviendo el stock de sus líneas activas (lo que usan
    CancelarPedido y PedidoDetailView). Las pre-reservas del pedido quedan
    canceladas en la auditoría, y el stock devuelto se ofrece a las
    pre-reservas de OTROS pedidos que esperan esos productos."""
    referencia = f"Pedido #{pedido.id} anulado"
    productos = {}
    for detalle in pedido.detalles.exclude(estado="Cancelado").select_related('producto'):
        revertir_stock_detalle(detalle)
        registrar_pre_reserva(detalle, 'cancelada', 'anulacion_pedido',
                              detalle.unidades_pendientes, referencia=referencia, usuario=usuario)
        productos[detalle.producto_id] = detalle.producto
    pedido.estado = "Anulado"
    pedido.save()
    for producto in productos.values():
        asignar_pre_reservas(producto, 'anulacion_pedido', referencia, usuario)


def _es_verdadero(valor):
    return valor in (True, 'true', 'True', '1', 1)


def recalcular_total_pedido(pedido):
    pedido.total = pedido.detalles.exclude(estado="Cancelado").aggregate(
        total=Sum('total_venta'))['total'] or Decimal('0.00')


class CrearPedido(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, *args, **kwargs):
        data = request.data
        cliente_id = data.get('cliente')
        detalles = data.get('detalles')

        if not cliente_id or not detalles:
            return Response({'error': 'Faltan datos obligatorios'}, status=status.HTTP_400_BAD_REQUEST)

        # LÓGICA DE ASIGNACIÓN DE VENDEDOR
        # El vendedor del pedido se hereda SIEMPRE del vendedor dueño del cliente
        # (Cliente.vendedor), sin importar quién esté logueado al crear el pedido.
        # Esto evita que un vendedor "robe" (sin querer o a propósito) la autoría
        # de una venta de otro vendedor por crear el pedido desde su sesión.
        # Excepción explícita: un admin/staff puede reasignar manualmente pasando
        # 'forzar_vendedor' en el payload (nunca el campo 'vendedor', que se ignora).
        try:
            cliente = Cliente.objects.get(id=cliente_id)
        except Cliente.DoesNotExist:
            return Response({'error': 'Cliente no encontrado'}, status=status.HTTP_404_NOT_FOUND)

        forzar_vendedor_id = data.get('forzar_vendedor')
        if request.user.is_staff and forzar_vendedor_id:
            try:
                vendedor = Vendedor.objects.get(id=forzar_vendedor_id)
            except Vendedor.DoesNotExist:
                return Response({'error': 'Vendedor no encontrado'}, status=404)
        else:
            vendedor = cliente.vendedor
            if vendedor is None:
                return Response(
                    {'error': 'El cliente seleccionado no tiene un vendedor asignado.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if not isinstance(detalles, list) or len(detalles) == 0:
            return Response({'error': 'Los detalles deben ser una lista no vacía'}, status=status.HTTP_400_BAD_REQUEST)

        # Precio POR PRODUCTO: lista (default), descuento $/kg, personalizado o a costo.
        try:
            configs = [parse_precio_linea(d) for d in detalles]
        except ValidationError as e:
            return Response({'error': str(e.detail[0])}, status=status.HTTP_400_BAD_REQUEST)

        # Sin este flag, pedir más de lo que hay sigue siendo un error: la
        # pre-reserva tiene que pedirse a propósito desde Nuevo Pedido.
        permitir_pre_reserva = _es_verdadero(data.get('permitir_pre_reserva'))

        tipo_recibo = data.get('tipo_recibo') or ('Factura' if cliente.tipo_cliente == 'mayorista' else 'Boleta')
        if tipo_recibo not in ('Boleta', 'Factura'):
            tipo_recibo = 'Boleta'

        try:
            with transaction.atomic():
                pedido = Pedido.objects.create(
                    cliente_id=cliente_id,
                    observaciones=(data.get('observaciones') or '').strip(),
                    tipo_recibo=tipo_recibo,
                )
                todo_pesado = True

                for detalle, cfg in zip(detalles, configs):
                    producto_id = detalle.get('producto')
                    if not producto_id:
                        raise ValidationError("El ID del producto es obligatorio")
                    try:
                        producto = Producto.objects.get(id=producto_id)
                    except Producto.DoesNotExist:
                        raise ValidationError(f"Producto con ID {producto_id} no existe")

                    kilos = Decimal(str(detalle.get('cantidad_kilos') or 0).replace(',', '.'))
                    unidades = int(Decimal(str(detalle.get('cantidad_unidades') or 0).replace(',', '.')))
                    if kilos <= 0:
                        kilos = Decimal('0.00')
                        todo_pesado = False

                    crear_linea_pedido(
                        pedido, producto, unidades, kilos, cfg,
                        congelado=_es_verdadero(detalle.get('congelado')),
                        permitir_pre_reserva=permitir_pre_reserva,
                        usuario=request.user,
                    )

                # Antes el estado quedaba según la ÚLTIMA línea: un pedido con una
                # línea sin pesar podía quedar "Preparado" (por cobrar).
                pedido.estado = "Preparado" if todo_pesado else "Reservado"
                actualizar_estado_pre_reserva(pedido)
                pedido.vendedor = vendedor
                recalcular_total_pedido(pedido)
                pedido.save()

                return Response(PedidoSerializer(pedido).data, status=status.HTTP_201_CREATED)

        except ValidationError as e:
            return _error_de_validacion(e)
        except Exception as e:
            return Response({'error': f'Error al crear el pedido o detalles: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)
        

class PedidoDetailView(APIView):
    permission_classes = [IsAuthenticated]
    def put(self, request, pk):
        try:
            pedido = Pedido.objects.get(pk=pk)
            data = request.data

            # Un pedido anulado ya devolvió todo su stock: editarlo volvería a
            # mover el ledger contra líneas que ya no existen en bodega.
            if pedido.estado == "Anulado":
                return Response({'error': 'El pedido está Anulado y no se puede editar'}, status=status.HTTP_400_BAD_REQUEST)

            with transaction.atomic():
                # 1. Actualizar el estado si viene (Pagado, Preparado, ...).
                # Anular por aquí no devolvía el stock: se usa la misma reversión
                # que CancelarPedido.
                if 'estado' in data:
                    nuevo_estado = data['estado']
                    if nuevo_estado not in dict(Pedido._meta.get_field('estado').choices):
                        raise ValidationError("Estado inválido")
                    if nuevo_estado == "Anulado":
                        anular_pedido(pedido, request.user)
                        return Response(PedidoSerializer(pedido).data, status=status.HTTP_200_OK)
                    pedido.estado = nuevo_estado
                if data.get('tipo_recibo') in ('Boleta', 'Factura'):
                    pedido.tipo_recibo = data['tipo_recibo']
                if 'observaciones' in data:
                    pedido.observaciones = (data.get('observaciones') or '').strip()

                # 2. Actualizar detalles (kilos y unidades)
                detalles_data = data.get('detalles', [])
                # Productos a los que esta edición les devolvió unidades al
                # inventario: al final se ofrecen a otras pre-reservas.
                productos_liberados = {}

                for det in detalles_data:
                    # Extraemos el ID del producto (manejando si viene como objeto o ID)
                    prod_id = det['producto']['id'] if isinstance(det['producto'], dict) else det['producto']

                    # Por id de línea si viene: un pedido puede tener el mismo
                    # producto dos veces (una línea cancelada y otra re-agregada)
                    # y .get(producto) explotaba con MultipleObjectsReturned.
                    if det.get('id'):
                        detalle_obj = DetallePedido.objects.get(pedido=pedido, id=det['id'])
                    else:
                        detalle_obj = DetallePedido.objects.get(
                            pedido=pedido, producto_id=prod_id, estado="Activo")

                    # Una línea Cancelada ya devolvió su stock/costo al ledger
                    # (ver CancelarProductoPedido) y no participa del total del
                    # pedido: no se toca su stock ni se re-incluye su venta.
                    if detalle_obj.estado == "Cancelado":
                        continue

                    unidades_anteriores = int(detalle_obj.cantidad_unidades or 0)
                    kilos_anteriores = Decimal(str(detalle_obj.cantidad_kilos or 0))
                    congelado = detalle_obj.congelado

                    unidades_raw = det.get('cantidad_unidades') or 0
                    nuevas_unidades = int(Decimal(str(unidades_raw).replace(',', '.')))
                    if nuevas_unidades < 0:
                        raise ValidationError("Las unidades no pueden ser negativas")

                    # Actualizamos valores
                    detalle_obj.cantidad_kilos = Decimal(str(det.get('cantidad_kilos') or 0).replace(',', '.'))
                    if detalle_obj.cantidad_kilos < 0:
                        raise ValidationError("Los kilos no pueden ser negativos")

                    detalle_obj.cantidad_unidades = nuevas_unidades

                    delta_unidades = nuevas_unidades - unidades_anteriores
                    if delta_unidades > 0:
                        # Subir la cantidad de unidades tiene que consumir stock real
                        # (FIFO) por la diferencia; si no, las unidades extra se
                        # venden sin descontar nunca el inventario (bug de origen:
                        # ver Pedido #34, que tenia 4 unidades vendidas pero solo 2
                        # con factura de compra asociada).
                        # Si no alcanza y la línea ya es pre-reserva (o se pide
                        # explícitamente), lo que falta queda pendiente.
                        a_consumir = delta_unidades
                        if detalle_obj.unidades_pendientes > 0 or _es_verdadero(data.get('permitir_pre_reserva')):
                            if not congelado:
                                hay = int(unidades_en_stock(detalle_obj.producto))
                                a_consumir = min(delta_unidades, hay)
                                detalle_obj.unidades_pendientes += delta_unidades - a_consumir
                                registrar_pre_reserva(
                                    detalle_obj, 'aumentada', 'edicion_pedido', delta_unidades - a_consumir,
                                    referencia=f"Pedido #{pedido.id} editado", usuario=request.user)
                        _c, _k, facturas_usadas_delta, facturas_cantidades_delta = consumir_fifo(
                            detalle_obj.producto, a_consumir, congelado=congelado
                        )
                        vincular_lotes(detalle_obj, facturas_usadas_delta, facturas_cantidades_delta)

                        # Recalcular el costo/kg de la linea como el promedio
                        # ponderado de los lotes vinculados (incluye los nuevos).
                        # total_costo se deriva de costo/kg * kilos en save().
                        nuevo_cpk = costo_por_kilo_ponderado(detalle_obj)
                        if nuevo_cpk is not None:
                            detalle_obj.costo_por_kilo = nuevo_cpk
                    elif delta_unidades < 0:
                        # Bajar la cantidad de unidades tiene que devolver esa
                        # diferencia al ledger (ver Pedido reportado: se bajo 1
                        # unidad de tapabarriga al editar y no volvio al stock).
                        # El costo/kg de la linea se mantiene: solo cambia el
                        # total al recalcularse con los kilos nuevos abajo.
                        # Primero se descuentan las de pre-reserva: esas nunca
                        # salieron del stock.
                        quitar = -delta_unidades
                        de_pendientes = min(quitar, detalle_obj.unidades_pendientes)
                        detalle_obj.unidades_pendientes -= de_pendientes
                        registrar_pre_reserva(
                            detalle_obj, 'reducida', 'edicion_pedido', de_pendientes,
                            referencia=f"Pedido #{pedido.id} editado", usuario=request.user)
                        if quitar - de_pendientes > 0:
                            restituir_unidades_fifo(
                                detalle_obj.producto, quitar - de_pendientes, congelado=congelado)
                            if not congelado:
                                productos_liberados[detalle_obj.producto_id] = detalle_obj.producto

                    if detalle_obj.unidades_pendientes > 0 and detalle_obj.cantidad_kilos > 0:
                        raise ValidationError(
                            f"'{detalle_obj.producto.nombre}' tiene {detalle_obj.unidades_pendientes} "
                            "unidad(es) en pre-reserva sin stock: no se puede pesar hasta que llegue la factura")

                    # Los kilos del ledger siguen al peso real de la linea: solo
                    # se mueve la diferencia contra lo que ya estaba registrado.
                    delta_kilos = detalle_obj.cantidad_kilos - kilos_anteriores
                    if delta_kilos > 0:
                        descontar_kilos_fifo(
                            detalle_obj.producto, delta_kilos, permitir_faltante=True, congelado=congelado)
                    elif delta_kilos < 0:
                        restituir_kilos_fifo(detalle_obj.producto, -delta_kilos, congelado=congelado)

                    # Cambio de precio de la línea (opcional): mismo criterio que al crear.
                    if det.get('modo_precio'):
                        # Lista y descuento se miden contra el precio de lista
                        # que tenía el producto cuando se hizo la venta.
                        cfg = parse_precio_linea(det)
                        lista = detalle_obj.precio_lista or detalle_obj.producto.precio_por_kilo
                        detalle_obj.modo_precio = cfg['modo']
                        detalle_obj.precio_venta = precio_segun_modo(
                            detalle_obj.producto, cfg, detalle_obj.costo_por_kilo, lista)
                        detalle_obj.descuento_por_kilo = max(lista - detalle_obj.precio_venta, Decimal('0.00'))
                    elif detalle_obj.modo_precio == 'costo' and delta_unidades > 0:
                        # A costo sigue al costo ponderado si entraron lotes nuevos.
                        detalle_obj.precio_venta = precio_segun_modo(
                            detalle_obj.producto, {'modo': 'costo'}, detalle_obj.costo_por_kilo)

                    # Recalculamos subtotal de la línea
                    detalle_obj.total_venta = detalle_obj.cantidad_kilos * detalle_obj.precio_venta
                    detalle_obj.save()

                # 3. Total general: SIEMPRE sobre todas las líneas activas. Antes se
                # sumaban solo las líneas que venían en el payload, así que una
                # edición parcial dejaba el total del pedido más bajo que sus líneas.
                recalcular_total_pedido(pedido)
                if pedido.estado in ("Preparado", "Pagado") and pedido.detalles.filter(
                        estado="Activo", unidades_pendientes__gt=0).exists():
                    raise ValidationError(
                        "El pedido tiene unidades en pre-reserva sin stock: no puede pasar a "
                        f"{pedido.estado} hasta que llegue la factura")
                actualizar_estado_pre_reserva(pedido)
                pedido.save()

                for producto in productos_liberados.values():
                    asignar_pre_reservas(
                        producto, 'edicion_pedido', f"Pedido #{pedido.id} bajó unidades", request.user)
                pedido.refresh_from_db()

            serializer = PedidoSerializer(pedido)
            return Response(serializer.data, status=status.HTTP_200_OK)

        except Pedido.DoesNotExist:
            return Response({'error': 'Pedido no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except ValidationError as e:
            return _error_de_validacion(e)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class ActualizarKilosPedido(APIView):
    """Registra el peso real (bascula) de un pedido, tipicamente uno Reservado.

    Ademas de guardar los kilos en la linea, MUEVE EL LEDGER: los kilos del
    stock bajan solo aca y en CrearPedido (cuando el pedido ya viene pesado),
    siempre con peso real. Antes este endpoint solo escribia
    detalle.cantidad_kilos y nunca tocaba EntradaProducto, asi que la carne
    salia de la camara y el dashboard seguia mostrando los mismos kilos.
    """
    permission_classes = [IsAuthenticated]
    def post(self, request, pedido_id, *args, **kwargs):
        try:
            pedido = Pedido.objects.get(id=pedido_id)
            if pedido.estado == "Anulado":
                return Response({'error': 'El pedido está Anulado'}, status=status.HTTP_400_BAD_REQUEST)
            detalles_data = request.data.get('detalles', [])
            with transaction.atomic():
                for detalle_data in detalles_data:
                    producto_id = detalle_data.get('producto')
                    cantidad_kilos = detalle_data.get('cantidad_kilos')

                    # Las líneas Canceladas ya devolvieron su stock: no se pesan.
                    detalle = DetallePedido.objects.filter(
                        pedido=pedido, producto_id=producto_id, estado="Activo").first()
                    if detalle is None:
                        continue

                    kilos_anteriores = Decimal(str(detalle.cantidad_kilos or 0))
                    kilos_nuevos = Decimal(str(cantidad_kilos or 0).replace(',', '.'))
                    delta = kilos_nuevos - kilos_anteriores
                    if kilos_nuevos > 0 and detalle.unidades_pendientes > 0:
                        raise ValidationError(
                            f"'{detalle.producto.nombre}' tiene unidades en pre-reserva sin stock: "
                            "no se puede pesar hasta que llegue la factura")

                    # Antes solo se guardaban los kilos y total_venta quedaba en 0:
                    # el pedido pesado seguía sumando $0 en ventas.
                    detalle.cantidad_kilos = kilos_nuevos
                    detalle.total_venta = kilos_nuevos * detalle.precio_venta
                    detalle.save()

                    # Solo la DIFERENCIA toca el stock, para que repesar una
                    # linea no descuente dos veces. Un delta negativo (correccion
                    # a la baja) devuelve los kilos que nunca salieron.
                    if delta > 0:
                        descontar_kilos_fifo(detalle.producto, delta, permitir_faltante=True,
                                             congelado=detalle.congelado)
                    elif delta < 0:
                        restituir_kilos_fifo(detalle.producto, -delta, congelado=detalle.congelado)

                recalcular_total_pedido(pedido)
                pedido.save()

                

            return Response({'status': 'Kilos actualizados exitosamente'}, status=status.HTTP_200_OK)
        except Pedido.DoesNotExist:
            return Response({'error': 'Pedido no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except ValidationError as e:
            return _error_de_validacion(e)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        

class VendedorListView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        vendedores = Vendedor.objects.all()
        serializer = VendedorSerializer(vendedores, many=True)
        return Response(serializer.data)

class ClienteListView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        # select_related: sin esto el serializer hace una consulta por cliente
        # para traer su vendedor.
        clientes = Cliente.objects.select_related('vendedor').order_by('nombre')
        serializer = ClienteSerializer(clientes, many=True)
        return Response(serializer.data)

class CrearCliente(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, *args, **kwargs):
        data = request.data
        if not data.get('nombre') or not data.get('direccion') or not data.get('vendedor_id'):
            return Response({'error': 'Faltan datos obligatorios'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = ClienteSerializer(data=data)
        if not serializer.is_valid():
            return Response({'error': _primer_error(serializer.errors)}, status=status.HTTP_400_BAD_REQUEST)
        cliente = serializer.save()
        return Response(ClienteSerializer(cliente).data, status=status.HTTP_201_CREATED)

class CrearFacturaEntrada(APIView):
    permission_classes = [IsAuthenticated]
    @transaction.atomic
    def post(self, request):
        data = request.data
        try:
            # 1. Obtener Proveedor
            proveedor_id = data.get('proveedor')
            proveedor = Proveedor.objects.get(id=proveedor_id)

            # 2. Crear la Factura
            if Factura.objects.filter(numero_factura=data.get('numero_factura')).exists():
                raise ValidationError("Ya existe una factura con ese número")
            factura = Factura.objects.create(
                numero_factura=data.get('numero_factura'),
                proveedor=proveedor,
                fecha=data.get('fecha') or timezone.now().date(),
                fecha_vencimiento=data.get('fecha_vencimiento') or None,
                subtotal=Decimal(str(data.get('subtotal', 0))),
                iva=Decimal(str(data.get('iva', 0))),
                anticipo_iva=Decimal(str(data.get('anticipo_iva') or 0)),
                total=Decimal(str(data.get('total', 0)))
            )

            detalles_data = data.get('detalles', [])
            if isinstance(detalles_data, str):
                # Llega como texto JSON cuando la factura viene con foto (multipart).
                import json
                detalles_data = json.loads(detalles_data)
            if request.FILES.get('foto'):
                factura.foto = request.FILES['foto']
                factura.save(update_fields=['foto'])
            
            for item in detalles_data:
                producto = Producto.objects.get(id=item.get('producto'))
                
                # Leemos con nombres explícitos y valores por defecto 0.0
                kilos = Decimal(str(item.get('cantidad_kilos', 0)))
                unidades = int(item.get('cantidad_unidades', 0))
                costo_un = Decimal(str(item.get('costo_por_kilo', 0)))
                # Si el frontend envía 'costo_total', lo usamos; si no, lo calculamos
                costo_tot = Decimal(str(item.get('costo_total', kilos * costo_un)))

                # 3. Crear DetalleFactura
                DetalleFactura.objects.create(
                    factura=factura,
                    producto=producto,
                    cantidad_kilos=kilos,
                    cantidad_unidades=unidades,
                    costo_por_kilo=costo_un,
                    costo_total=costo_tot
                )

                # 4. Crear EntradaProducto (Aquí es donde fallaba)
                # Nos aseguramos que costo_por_kilo NUNCA sea None
                EntradaProducto.objects.create(
                    factura=factura,
                    producto=producto,
                    cantidad_kilos=kilos,
                    cantidad_unidades=unidades,
                    costo_por_kilo=costo_un,
                    fecha_entrada=factura.fecha
                )

            # Con el stock ya cargado, las pre-reservas de estos productos
            # toman sus unidades (la más antigua primero) y pasan a Reservado.
            pre_reservas = []
            for producto_id in {item.get('producto') for item in detalles_data}:
                pre_reservas += asignar_pre_reservas(
                    Producto.objects.get(id=producto_id), 'factura',
                    f"Factura {factura.numero_factura}", request.user)

            return Response({'message': 'Éxito', 'pre_reservas_asignadas': pre_reservas},
                            status=status.HTTP_201_CREATED)

        except ValidationError as e:
            transaction.set_rollback(True)
            return _error_de_validacion(e)
        except Exception as e:
            # Sin esto la factura quedaba creada a medias: el decorador atomic
            # solo revierte si la excepción sale de la vista, y aquí se atrapa.
            transaction.set_rollback(True)
            print(f"DEBUG ERROR: {str(e)}")
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class FacturaListView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        facturas = Factura.objects.select_related('proveedor', 'pago_factura').prefetch_related(
            'notas_credito', 'detalles__producto')
        serializer = FacturaSerializer(facturas, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

class UpdateFacturaEntrada(APIView):
    """Edita una factura ya emitida (proveedor, fecha y sus líneas) aplicando
    guardas de stock por línea:

      - línea no consumida  -> edición libre de cantidad y costo.
      - línea parcialmente consumida -> costo libre; la cantidad no puede bajar
        de lo ya vendido; el stock restante se ajusta a la diferencia.
      - línea totalmente consumida -> bloqueada para cantidad/costo (se ignora
        cualquier cambio enviado para esa línea).

    Sólo se editan líneas existentes (identificadas por ``id`` o, en su defecto,
    por ``producto``). Cambiar el producto de una línea o agregar/quitar líneas
    queda fuera del alcance de esta edición. Toda la reconciliación de stock
    corre dentro de una transacción, siguiendo el patrón de ``CancelarPedido``.
    """
    permission_classes = [IsAuthenticated]

    def put(self, request, numero_factura):
        data = request.data
        try:
            with transaction.atomic():
                factura = Factura.objects.select_for_update().get(numero_factura=numero_factura)

                # Metadatos no ligados a stock: siempre editables sin restricción.
                proveedor_id = data.get('proveedor')
                if proveedor_id:
                    factura.proveedor = Proveedor.objects.get(id=proveedor_id)
                if data.get('fecha'):
                    factura.fecha = data.get('fecha')
                if 'fecha_vencimiento' in data:
                    factura.fecha_vencimiento = data.get('fecha_vencimiento') or None
                if request.FILES.get('foto'):
                    factura.foto = request.FILES['foto']
                elif data.get('quitar_foto') in (True, 'true', '1'):
                    factura.foto = None

                detalles_put = data.get('detalles', [])
                if isinstance(detalles_put, str):
                    import json
                    detalles_put = json.loads(detalles_put)

                productos_tocados = set()
                for item in detalles_put:
                    detalle_id = item.get('id')
                    if detalle_id is not None:
                        detalle = DetalleFactura.objects.get(id=detalle_id, factura=factura)
                    else:
                        detalle = DetalleFactura.objects.get(factura=factura, producto_id=item.get('producto'))

                    info = estado_consumo_detalle(detalle)
                    estado = info['estado']
                    consumidas = info['consumidas']
                    # Lo que de este lote se pasó a congelado sigue vivo, pero en
                    # otro pool: la edición no lo toca y la cantidad no puede
                    # quedar por debajo de vendido + congelado.
                    congeladas = EntradaProducto.objects.filter(
                        factura=detalle.factura_id, producto=detalle.producto_id, congelado=True
                    ).aggregate(t=Sum('cantidad_unidades'))['t'] or 0

                    # Línea totalmente consumida: no se toca cantidad ni costo.
                    if estado == 'bloqueada':
                        continue

                    nuevos_kilos = Decimal(str(item.get('cantidad_kilos', detalle.cantidad_kilos)))
                    nuevas_unidades = int(item.get('cantidad_unidades', detalle.cantidad_unidades))
                    nuevo_costo = Decimal(str(item.get('costo_por_kilo', detalle.costo_por_kilo)))

                    # Parcialmente consumida: la cantidad no puede bajar de lo vendido.
                    if estado == 'parcial' and nuevas_unidades < consumidas:
                        raise ValidationError(
                            f"El producto '{detalle.producto.nombre}' ya tiene {consumidas} "
                            f"unidad(es) vendida(s); la cantidad no puede ser menor a ese valor."
                        )
                    if congeladas and nuevas_unidades < consumidas + congeladas:
                        raise ValidationError(
                            f"El producto '{detalle.producto.nombre}' tiene {congeladas} unidad(es) "
                            f"congelada(s) y {consumidas} vendida(s); la cantidad no puede ser menor "
                            f"a {consumidas + congeladas}."
                        )

                    kilos_originales = detalle.cantidad_kilos

                    # Actualizar la línea histórica (DetalleFactura).
                    detalle.cantidad_kilos = nuevos_kilos
                    detalle.cantidad_unidades = nuevas_unidades
                    detalle.costo_por_kilo = nuevo_costo
                    detalle.costo_total = nuevos_kilos * nuevo_costo
                    detalle.save()

                    # Reconciliar el stock vivo (EntradaProducto) con lo restante.
                    self._reconciliar_entrada(
                        detalle, consumidas + congeladas, kilos_originales, nuevos_kilos,
                        nuevas_unidades, nuevo_costo
                    )
                    productos_tocados.add(detalle.producto)

                # Recalcular totales igual que en creación (subtotal + IVA +
                # anticipo de la carne si lo trae), solo si se tocaron líneas o
                # el anticipo: subir la foto o cambiar el vencimiento no debe
                # mover los montos ya registrados.
                if detalles_put or 'con_anticipo' in data:
                    config = ConfiguracionContable.actual()
                    subtotal = factura.detalles.aggregate(total=Sum('costo_total'))['total'] or Decimal('0')
                    iva = (subtotal * config.tasa_iva / 100).quantize(Decimal('1'))
                    con_anticipo = (str(data['con_anticipo']).lower() in ('true', '1')
                                    if 'con_anticipo' in data else factura.anticipo_iva > 0)
                    anticipo = (subtotal * config.tasa_anticipo_carne / 100).quantize(Decimal('1')) if con_anticipo else Decimal('0')
                    factura.subtotal = subtotal.quantize(Decimal('0.01'))
                    factura.iva = iva
                    factura.anticipo_iva = anticipo
                    factura.total = (subtotal + iva + anticipo).quantize(Decimal('0.01'))
                factura.save()

                # Si la edición sumó unidades, pueden cubrir pre-reservas.
                for producto in productos_tocados:
                    asignar_pre_reservas(producto, 'edicion_factura',
                                         f"Factura {factura.numero_factura} editada", request.user)

            factura.refresh_from_db()
            return Response(FacturaSerializer(factura).data, status=status.HTTP_200_OK)

        except Factura.DoesNotExist:
            return Response({'error': 'Factura no encontrada'}, status=status.HTTP_404_NOT_FOUND)
        except DetalleFactura.DoesNotExist:
            return Response({'error': 'Una de las líneas enviadas no pertenece a la factura'}, status=status.HTTP_400_BAD_REQUEST)
        except ValidationError as e:
            detail = e.detail if hasattr(e, 'detail') else str(e)
            if isinstance(detail, list) and detail:
                detail = detail[0]
            return Response({'error': str(detail)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            print(f"DEBUG ERROR (UpdateFacturaEntrada): {str(e)}")
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    def _reconciliar_entrada(self, detalle, consumidas, kilos_originales, nuevos_kilos, nuevas_unidades, nuevo_costo):
        """Ajusta el/los EntradaProducto vivos del producto+factura para que
        reflejen la nueva cantidad menos lo ya consumido, al nuevo costo. Se
        actualiza in-place la fila más antigua (preservando su posición FIFO) y
        se consolidan las demás.

        Los kilos vivos NO se recalculan como "peso promedio x unidades
        restantes": ese promedio ignora que los kilos reales solo bajan
        cuando se pesa una venta (ver descontar_kilos_fifo en utils.py), asi
        que unidades reservadas y no pesadas todavia pueden dejar mas o menos
        kilos vivos que el promedio del lote. En vez de eso, se parte de los
        kilos vivos actuales (el valor real) y se les aplica solo el delta de
        la edicion (nuevos_kilos - kilos_originales), que es lo unico que de
        verdad cambio en la factura.
        """
        # Solo el inventario normal: lo congelado de este lote se dejó fuera
        # sumándolo a ``consumidas`` (ver put).
        entradas = list(
            EntradaProducto.objects.filter(
                factura=detalle.factura_id, producto=detalle.producto_id, congelado=False
            ).order_by('fecha_entrada')
        )

        unidades_restantes = nuevas_unidades - consumidas
        if unidades_restantes < 0:
            unidades_restantes = 0

        # El costo corregido también vale para la parte congelada del lote.
        EntradaProducto.objects.filter(
            factura=detalle.factura_id, producto=detalle.producto_id, congelado=True
        ).update(costo_por_kilo=nuevo_costo)

        kilos_vivos_actuales = sum((e.cantidad_kilos for e in entradas), Decimal('0.00'))
        delta_kilos = nuevos_kilos - kilos_originales
        kilos_restantes = kilos_vivos_actuales + delta_kilos
        if kilos_restantes < 0:
            kilos_restantes = Decimal('0.00')

        if entradas:
            principal = entradas[0]
            principal.cantidad_unidades = unidades_restantes
            principal.cantidad_kilos = kilos_restantes
            principal.costo_por_kilo = nuevo_costo
            principal.save()
            for extra in entradas[1:]:
                extra.delete()
        elif unidades_restantes > 0 or kilos_restantes > 0:
            # No debería ocurrir en 'libre'/'parcial' (siempre queda stock vivo),
            # pero por robustez recreamos la entrada.
            EntradaProducto.objects.create(
                factura=detalle.factura,
                producto=detalle.producto,
                cantidad_kilos=kilos_restantes,
                cantidad_unidades=unidades_restantes,
                costo_por_kilo=nuevo_costo,
            )

class NotaCreditoView(APIView):
    """Crea (POST, multipart si trae foto) o borra (DELETE) notas de crédito de
    una factura de compra. Se ingresa el neto; el IVA es el 19% salvo que se
    indique otro (algunas NC vienen con el IVA ya calculado por el proveedor)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, numero_factura):
        factura = Factura.objects.filter(numero_factura=numero_factura).first()
        if not factura:
            return Response({'error': 'Factura no encontrada'}, status=status.HTTP_404_NOT_FOUND)
        data = request.data
        numero = str(data.get('numero') or '').strip()
        if not numero or not data.get('fecha'):
            return Response({'error': 'Indica número y fecha de la nota de crédito'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            neto = Decimal(str(data.get('neto')).replace(',', '.'))
            iva = (Decimal(str(data.get('iva')).replace(',', '.')) if data.get('iva') not in (None, '')
                   else (neto * Decimal('0.19')).quantize(Decimal('1')))
        except (InvalidOperation, ValueError):
            return Response({'error': 'Monto inválido'}, status=status.HTTP_400_BAD_REQUEST)
        if neto <= 0:
            return Response({'error': 'El neto debe ser mayor a 0'}, status=status.HTTP_400_BAD_REQUEST)
        total = neto + iva
        ya_acreditado = factura.total_notas_credito()
        if ya_acreditado + total > factura.total + Decimal('1'):
            return Response({'error': 'Las notas de crédito superarían el total de la factura'}, status=status.HTTP_400_BAD_REQUEST)
        if factura.notas_credito.filter(numero=numero).exists():
            return Response({'error': 'Esa nota de crédito ya está registrada'}, status=status.HTTP_400_BAD_REQUEST)
        nc = NotaCredito.objects.create(
            factura=factura, numero=numero, fecha=data.get('fecha'), neto=neto, iva=iva, total=total,
            motivo=str(data.get('motivo') or '')[:255], foto=request.FILES.get('foto'),
        )
        return Response(NotaCreditoSerializer(nc).data, status=status.HTTP_201_CREATED)


class NotaCreditoDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        NotaCredito.objects.filter(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CrearPagoFactura(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, *args, **kwargs):
        data = request.data
        factura_id = data.get('factura')
        fecha_de_pago = data.get('fecha_de_pago')
        monto_del_pago = data.get('monto_del_pago')

        if not factura_id or not fecha_de_pago or not monto_del_pago:
            return Response({'error': 'Faltan datos obligatorios'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            factura = Factura.objects.get(numero_factura=factura_id)
        except Factura.DoesNotExist:
            return Response({'error': f'Factura con ID {factura_id} no existe'}, status=status.HTTP_404_NOT_FOUND)

        if hasattr(factura, 'pago_factura'):
            return Response({'error': 'Esta factura ya tiene un pago registrado'}, status=status.HTTP_400_BAD_REQUEST)

        pago_factura = PagoFactura.objects.create(
            factura=factura,
            fecha_de_pago=fecha_de_pago,
            monto_del_pago=monto_del_pago
        )

        return Response(PagoFacturaSerializer(pago_factura).data, status=status.HTTP_201_CREATED)

class CancelarPedido(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, *args, **kwargs):
        pedido_id = request.data.get('pedido_id')

        if not pedido_id:
            return Response({'error': 'El ID del pedido es obligatorio'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                # Seleccionamos con select_for_update para evitar colisiones
                pedido = Pedido.objects.select_for_update().get(id=pedido_id)

                if pedido.estado == "Anulado":
                    return Response({'error': 'El pedido ya está Anulado'}, status=status.HTTP_400_BAD_REQUEST)

                # 1. Revertir stock a las entradas originales (misma lógica que
                # CancelarProductoPedido usa por línea, ver utils.revertir_stock_detalle).
                # Las líneas ya canceladas individualmente saltan esta reversión:
                # su stock ya volvió al ledger cuando se cancelaron.
                # 2. IMPORTANTE: NO borres los detalles.
                # Si los borras, pierdes el historial de qué se vendió.
                # Solo cambia el estado del pedido.
                anular_pedido(pedido, request.user)

                return Response({'status': 'Pedido Anulado y stock revertido'}, status=status.HTTP_200_OK)

        except Pedido.DoesNotExist:
            return Response({'error': 'Pedido no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': f'Error: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)


class CancelarProductoPedido(APIView):
    """Cancela UNA línea (producto) de un pedido sin anular el pedido entero.

    Revierte el stock/costo de esa línea exactamente igual que ``CancelarPedido``
    (misma función, ``revertir_stock_detalle``): crea de vuelta la(s)
    ``EntradaProducto`` con el costo_por_kilo original recuperado desde la(s)
    factura(s) que abastecieron la línea, en la posición FIFO más antigua.

    La línea NO se borra (se conserva el historial de qué se vendió); se marca
    ``estado='Cancelado'`` y se excluye del total del pedido y de todos los
    reportes que ya excluían pedidos Anulado (ver DetallePedido.estado en
    models.py y los querysets que ahora también excluyen estado='Cancelado').

    Si al cancelar la línea no queda ninguna línea activa en el pedido, el
    pedido completo se marca 'Anulado' (no tiene sentido un pedido "vivo" sin
    ningún producto).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        pedido_id = request.data.get('pedido_id')
        detalle_id = request.data.get('detalle_id')

        if not pedido_id or not detalle_id:
            return Response(
                {'error': 'pedido_id y detalle_id son obligatorios'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            with transaction.atomic():
                pedido = Pedido.objects.select_for_update().get(id=pedido_id)

                if pedido.estado == "Anulado":
                    return Response({'error': 'El pedido ya está Anulado'}, status=status.HTTP_400_BAD_REQUEST)

                try:
                    detalle = pedido.detalles.get(id=detalle_id)
                except DetallePedido.DoesNotExist:
                    return Response(
                        {'error': 'Esa línea no pertenece a este pedido'},
                        status=status.HTTP_404_NOT_FOUND
                    )

                if detalle.estado == "Cancelado":
                    return Response({'error': 'Ese producto ya fue cancelado'}, status=status.HTTP_400_BAD_REQUEST)

                # Revertir stock+costo de esta línea al ledger.
                revertir_stock_detalle(detalle)

                detalle.estado = "Cancelado"
                detalle.save()
                referencia = f"Línea de Pedido #{pedido.id} cancelada"
                registrar_pre_reserva(detalle, 'cancelada', 'cancelacion_linea',
                                      detalle.unidades_pendientes, referencia=referencia, usuario=request.user)

                # Recalcular el total del pedido con las líneas que siguen activas.
                lineas_activas = pedido.detalles.exclude(estado="Cancelado")
                pedido.total = lineas_activas.aggregate(
                    total=Sum('total_venta')
                )['total'] or Decimal('0.00')

                if not lineas_activas.exists():
                    # No queda nada vivo en el pedido: se anula completo.
                    pedido.estado = "Anulado"
                else:
                    # Si la línea cancelada era la única pre-reserva, el pedido
                    # vuelve a Reservado.
                    actualizar_estado_pre_reserva(pedido)

                pedido.save()

                # Lo devuelto puede cubrir pre-reservas de otros pedidos (o de
                # otra línea de este mismo).
                if not detalle.congelado:
                    asignar_pre_reservas(detalle.producto, 'cancelacion_linea', referencia, request.user)
                pedido.refresh_from_db()

                return Response(PedidoSerializer(pedido).data, status=status.HTTP_200_OK)

        except Pedido.DoesNotExist:
            return Response({'error': 'Pedido no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': f'Error: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)


class AgregarProductoPedido(APIView):
    """Agrega una línea de producto NUEVA a un pedido ya creado.

    Sigue la misma lógica de consumo de stock que CrearPedido (consumir_fifo
    para las facturas/costo, descontar_kilos_fifo si ya viene pesado), para
    que la línea agregada quede idéntica a una creada junto con el pedido.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        pedido_id = request.data.get('pedido_id')
        producto_id = request.data.get('producto_id')

        if not pedido_id or not producto_id:
            return Response(
                {'error': 'pedido_id y producto_id son obligatorios'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            with transaction.atomic():
                pedido = Pedido.objects.select_for_update().get(id=pedido_id)

                if pedido.estado == "Anulado":
                    return Response({'error': 'El pedido está Anulado'}, status=status.HTTP_400_BAD_REQUEST)

                try:
                    producto = Producto.objects.get(id=producto_id)
                except Producto.DoesNotExist:
                    return Response({'error': f"Producto con ID {producto_id} no existe"}, status=status.HTTP_404_NOT_FOUND)

                kilos = Decimal(str(request.data.get('cantidad_kilos') or 0).replace(',', '.'))
                unidades = int(Decimal(str(request.data.get('cantidad_unidades') or 0).replace(',', '.')))
                if kilos <= 0:
                    kilos = Decimal('0.00')

                # Igual que en CrearPedido (misma función): precio propio de esta línea.
                cfg = parse_precio_linea(request.data)
                linea = crear_linea_pedido(
                    pedido, producto, unidades, kilos, cfg,
                    congelado=_es_verdadero(request.data.get('congelado')),
                    permitir_pre_reserva=_es_verdadero(request.data.get('permitir_pre_reserva')),
                    origen='agregar_producto', usuario=request.user,
                )
                recalcular_total_pedido(pedido)

                # Si el pedido ya estaba Preparado/Pagado y la línea nueva viene
                # sin pesar, no lo degradamos; si estaba Reservado y esta línea
                # trae peso, sigue el mismo criterio que CrearPedido.
                if pedido.estado == "Reservado" and kilos > 0:
                    pedido.estado = "Preparado"
                if linea.unidades_pendientes > 0 and pedido.estado in ("Preparado", "Pagado"):
                    raise ValidationError(
                        f"No hay stock suficiente de '{producto.nombre}' y el pedido ya está "
                        f"{pedido.estado}: una pre-reserva solo puede ir en un pedido sin preparar")
                actualizar_estado_pre_reserva(pedido)

                pedido.save()

                return Response(PedidoSerializer(pedido).data, status=status.HTTP_201_CREATED)

        except Pedido.DoesNotExist:
            return Response({'error': 'Pedido no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except ValidationError as e:
            return _error_de_validacion(e)
        except Exception as e:
            return Response({'error': f'Error al agregar el producto: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)


class ObtenerPedido(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, pedido_id, *args, **kwargs):
        try:
            pedido = Pedido.objects.get(id=pedido_id)
            serializer = PedidoSerializer(pedido)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except Pedido.DoesNotExist:
            return Response({'error': 'Pedido no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        

from django.db.models import Sum, Count

from rest_framework import generics

class UpdateCliente(generics.UpdateAPIView):
    permission_classes = [IsAuthenticated]
    queryset = Cliente.objects.all()
    serializer_class = ClienteSerializer
    lookup_field = 'pk'


class StockProductos(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, *args, **kwargs):
        productos = Producto.objects.exclude(estado="desactivado")
        stock_data = []

        # Todo se agrupa por producto en 3 consultas fijas, en vez de 3 por
        # producto: con la base remota cada consulta cuesta un viaje de red.
        # El stock congelado es un pool aparte, por eso se agrupa también
        # por `congelado`: no cuenta como disponible para vender normal.
        reales_por_producto = {
            (r['producto'], r['congelado']): r
            for r in EntradaProducto.objects.values('producto', 'congelado').annotate(
                u=Sum('cantidad_unidades'),
                k=Sum('cantidad_kilos'),
            )
        }
        # Reservas: pedidos no anulados sin kilos. Las pre-reservas
        # (unidades_pendientes) no descontaron stock: esas unidades todavía no existen.
        reservas_por_producto = {
            (r['producto'], r['congelado']): r
            for r in DetallePedido.objects.filter(cantidad_kilos=0)
            .exclude(pedido__estado="Anulado").exclude(estado="Cancelado")
            .values('producto', 'congelado')
            .annotate(u=Sum('cantidad_unidades'), p=Sum('unidades_pendientes'))
        }
        lotes_por_producto = {}
        for e in EntradaProducto.objects.filter(cantidad_unidades__gt=0).order_by('fecha_entrada'):
            lotes_por_producto.setdefault((e.producto_id, e.congelado), []).append(
                {'unidades': e.cantidad_unidades, 'costo_por_kilo': e.costo_por_kilo}
            )

        for producto in productos:
            # DISPONIBLES: se calcula EXACTAMENTE igual que el chequeo de stock
            # de CrearPedido (Sum de EntradaProducto), que es el ledger real que
            # se descuenta con cada venta/reserva (consumir_fifo) y se restaura
            # al anular un pedido (CancelarPedido). Antes esto se recalculaba
            # de forma independiente a partir de DetalleFactura/DetallePedido/
            # AjusteInventario, y con el tiempo esa cuenta paralela se
            # desincronizaba del ledger real: la pantalla mostraba stock que
            # CrearPedido igual rechazaba por "No hay suficiente stock".
            # Usar la misma fuente que el chequeo real hace que ambos numeros
            # NUNCA puedan divergir.
            reales = reales_por_producto.get((producto.id, False), {})
            disponibles = reales.get('u') or 0
            kilos_actuales = reales.get('k') or 0
            congelado = reales_por_producto.get((producto.id, True), {})

            # Reservas: pedidos no anulados sin kilos (ya descontaron unidades
            # del ledger real, pero siguen fisicamente en bodega esperando).
            # Las pre-reservas no: esas unidades todavía no existen.
            res_normal = reservas_por_producto.get((producto.id, False), {})
            res_congelado = reservas_por_producto.get((producto.id, True), {})
            pre_reservas = (res_normal.get('p') or 0) + (res_congelado.get('p') or 0)
            unidades_reservadas = (
                (res_normal.get('u') or 0) + (res_congelado.get('u') or 0) - pre_reservas
            )
            reservas_congelado = res_congelado.get('u') or 0

            # Stock físico = disponibles + lo reservado (que sigue en la repisa).
            stock_fisico = disponibles + unidades_reservadas - reservas_congelado

            # Lotes vivos en orden FIFO: con esto Nuevo Pedido estima el costo/kg
            # exacto que tendrá la línea (mismo ponderado por unidades que
            # costo_por_kilo_ponderado) y avisa si un precio queda bajo costo.
            lotes = lotes_por_producto.get((producto.id, False), [])
            lotes_congelado = lotes_por_producto.get((producto.id, True), [])

            stock_data.append({
                'id': producto.id,
                'producto': producto.nombre,
                'precio_por_kilo': producto.precio_por_kilo,
                'categoria': producto.categoria,
                'venta_por_unidad': producto.venta_por_unidad,
                'peso_flyer': producto.peso_flyer,
                'disponibles': disponibles,
                'estado': producto.estado,
                'stock': stock_fisico,
                'reservas': unidades_reservadas,
                'kilos_actuales': round(kilos_actuales, 2),
                'lotes': lotes,
                'pre_reservas': pre_reservas,
                'congelado_unidades': congelado.get('u') or 0,
                'congelado_kilos': round(congelado.get('k') or 0, 2),
                'congelado_reservas': reservas_congelado,
                'lotes_congelado': lotes_congelado,
            })

        return Response(stock_data, status=status.HTTP_200_OK)


from .serializers import DetalleFacturaSerializer, DetallePedidoSerializer


# views.py

class PagoVendedorView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        vendedor_id = request.query_params.get('vendedor')
        if vendedor_id:
            pagos = PagoVendedor.objects.filter(vendedor_id=vendedor_id).order_by('-fecha')
        else:
            pagos = PagoVendedor.objects.all().order_by('-fecha')
        
        # Opcional: podrías usar el serializer o devolver datos crudos
        data = [{
            "id": p.id,
            "vendedor": p.vendedor.id,
            "monto": p.monto,
            "comentario": p.comentario,
            "tipo": p.tipo,
            "fecha": p.fecha,
            "comprobante": p.comprobante.url if p.comprobante else None
        } for p in pagos]
        return Response({"data": data}, status=status.HTTP_200_OK)

    def post(self, request):
        # Para manejar archivos (FormData), usamos request.data
        try:
            vendedor = Vendedor.objects.get(id=request.data.get('vendedor'))
            pago = PagoVendedor.objects.create(
                vendedor=vendedor,
                monto=Decimal(request.data.get('monto')),
                comentario=request.data.get('comentario', ''),
                tipo=request.data.get('tipo', 'pago'),
                comprobante=request.FILES.get('comprobante')
            )
            return Response({'message': 'Registrado con éxito'}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class PagoVendedorDetailView(APIView):
    """Borra un pago/adelanto mal ingresado (no hay otro efecto contable)."""
    permission_classes = [IsAuthenticated]
    def delete(self, request, pk):
        try:
            pago = PagoVendedor.objects.get(pk=pk)
        except PagoVendedor.DoesNotExist:
            return Response({'error': 'Movimiento no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        if pago.comprobante:
            pago.comprobante.delete(save=False)
        pago.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

class DetalleFacturasList(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        # Optimizamos con select_related para traer nombres de productos/proveedores en una sola consulta
        detalles = DetalleFactura.objects.select_related('factura__proveedor', 'producto').order_by('-factura__fecha', '-factura__numero_factura')
        serializer = DetalleFacturaSerializer(detalles, many=True)
        return Response(serializer.data)

class DetallePedidosList(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        # Excluimos los pedidos Anulados y las lineas Canceladas: al anular o al
        # cancelar una linea, se devuelven las unidades al ledger
        # (EntradaProducto) pero a proposito NO se borra el DetallePedido (se
        # conserva el historial de que se vendio). Si esta lista los siguiera
        # devolviendo, la pantalla de Movimientos y su export a Excel restarian
        # una salida que el stock ya revirtio, y la cuenta manual "entradas -
        # salidas" nunca cuadraria con el dashboard.
        detalles = DetallePedido.objects.select_related(
            'pedido__cliente', 'pedido__vendedor', 'producto'
        ).prefetch_related('facturas').exclude(pedido__estado="Anulado").exclude(estado="Cancelado")
        serializer = DetallePedidoSerializer(detalles, many=True)
        return Response(serializer.data)

class UpdateProducto(APIView):
    permission_classes = [IsAuthenticated]
    def put(self, request, producto_id, *args, **kwargs):
        try:
            producto = Producto.objects.get(id=producto_id)
            data = request.data
            precio_anterior = producto.precio_por_kilo

            # Actualizamos todos los campos enviados desde el Frontend
            producto.nombre = data.get('nombre', producto.nombre)
            producto.precio_por_kilo = data.get('precio_por_kilo', producto.precio_por_kilo)
            producto.peso_minimo = data.get('peso_minimo', producto.peso_minimo)
            producto.estado = data.get('estado', producto.estado)
            producto.categoria = data.get('categoria', producto.categoria)
            producto.descripcion = data.get('descripcion', producto.descripcion)
            producto.venta_por_unidad = data.get('venta_por_unidad', producto.venta_por_unidad)
            producto.peso_flyer = (data.get('peso_flyer', producto.peso_flyer) or '').strip()

            producto.save()

            if Decimal(precio_anterior) != Decimal(producto.precio_por_kilo):
                HistorialPrecioProducto.objects.create(
                    producto=producto,
                    precio_anterior=precio_anterior,
                    precio_nuevo=producto.precio_por_kilo,
                    usuario=request.user,
                )

            return Response(ProductoSerializer(producto).data, status=status.HTTP_200_OK)
        except Producto.DoesNotExist:
            return Response({'error': 'Producto no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class HistorialPrecioProductoView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, producto_id, *args, **kwargs):
        historial = HistorialPrecioProducto.objects.filter(
            producto_id=producto_id
        ).select_related('usuario', 'usuario__vendedor_profile').order_by('-fecha_cambio')
        serializer = HistorialPrecioProductoSerializer(historial, many=True)
        return Response(serializer.data)
        
# Nueva vista para Proveedores
class ProveedorListView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        proveedores = Proveedor.objects.annotate(cantidad_facturas=Count('facturas')).order_by('nombre')
        serializer = ProveedorSerializer(proveedores, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):
        serializer = ProveedorSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({'error': _primer_error(serializer.errors)}, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ProveedorDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, pk):
        try:
            proveedor = Proveedor.objects.get(pk=pk)
        except Proveedor.DoesNotExist:
            return Response({'error': 'Proveedor no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        serializer = ProveedorSerializer(proveedor, data=request.data)
        if not serializer.is_valid():
            return Response({'error': _primer_error(serializer.errors)}, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request, pk):
        try:
            proveedor = Proveedor.objects.get(pk=pk)
        except Proveedor.DoesNotExist:
            return Response({'error': 'Proveedor no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        # Factura.proveedor es PROTECT: no se puede borrar un proveedor con facturas.
        if proveedor.facturas.exists():
            return Response(
                {'error': 'No se puede eliminar: el proveedor tiene facturas asociadas'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        proveedor.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _primer_error(errors):
    """Devuelve el primer mensaje de error de un serializer como texto plano."""
    for mensajes in errors.values():
        if isinstance(mensajes, list) and mensajes:
            return str(mensajes[0])
    return 'Datos inválidos'


class StockProductosView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        productos = Producto.objects.all()
        stock_data = []

        for producto in productos:
            # 1. Calcular Entradas (Compras)
            entradas_kilos = EntradaProducto.objects.filter(
                producto=producto
            ).aggregate(total=Sum('cantidad_kilos'))['total'] or 0
            
            entradas_unidades = EntradaProducto.objects.filter(
                producto=producto
            ).aggregate(total=Sum('cantidad_unidades'))['total'] or 0

            # 2. Calcular Salidas (Ventas - Solo pedidos no anulados)
            salidas = DetallePedido.objects.filter(
                producto=producto
            ).exclude(pedido__estado="Anulado").exclude(estado="Cancelado")
            
            salidas_kilos = salidas.aggregate(total=Sum('cantidad_kilos'))['total'] or 0
            salidas_unidades = salidas.aggregate(total=Sum('cantidad_unidades'))['total'] or 0

            # 3. Calcular Ajustes (Mermas o Inventario Manual)
            # Los ajustes ya vienen firmados: merma en negativo, exceso en positivo.
            ajustes_agg = AjusteInventario.objects.filter(
                producto=producto
            ).aggregate(
                total_kilos=Sum('cantidad'),
                total_unidades=Sum('cantidad_unidades'),
            )
            ajustes_kilos = ajustes_agg['total_kilos'] or 0
            ajustes_unidades = ajustes_agg['total_unidades'] or 0

            # 4. Cálculo Final
            stock_kilos = (entradas_kilos - salidas_kilos) + ajustes_kilos
            stock_unidades = (entradas_unidades - salidas_unidades) + ajustes_unidades

            stock_data.append({
                'id': producto.id,
                'nombre': producto.nombre,
                'categoria': producto.categoria,
                'stock_kilos': round(stock_kilos, 2),
                'stock_unidades': int(stock_unidades),
                'precio_kilo': producto.precio_por_kilo,
                'valor_inventario_estimado': round(stock_kilos * producto.precio_por_kilo, 2),
                'estado': 'Crítico' if stock_kilos < 10 else 'Normal' # Ejemplo de alerta
            })

        return Response(stock_data, status=status.HTTP_200_OK)


class AjusteInventarioListView(APIView):
    """Lista los ajustes de inventario (mermas, excesos y ajustes manuales)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ajustes = AjusteInventario.objects.select_related('producto').order_by('-fecha', '-id')

        producto_id = request.query_params.get('producto')
        if producto_id:
            ajustes = ajustes.filter(producto_id=producto_id)

        tipo = request.query_params.get('tipo')
        if tipo:
            ajustes = ajustes.filter(tipo=tipo)

        serializer = AjusteInventarioSerializer(ajustes, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


def _aplicar_ajuste_en_ledger(producto, cantidad, cantidad_unidades):
    """Aplica al ledger (``EntradaProducto``) el efecto de un ajuste YA FIRMADO.

    Kilos y unidades son magnitudes independientes y se mueven por separado:
    lo negativo baja por FIFO y lo positivo se suma al lote vivo mas antiguo
    (ver docstring de ``CrearAjusteInventario``).
    """
    if cantidad_unidades < 0:
        consumir_fifo(producto, abs(cantidad_unidades))
    if cantidad < 0:
        descontar_kilos_fifo(producto, abs(cantidad))
    if cantidad_unidades > 0 or cantidad > 0:
        agregar_exceso_fifo(
            producto,
            cantidad_unidades if cantidad_unidades > 0 else 0,
            cantidad if cantidad > 0 else Decimal('0'),
        )


def _revertir_ajuste_en_ledger(ajuste):
    """Deshace en el ledger el movimiento que hizo ``ajuste`` al registrarse.

    Es el espejo de ``_aplicar_ajuste_en_ledger``: lo que se descontó vuelve al
    lote vivo mas antiguo (mismo criterio que las correcciones de pesaje en un
    pedido) y lo que se sumó se vuelve a descontar por FIFO.

    Si el ledger no admite la reversion — por ejemplo, el producto ya no tiene
    ningun lote vivo donde devolver los kilos de una merma — levanta
    ValidationError y el llamador debe abortar la transaccion completa.
    """
    producto = ajuste.producto
    cantidad = Decimal(str(ajuste.cantidad or 0))
    cantidad_unidades = int(ajuste.cantidad_unidades or 0)

    if cantidad_unidades < 0:
        restituir_unidades_fifo(producto, abs(cantidad_unidades))
    if cantidad < 0:
        restituir_kilos_fifo(producto, abs(cantidad))
    if cantidad_unidades > 0:
        consumir_fifo(producto, cantidad_unidades)
    if cantidad > 0:
        descontar_kilos_fifo(producto, cantidad)


def _validar_datos_ajuste(data, ajuste_actual=None):
    """Valida y firma el payload de un ajuste, para crear o para editar.

    Devuelve ``(datos, None)`` con los valores listos para guardar, o
    ``(None, (mensaje, status))`` si algo no cuadra. Al editar, los campos que
    no vengan en el payload se toman de ``ajuste_actual``, asi que una edicion
    parcial (solo la razon, solo los kilos) no obliga a reenviar todo.

    El signo lo decide siempre el ``tipo``, tambien al editar: si una merma
    pasa a exceso, la magnitud guardada cambia de signo aunque el usuario no
    haya tocado las cantidades.
    """
    def _campo(nombre, actual):
        return data.get(nombre) if nombre in data else actual

    producto_id = _campo('producto', ajuste_actual.producto_id if ajuste_actual else None)
    tipo = _campo('tipo', ajuste_actual.tipo if ajuste_actual else None)
    cantidad = _campo('cantidad', ajuste_actual.cantidad if ajuste_actual else None)
    cantidad_unidades = _campo(
        'cantidad_unidades', ajuste_actual.cantidad_unidades if ajuste_actual else None
    )
    razon = _campo('razon', ajuste_actual.razon if ajuste_actual else '') or ''

    if not producto_id or not tipo:
        return None, ('Faltan datos obligatorios (producto, tipo)', status.HTTP_400_BAD_REQUEST)

    if tipo not in dict(AjusteInventario.TIPO_AJUSTE):
        return None, ('Tipo de ajuste inválido', status.HTTP_400_BAD_REQUEST)

    try:
        producto = Producto.objects.get(id=producto_id)
    except Producto.DoesNotExist:
        return None, ('Producto no encontrado', status.HTTP_404_NOT_FOUND)

    try:
        cantidad = Decimal(str(cantidad)) if cantidad not in (None, '') else Decimal('0')
    except Exception:
        return None, ('Cantidad en kilos inválida', status.HTTP_400_BAD_REQUEST)

    try:
        cantidad_unidades = int(cantidad_unidades) if cantidad_unidades not in (None, '') else 0
    except Exception:
        return None, ('Cantidad de unidades inválida', status.HTTP_400_BAD_REQUEST)

    if cantidad == 0 and cantidad_unidades == 0:
        return None, (
            'Debes ingresar una cantidad en kilos o en unidades distinta de cero',
            status.HTTP_400_BAD_REQUEST,
        )

    if tipo == 'merma':
        cantidad = -abs(cantidad)
        cantidad_unidades = -abs(cantidad_unidades)
    elif tipo == 'exceso':
        cantidad = abs(cantidad)
        cantidad_unidades = abs(cantidad_unidades)

    return {
        'producto': producto,
        'tipo': tipo,
        'cantidad': cantidad,
        'cantidad_unidades': cantidad_unidades,
        'razon': razon,
    }, None


def _error_de_validacion(e):
    """Extrae el texto de un ValidationError de DRF para devolverlo como error."""
    detail = e.detail if hasattr(e, 'detail') else str(e)
    mensaje = detail[0] if isinstance(detail, list) and detail else detail
    return Response({'error': str(mensaje)}, status=status.HTTP_400_BAD_REQUEST)


class CrearAjusteInventario(APIView):
    """
    Registra un ajuste de inventario (merma, exceso o ajuste manual).

    El ajuste se registra en kilos (`cantidad`) y/o en unidades
    (`cantidad_unidades`); basta con que uno de los dos sea distinto de cero.

    El usuario siempre ingresa la magnitud como un valor positivo; el signo con
    el que se guarda lo decide el `tipo`:
      - merma: siempre resta stock -> se guarda en negativo.
      - exceso: siempre suma stock -> se guarda en positivo.
      - ajuste: corrección manual libre -> se respeta el signo enviado.

    EFECTO SOBRE EL STOCK
    Todo ajuste (negativo o positivo) mueve de verdad el ledger
    `EntradaProducto`, que es la unica fuente del stock que muestra el
    dashboard (StockProductos) y contra la que valida CrearPedido. Antes esta
    vista solo dejaba el registro contable en AjusteInventario y el stock no
    se movia: se registraba una merma o un exceso y el dashboard seguia igual.

    Un exceso (o un ajuste manual con signo positivo) suma al lote MAS
    ANTIGUO del producto via `agregar_exceso_fifo` (no tiene factura ni costo
    propio, asi que no se puede crear un lote nuevo con esos datos). Si el
    producto no tiene ningun lote todavia, el ajuste se rechaza: registra
    primero una compra (EntradaProducto) para ese producto.

    Kilos y unidades se descuentan por separado, porque en el ledger son dos
    magnitudes independientes: las unidades bajan por FIFO (consumir_fifo) y los
    kilos por su propio FIFO (descontar_kilos_fifo). Los dos valores que escribe
    el usuario son cantidades REALES declaradas, asi que ambos se aplican tal
    cual — no se estima uno a partir del otro.

    Eso permite las tres formas de merma:
      - kilos y unidades: se fue una pieza entera y se sabe cuanto pesaba.
      - solo unidades: desaparecio una pieza sin pesar.
      - solo kilos: merma de peso (goteo, recorte); la pieza sigue en la repisa
        pero pesa menos.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        datos, error = _validar_datos_ajuste(request.data)
        if error:
            return Response({'error': error[0]}, status=error[1])

        try:
            with transaction.atomic():
                ajuste = AjusteInventario.objects.create(
                    producto=datos['producto'],
                    cantidad=datos['cantidad'],
                    cantidad_unidades=datos['cantidad_unidades'],
                    tipo=datos['tipo'],
                    razon=datos['razon'],
                )

                # Impacto real en el stock. Los ajustes negativos descuentan del
                # ledger; los positivos (exceso, o ajuste manual en positivo) suman
                # al lote mas antiguo — ver docstring de la clase.
                _aplicar_ajuste_en_ledger(
                    datos['producto'], datos['cantidad'], datos['cantidad_unidades']
                )
                if datos['cantidad_unidades'] > 0:
                    asignar_pre_reservas(datos['producto'], 'ajuste_inventario',
                                         f"Ajuste #{ajuste.id} ({ajuste.tipo})", request.user)

        except ValidationError as e:
            return _error_de_validacion(e)

        return Response(AjusteInventarioSerializer(ajuste).data, status=status.HTTP_201_CREATED)


class AjusteInventarioDetailView(APIView):
    """Edita (PUT/PATCH) o elimina (DELETE) un ajuste de inventario.

    Un ajuste no es solo un registro contable: al crearse movio de verdad el
    ledger ``EntradaProducto``, que es la unica fuente del stock que muestra el
    dashboard (ver ``CrearAjusteInventario``). Por eso corregir o borrar una
    merma tiene que DESHACER primero ese movimiento y, al editar, aplicar
    despues el nuevo. Si solo se tocara la fila de AjusteInventario, la lista de
    mermas y el stock quedarian contando cosas distintas.

    Editar es entonces "revertir + aplicar", no un delta: asi da lo mismo que
    cambie la cantidad, el tipo o incluso el producto (una merma cargada al
    producto equivocado se devuelve al original y se descuenta del correcto).

    Todo ocurre en UNA transaccion. Si el ledger no admite la reversion — el
    producto ya no tiene ningun lote vivo donde devolver los kilos, o el nuevo
    valor no alcanza a descontarse — no se toca nada y se devuelve el error.
    """
    permission_classes = [IsAuthenticated]

    def _get_ajuste(self, pk):
        return AjusteInventario.objects.select_related('producto').filter(pk=pk).first()

    def put(self, request, pk, *args, **kwargs):
        ajuste = self._get_ajuste(pk)
        if ajuste is None:
            return Response({'error': 'Ajuste no encontrado'}, status=status.HTTP_404_NOT_FOUND)

        datos, error = _validar_datos_ajuste(request.data, ajuste_actual=ajuste)
        if error:
            return Response({'error': error[0]}, status=error[1])

        try:
            with transaction.atomic():
                _revertir_ajuste_en_ledger(ajuste)
                producto_anterior = ajuste.producto

                ajuste.producto = datos['producto']
                ajuste.tipo = datos['tipo']
                ajuste.cantidad = datos['cantidad']
                ajuste.cantidad_unidades = datos['cantidad_unidades']
                ajuste.razon = datos['razon']
                ajuste.save()

                _aplicar_ajuste_en_ledger(
                    datos['producto'], datos['cantidad'], datos['cantidad_unidades']
                )
                # Revertir una merma o aplicar un exceso puede dejar unidades
                # libres en cualquiera de los dos productos.
                for producto in {producto_anterior.id: producto_anterior, datos['producto'].id: datos['producto']}.values():
                    asignar_pre_reservas(producto, 'ajuste_inventario',
                                         f"Ajuste #{ajuste.id} editado", request.user)
        except ValidationError as e:
            return _error_de_validacion(e)

        return Response(AjusteInventarioSerializer(ajuste).data, status=status.HTTP_200_OK)

    def patch(self, request, pk, *args, **kwargs):
        return self.put(request, pk, *args, **kwargs)

    def delete(self, request, pk, *args, **kwargs):
        ajuste = self._get_ajuste(pk)
        if ajuste is None:
            return Response({'error': 'Ajuste no encontrado'}, status=status.HTTP_404_NOT_FOUND)

        try:
            with transaction.atomic():
                _revertir_ajuste_en_ledger(ajuste)
                referencia = f"Ajuste #{ajuste.id} ({ajuste.tipo}) eliminado"
                producto = ajuste.producto
                ajuste.delete()
                # Borrar una merma devuelve sus unidades al inventario.
                asignar_pre_reservas(producto, 'ajuste_inventario', referencia, request.user)
        except ValidationError as e:
            return _error_de_validacion(e)

        return Response(status=status.HTTP_204_NO_CONTENT)


class RegistroPreReservaView(APIView):
    """GET: auditoría de pre-reservas, la más reciente primero. Filtros
    opcionales: ?pedido=<id>, ?producto=<id>, ?evento=<evento>."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        registros = RegistroPreReserva.objects.select_related(
            'producto', 'pedido__cliente', 'usuario', 'factura__proveedor')
        for campo in ('pedido', 'producto', 'evento'):
            valor = request.query_params.get(campo)
            if valor:
                registros = registros.filter(**{f"{campo}_id" if campo != 'evento' else campo: valor})
        return Response(RegistroPreReservaSerializer(registros[:500], many=True).data)


class MovimientoCongeladoView(APIView):
    """GET: historial de movimientos entre inventario y congelado.
    POST: {producto, cantidad_unidades, cantidad_kilos?, direccion, razon?}
    mueve los lotes (ver mover_stock_congelado) y deja el registro.

    ``direccion``: 'congelar' (inventario -> congelado, default) o
    'descongelar' (congelado -> inventario). Si se descongela, el stock que
    vuelve al inventario puede cubrir pre-reservas pendientes."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        movimientos = MovimientoCongelado.objects.select_related('producto', 'usuario')
        producto_id = request.query_params.get('producto')
        if producto_id:
            movimientos = movimientos.filter(producto_id=producto_id)
        return Response(MovimientoCongeladoSerializer(movimientos, many=True).data)

    def post(self, request):
        data = request.data
        direccion = data.get('direccion') or 'congelar'
        if direccion not in dict(MovimientoCongelado.DIRECCIONES):
            return Response({'error': 'Dirección inválida'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            producto = Producto.objects.get(id=data.get('producto'))
        except (Producto.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'Producto no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        try:
            unidades = int(Decimal(str(data.get('cantidad_unidades') or 0).replace(',', '.')))
            kilos_raw = data.get('cantidad_kilos')
            kilos = (Decimal(str(kilos_raw).replace(',', '.'))
                     if kilos_raw not in (None, '') else None)
        except (InvalidOperation, ValueError):
            return Response({'error': 'Cantidad inválida'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                unidades, kilos_movidos = mover_stock_congelado(
                    producto, unidades, kilos, a_congelado=(direccion == 'congelar'))
                movimiento = MovimientoCongelado.objects.create(
                    producto=producto, direccion=direccion,
                    cantidad_unidades=unidades, cantidad_kilos=kilos_movidos,
                    razon=(data.get('razon') or '').strip(),
                    usuario=request.user if request.user.is_authenticated else None,
                )
                pre_reservas = asignar_pre_reservas(
                    producto, 'descongelar', f"Movimiento de congelado #{movimiento.id}", request.user,
                ) if direccion == 'descongelar' else []
        except ValidationError as e:
            return _error_de_validacion(e)

        respuesta = MovimientoCongeladoSerializer(movimiento).data
        respuesta['pre_reservas_asignadas'] = pre_reservas
        return Response(respuesta, status=status.HTTP_201_CREATED)


# ============================================================================
# REPORTES FINANCIEROS (Plan 03 — Ganancias, Márgenes y Estadísticas)
# ============================================================================
from django.db.models import Avg, F, OuterRef, Subquery, DecimalField
from django.db.models.functions import TruncMonth, TruncDate, Coalesce


# Los costos de compra se ingresan SIN IVA (ver Facturas.tsx: subtotal/costo_por_kilo
# son netos, el IVA se calcula aparte). El precio de venta (Producto.precio_por_kilo /
# DetallePedido.total_venta), en cambio, es el precio de boleta que paga el cliente y
# YA INCLUYE el 19% de IVA. La ganancia contable real debe restar montos NETOS en
# ambos lados (venta sin IVA - costo sin IVA): si se resta el costo con IVA de la venta
# bruta (como se hacía antes), la "ganancia" queda inflada exactamente por el débito
# fiscal que en realidad corresponde enterar al Fisco (neteado del crédito fiscal de
# las compras). Los campos DetallePedido.total_costo/margen quedaron persistidos con el
# costo neto (bug de origen), por eso los reportes recalculan la ganancia en vez de
# confiar en Sum('margen').
IVA_RATE = Decimal('1.19')


def _desglose_iva(ventas_con_iva, costo_neto):
    """
    A partir de ventas CON IVA incluido (precio de boleta) y costo neto de compra
    (tal como se ingresa en la Factura), devuelve:
    - ventas_neto: venta sin IVA
    - ganancia: ganancia contable real (ventas_neto - costo_neto)
    - iva_debito: IVA recargado en la venta (a favor del Fisco)
    - iva_credito: IVA pagado en la compra (crédito fiscal, a favor del negocio)
    - iva_a_pagar: iva_debito - iva_credito (si es negativo, es crédito/remanente
      a favor del negocio, no un pago)
    """
    ventas_neto = ventas_con_iva / IVA_RATE
    ganancia = ventas_neto - costo_neto
    iva_debito = ventas_con_iva - ventas_neto
    iva_credito = costo_neto * (IVA_RATE - 1)
    iva_a_pagar = iva_debito - iva_credito
    return ventas_neto, ganancia, iva_debito, iva_credito, iva_a_pagar


def _detalles_ganancia_qs(request):
    """
    Base de agregación de ganancias: líneas de venta (DetallePedido)
    EXCLUYENDO pedidos Anulado y líneas Cancelado (de lo contrario las ventas
    revertidas inflarían la ganancia reportada). Acepta filtro opcional de
    rango de fechas vía ?desde=YYYY-MM-DD & ?hasta=YYYY-MM-DD sobre
    DetallePedido.fecha.
    """
    qs = DetallePedido.objects.exclude(pedido__estado="Anulado").exclude(estado="Cancelado")
    desde = request.query_params.get('desde')
    hasta = request.query_params.get('hasta')
    if desde:
        qs = qs.filter(fecha__gte=desde)
    if hasta:
        qs = qs.filter(fecha__lte=hasta)
    return qs


class ReporteGananciasView(APIView):
    """
    Agregación de ganancias sobre DetallePedido (pedidos NO anulados).
    Devuelve en una sola respuesta: total general, por producto ("corte"),
    por mes y por vendedor.

    La ganancia se RECALCULA netA de IVA en ambos lados (ver _desglose_iva) en
    vez de usar el campo persistido DetallePedido.margen, que mezcla venta
    bruta (con IVA) con costo neto y por lo tanto no representa ni la
    ganancia contable ni el costo real.

    'total' además incluye el desglose de IVA (débito de la venta, crédito de
    la compra y el neto a enterar/-recuperar), y 'por_mes' lo repite por mes
    porque el IVA se declara mensualmente (Formulario 29).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        detalles = _detalles_ganancia_qs(request)

        # --- Total general ---
        totales = detalles.aggregate(
            ventas=Coalesce(Sum('total_venta'), Decimal('0')),
            costo_neto=Coalesce(Sum('total_costo'), Decimal('0')),
            kilos=Coalesce(Sum('cantidad_kilos'), Decimal('0')),
        )
        ventas_neto, ganancia, *_ = _desglose_iva(
            totales['ventas'], totales['costo_neto']
        )
        margen_pct = float(ganancia / ventas_neto * 100) if ventas_neto else 0.0

        # --- Por producto / "corte" (= Producto.nombre) ---
        por_producto_raw = list(
            detalles.values('producto__id', 'producto__nombre')
            .annotate(
                ventas=Coalesce(Sum('total_venta'), Decimal('0')),
                costo_neto=Coalesce(Sum('total_costo'), Decimal('0')),
                kilos=Coalesce(Sum('cantidad_kilos'), Decimal('0')),
            )
        )
        por_producto = []
        for r in por_producto_raw:
            ventas_n, gan, *_ = _desglose_iva(r['ventas'], r['costo_neto'])
            por_producto.append({
                'producto_id': r['producto__id'],
                'nombre': r['producto__nombre'],
                'ganancia': gan,
                'ventas': ventas_n,
                'costo': r['costo_neto'],
                'kilos': r['kilos'],
                'margen_pct': float(gan / ventas_n * 100) if ventas_n else 0.0,
            })
        por_producto.sort(key=lambda x: x['ganancia'], reverse=True)

        # --- Por mes (con desglose de IVA, se declara mensualmente) ---
        por_mes_raw = list(
            detalles.annotate(mes=TruncMonth('fecha'))
            .values('mes')
            .annotate(
                ventas=Coalesce(Sum('total_venta'), Decimal('0')),
                costo_neto=Coalesce(Sum('total_costo'), Decimal('0')),
            )
            .order_by('mes')
        )
        # IVA como en el F29: crédito de las COMPRAS del mes (facturas - notas de
        # crédito + gastos con factura) y con remanente arrastrado. Antes el
        # crédito salía del costo de lo vendido, que no es lo que se declara.
        f29, _cfg = resumen_mensual(request.query_params.get('desde'), request.query_params.get('hasta'))
        f29_por_mes = {f['mes']: f for f in f29}
        por_mes = []
        for r in por_mes_raw:
            ventas_n, gan, *_ = _desglose_iva(r['ventas'], r['costo_neto'])
            mes = r['mes'].strftime('%Y-%m') if r['mes'] else None
            iva = f29_por_mes.get(mes, {})
            por_mes.append({
                'mes': mes,
                'ganancia': gan,
                'ventas': ventas_n,
                'costo': r['costo_neto'],
                'iva_debito': iva.get('iva_debito', Decimal('0')),
                'iva_credito': iva.get('iva_credito', Decimal('0')),
                'iva_a_pagar': iva.get('iva_a_pagar', Decimal('0')) - iva.get('remanente', Decimal('0')),
            })
        iva_debito = sum((f['iva_debito'] for f in f29), Decimal('0'))
        iva_credito = sum((f['iva_credito'] for f in f29), Decimal('0'))
        iva_a_pagar = sum((f['iva_a_pagar'] for f in f29), Decimal('0')) - (f29[-1]['remanente'] if f29 else 0)

        # --- Por vendedor ---
        por_vendedor_raw = list(
            detalles.values('pedido__vendedor__id', 'pedido__vendedor__nombre')
            .annotate(
                ventas=Coalesce(Sum('total_venta'), Decimal('0')),
                costo_neto=Coalesce(Sum('total_costo'), Decimal('0')),
            )
        )
        por_vendedor = []
        for r in por_vendedor_raw:
            ventas_n, gan, *_ = _desglose_iva(r['ventas'], r['costo_neto'])
            por_vendedor.append({
                'vendedor_id': r['pedido__vendedor__id'],
                'nombre': r['pedido__vendedor__nombre'] or 'Sin vendedor',
                'ganancia': gan,
                'ventas': ventas_n,
                'margen_pct': float(gan / ventas_n * 100) if ventas_n else 0.0,
            })
        por_vendedor.sort(key=lambda x: x['ganancia'], reverse=True)

        return Response({
            'total': {
                'ganancia': ganancia,
                'ventas': ventas_neto,
                'costo': totales['costo_neto'],
                'kilos': totales['kilos'],
                'margen_pct': round(margen_pct, 2),
                'iva_debito': iva_debito,
                'iva_credito': iva_credito,
                'iva_a_pagar': iva_a_pagar,
            },
            'por_producto': por_producto,
            'por_mes': por_mes,
            'por_vendedor': por_vendedor,
        }, status=status.HTTP_200_OK)


class ReportePerdidasView(APIView):
    """
    Pérdidas por mermas (AjusteInventario tipo 'merma').

    CRITERIO DE VALORIZACIÓN (decisión de negocio):
    AjusteInventario no tiene costo unitario propio, por lo que cada merma se
    valoriza con el costo_por_kilo NETO de la ÚLTIMA FACTURA de compra del
    producto (el costo de reposición más reciente). Sin IVA, igual que la
    ganancia: el IVA de la compra es crédito fiscal recuperable.

    El costo sale de DetalleFactura, NO de EntradaProducto: EntradaProducto es
    un ledger de stock que se decrementa y se BORRA por FIFO cuando un lote se
    consume entero (ver consumir_fifo en utils.py), asi que un producto sin
    lotes vivos no tiene ninguna entrada y sus mermas se valorizaban en 0
    aunque tuviera facturas de compra. DetalleFactura es el historico completo
    de compras y nunca se borra.

    Si el producto nunca se compro, la merma se valoriza en 0. La cantidad de
    la merma se toma en valor absoluto (las mermas suelen registrarse como
    cantidad negativa).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Valorización compartida con Tesorería (contabilidad.mermas_valorizadas):
        # costo NETO de la última compra; las mermas solo en piezas se estiman
        # con el peso promedio por pieza. Antes se multiplicaba por 1,19 (la
        # pérdida salía inflada) y las mermas en piezas valían $0.
        desde = request.query_params.get('desde')
        hasta = request.query_params.get('hasta')

        por_producto = {}
        por_mes = {}
        total_valor = Decimal('0')
        total_kilos = Decimal('0')

        for m, kilos, valor in mermas_valorizadas(desde, hasta):
            total_valor += valor
            total_kilos += kilos

            pid = m.producto_id
            if pid not in por_producto:
                por_producto[pid] = {
                    'producto_id': pid,
                    'nombre': m.producto.nombre,
                    'kilos': Decimal('0'),
                    'valor': Decimal('0'),
                }
            por_producto[pid]['kilos'] += kilos
            por_producto[pid]['valor'] += valor

            mes = m.fecha.strftime('%Y-%m') if m.fecha else 'Sin fecha'
            if mes not in por_mes:
                por_mes[mes] = {'mes': mes, 'kilos': Decimal('0'), 'valor': Decimal('0')}
            por_mes[mes]['kilos'] += kilos
            por_mes[mes]['valor'] += valor

        por_producto_list = sorted(por_producto.values(), key=lambda x: x['valor'], reverse=True)
        por_mes_list = sorted(por_mes.values(), key=lambda x: x['mes'])

        return Response({
            'total': {'valor': total_valor, 'kilos': total_kilos},
            'por_producto': por_producto_list,
            'por_mes': por_mes_list,
        }, status=status.HTTP_200_OK)


class FluctuacionPreciosView(APIView):
    """
    Series temporales de precios por producto:
    - compras: un punto POR CADA FACTURA de compra, tomado de DetalleFactura
      (el historico COMPLETO de compras — a diferencia de EntradaProducto,
      que es un ledger de stock que se decrementa y se BORRA por FIFO cuando
      un lote se vende entero, ver consumir_fifo en utils.py; usarlo aquí
      ocultaría el costo de cualquier factura ya agotada). Cada punto trae su
      costo_por_kilo real y número de factura. Antes se promediaba por mes,
      lo que además ocultaba el costo exacto de cada compra individual.
    - ventas: precio_venta desde DetallePedido (excluyendo pedidos Anulado),
      promediado por día (no por mes) para no perder resolución frente a la
      serie de compras.

    Siempre devuelve la lista de productos (para el selector). Si se pasa
    ?producto=<id> devuelve las dos series de ese producto.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        productos = list(Producto.objects.values('id', 'nombre').order_by('nombre'))
        producto_id = request.query_params.get('producto')

        compras = []
        ventas = []
        if producto_id:
            compras_qs = (
                DetalleFactura.objects.filter(producto_id=producto_id)
                .select_related('factura')
                .order_by('factura__fecha')
            )
            compras = [{
                'fecha': df.factura.fecha.isoformat() if df.factura.fecha else None,
                'costo': df.costo_por_kilo,
                'numero_factura': df.factura.numero_factura,
            } for df in compras_qs]

            ventas_qs = (
                DetallePedido.objects.filter(producto_id=producto_id)
                .exclude(pedido__estado="Anulado")
                .exclude(estado="Cancelado")
                .annotate(dia=TruncDate('fecha'))
                .values('dia')
                .annotate(precio=Avg('precio_venta'))
                .order_by('dia')
            )
            ventas = [{
                'fecha': r['dia'].isoformat() if r['dia'] else None,
                'precio': r['precio'],
            } for r in ventas_qs]

        return Response({
            'productos': productos,
            'producto_id': int(producto_id) if producto_id else None,
            'compras': compras,
            'ventas': ventas,
        }, status=status.HTTP_200_OK)


class MargenActualProductoView(APIView):
    """
    Margen actual por producto, para la vista previa en vivo al crear una
    Factura de compra. Por cada producto devuelve:
    - precio_por_kilo: precio de venta vigente (Producto.precio_por_kilo)
    - costo_reciente: último costo_por_kilo de EntradaProducto (SIN IVA, tal
      como se ingresa en la Factura de compra)
    - margen_unitario_actual / margen_pct_actual: precio de venta SIN IVA
      (precio / IVA_RATE, ya que precio_por_kilo es precio de boleta con IVA
      incluido) vs. costo reciente NETO, para que refleje la ganancia
      contable real y no el débito fiscal que corresponde enterar al Fisco.
      margen_pct_actual se expresa sobre el costo neto.
    - margen_pct_historico: margen promedio de ventas NO anuladas, recalculado
      como (ventas_neto - costo_neto) / ventas_neto del producto (no se usa
      el campo persistido DetallePedido.margen porque se guardó sin IVA).
    - costo_reciente: se sigue devolviendo CON IVA (costo real pagado en
      efectivo al proveedor), para mostrar en pantalla cuánto costó reponer
      el producto; el cálculo de margen internamente usa su versión neta.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        productos = Producto.objects.all()

        # Último costo conocido por producto (neto, sin IVA)
        ultimo_costo = {}
        for e in EntradaProducto.objects.order_by('producto_id', '-fecha_entrada'):
            if e.producto_id not in ultimo_costo:
                ultimo_costo[e.producto_id] = e.costo_por_kilo

        # Margen histórico por producto (ventas no anuladas, líneas no canceladas)
        hist = {
            r['producto_id']: r
            for r in DetallePedido.objects.exclude(pedido__estado="Anulado").exclude(estado="Cancelado")
            .values('producto_id')
            .annotate(costo_neto=Coalesce(Sum('total_costo'), Decimal('0')),
                      ventas=Coalesce(Sum('total_venta'), Decimal('0')))
        }

        data = []
        for p in productos:
            costo_reciente = ultimo_costo.get(p.id)
            costo_reciente_con_iva = (costo_reciente * IVA_RATE) if costo_reciente is not None else None
            precio = p.precio_por_kilo or Decimal('0')
            precio_neto = (precio / IVA_RATE) if precio else Decimal('0')
            margen_unit = (precio_neto - costo_reciente) if costo_reciente is not None else None
            # Porcentaje sobre el costo neto (base sobre la que se gana).
            margen_pct = float(margen_unit / costo_reciente * 100) if (margen_unit is not None and costo_reciente) else None

            h = hist.get(p.id)
            margen_pct_hist = None
            if h and h['ventas']:
                ventas_neto_hist = h['ventas'] / IVA_RATE
                ganancia_hist = ventas_neto_hist - h['costo_neto']
                margen_pct_hist = float(ganancia_hist / ventas_neto_hist * 100)

            data.append({
                'producto_id': p.id,
                'nombre': p.nombre,
                'precio_por_kilo': precio,
                'costo_reciente': costo_reciente_con_iva,
                'margen_unitario_actual': margen_unit,
                'margen_pct_actual': round(margen_pct, 2) if margen_pct is not None else None,
                'margen_pct_historico': round(margen_pct_hist, 2) if margen_pct_hist is not None else None,
            })

        return Response(data, status=status.HTTP_200_OK)


class RentabilidadHistoricaView(APIView):
    """
    Rentabilidad de un producto agrupada por PRECIO DE VENTA, desglosando
    dentro de cada precio los distintos costos reales de factura que
    abastecieron esas ventas (mismo criterio de atribución proporcional que
    DetallePedidoSerializer.get_facturas_detalle: los kilos de cada línea de
    venta se reparten entre las facturas consumidas en proporción a las
    unidades tomadas de cada una).

    Cada fila del resultado es un grupo (precio_venta, costo_por_kilo de una
    factura) con: kilos atribuidos, venta atribuida, costo atribuido (con
    IVA), ganancia y margen %. Si una línea de venta no tiene factura
    vinculada (dato legado), se agrupa bajo costo_por_kilo=None usando el
    costo ya calculado en la propia línea (DetallePedido.total_costo).

    Siempre devuelve la lista de productos (para el selector). Si se pasa
    ?producto=<id> devuelve además los grupos de ese producto, ordenados por
    precio de venta y luego por costo de factura.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        productos = list(Producto.objects.values('id', 'nombre').order_by('nombre'))
        producto_id = request.query_params.get('producto')

        periodos = []
        if producto_id:
            try:
                producto = Producto.objects.get(id=producto_id)
            except Producto.DoesNotExist:
                return Response({'error': 'Producto no encontrado'}, status=status.HTTP_404_NOT_FOUND)

            detalles = list(
                DetallePedido.objects.filter(producto_id=producto_id)
                .exclude(pedido__estado="Anulado").exclude(estado="Cancelado")
            )

            costo_por_factura = {
                df.factura_id: df.costo_por_kilo
                for df in DetalleFactura.objects.filter(producto_id=producto_id)
            }

            links_por_detalle = {}
            for link in FacturaDetallePedido.objects.filter(detallepedido__in=detalles):
                links_por_detalle.setdefault(link.detallepedido_id, []).append(link)

            # grupos: (precio_venta, costo_por_kilo|None) -> acumuladores
            grupos = {}
            fecha_maxima_global = None
            for d in detalles:
                if d.fecha and (fecha_maxima_global is None or d.fecha > fecha_maxima_global):
                    fecha_maxima_global = d.fecha

                links = links_por_detalle.get(d.id, [])
                total_unidades = sum(l.cantidad_unidades for l in links) or 0
                kilos_linea = Decimal(str(d.cantidad_kilos or 0))

                if not links or total_unidades == 0:
                    key = (d.precio_venta, None)
                    g = grupos.setdefault(key, {'kilos': Decimal('0'), 'venta': Decimal('0'), 'costo_neto': Decimal('0'), 'fechas': []})
                    g['kilos'] += kilos_linea
                    g['venta'] += d.total_venta or Decimal('0')
                    g['costo_neto'] += d.total_costo or Decimal('0')
                    g['fechas'].append(d.fecha)
                    continue

                for link in links:
                    costo_por_kilo = costo_por_factura.get(link.factura_id)
                    kilos_atrib = kilos_linea * Decimal(link.cantidad_unidades) / Decimal(total_unidades)
                    venta_atrib = kilos_atrib * (d.precio_venta or Decimal('0'))
                    costo_atrib = (kilos_atrib * costo_por_kilo) if costo_por_kilo is not None else Decimal('0')

                    key = (d.precio_venta, costo_por_kilo)
                    g = grupos.setdefault(key, {'kilos': Decimal('0'), 'venta': Decimal('0'), 'costo_neto': Decimal('0'), 'fechas': []})
                    g['kilos'] += kilos_atrib
                    g['venta'] += venta_atrib
                    g['costo_neto'] += costo_atrib
                    g['fechas'].append(d.fecha)

            for (precio, costo_por_kilo), g in sorted(
                grupos.items(), key=lambda kv: (kv[0][0], kv[0][1] if kv[0][1] is not None else Decimal('0'))
            ):
                # 'costo'/'costo_unitario' se muestran CON IVA (costo real pagado en
                # efectivo al proveedor), pero 'ganancia'/'margen_pct' se calculan
                # NETOS de IVA en ambos lados (venta sin IVA - costo neto): 'venta'
                # (g['venta']) es precio de boleta con IVA incluido, así que restarle
                # el costo con IVA inflaría la ganancia con el débito fiscal que en
                # realidad corresponde enterar al Fisco.
                costo_con_iva = g['costo_neto'] * IVA_RATE
                venta_neta = g['venta'] / IVA_RATE
                ganancia = venta_neta - g['costo_neto']
                margen_pct = float(ganancia / venta_neta * 100) if venta_neta else None
                costo_unitario = (costo_con_iva / g['kilos']) if g['kilos'] else None
                ganancia_unitaria = (ganancia / g['kilos']) if g['kilos'] else None
                fechas = [f for f in g['fechas'] if f]

                periodos.append({
                    'precio': precio,
                    'costo_por_kilo': costo_por_kilo,
                    # costo_unitario va CON IVA (costo_con_iva / kilos): es el costo real
                    # comparable contra 'precio' (precio de venta), a diferencia de
                    # costo_por_kilo que es el costo neto tal como se ingresa en la Factura.
                    'costo_unitario': round(costo_unitario, 2) if costo_unitario is not None else None,
                    'ganancia_unitaria': round(ganancia_unitaria, 2) if ganancia_unitaria is not None else None,
                    'desde': min(fechas).isoformat() if fechas else None,
                    'hasta': max(fechas).isoformat() if fechas else None,
                    'vigente': fecha_maxima_global is not None and fecha_maxima_global in fechas,
                    'kilos': g['kilos'],
                    'ventas': venta_neta,
                    'costo': g['costo_neto'],
                    'ganancia': ganancia,
                    'margen_pct': round(margen_pct, 2) if margen_pct is not None else None,
                })

        return Response({
            'productos': productos,
            'producto_id': int(producto_id) if producto_id else None,
            'periodos': periodos,
        }, status=status.HTTP_200_OK)

class CambiarPasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError
        from django.utils import translation

        actual = request.data.get('password_actual')
        nueva = request.data.get('password_nueva')

        if not actual or not nueva:
            return Response({'error': 'Faltan datos obligatorios'}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        # 400 (no 401) para no gatillar el refresh/logout del interceptor del frontend
        if not user.check_password(actual):
            return Response({'error': 'La contraseña actual es incorrecta'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with translation.override('es'):
                validate_password(nueva, user)
        except DjangoValidationError as e:
            with translation.override('es'):
                mensajes = [str(m) for m in e.messages]
            return Response({'error': ' '.join(mensajes)}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(nueva)
        user.save(update_fields=['password'])
        return Response({'mensaje': 'Contraseña actualizada correctamente'}, status=status.HTTP_200_OK)


class PerfilView(APIView):
    """Datos propios del usuario logueado para su flyer: teléfono, fotos y el
    mensaje de WhatsApp. Viven en PerfilUsuario (uno por usuario, tenga o no
    perfil de vendedor), así cada uno tiene los suyos y no hay uno general."""
    permission_classes = [IsAuthenticated]
    FOTOS = ('foto1', 'foto2', 'logo')

    def _perfil(self, user):
        perfil, creado = PerfilUsuario.objects.get_or_create(user=user)
        vendedor = getattr(user, 'vendedor_profile', None)
        if creado and vendedor and vendedor.telefono:
            # Hereda el teléfono que antes se guardaba en el Vendedor.
            perfil.telefono = vendedor.telefono
            perfil.save(update_fields=['telefono'])
        return perfil, vendedor

    def _respuesta(self, request, perfil, vendedor):
        return Response({
            'username': request.user.username,
            'nombre': vendedor.nombre if vendedor else request.user.username,
            'telefono': perfil.telefono,
            'mensaje_whatsapp': perfil.mensaje_whatsapp,
            'tiene_vendedor': vendedor is not None,
            'es_admin': request.user.is_staff,
            **{f: (getattr(perfil, f).url if getattr(perfil, f) else None) for f in self.FOTOS},
        }, status=status.HTTP_200_OK)

    def get(self, request):
        perfil, vendedor = self._perfil(request.user)
        return self._respuesta(request, perfil, vendedor)

    def patch(self, request):
        perfil, vendedor = self._perfil(request.user)
        if 'telefono' in request.data:
            telefono = str(request.data.get('telefono') or '').strip()
            if len(telefono) > 30:
                return Response({'error': 'El teléfono es demasiado largo'}, status=status.HTTP_400_BAD_REQUEST)
            perfil.telefono = telefono
        if 'mensaje_whatsapp' in request.data:
            perfil.mensaje_whatsapp = str(request.data.get('mensaje_whatsapp') or '')[:2000]
        for campo in self.FOTOS:
            if request.FILES.get(campo):
                archivo = request.FILES[campo]
                if not (archivo.content_type or '').startswith('image/'):
                    return Response({'error': 'La foto debe ser una imagen'}, status=status.HTTP_400_BAD_REQUEST)
                if archivo.size > 8 * 1024 * 1024:
                    return Response({'error': 'La foto pesa más de 8 MB'}, status=status.HTTP_400_BAD_REQUEST)
                setattr(perfil, campo, archivo)
            elif request.data.get(f'quitar_{campo}') in (True, 'true', '1'):
                # Vuelve a la foto original del flyer.
                setattr(perfil, campo, None)
        perfil.save()
        return self._respuesta(request, perfil, vendedor)
