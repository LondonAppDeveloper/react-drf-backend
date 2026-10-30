from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import EntradaProducto, FacturaDetallePedido, DetalleFactura, DetallePedido, RegistroPreReserva


def costo_por_kilo_ponderado(detalle):
    """Costo/kg de una linea de venta (DetallePedido) segun el modelo de costo
    elegido: promedio ponderado (por unidades consumidas) del costo/kg de los
    lotes de compra que la abastecieron (FacturaDetallePedido -> DetalleFactura).

    Robusto por diseno: solo usa el costo/kg del proveedor y las unidades, NUNCA
    los pesos por pieza (que en los datos historicos estan corruptos en ~30% de
    las lineas). El resultado siempre queda entre el minimo y el maximo costo/kg
    de los lotes, asi que jamas produce costos absurdos.

    Devuelve None si la linea no tiene ninguna factura vinculada.
    """
    suma_costo = Decimal('0')
    suma_unidades = 0
    for link in FacturaDetallePedido.objects.filter(detallepedido=detalle):
        df = DetalleFactura.objects.filter(
            factura=link.factura_id, producto=detalle.producto_id
        ).first()
        if not df:
            continue
        suma_costo += Decimal(link.cantidad_unidades) * df.costo_por_kilo
        suma_unidades += link.cantidad_unidades
    if suma_unidades == 0:
        return None
    return suma_costo / suma_unidades


def consumir_fifo(producto, unidades_a_consumir, congelado=False):
    """Descuenta ``unidades_a_consumir`` de ``EntradaProducto`` (FIFO por
    fecha_entrada), ponderando el costo por KILOS estimados de cada lote (no
    por cantidad de unidades: costo_por_kilo es un precio por kilo, y las
    unidades de un mismo lote no pesan todas lo mismo).

    Usada tanto al crear un pedido (CrearPedido) como al editarlo subiendo
    cantidad_unidades (PedidoDetailView.put) para que ambos flujos consuman
    inventario real y calculen el costo de la misma forma.

    SOLO MUEVE UNIDADES. Los kilos del ledger NO se tocan aca: se descuentan
    con el peso REAL de la bascula, cuando se conoce (CrearPedido si el pedido
    viene pesado, ActualizarKilosPedido al registrar el pesaje de una reserva),
    via ``descontar_kilos_fifo``. Antes esta funcion restaba un peso ESTIMADO
    (promedio del lote) y nadie corregia despues la diferencia contra el peso
    real, asi que el ledger de kilos derivaba en (estimado - real) por cada
    venta. ``kilos_consumidos`` se sigue calculando y devolviendo porque el
    COSTEO lo necesita, pero es un valor de costo, no de stock.

    ``congelado`` elige el pool: inventario normal (default) o stock congelado.

    Devuelve (costo_total, kilos_consumidos, facturas_usadas, facturas_cantidades).
    Lanza ValidationError si no hay stock suficiente.
    """
    if unidades_a_consumir <= 0:
        return Decimal('0.00'), Decimal('0.00'), [], {}

    entradas = EntradaProducto.objects.filter(
        producto=producto, congelado=congelado).order_by('fecha_entrada')
    costo_total = Decimal('0.00')
    kilos_consumidos = Decimal('0.00')
    cantidad_restante_unidades = Decimal(unidades_a_consumir)
    facturas_usadas = []
    facturas_cantidades = {}

    for entrada in entradas:
        if cantidad_restante_unidades <= 0:
            break
        if entrada.cantidad_unidades <= 0:
            continue

        peso_promedio = (
            entrada.cantidad_kilos / entrada.cantidad_unidades
            if entrada.cantidad_unidades else Decimal('0.00')
        )
        unidades_consumidas = min(Decimal(entrada.cantidad_unidades), cantidad_restante_unidades)
        kilos_consumidos_lote = unidades_consumidas * peso_promedio

        costo_total += kilos_consumidos_lote * entrada.costo_por_kilo
        kilos_consumidos += kilos_consumidos_lote

        entrada.cantidad_unidades -= int(unidades_consumidas)
        cantidad_restante_unidades -= unidades_consumidas

        facturas_usadas.append(entrada.factura)
        # OJO: Factura.numero_factura ES el primary key (ver models.py), no hay
        # campo "id" -> hay que usar factura_id (el FK), no factura.id.
        facturas_cantidades[entrada.factura_id] = (
            facturas_cantidades.get(entrada.factura_id, 0) + int(unidades_consumidas)
        )

        # El lote solo se borra cuando no queda NADA que rastrear. Si se
        # quedo sin unidades pero todavia carga kilos, la fila se conserva:
        # esos kilos son stock real que aun no se ha pesado en una venta, y
        # borrarlos aqui los haria desaparecer del inventario.
        if entrada.cantidad_unidades <= 0 and entrada.cantidad_kilos <= 0:
            entrada.delete()
        else:
            entrada.save()

    if cantidad_restante_unidades > 0:
        raise ValidationError(
            f"No hay stock disponible suficiente de '{producto.nombre}' para cubrir el pedido"
        )

    return costo_total, kilos_consumidos, facturas_usadas, facturas_cantidades


