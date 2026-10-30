import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

from django.db.models import Sum
from core.models import Producto, DetallePedido

p = Producto.objects.get(nombre='Filete')

print('--- Pagado sin pesar (kilos=0, podria seguir fisico) ---')
qs = DetallePedido.objects.filter(producto=p, pedido__estado='Pagado', cantidad_kilos=0).exclude(estado='Cancelado')
for d in qs:
    print(f'pedido={d.pedido_id} detalle={d.id} unidades={d.cantidad_unidades}')
print('total:', qs.aggregate(u=Sum('cantidad_unidades')))

print('\n--- Todas las lineas Canceladas de Filete (en pedidos no anulados) ---')
qs2 = DetallePedido.objects.filter(producto=p, estado='Cancelado').exclude(pedido__estado='Anulado')
for d in qs2:
    print(f'pedido={d.pedido_id} detalle={d.id} unidades={d.cantidad_unidades} kilos={d.cantidad_kilos} pedido_estado={d.pedido.estado}')
print('total:', qs2.aggregate(u=Sum('cantidad_unidades')))

print('\n--- Todos los pedidos ACTIVOS (no anulado, no cancelado) con Filete, por estado ---')
qs3 = DetallePedido.objects.filter(producto=p).exclude(pedido__estado='Anulado').exclude(estado='Cancelado')
for d in qs3.order_by('pedido__estado'):
    print(f'pedido={d.pedido_id} estado_pedido={d.pedido.estado} unidades={d.cantidad_unidades} kilos={d.cantidad_kilos}')
