import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from decimal import Decimal
from django.db.models import Sum
from core.models import DetallePedido, FacturaDetallePedido, DetalleFactura

casos = []
for d in DetallePedido.objects.exclude(pedido__estado='Anulado').select_related('pedido','producto'):
    ud = int(d.cantidad_unidades or 0)
    if ud == 0 or not d.cantidad_kilos:
        continue
    peso_venta_un = Decimal(d.cantidad_kilos)/ud
    kl = Decimal('0'); un = 0
    for l in FacturaDetallePedido.objects.filter(detallepedido=d):
        df = DetalleFactura.objects.filter(factura=l.factura_id, producto=d.producto_id).first()
        if df and df.cantidad_unidades:
            kl += Decimal(df.cantidad_kilos)/Decimal(df.cantidad_unidades)*l.cantidad_unidades
            un += l.cantidad_unidades
    if un == 0:
        continue
    peso_compra_un = kl/un
    ratio = peso_venta_un/peso_compra_un
    if ratio > Decimal('1.05'):
        casos.append((d.pedido_id, d.producto.nombre, d.pedido.fecha, ud, d.cantidad_kilos, peso_venta_un, peso_compra_un, ratio, d.pedido.estado))

casos.sort(key=lambda c: c[2])
print(f"Total casos peso incoherente: {len(casos)}")
print()
for c in casos[:15]:
    pid, prod, fecha, ud, kilos, pv, pc, ratio, estado = c
    print(f"Pedido #{pid} ({fecha}, {estado}) / {prod}: {ud} un = {kilos} kg -> {pv:.2f} kg/un vendido vs {pc:.2f} kg/un comprado (ratio {ratio:.1f}x)")
print("...")
for c in casos[-5:]:
    pid, prod, fecha, ud, kilos, pv, pc, ratio, estado = c
    print(f"Pedido #{pid} ({fecha}, {estado}) / {prod}: {ud} un = {kilos} kg -> {pv:.2f} kg/un vendido vs {pc:.2f} kg/un comprado (ratio {ratio:.1f}x)")

print()
fechas = [c[2] for c in casos]
print("Rango de fechas de los casos:", min(fechas), "a", max(fechas))

# Ver si el problema esta concentrado en ciertos productos
from collections import Counter
por_producto = Counter(c[1] for c in casos)
print("Por producto:", dict(por_producto))
