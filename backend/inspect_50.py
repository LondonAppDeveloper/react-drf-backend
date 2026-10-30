import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from decimal import Decimal
from django.db.models import Sum
from core.models import DetallePedido, FacturaDetallePedido, DetalleFactura

for pid, prod in [(50,'Filete'), (106,'Filete'), (85,'Plateada'), (3,'Punta De Ganso')]:
    d = DetallePedido.objects.get(pedido_id=pid, producto__nombre=prod)
    print(f"=== Pedido #{pid} / {prod} ===")
    print(f"  cantidad_unidades={d.cantidad_unidades}  cantidad_kilos={d.cantidad_kilos}  precio_venta={d.precio_venta}")
    peso_prom_venta = (d.cantidad_kilos/d.cantidad_unidades) if d.cantidad_unidades else None
    print(f"  peso promedio por unidad VENDIDA (bascula): {peso_prom_venta}")
    links = FacturaDetallePedido.objects.filter(detallepedido=d)
    suma_un = 0
    suma_kilos_lote = Decimal('0')
    for l in links:
        df = DetalleFactura.objects.filter(factura=l.factura_id, producto=d.producto_id).first()
        pp = (df.cantidad_kilos/df.cantidad_unidades) if (df and df.cantidad_unidades) else None
        suma_un += l.cantidad_unidades
        if pp: suma_kilos_lote += Decimal(l.cantidad_unidades)*pp
        print(f"    factura {l.factura_id}: {l.cantidad_unidades} un | peso_prom_compra={pp}")
    print(f"  SUMA unidades en facturas: {suma_un} (detalle dice {int(d.cantidad_unidades)})")
    print(f"  SUMA kilos de lote atribuidos: {suma_kilos_lote}  vs cantidad_kilos bascula: {d.cantidad_kilos}")
    print()
