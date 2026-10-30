"""Descompone el stock del dashboard (ledger EntradaProducto) para un producto
y lo contrasta contra la cuenta manual del Excel de Movimientos.

Solo lee, no escribe nada.

Uso:  python manage.py shell < reconciliar_stock.py
"""
from decimal import Decimal

from django.db.models import Sum
from core.models import (
    Producto, DetalleFactura, DetallePedido, EntradaProducto, AjusteInventario,
    FacturaDetallePedido,
)

FILTRO_NOMBRE = "ganso"   # substring; vacio = todos los productos


def s(qs, campo):
    return qs.aggregate(t=Sum(campo))['t'] or 0


productos = Producto.objects.exclude(estado="desactivado").order_by('nombre')
if FILTRO_NOMBRE:
    productos = productos.filter(nombre__icontains=FILTRO_NOMBRE)

for p in productos:
    ledger = s(EntradaProducto.objects.filter(producto=p), 'cantidad_unidades')
    df_total = s(DetalleFactura.objects.filter(producto=p), 'cantidad_unidades')
    sal_activas = s(
        DetallePedido.objects.filter(producto=p).exclude(pedido__estado="Anulado"),
        'cantidad_unidades')
    sal_anuladas = s(
        DetallePedido.objects.filter(producto=p, pedido__estado="Anulado"),
        'cantidad_unidades')
    manual = df_total - sal_activas

    print(f"\n{'=' * 70}")
    print(f"{p.nombre}  (id={p.id})")
    print(f"{'=' * 70}")
    print(f"  DASHBOARD (Sum EntradaProducto.cantidad_unidades) : {ledger}")
    print(f"  EXCEL     (DetalleFactura {df_total} - salidas activas {sal_activas}) : {manual}")
    print(f"  DIFERENCIA (dashboard - excel) : {ledger - manual}")
    print(f"  [salidas en pedidos Anulados, ya excluidas del Excel: {sal_anuladas}]")

    # --- De donde salen las filas vivas del ledger, factura por factura ---
    print("\n  LEDGER VIVO POR FACTURA:")
    vivas_por_factura = {}
    for e in EntradaProducto.objects.filter(producto=p).order_by('fecha_entrada'):
        vivas_por_factura.setdefault(e.factura_id, []).append(e)

    df_por_factura = {
        d.factura_id: d.cantidad_unidades or 0
        for d in DetalleFactura.objects.filter(producto=p)
    }

    huerfanas = 0
    for fid, filas in vivas_por_factura.items():
        vivas = sum(int(f.cantidad_unidades) for f in filas)
        orig = int(df_por_factura.get(fid, 0))
        # Unidades de esa factura ya consumidas por pedidos NO anulados
        consumidas_activas = s(
            FacturaDetallePedido.objects.filter(
                factura=fid, detallepedido__producto=p
            ).exclude(detallepedido__pedido__estado="Anulado"),
            'cantidad_unidades')
        esperado = orig - consumidas_activas
        marca = "" if vivas == esperado else f"   <<< descuadre {vivas - esperado}"
        if fid not in df_por_factura:
            huerfanas += vivas
            marca += "  [SIN DetalleFactura: fila creada por anulacion]"
        print(f"    factura {fid}: vivas={vivas}  DetalleFactura={orig}  "
              f"consumidas_activas={consumidas_activas}  esperado={esperado}"
              f"  filas={len(filas)}{marca}")

    if huerfanas:
        print(f"\n  >>> {huerfanas} unidades vivas NO respaldadas por ninguna "
              f"DetalleFactura (devoluciones de anulacion)")

    # --- Ajustes registrados ---
    aj = AjusteInventario.objects.filter(producto=p)
    if aj.exists():
        print("\n  AJUSTES REGISTRADOS:")
        for a in aj.order_by('fecha'):
            print(f"    {a.fecha} {a.tipo:8} {a.cantidad_unidades:>4} un "
                  f"{a.cantidad:>8} kg  {(a.razon or '')[:40]}")
        print(f"    total unidades ajustadas: {s(aj, 'cantidad_unidades')}")
