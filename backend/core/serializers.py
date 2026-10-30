from decimal import Decimal

from django.db import models
from rest_framework import serializers
from .models import Producto, Pedido, DetallePedido, Cliente, PagoFactura, Factura, DetalleFactura, Vendedor, Proveedor, FacturaDetallePedido, HistorialPrecioProducto, AjusteInventario, MovimientoCongelado, RegistroPreReserva, NotaCredito, MovimientoBancario, AsignacionMovimiento, Cartola, Gasto

from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

class MyTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)

        # Intentamos obtener los datos del modelo Vendedor vinculado
        try:
            # vendedor_profile es el related_name que deberías tener en tu OneToOneField
            # si no pusiste related_name, Django usa por defecto 'vendedor'
            vendedor = getattr(user, 'vendedor_profile', None) or getattr(user, 'vendedor', None)
            
            if vendedor:
                token['nombre'] = vendedor.nombre
                token['sigla'] = vendedor.sigla
            else:
                # Si es un admin sin perfil de vendedor todavía
                token['nombre'] = user.username
                token['sigla'] = "ADMIN"
        except Exception:
            token['nombre'] = user.username
            token['sigla'] = "N/A"

        return token

class VendedorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vendedor
        fields = ['id', 'nombre', 'sigla']


CAMPOS_FACTURACION_CLIENTE = [
    'tipo_cliente', 'rut', 'razon_social', 'giro', 'direccion_facturacion',
    'comuna', 'ciudad', 'email_facturacion', 'contacto',
]


class ClienteSerializer(serializers.ModelSerializer):
    # Esto se usa para la LECTURA (GET) - devuelve el objeto completo
    vendedor = VendedorSerializer(read_only=True)
    
    # Esto se usa para la ESCRITURA (PUT/POST) - acepta el ID numérico
    vendedor_id = serializers.PrimaryKeyRelatedField(
        queryset=Vendedor.objects.all(), 
        source='vendedor', 
        write_only=True
    )

    class Meta:
        model = Cliente
        fields = ['id', 'nombre', 'vendedor', 'vendedor_id', 'direccion', 'telefono', 'email'] + CAMPOS_FACTURACION_CLIENTE

    def validate(self, attrs):
        tipo = attrs.get('tipo_cliente', getattr(self.instance, 'tipo_cliente', 'minorista'))
        if tipo == 'mayorista':
            rut = attrs.get('rut', getattr(self.instance, 'rut', ''))
            razon = attrs.get('razon_social', getattr(self.instance, 'razon_social', ''))
            if not rut or not razon:
                raise serializers.ValidationError('Un cliente mayorista necesita RUT y razón social para facturarle')
        return attrs

class ProductoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Producto
        fields = ['id', 'nombre', 'descripcion', 'categoria', 'precio_por_kilo', 'estado', 'peso_minimo', 'venta_por_unidad', 'peso_flyer']

class HistorialPrecioProductoSerializer(serializers.ModelSerializer):
    usuario_nombre = serializers.SerializerMethodField()

    class Meta:
        model = HistorialPrecioProducto
        fields = ['id', 'precio_anterior', 'precio_nuevo', 'usuario_nombre', 'fecha_cambio']

    def get_usuario_nombre(self, obj):
        if not obj.usuario:
            return "Sistema"
        vendedor = getattr(obj.usuario, 'vendedor_profile', None)
        return vendedor.nombre if vendedor else obj.usuario.username


class AjusteInventarioSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.ReadOnlyField(source='producto.nombre')

    class Meta:
        model = AjusteInventario
        fields = ['id', 'producto', 'producto_nombre', 'cantidad', 'cantidad_unidades', 'tipo', 'razon', 'fecha']


class RegistroPreReservaSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.ReadOnlyField(source='producto.nombre')
    cliente_nombre = serializers.ReadOnlyField(source='pedido.cliente.nombre')
    evento_display = serializers.CharField(source='get_evento_display', read_only=True)
    origen_display = serializers.CharField(source='get_origen_display', read_only=True)
    proveedor_nombre = serializers.SerializerMethodField()
    usuario_nombre = serializers.SerializerMethodField()

    class Meta:
        model = RegistroPreReserva
        fields = ['id', 'pedido', 'cliente_nombre', 'detalle', 'producto', 'producto_nombre', 'evento',
                  'evento_display', 'origen', 'origen_display', 'unidades', 'pendientes_despues', 'factura',
                  'proveedor_nombre', 'referencia', 'usuario_nombre', 'fecha']

    def get_proveedor_nombre(self, obj):
        return obj.factura.proveedor.nombre if obj.factura_id and obj.factura.proveedor_id else None

    def get_usuario_nombre(self, obj):
        return obj.usuario.username if obj.usuario else None


class MovimientoCongeladoSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.ReadOnlyField(source='producto.nombre')
    usuario_nombre = serializers.SerializerMethodField()

    class Meta:
        model = MovimientoCongelado
        fields = ['id', 'producto', 'producto_nombre', 'direccion', 'cantidad_unidades', 'cantidad_kilos', 'razon', 'usuario_nombre', 'fecha']

    def get_usuario_nombre(self, obj):
        return obj.usuario.username if obj.usuario else None


class DetallePedidoSerializer(serializers.ModelSerializer):
    producto = ProductoSerializer()
    cliente_nombre = serializers.ReadOnlyField(source='pedido.cliente.nombre')
    vendedor_nombre = serializers.ReadOnlyField(source='pedido.vendedor.nombre')
    estado_pedido = serializers.ReadOnlyField(source='pedido.estado')
    facturas_detalle = serializers.SerializerMethodField()

    def _cache_facturas(self):
        # Cachea en `self` (compartido por todas las filas cuando se serializa
        # con many=True) los links de FacturaDetallePedido agrupados por pedido
        # y los DetalleFactura indexados por (factura, producto), para evitar
        # 1-2 queries extra POR FILA (N+1) — ver spawn_task sobre esta vista.
        cache = getattr(self, '_facturas_cache', None)
        if cache is None:
            links_por_pedido = {}
            for link in FacturaDetallePedido.objects.select_related('factura', 'factura__proveedor'):
                links_por_pedido.setdefault(link.detallepedido_id, []).append(link)

            detalle_factura_por_par = {
                (df.factura_id, df.producto_id): df
                for df in DetalleFactura.objects.all()
            }

            cache = {'links_por_pedido': links_por_pedido, 'detalle_factura_por_par': detalle_factura_por_par}
            self._facturas_cache = cache
        return cache

    def get_facturas_detalle(self, obj):
        # Desglose por factura de compra que abastecio esta linea de venta.
        # Los kilos de la venta (bascula) se reparten entre las facturas en
        # PROPORCION a las unidades tomadas de cada una, y el costo atribuido de
        # cada factura = esos kilos * el costo/kg de ese lote. Asi la suma de
        # costos atribuidos coincide EXACTA con total_costo de la linea
        # (= costo/kg ponderado * kilos vendidos), en vez de reconstruir desde el
        # peso de compra por pieza (que en historicos esta corrupto y no cuadra).
        cache = self._cache_facturas()
        links = cache['links_por_pedido'].get(obj.id, [])
        total_unidades = sum(l.cantidad_unidades for l in links) or 0
        kilos_linea = Decimal(str(obj.cantidad_kilos or 0))

        detalle = []
        for link in links:
            detalle_factura = cache['detalle_factura_por_par'].get((link.factura_id, obj.producto_id))
            costo_por_kilo = detalle_factura.costo_por_kilo if detalle_factura else None
            if total_unidades > 0:
                kilos_atribuidos = kilos_linea * Decimal(link.cantidad_unidades) / Decimal(total_unidades)
            else:
                kilos_atribuidos = Decimal('0')
            detalle.append({
                'factura_id': link.factura_id,
                'numero_factura': link.factura.numero_factura,
                'proveedor_nombre': link.factura.proveedor.nombre if link.factura.proveedor_id else None,
                'unidades_consumidas': link.cantidad_unidades,
                'costo_por_kilo': costo_por_kilo,
                'kilos_atribuidos': kilos_atribuidos,
                'costo_atribuido': (kilos_atribuidos * costo_por_kilo) if costo_por_kilo is not None else None,
            })
        return detalle

    class Meta:
        model = DetallePedido
        fields = ['id', 'producto', 'cantidad_unidades', 'cantidad_kilos', 'total_venta', 'total_costo', 'margen', 'costo_por_kilo', 'facturas', 'facturas_detalle', 'precio_venta', 'precio_lista', 'modo_precio', 'descuento_por_kilo', 'fecha', 'pedido', 'cliente_nombre', 'vendedor_nombre', 'estado_pedido', 'estado', 'unidades_pendientes', 'congelado']


class DetallePedidoLigeroSerializer(serializers.ModelSerializer):
    """Línea de pedido sin el desglose por factura (facturas_detalle), para la
    lista de pedidos: ese desglose solo lo usa Movimientos y costaba queries."""
    producto = ProductoSerializer()

    class Meta:
        model = DetallePedido
        fields = ['id', 'producto', 'cantidad_unidades', 'cantidad_kilos', 'total_venta', 'total_costo', 'costo_por_kilo', 'precio_venta', 'precio_lista', 'modo_precio', 'descuento_por_kilo', 'fecha', 'estado', 'unidades_pendientes', 'congelado']


