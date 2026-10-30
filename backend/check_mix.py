import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from core.models import DetallePedido, FacturaDetallePedido, DetalleFactura

qs = DetallePedido.objects.filter(producto__nombre='Punta De Ganso').exclude(pedido__estado='Anulado')
for d in qs.order_by('pedido_id'):
    links = FacturaDetallePedido.objects.filter(detallepedido=d)
    facturas_info = []
    for l in links:
        df = DetalleFactura.objects.filter(factura=l.factura_id, producto=d.producto_id).first()
        facturas_info.append((l.factura.numero_factura, l.cantidad_unidades, float(df.costo_por_kilo) if df else None))
    if len(facturas_info) > 1:
        print(f"Pedido #{d.pedido_id}: costo_por_kilo={float(d.costo_por_kilo):.2f}  facturas={facturas_info}")
