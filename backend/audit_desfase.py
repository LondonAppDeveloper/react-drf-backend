import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from decimal import Decimal
from django.db.models import Sum
from core.models import DetallePedido, FacturaDetallePedido, DetalleFactura, EntradaProducto

# Buscar DetallePedido donde cantidad_unidades > suma de FacturaDetallePedido.cantidad_unidades
total_lineas = 0
desfase = []
for d in DetallePedido.objects.exclude(pedido__estado='Anulado').select_related('pedido','producto'):
    total_lineas += 1
    unidades_detalle = int(d.cantidad_unidades or 0)
    if unidades_detalle == 0:
        continue
    unidades_facturas = FacturaDetallePedido.objects.filter(detallepedido=d).aggregate(t=Sum('cantidad_unidades'))['t'] or 0
    unidades_facturas = int(unidades_facturas)
    if unidades_detalle > unidades_facturas:
        desfase.append({
            'detalle_id': d.id,
            'pedido_id': d.pedido_id,
            'estado': d.pedido.estado,
            'producto': d.producto.nombre,
            'producto_id': d.producto_id,
            'unidades_detalle': unidades_detalle,
            'unidades_facturas': unidades_facturas,
            'faltan': unidades_detalle - unidades_facturas,
            'cantidad_kilos': d.cantidad_kilos,
            'costo_por_kilo': d.costo_por_kilo,
            'total_costo': d.total_costo,
        })

print(f"Total lineas DetallePedido (no anuladas): {total_lineas}")
print(f"Lineas con desfase (unidades vendidas > unidades con factura): {len(desfase)}")
print()
for x in sorted(desfase, key=lambda r: r['pedido_id']):
    print(f"Pedido #{x['pedido_id']} ({x['estado']}) / {x['producto']}: "
          f"vendidas={x['unidades_detalle']} con_factura={x['unidades_facturas']} faltan={x['faltan']} "
          f"| costo/kg={x['costo_por_kilo']} kilos={x['cantidad_kilos']}")

# Ademas: cuanto stock vivo hay disponible por producto para poder cubrir el faltante
print()
print("Stock vivo (EntradaProducto) por producto involucrado:")
prods = set(x['producto_id'] for x in desfase)
for pid in prods:
    from core.models import Producto
    p = Producto.objects.get(id=pid)
    vivo = EntradaProducto.objects.filter(producto=p).aggregate(u=Sum('cantidad_unidades'), k=Sum('cantidad_kilos'))
    faltan_prod = sum(x['faltan'] for x in desfase if x['producto_id']==pid)
    print(f"  {p.nombre}: stock_vivo_unidades={vivo['u'] or 0} stock_vivo_kilos={vivo['k'] or 0} | faltan_total_a_cubrir={faltan_prod}")
