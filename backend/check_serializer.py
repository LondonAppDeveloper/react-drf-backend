import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from core.models import DetallePedido
from core.serializers import DetallePedidoSerializer
import json

d = DetallePedido.objects.get(pedido_id=78, producto__nombre='Punta De Ganso')
data = DetallePedidoSerializer(d).data
print(json.dumps({k: str(v) for k,v in data.items() if k in ('facturas_detalle','costo_por_kilo','pedido')}, indent=2, default=str))
