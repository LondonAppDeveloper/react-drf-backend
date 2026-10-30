import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from decimal import Decimal
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
    casos.append((d.pedido_id, d.producto.nombre, ud, float(d.cantidad_kilos), float(peso_venta_un), float(peso_compra_un), float(ratio)))

casos.sort(key=lambda c: -c[6])
print("TOP 10 ratios mas altos (venta/compra por unidad):")
for c in casos[:10]:
    print(f"  Pedido #{c[0]} / {c[1]}: {c[2]} un = {c[3]}kg -> {c[4]:.2f} kg/un vendido vs {c[5]:.2f} kg/un comprado = {c[6]:.2f}x")

print()
print("TOP 10 ratios mas bajos:")
for c in casos[-10:]:
    print(f"  Pedido #{c[0]} / {c[1]}: {c[2]} un = {c[3]}kg -> {c[4]:.2f} kg/un vendido vs {c[5]:.2f} kg/un comprado = {c[6]:.2f}x")

import statistics
ratios = [c[6] for c in casos]
print()
print(f"N={len(ratios)}  mediana={statistics.median(ratios):.2f}  min={min(ratios):.2f}  max={max(ratios):.2f}")