def descontar_kilos_fifo(producto, kilos_a_descontar, permitir_faltante=False, congelado=False):
    """Descuenta SOLO kilos de ``EntradaProducto`` (FIFO por fecha_entrada) sin
    tocar las unidades.

    Es la unica via por la que bajan los kilos del ledger. La usan:
      - las mermas declaradas en kilos (CrearAjusteInventario),
      - las ventas, con el peso REAL de la bascula (CrearPedido cuando el
        pedido viene pesado, ActualizarKilosPedido y PedidoDetailView.put al
        registrar o corregir el pesaje).

    El lote nunca se borra aunque llegue a 0 kilos: puede seguir teniendo
    unidades sin pesar, y borrarlo las eliminaria.

    ``permitir_faltante`` cambia que pasa cuando el ledger no alcanza:
      - False (default): lanza ValidationError y no toca nada. Para operaciones
        que todavia se pueden rechazar, como registrar una merma.
      - True: descuenta hasta donde alcance y devuelve lo que falto. Para
        registrar un pesaje: la carne YA salio de la camara, bloquear el
        registro no la devuelve; el faltante queda visible en el comando
        resincronizar_ledger_stock --kilos.

    Devuelve (kilos_descontados, faltante).
    """
    kilos_a_descontar = Decimal(str(kilos_a_descontar))
    if kilos_a_descontar <= 0:
        return Decimal('0.00'), Decimal('0.00')

    entradas = list(
        EntradaProducto.objects.filter(
            producto=producto, congelado=congelado).order_by('fecha_entrada')
    )
    disponibles = sum((e.cantidad_kilos for e in entradas), Decimal('0.00'))
    if disponibles < kilos_a_descontar and not permitir_faltante:
        raise ValidationError(
            f"No hay kilos suficientes de '{producto.nombre}': hay "
            f"{disponibles} kg en stock y se intentan descontar "
            f"{kilos_a_descontar} kg"
        )

    restante = kilos_a_descontar
    for entrada in entradas:
        if restante <= 0:
            break
        if entrada.cantidad_kilos <= 0:
            continue
        tomados = min(entrada.cantidad_kilos, restante)
        entrada.cantidad_kilos -= tomados
        restante -= tomados
        entrada.save()

    return kilos_a_descontar - restante, restante


def restituir_kilos_fifo(producto, kilos_a_devolver, congelado=False):
    """Devuelve kilos al ledger, al lote vivo MAS ANTIGUO (para que vuelvan a
    la misma posicion FIFO de la que salieron).

    La usan las correcciones de pesaje a la baja: si una linea pasa de 3.0 a
    2.5 kg, esos 0.5 kg nunca salieron de la camara y tienen que volver.
    """
    kilos_a_devolver = Decimal(str(kilos_a_devolver))
    if kilos_a_devolver <= 0:
        return Decimal('0.00')

    entrada = (
        EntradaProducto.objects.filter(producto=producto, congelado=congelado)
        .order_by('fecha_entrada')
        .first()
    )
    if entrada is None:
        # Sin ningun lote vivo no hay donde ponerlos: el producto quedaria con
        # kilos sin lote ni costo asociado. Se reporta en vez de inventar.
        raise ValidationError(
            f"No hay ningun lote de '{producto.nombre}' donde devolver "
            f"{kilos_a_devolver} kg"
        )

    entrada.cantidad_kilos = Decimal(str(entrada.cantidad_kilos)) + kilos_a_devolver
    entrada.save()
    return kilos_a_devolver


