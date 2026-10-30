import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from core.models import DetallePedido, FacturaDetallePedido, DetalleFactura, Pedido

d = DetallePedido.objects.get(pedido_id=34, producto__nombre='Punta De Ganso')
print("id:", d.id)
print("cantidad_kilos:", repr(d.cantidad_kilos))
print("cantidad_unidades:", repr(d.cantidad_unidades))
print("costo_por_kilo:", repr(d.costo_por_kilo))
print("total_costo:", repr(d.total_costo))
print("total_venta:", repr(d.total_venta))
print("precio_venta:", repr(d.precio_venta))
print("margen:", repr(d.margen))
print("facturas (M2M):", list(d.facturas.all().values_list('numero_factura', flat=True)))

links = FacturaDetallePedido.objects.filter(detallepedido=d)
total_unidades_facturas = 0
for l in links:
    print("FacturaDetallePedido:", l.factura_id, "cantidad_unidades:", l.cantidad_unidades)
    total_unidades_facturas += l.cantidad_unidades
print("TOTAL unidades cubiertas por facturas:", total_unidades_facturas, " vs cantidad_unidades del detalle:", d.cantidad_unidades)

# Recalcular con formula VIEJA (bug: pondera por unidades)
costo_total_viejo = sum(l.cantidad_unidades * DetalleFactura.objects.filter(factura=l.factura_id, producto=d.producto_id).first().costo_por_kilo for l in links)
print("costo_total (formula vieja, ponderando unidades):", costo_total_viejo)
if total_unidades_facturas:
    print("costoXkilo (formula vieja):", costo_total_viejo/total_unidades_facturas)
