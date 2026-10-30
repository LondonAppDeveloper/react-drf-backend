import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from core.models import DetallePedido, FacturaDetallePedido, DetalleFactura, Pedido, EntradaProducto

d = DetallePedido.objects.get(pedido_id=34, producto__nombre='Punta De Ganso')
print("Pedido estado:", d.pedido.estado, "fecha detalle:", d.fecha)

# Verificar si las 2 facturas linkeadas siguen teniendo EntradaProducto viva (senal de que no se consumieron por completo, o que se reconciliaron)
for numf in ['37950070', '37888237']:
    ep = EntradaProducto.objects.filter(factura_id=numf, producto=d.producto_id)
    print(f"EntradaProducto viva para factura {numf}:", list(ep.values('cantidad_unidades','cantidad_kilos','costo_por_kilo')))
    df = DetalleFactura.objects.filter(factura_id=numf, producto=d.producto_id).first()
    print(f"  DetalleFactura original: cantidad_unidades={df.cantidad_unidades} cantidad_kilos={df.cantidad_kilos}")

# Buscar TODOS los FacturaDetallePedido para este producto ligados a pedido 34 (por si hay mas de un DetallePedido para el mismo producto en el mismo pedido, poco probable pero por si acaso)
print("Todos los DetallePedido de pedido 34:")
for dd in DetallePedido.objects.filter(pedido_id=34):
    print(" ", dd.id, dd.producto.nombre, dd.cantidad_unidades, dd.cantidad_kilos, dd.costo_por_kilo)
