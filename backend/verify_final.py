import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from decimal import Decimal
from core.models import DetallePedido
from core.serializers import DetallePedidoSerializer
from rest_framework.renderers import JSONRenderer
import json

for pid, prod in [(3,'Punta De Ganso'), (50,'Filete'), (34,'Punta De Ganso')]:
    d = DetallePedido.objects.get(pedido_id=pid, producto__nombre=prod)
    IVA = Decimal('1.19')
    print(f"=== Pedido #{pid} / {prod} ===")
    print(f"  Fila principal -> costo/kg (con IVA): ${d.costo_por_kilo*IVA:.0f} | total_costo (con IVA): ${d.total_costo*IVA:.0f}")
    data = json.loads(JSONRenderer().render(DetallePedidoSerializer(d).data))
    suma = Decimal('0'); suma_un=0
    for f in data['facturas_detalle']:
        c = Decimal(str(f['costo_atribuido']))
        suma += c; suma_un += f['unidades_consumidas']
        print(f"    {f['numero_factura']}: {f['unidades_consumidas']} un, {float(f['kilos_atribuidos']):.2f} kg @ ${f['costo_por_kilo']} = ${float(c):.0f} (neto)")
    print(f"  Diálogo: suma unidades={suma_un} (fila={int(d.cantidad_unidades)}) | suma costo atribuido (neto)=${float(suma):.2f} vs total_costo=${float(d.total_costo):.2f}")
    print(f"  >>> {'CUADRA' if abs(suma - d.total_costo) < Decimal('1') else 'NO CUADRA'}")
    print()
