import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from decimal import Decimal
from django.db import transaction
from core.models import (Producto, Cliente, Vendedor, Proveedor, Factura, DetalleFactura,
                          EntradaProducto, Pedido, DetallePedido, FacturaDetallePedido)
from core.utils import consumir_fifo

class RollbackTest(Exception):
    pass

try:
    with transaction.atomic():
        prov = Proveedor.objects.first()
        vend = Vendedor.objects.first()
        cli = Cliente.objects.filter(vendedor=vend).first() or Cliente.objects.first()
        prod = Producto.objects.create(nombre='TEST-PROD-TMP', precio_por_kilo=Decimal('20000'))

        f1 = Factura.objects.create(numero_factura='TESTF1', proveedor=prov, fecha='2026-01-01',
                                     subtotal=0, iva=0, total=0)
        f2 = Factura.objects.create(numero_factura='TESTF2', proveedor=prov, fecha='2026-01-02',
                                     subtotal=0, iva=0, total=0)
        EntradaProducto.objects.create(factura=f1, producto=prod, cantidad_kilos=Decimal('2'),
                                        cantidad_unidades=2, costo_por_kilo=Decimal('1000'))
        EntradaProducto.objects.create(factura=f2, producto=prod, cantidad_kilos=Decimal('10'),
                                        cantidad_unidades=10, costo_por_kilo=Decimal('2000'))

        pedido = Pedido.objects.create(cliente=cli, vendedor=vend, estado='Preparado', total=0)

        # Simular creacion: 2 unidades (de factura 1, costo 1000/kg), 2 kilos
        costo_total, kilos_consumidos, facturas_usadas, facturas_cant = consumir_fifo(prod, 2)
        costo_por_kilo = costo_total / kilos_consumidos
        detalle = DetallePedido.objects.create(
            pedido=pedido, producto=prod, cantidad_kilos=Decimal('2.0'), cantidad_unidades=2,
            total_costo=costo_total, total_venta=Decimal('2.0')*prod.precio_por_kilo,
            costo_por_kilo=costo_por_kilo, precio_venta=prod.precio_por_kilo
        )
        detalle.facturas.set(facturas_usadas)
        for fid, cant in facturas_cant.items():
            FacturaDetallePedido.objects.create(detallepedido=detalle, factura_id=fid, cantidad_unidades=cant)

        print("Tras crear (2 unidades, deberia costar 1000/kg):")
        print("  costo_por_kilo:", detalle.costo_por_kilo, "total_costo:", detalle.total_costo)

        # Simular EDICION: subir a 4 unidades, 4 kilos (deberia consumir 2 unidades MAS de factura 1 restante)
        unidades_anteriores = int(detalle.cantidad_unidades)
        costo_total_previo = detalle.total_costo
        nuevas_unidades = 4
        detalle.cantidad_kilos = Decimal('4.0')
        detalle.cantidad_unidades = nuevas_unidades
        delta = nuevas_unidades - unidades_anteriores
        costo_delta, kilos_delta, facturas_usadas_delta, facturas_cant_delta = consumir_fifo(prod, delta)
        costo_total_combinado = costo_total_previo + costo_delta
        detalle.costo_por_kilo = costo_total_combinado / detalle.cantidad_kilos
        detalle.facturas.add(*facturas_usadas_delta)
        for fid, cant in facturas_cant_delta.items():
            link, created = FacturaDetallePedido.objects.get_or_create(
                detallepedido=detalle, factura_id=fid, defaults={'cantidad_unidades': cant})
            if not created:
                link.cantidad_unidades += cant
                link.save()
        detalle.total_venta = detalle.cantidad_kilos * detalle.precio_venta
        detalle.save()

        print("Tras editar a 4 unidades (2 de factura1 @1000 + 2 de factura2 @2000, esperado ~1500/kg):")
        print("  costo_por_kilo:", detalle.costo_por_kilo, "total_costo:", detalle.total_costo)
        print("  FacturaDetallePedido:", list(FacturaDetallePedido.objects.filter(detallepedido=detalle).values('factura_id','cantidad_unidades')))
        print("  suma unidades en facturas:", sum(l.cantidad_unidades for l in FacturaDetallePedido.objects.filter(detallepedido=detalle)))

        raise RollbackTest("rollback - solo test")
except RollbackTest:
    print("OK: rollback exitoso, nada se persistio")
