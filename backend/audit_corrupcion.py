import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from decimal import Decimal
from django.db.models import Sum
from core.models import DetallePedido, FacturaDetallePedido, DetalleFactura

total=0; desfase_sube=0; desfase_baja=0; ok=0; peso_incoherente=0; sin_factura=0
for d in DetallePedido.objects.exclude(pedido__estado='Anulado'):
    total+=1
    ud = int(d.cantidad_unidades or 0)
    if ud==0: continue
    uf = int(FacturaDetallePedido.objects.filter(detallepedido=d).aggregate(t=Sum('cantidad_unidades'))['t'] or 0)
    if uf==0:
        sin_factura+=1; continue
    if ud>uf: desfase_sube+=1
    elif ud<uf: desfase_baja+=1
    else: ok+=1
    # peso incoherente: kilos vendidos por unidad > peso de compra por unidad (imposible fisicamente)
    if d.cantidad_kilos and ud>0:
        peso_venta_un = Decimal(d.cantidad_kilos)/ud
        # peso compra promedio de los lotes vinculados
        kl=Decimal('0'); un=0
        for l in FacturaDetallePedido.objects.filter(detallepedido=d):
            df=DetalleFactura.objects.filter(factura=l.factura_id, producto=d.producto_id).first()
            if df and df.cantidad_unidades:
                kl += Decimal(df.cantidad_kilos)/Decimal(df.cantidad_unidades)*l.cantidad_unidades
                un += l.cantidad_unidades
        if un>0:
            peso_compra_un = kl/un
            if peso_venta_un > peso_compra_un * Decimal('1.05'):  # 5% tolerancia
                peso_incoherente+=1

print(f"Total lineas no anuladas con unidades: {total}")
print(f"  OK (unidades detalle == facturas): {ok}")
print(f"  Desfase SUBE (detalle > facturas): {desfase_sube}")
print(f"  Desfase BAJA (detalle < facturas): {desfase_baja}")
print(f"  Sin factura vinculada: {sin_factura}")
print(f"  Peso incoherente (kg vendido/un > kg compra/un +5%): {peso_incoherente}")
