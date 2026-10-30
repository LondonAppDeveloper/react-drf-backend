import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from decimal import Decimal
from core.models import DetallePedido, FacturaDetallePedido, DetalleFactura
from core.serializers import DetallePedidoSerializer
from rest_framework.renderers import JSONRenderer
import json

d = DetallePedido.objects.get(pedido_id=34, producto__nombre='Punta De Ganso')
print("cantidad_unidades:", d.cantidad_unidades, "cantidad_kilos:", d.cantidad_kilos)
print("costo_por_kilo:", d.costo_por_kilo, "total_costo:", d.total_costo)
data = json.loads(JSONRenderer().render(DetallePedidoSerializer(d).data))
suma_un = sum(f['unidades_consumidas'] for f in data['facturas_detalle'])
suma_costo = sum(f['costo_atribuido'] for f in data['facturas_detalle'])
print(f"Facturas en desglose: {len(data['facturas_detalle'])}, suma unidades={suma_un} (detalle dice {int(d.cantidad_unidades)})")
for f in data['facturas_detalle']:
    print(f"  {f['numero_factura']}: {f['unidades_consumidas']} un, {f['kilos_atribuidos']:.2f} kg @ ${f['costo_por_kilo']} = ${f['costo_atribuido']:.0f}")
print(f"Suma costo atribuido: ${suma_costo:.0f}  vs total_costo linea: ${float(d.total_costo):.0f}")