def restituir_unidades_fifo(producto, unidades_a_devolver, congelado=False):
    """Devuelve unidades al ledger, al lote vivo MAS ANTIGUO (mismo criterio que
    ``restituir_kilos_fifo``), para que vuelvan a la misma posicion FIFO de la
    que salieron.

    La usan las correcciones de ``cantidad_unidades`` a la baja en un pedido ya
    creado (``PedidoDetailView.put``): si una linea pasa de 3 a 2 unidades, esa
    unidad nunca debio quedar comprometida del inventario y tiene que volver.
    """
    unidades_a_devolver = int(unidades_a_devolver)
    if unidades_a_devolver <= 0:
        return 0

    entrada = (
        EntradaProducto.objects.filter(producto=producto, congelado=congelado)
        .order_by('fecha_entrada')
        .first()
    )
    if entrada is None:
        # Sin ningun lote vivo no hay donde ponerlas: el producto quedaria con
        # unidades sin lote ni costo asociado. Se reporta en vez de inventar.
        raise ValidationError(
            f"No hay ningun lote de '{producto.nombre}' donde devolver "
            f"{unidades_a_devolver} unidades"
        )

    entrada.cantidad_unidades = int(entrada.cantidad_unidades) + unidades_a_devolver
    entrada.save()
    return unidades_a_devolver


def agregar_exceso_fifo(producto, unidades_a_agregar, kilos_a_agregar):
    """Suma al ledger (``EntradaProducto``) unidades y/o kilos encontrados en
    un conteo físico que superó al stock del sistema (ajuste tipo "exceso").

    A diferencia de una compra, un exceso no tiene factura ni costo propio:
    se suma al lote vivo MAS ANTIGUO del producto (mismo criterio que
    ``restituir_kilos_fifo``), para no inventar un lote con costo ficticio.
    Si el producto no tiene ningun lote todavia, no hay donde sumarlo.
    """
    unidades_a_agregar = int(unidades_a_agregar)
    kilos_a_agregar = Decimal(str(kilos_a_agregar))
    if unidades_a_agregar <= 0 and kilos_a_agregar <= 0:
        return

    entrada = (
        EntradaProducto.objects.filter(producto=producto, congelado=False)
        .order_by('fecha_entrada')
        .first()
    )
    if entrada is None:
        raise ValidationError(
            f"No hay ningun lote de '{producto.nombre}' donde sumar el exceso"
        )

    if unidades_a_agregar > 0:
        entrada.cantidad_unidades = int(entrada.cantidad_unidades) + unidades_a_agregar
    if kilos_a_agregar > 0:
        entrada.cantidad_kilos = Decimal(str(entrada.cantidad_kilos)) + kilos_a_agregar
    entrada.save()


def estado_consumo_detalle(detalle):
    """Para una línea de factura (``DetalleFactura``) determina cuánto de su
    stock (``EntradaProducto``) sigue vivo frente a lo originalmente registrado
    y devuelve el estado de edición permitido.

    El stock se crea 1:1 con cada ``DetalleFactura`` al emitir la factura y se
    consume por FIFO en cada venta (``CrearPedido``), borrando la fila de
    ``EntradaProducto`` cuando llega a 0. Comparar las unidades vivas contra las
    originales nos dice cuánto de ese lote ya se vendió.

    Estados:
      - ``libre``: nada vendido de ese lote -> cantidad y costo editables.
      - ``parcial``: parte vendida -> costo libre, cantidad con piso en lo vendido.
      - ``bloqueada``: lote totalmente consumido -> cantidad/costo bloqueados.
    """
    original = int(detalle.cantidad_unidades or 0)

    vivas = EntradaProducto.objects.filter(
        factura=detalle.factura_id,
        producto=detalle.producto_id,
    ).aggregate(total=Sum('cantidad_unidades'))['total'] or 0
    vivas = int(vivas)

    consumidas = original - vivas
    if consumidas < 0:
        consumidas = 0

    if consumidas <= 0:
        estado = 'libre'
    elif vivas <= 0:
        estado = 'bloqueada'
    else:
        estado = 'parcial'

    return {
        'estado': estado,
        'original': original,
        'vivas': vivas,
        'consumidas': consumidas,
    }


