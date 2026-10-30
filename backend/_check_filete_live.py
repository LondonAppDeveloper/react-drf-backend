import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

from django.db.models import Sum
from core.models import Producto, EntradaProducto, DetallePedido, DetalleFactura, AjusteInventario

p = Producto.objects.get(nombre='Filete')

ledger = EntradaProducto.objects.filter(producto=p).aggregate(u=Sum('cantidad_unidades'), k=Sum('cantidad_kilos'))
print('ledger (lo que muestra Stock):', ledger)

reservado_qs = DetallePedido.objects.filter(producto=p, pedido__estado='Reservado').exclude(estado='Cancelado')
print('\n--- Reservado ---')
for d in reservado_qs:
    print(f'pedido={d.pedido_id} detalle={d.id} unidades={d.cantidad_unidades} kilos={d.cantidad_kilos}')
print('total reservado:', reservado_qs.aggregate(u=Sum('cantidad_unidades')))

comprado = DetalleFactura.objects.filter(producto=p).aggregate(u=Sum('cantidad_unidades'))
vendido = DetallePedido.objects.filter(producto=p).exclude(pedido__estado="Anulado").exclude(estado="Cancelado").aggregate(u=Sum('cantidad_unidades'))
ajustes = AjusteInventario.objects.filter(producto=p).aggregate(u=Sum('cantidad_unidades'))
print('\ncomprado:', comprado, 'vendido:', vendido, 'ajustes:', ajustes)
