import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from core.models import DetallePedido, FacturaDetallePedido, DetalleFactura
from core.serializers import DetallePedidoSerializer
from rest_framework.renderers import JSONRenderer

d = DetallePedido.objects.get(pedido_id=34, producto__nombre='Punta De Ganso')
print("cantidad_kilos:", d.cantidad_kilos, "cantidad_unidades:", d.cantidad_unidades)
print("costo_por_kilo:", d.costo_por_kilo, "total_costo:", d.total_costo, "total_venta:", d.total_venta)

links = FacturaDetallePedido.objects.filter(detallepedido=d)
for l in links:
    df = DetalleFactura.objects.filter(factura=l.factura_id, producto=d.producto_id).first()
    print("factura", l.factura_id, "unidades_consumidas", l.cantidad_unidades)
    print("  DetalleFactura.cantidad_kilos:", df.cantidad_kilos, "cantidad_unidades:", df.cantidad_unidades, "costo_por_kilo:", df.costo_por_kilo)
    peso_prom = df.cantidad_kilos / df.cantidad_unidades
    kilos_atrib = peso_prom * l.cantidad_unidades
    costo_atrib = kilos_atrib * df.costo_por_kilo
    print("  peso_promedio:", peso_prom, "kilos_atribuidos:", kilos_atrib, "costo_atribuido:", costo_atrib)

data = DetallePedidoSerializer(d).data
raw = JSONRenderer().render(data)
print("RAW JSON (facturas_detalle portion):")
import json
parsed = json.loads(raw)
print(json.dumps(parsed['facturas_detalle'], indent=2))