def revertir_stock_detalle(detalle):
    """Devuelve al ledger (``EntradaProducto``) el stock+costo que una línea de
    venta (``DetallePedido``) consumió, lote por lote, vía sus
    ``FacturaDetallePedido``. Es el mismo procedimiento que ``CancelarPedido``
    aplicaba inline por cada línea del pedido; se extrajo aquí para que tanto
    anular un pedido completo como cancelar un solo producto de un pedido
    reviertan el inventario exactamente de la misma forma (misma factura,
    mismo costo_por_kilo recuperado, mismo orden FIFO).

    No toca ``detalle`` ni ``pedido``: solo mueve stock. El llamador decide qué
    hacer con el estado de la línea/pedido y con el total.
    """
    relaciones = FacturaDetallePedido.objects.filter(detallepedido=detalle)

    # TOPE DE DEVOLUCION: nunca devolver mas unidades de las que la linea de
    # venta declara (ver nota historica en CancelarPedido sobre pedidos con
    # links de FacturaDetallePedido que no cuadran con cantidad_unidades).
    unidades_vendidas = int(detalle.cantidad_unidades or 0)
    restante = unidades_vendidas

    for relacion in relaciones:
        if restante <= 0:
            break

        factura = relacion.factura
        unidades_a_devolver = min(int(relacion.cantidad_unidades or 0), restante)
        if unidades_a_devolver <= 0:
            continue

        # BUSCAR EL COSTO ORIGINAL DE ESTE PRODUCTO EN ESTA FACTURA
        try:
            detalle_factura_original = DetalleFactura.objects.get(
                factura=factura,
                producto=detalle.producto
            )
            costo_unitario_compra = detalle_factura_original.costo_por_kilo
        except DetalleFactura.DoesNotExist:
            # FacturaDetallePedido NO tiene costo_por_kilo (ver models.py): si
            # la factura no tiene linea de compra de este producto, no hay
            # costo que recuperar y devolvemos el lote a costo 0 antes que
            # perder el stock.
            costo_unitario_compra = Decimal('0')

        # Buscar fecha para mantener FIFO
        entrada_ref = EntradaProducto.objects.filter(
            producto=detalle.producto, congelado=detalle.congelado
        ).order_by('fecha_entrada').first()

        if entrada_ref:
            nueva_fecha = entrada_ref.fecha_entrada - timezone.timedelta(seconds=1)
        else:
            nueva_fecha = timezone.now()

        # Kilos proporcionales a las unidades que si devolvemos.
        if unidades_vendidas > 0:
            kilos_a_devolver = (
                Decimal(str(detalle.cantidad_kilos or 0)) / unidades_vendidas
            ) * unidades_a_devolver
        else:
            kilos_a_devolver = Decimal('0')

        # Crear la entrada de retorno
        EntradaProducto.objects.create(
            factura=factura,
            producto=detalle.producto,
            cantidad_kilos=kilos_a_devolver,
            cantidad_unidades=unidades_a_devolver,
            costo_por_kilo=costo_unitario_compra,  # <--- COSTO RECUPERADO
            fecha_entrada=nueva_fecha,
            congelado=detalle.congelado,
        )

        restante -= unidades_a_devolver


def pedidos_consumidores_detalle(detalle):
    """IDs de pedidos (no anulados) que consumieron stock de este
    producto+factura, vía ``FacturaDetallePedido``, para poder explicar en el
    frontend por qué una línea quedó bloqueada."""
    return list(
        FacturaDetallePedido.objects.filter(
            factura=detalle.factura_id,
            detallepedido__producto=detalle.producto_id,
        )
        .exclude(detallepedido__pedido__estado='Anulado')
        .values_list('detallepedido__pedido_id', flat=True)
        .distinct()
    )


def unidades_en_stock(producto, congelado=False):
    """Unidades vivas del producto en un pool (inventario normal o congelado)."""
    return EntradaProducto.objects.filter(
        producto=producto, congelado=congelado
    ).aggregate(total=Sum('cantidad_unidades'))['total'] or 0


def vincular_lotes(detalle, facturas_usadas, facturas_cantidades):
    """Registra en la línea de venta los lotes que devolvió ``consumir_fifo``,
    sumando a un vínculo existente si la línea ya había tomado de esa factura."""
    detalle.facturas.add(*facturas_usadas)
    for factura_id, cantidad in facturas_cantidades.items():
        link, created = FacturaDetallePedido.objects.get_or_create(
            detallepedido=detalle, factura_id=factura_id,
            defaults={'cantidad_unidades': cantidad}
        )
        if not created:
            link.cantidad_unidades += cantidad
            link.save()


