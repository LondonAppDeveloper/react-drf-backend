import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from decimal import Decimal
from core.models import DetallePedido, FacturaDetallePedido, DetalleFactura

d = DetallePedido.objects.get(pedido_id=3, producto__nombre='Punta De Ganso')
print(f"Kilos VENDIDOS (bascula, la fuente de verdad): {d.cantidad_kilos}")
print(f"Unidades vendidas: {d.cantidad_unidades}")
print()

links = FacturaDetallePedido.objects.filter(detallepedido=d)
total_un = sum(l.cantidad_unidades for l in links)
for l in links:
    df = DetalleFactura.objects.filter(factura=l.factura_id, producto=d.producto_id).first()
    peso_prom_compra = df.cantidad_kilos/df.cantidad_unidades
    kilos_reparto_nuevo = Decimal(d.cantidad_kilos) * l.cantidad_unidades / total_un
    kilos_peso_real_compra = peso_prom_compra * l.cantidad_unidades
    print(f"Factura {l.factura_id}: {l.cantidad_unidades} unidades")
    print(f"  Peso promedio de ESA pieza en la factura de compra: {peso_prom_compra:.4f} kg/un -> si multiplicas x{l.cantidad_unidades} un = {kilos_peso_real_compra:.2f} kg -> x ${df.costo_por_kilo} = ${kilos_peso_real_compra*df.costo_por_kilo:.0f}")
    print(f"  Kilos REPARTIDOS proporcionalmente (metodo actual): {kilos_reparto_nuevo:.2f} kg -> x ${df.costo_por_kilo} = ${kilos_reparto_nuevo*df.costo_por_kilo:.0f}")
    print()
