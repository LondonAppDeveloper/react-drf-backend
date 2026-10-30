import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from decimal import Decimal
from core.models import DetallePedido, FacturaDetallePedido, DetalleFactura
from core.serializers import DetallePedidoSerializer
from rest_framework.renderers import JSONRenderer
import json

d = DetallePedido.objects.get(pedido_id=3, producto__nombre='Punta De Ganso')
print("cantidad_unidades:", d.cantidad_unidades, "cantidad_kilos:", d.cantidad_kilos)
print("costo_por_kilo (neto, guardado):", d.costo_por_kilo)
print("total_costo (neto, guardado):", d.total_costo)
print("precio_venta:", d.precio_venta, "total_venta:", d.total_venta)
print()
IVA = Decimal('1.19')
print("costo_por_kilo CON IVA (lo que muestra la fila principal):", d.costo_por_kilo * IVA)
print()
data = json.loads(JSONRenderer().render(DetallePedidoSerializer(d).data))
suma_un = 0
suma_costo = Decimal('0')
suma_kilos = Decimal('0')
for f in data['facturas_detalle']:
    kilos = Decimal(str(f['kilos_atribuidos']))
    cpk = Decimal(str(f['costo_por_kilo']))
    costo = Decimal(str(f['costo_atribuido']))
    suma_un += f['unidades_consumidas']
    suma_costo += costo
    suma_kilos += kilos
    print(f"  {f['numero_factura']}: {f['unidades_consumidas']} un | kilos EXACTO={kilos} (display {kilos:.2f}) | @${cpk} | costo EXACTO={costo} (display {costo:.0f})")
    print(f"       verif kilos*cpk = {kilos*cpk}")
print()
print(f"Suma unidades: {suma_un}")
print(f"Suma kilos atribuidos: {suma_kilos}  vs cantidad_kilos bascula: {d.cantidad_kilos}")
print(f"Suma costo atribuido (neto): {suma_costo}  vs total_costo linea: {d.total_costo}")
print(f"costo_por_kilo implicito = suma_costo/suma_kilos = {suma_costo/suma_kilos}")
print(f"costo_por_kilo implicito CON IVA = {suma_costo/suma_kilos*IVA}")