class PedidoSerializer(serializers.ModelSerializer):
    detalles = DetallePedidoLigeroSerializer(many=True)
    cliente = ClienteSerializer()
    vendedor = VendedorSerializer()
    pagado_banco = serializers.SerializerMethodField()

    class Meta:
        model = Pedido
        fields = ['id', 'cliente', 'vendedor', 'fecha', 'estado', 'detalles', 'total', 'observaciones', 'tipo_recibo', 'pagado_banco']

    def get_pagado_banco(self, obj):
        # Lo cobrado según movimientos de la cartola asociados a este pedido.
        cache = getattr(obj, '_prefetched_objects_cache', {})
        if 'asignaciones_banco' in cache:
            return sum((a.monto for a in obj.asignaciones_banco.all()), Decimal('0'))
        return obj.asignaciones_banco.aggregate(t=models.Sum('monto'))['t'] or Decimal('0')

    def create(self, validated_data):
        detalles_data = validated_data.pop('detalles')
        pedido = Pedido.objects.create(**validated_data)
        for detalle_data in detalles_data:
            DetallePedido.objects.create(pedido=pedido, **detalle_data)
        return pedido


class PagoFacturaSerializer(serializers.ModelSerializer):
    class Meta:
        model = PagoFactura
        fields = ['fecha_de_pago', 'monto_del_pago']



class ProveedorSerializer(serializers.ModelSerializer):
    cantidad_facturas = serializers.SerializerMethodField()

    class Meta:
        model = Proveedor
        fields = ['id', 'nombre', 'rut', 'cantidad_facturas']

    def get_cantidad_facturas(self, obj):
        # La lista lo trae anotado; en create/update se cuenta directo.
        if hasattr(obj, 'cantidad_facturas'):
            return obj.cantidad_facturas
        return obj.facturas.count() if obj.pk else 0

    def validate_nombre(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('El nombre es obligatorio')
        qs = Proveedor.objects.filter(nombre__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Ya existe un proveedor con ese nombre')
        return value


        
class DetalleFacturaSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.ReadOnlyField(source='producto.nombre')
    proveedor_nombre = serializers.ReadOnlyField(source='factura.proveedor.nombre')
    fecha = serializers.ReadOnlyField(source='factura.fecha')
    # Estado de edición según cuánto del lote ya se vendió (guardas de stock).
    estado_edicion = serializers.SerializerMethodField()
    unidades_consumidas = serializers.SerializerMethodField()
    unidades_vivas = serializers.SerializerMethodField()
    pedidos_consumidores = serializers.SerializerMethodField()

    class Meta:
        model = DetalleFactura
        fields = ['id', 'producto', 'producto_nombre', 'cantidad_kilos', 'cantidad_unidades', 'costo_por_kilo', 'costo_total','factura','proveedor_nombre', 'fecha', 'estado_edicion', 'unidades_consumidas', 'unidades_vivas', 'pedidos_consumidores']

    def _info(self, obj):
        # Cachea el cálculo por instancia para no repetir el query en cada campo.
        cache = getattr(obj, '_estado_consumo_cache', None)
        if cache is None:
            from .utils import estado_consumo_detalle
            cache = estado_consumo_detalle(obj)
            obj._estado_consumo_cache = cache
        return cache

    def get_estado_edicion(self, obj):
        return self._info(obj)['estado']

    def get_unidades_consumidas(self, obj):
        return self._info(obj)['consumidas']

    def get_unidades_vivas(self, obj):
        return self._info(obj)['vivas']

    def get_pedidos_consumidores(self, obj):
        if self._info(obj)['consumidas'] <= 0:
            return []
        from .utils import pedidos_consumidores_detalle
        return pedidos_consumidores_detalle(obj)

class NotaCreditoSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotaCredito
        fields = ['id', 'factura', 'numero', 'fecha', 'neto', 'iva', 'total', 'motivo', 'foto', 'creada']
        read_only_fields = ['creada']


class FacturaSerializer(serializers.ModelSerializer):
    # Eliminamos el source porque ahora coincide con el field name
    detalles = DetalleFacturaSerializer(many=True, read_only=True)
    proveedor_nombre = serializers.ReadOnlyField(source='proveedor.nombre')
    pago_factura = PagoFacturaSerializer(read_only=True)
    notas_credito = NotaCreditoSerializer(many=True, read_only=True)
    total_notas_credito = serializers.SerializerMethodField()
    # Lo que realmente se le debe al proveedor: total - notas de crédito.
    total_a_pagar = serializers.SerializerMethodField()

    class Meta:
        model = Factura
        fields = [
            'numero_factura',
            'proveedor',
            'proveedor_nombre',
            'fecha',
            'fecha_vencimiento',
            'foto',
            'detalles',
            'total',
            'subtotal',
            'iva',
            'anticipo_iva',
            'pago_factura',
            'notas_credito',
            'total_notas_credito',
            'total_a_pagar',
        ]

    def get_total_notas_credito(self, obj):
        return sum((nc.total for nc in obj.notas_credito.all()), Decimal('0'))

    def get_total_a_pagar(self, obj):
        return obj.total - self.get_total_notas_credito(obj)