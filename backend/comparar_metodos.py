import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from decimal import Decimal
from core.models import DetallePedido, FacturaDetallePedido, DetalleFactura

diffs = []
for d in DetallePedido.objects.exclude(pedido__estado='Anulado').select_related('pedido','producto'):
    links = list(FacturaDetallePedido.objects.filter(detallepedido=d))
    if len(links) < 2:
        continue  # solo interesa cuando hay MAS DE UN lote (ahi es donde divergen los metodos)

    suma_costo_un = Decimal('0'); suma_un = 0
    suma_costo_kg = Decimal('0'); suma_kg = Decimal('0')
    for l in links:
        df = DetalleFactura.objects.filter(factura=l.factura_id, producto=d.producto_id).first()
        if not df or not df.cantidad_unidades:
            continue
        suma_costo_un += Decimal(l.cantidad_unidades) * df.costo_por_kilo
        suma_un += l.cantidad_unidades
        peso_prom = df.cantidad_kilos / df.cantidad_unidades
        kilos_lote = Decimal(l.cantidad_unidades) * peso_prom
        suma_costo_kg += kilos_lote * df.costo_por_kilo
        suma_kg += kilos_lote

    if suma_un == 0 or suma_kg == 0:
        continue
    cpk_por_unidades = suma_costo_un / suma_un       # metodo ACTUAL
    cpk_por_kilos = suma_costo_kg / suma_kg           # metodo alternativo (peso de lote)
    diff_pct = abs(cpk_por_unidades - cpk_por_kilos) / cpk_por_kilos * 100
    diffs.append((d.pedido_id, d.producto.nombre, float(cpk_por_unidades), float(cpk_por_kilos), float(diff_pct)))

diffs.sort(key=lambda x: -x[4])
print(f"Lineas con 2+ facturas (donde los metodos pueden divergir): {len(diffs)}")
print()
print("TOP 10 mayor diferencia %:")
for x in diffs[:10]:
    print(f"  Pedido #{x[0]} / {x[1]}: por-unidades=${x[2]:.2f}/kg  por-kilos-de-lote=${x[3]:.2f}/kg  diff={x[4]:.2f}%")
import statistics
pcts = [x[4] for x in diffs]
print()
print(f"Mediana diferencia: {statistics.median(pcts):.3f}%   Max: {max(pcts):.2f}%   Promedio: {statistics.mean(pcts):.3f}%")
