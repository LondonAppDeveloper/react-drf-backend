"""Ubica, factura por factura, las unidades compradas que no estan ni vivas en
el ledger ni atribuidas a una venta. Esas son las que hay que reponer.
Solo lee."""
from django.db.models import Sum
from core.models import (
    Producto, DetalleFactura, EntradaProducto, FacturaDetallePedido,
)

IDS = [4, 6, 7]   # Picana, Longaniza, Hamburguesa


def s(qs, c):
    return qs.aggregate(t=Sum(c))['t'] or 0


for pid in IDS:
    p = Producto.objects.get(id=pid)
    print(f"\n{'=' * 66}\n  {p.nombre} (id={p.id})\n{'=' * 66}")
    print(f"  {'factura':<12}{'comprado':>9}{'vivas':>7}{'vendidas':>10}{'gap':>6}")

    total_gap = 0
    for d in DetalleFactura.objects.filter(producto=p).order_by('factura__fecha'):
        comprado = int(d.cantidad_unidades or 0)
        vivas = int(s(EntradaProducto.objects.filter(
            producto=p, factura=d.factura_id), 'cantidad_unidades'))
        vendidas = int(s(FacturaDetallePedido.objects.filter(
            factura=d.factura_id, detallepedido__producto=p
        ).exclude(detallepedido__pedido__estado="Anulado"), 'cantidad_unidades'))
        gap = comprado - vivas - vendidas
        total_gap += gap
        marca = "  <<<" if gap else ""
        print(f"  {str(d.factura_id):<12}{comprado:>9}{vivas:>7}{vendidas:>10}"
              f"{gap:>6}{marca}   costo/kg={d.costo_por_kilo} kg={d.cantidad_kilos}")

    # Lotes vivos sin DetalleFactura de respaldo (devoluciones de anulacion)
    facturas_df = set(DetalleFactura.objects.filter(producto=p)
                      .values_list('factura_id', flat=True))
    for e in EntradaProducto.objects.filter(producto=p):
        if e.factura_id not in facturas_df:
            print(f"  lote HUERFANO factura={e.factura_id} un={e.cantidad_unidades} "
                  f"kg={e.cantidad_kilos}  (sin compra que lo respalde)")

    print(f"  {'-' * 44}\n  GAP TOTAL (unidades a reponer): {total_gap}")