def actualizar_estado_pre_reserva(pedido):
    """Un pedido está en Pre-reserva mientras alguna línea activa tenga
    unidades sin stock; cuando ya no queda ninguna pasa a Reservado. No guarda:
    el llamador hace pedido.save()."""
    if pedido.estado == "Anulado":
        return
    pendiente = pedido.detalles.filter(estado="Activo", unidades_pendientes__gt=0).exists()
    if pendiente:
        pedido.estado = "Pre-reserva"
    elif pedido.estado == "Pre-reserva":
        pedido.estado = "Reservado"


def registrar_pre_reserva(detalle, evento, origen, unidades, referencia='', usuario=None, factura_id=None):
    """Escribe una fila de auditoría (RegistroPreReserva) con el estado de la
    línea DESPUÉS del cambio. ``usuario`` puede ser un AnonymousUser o None."""
    if unidades <= 0:
        return None
    if usuario is not None and not getattr(usuario, 'is_authenticated', False):
        usuario = None
    return RegistroPreReserva.objects.create(
        detalle=detalle, pedido_id=detalle.pedido_id, producto_id=detalle.producto_id,
        evento=evento, origen=origen, unidades=int(unidades),
        pendientes_despues=int(detalle.unidades_pendientes),
        factura_id=factura_id, referencia=referencia[:255], usuario=usuario,
    )


def asignar_pre_reservas(producto, origen='factura', referencia='', usuario=None):
    """Asigna stock del inventario normal a las pre-reservas del producto, la
    más antigua primero, consumiendo FIFO como cualquier venta. Se llama cada
    vez que vuelve o entra stock al inventario normal: ingreso o edición de
    factura, descongelar, anular un pedido, cancelar o achicar una línea y
    ajustes de inventario que suman unidades.

    Una línea puede quedar asignada a medias si no alcanza; el pedido pasa de
    Pre-reserva a Reservado cuando ninguna de sus líneas tiene pendientes.

    Cada asignación queda en RegistroPreReserva (una fila por factura de la
    que salieron las unidades) con ``origen`` y ``referencia`` del evento que
    liberó el stock.

    Devuelve [{'pedido': id, 'producto': nombre, 'unidades': n, 'completa': bool}].
    """
    from .views import precio_segun_modo  # evita import circular

    asignaciones = []
    lineas = (
        DetallePedido.objects.select_related('pedido')
        .filter(producto=producto, estado="Activo", unidades_pendientes__gt=0)
        .exclude(pedido__estado="Anulado")
        .order_by('pedido__fecha', 'pedido_id', 'id')
    )
    for detalle in lineas:
        disponibles = unidades_en_stock(producto)
        if disponibles <= 0:
            break
        unidades = min(detalle.unidades_pendientes, int(disponibles))

        _c, _k, facturas_usadas, facturas_cantidades = consumir_fifo(producto, unidades)
        vincular_lotes(detalle, facturas_usadas, facturas_cantidades)

        cpk = costo_por_kilo_ponderado(detalle)
        if cpk is not None:
            detalle.costo_por_kilo = cpk
            if detalle.modo_precio == 'costo':
                detalle.precio_venta = precio_segun_modo(producto, {'modo': 'costo'}, cpk)
                detalle.descuento_por_kilo = max(
                    (detalle.precio_lista or producto.precio_por_kilo) - detalle.precio_venta,
                    Decimal('0.00'))
                detalle.total_venta = (detalle.cantidad_kilos or 0) * detalle.precio_venta
        pendientes_antes = detalle.unidades_pendientes
        detalle.unidades_pendientes -= unidades
        detalle.save()

        # Una fila por lote (factura) de donde salieron las unidades, con los
        # pendientes que quedaron tras ESE lote, para leer el historial en orden.
        asignadas = 0
        for factura_id, cantidad in facturas_cantidades.items():
            asignadas += cantidad
            RegistroPreReserva.objects.create(
                detalle=detalle, pedido_id=detalle.pedido_id, producto=producto,
                evento='asignada', origen=origen, unidades=cantidad,
                pendientes_despues=pendientes_antes - asignadas,
                factura_id=factura_id, referencia=referencia[:255],
                usuario=usuario if getattr(usuario, 'is_authenticated', False) else None,
            )

        pedido = detalle.pedido
        actualizar_estado_pre_reserva(pedido)
        pedido.total = pedido.detalles.exclude(estado="Cancelado").aggregate(
            total=Sum('total_venta'))['total'] or Decimal('0.00')
        pedido.save()

        asignaciones.append({
            'pedido': pedido.id,
            'producto': producto.nombre,
            'unidades': unidades,
            'completa': detalle.unidades_pendientes == 0,
        })
    return asignaciones


def mover_stock_congelado(producto, unidades, kilos=None, a_congelado=True):
    """Pasa stock del inventario normal a congelado (o de vuelta), lote por
    lote en orden FIFO. Cada lote movido conserva su factura, costo y fecha,
    así el costeo y el orden FIFO siguen igual en el pool de destino.

    ``kilos`` es opcional: si no viene, cada lote aporta el peso promedio de
    sus unidades; si viene (pesaje real), se reparte entre los lotes en esa
    misma proporción. Nunca se sacan de un lote más kilos de los que tiene.

    Devuelve (unidades_movidas, kilos_movidos). Lanza ValidationError si el
    pool de origen no alcanza.
    """
    unidades = int(unidades or 0)
    if unidades <= 0:
        raise ValidationError("Indica cuántas unidades mover")
    origen_congelado = not a_congelado
    origen = list(
        EntradaProducto.objects.filter(
            producto=producto, congelado=origen_congelado, cantidad_unidades__gt=0
        ).order_by('fecha_entrada')
    )
    disponibles = sum(e.cantidad_unidades for e in origen)
    if unidades > disponibles:
        donde = "congelado" if origen_congelado else "inventario"
        raise ValidationError(
            f"No hay suficiente stock en {donde} de '{producto.nombre}': hay "
            f"{disponibles} unidades y se intentan mover {unidades}"
        )

    # Plan: cuántas unidades y kilos estimados salen de cada lote.
    plan = []
    restante = unidades
    for entrada in origen:
        if restante <= 0:
            break
        tomadas = min(entrada.cantidad_unidades, restante)
        promedio = Decimal(entrada.cantidad_kilos) / entrada.cantidad_unidades
        plan.append([entrada, tomadas, min(promedio * tomadas, Decimal(entrada.cantidad_kilos))])
        restante -= tomadas

    estimado = sum((p[2] for p in plan), Decimal('0'))
    if kilos is not None:
        kilos = Decimal(str(kilos))
        if kilos < 0:
            raise ValidationError("Los kilos no pueden ser negativos")
        kilos_origen = sum((Decimal(p[0].cantidad_kilos) for p in plan), Decimal('0'))
        if kilos > kilos_origen:
            raise ValidationError(
                f"Los lotes de donde salen esas unidades tienen {kilos_origen} kg; "
                f"no se pueden mover {kilos} kg"
            )
        if estimado > 0:
            for p in plan:
                p[2] = (kilos * p[2] / estimado).quantize(Decimal('0.01'))
        else:
            for p in plan:
                p[2] = (kilos / len(plan)).quantize(Decimal('0.01'))
        # El redondeo no puede dejar el total distinto a lo pesado.
        plan[-1][2] += kilos - sum((p[2] for p in plan), Decimal('0'))
        for p in plan:
            p[2] = min(max(p[2], Decimal('0')), Decimal(p[0].cantidad_kilos))
    else:
        for p in plan:
            p[2] = p[2].quantize(Decimal('0.01'))

    kilos_movidos = Decimal('0')
    for entrada, tomadas, kilos_lote in plan:
        destino = EntradaProducto.objects.filter(
            producto=producto, congelado=a_congelado, factura_id=entrada.factura_id,
            costo_por_kilo=entrada.costo_por_kilo, fecha_entrada=entrada.fecha_entrada,
        ).first()
        if destino:
            destino.cantidad_unidades += tomadas
            destino.cantidad_kilos = Decimal(destino.cantidad_kilos) + kilos_lote
            destino.save()
        else:
            EntradaProducto.objects.create(
                factura_id=entrada.factura_id, producto=producto,
                cantidad_unidades=tomadas, cantidad_kilos=kilos_lote,
                costo_por_kilo=entrada.costo_por_kilo,
                fecha_entrada=entrada.fecha_entrada, congelado=a_congelado,
            )

        entrada.cantidad_unidades -= tomadas
        entrada.cantidad_kilos = Decimal(entrada.cantidad_kilos) - kilos_lote
        if entrada.cantidad_unidades <= 0 and entrada.cantidad_kilos <= 0:
            entrada.delete()
        else:
            entrada.save()
        kilos_movidos += kilos_lote

    return unidades, kilos_movidos
