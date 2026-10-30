from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Sum

from core.models import DetallePedido, DetalleFactura, FacturaDetallePedido
from core.utils import consumir_fifo


class Command(BaseCommand):
    """Corrige lineas de DetallePedido cuyo cantidad_unidades es MAYOR que la
    suma de unidades registradas en FacturaDetallePedido (desfase de origen:
    el pedido se edito subiendo la cantidad sin volver a descontar inventario
    ni recalcular el costo; ver PedidoDetailView.put, ya corregido para
    pedidos nuevos).

    Por cada linea con desfase:
      1. Reconstruye el costo/kilos de las unidades que YA tienen factura
         asociada (peso_promedio del lote * costo_por_kilo de esa factura).
      2. Consume del stock vivo (EntradaProducto, FIFO) las unidades faltantes,
         descontando inventario real y obteniendo su costo.
      3. Recalcula costo_por_kilo como el ponderado por kilos de ambos tramos
         y lo persiste (total_costo se recalcula solo en DetallePedido.save()).
      4. Registra/actualiza las unidades faltantes en FacturaDetallePedido para
         que el desglose por factura cuadre con las unidades vendidas.

    Si el stock vivo no alcanza a cubrir el faltante, consumir_fifo lanza
    ValidationError y esa linea se reporta como no corregible (se omite; la
    transaccion es por linea).
    """

    help = "Corrige DetallePedido con unidades vendidas > unidades con factura (desfase por edicion)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true",
                            help="Simula sin guardar ni descontar inventario.")
        parser.add_argument("--pedido", type=int, default=None,
                            help="Limitar a un solo Pedido por su ID.")

    def _costo_kilos_facturas_existentes(self, detalle):
        """Costo y kilos ya cubiertos por las facturas vinculadas a la linea."""
        costo = Decimal("0.00")
        kilos = Decimal("0.00")
        for link in FacturaDetallePedido.objects.filter(detallepedido=detalle):
            df = DetalleFactura.objects.filter(
                factura=link.factura_id, producto=detalle.producto_id
            ).first()
            if not df or not df.cantidad_unidades:
                continue
            peso_prom = Decimal(df.cantidad_kilos) / Decimal(df.cantidad_unidades)
            kilos_lote = Decimal(link.cantidad_unidades) * peso_prom
            costo += kilos_lote * df.costo_por_kilo
            kilos += kilos_lote
        return costo, kilos

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        pedido_id = options["pedido"]

        qs = DetallePedido.objects.exclude(pedido__estado="Anulado").select_related("pedido", "producto")
        if pedido_id:
            qs = qs.filter(pedido_id=pedido_id)

        corregidas = 0
        sin_stock = 0

        for detalle in qs:
            unidades_detalle = int(detalle.cantidad_unidades or 0)
            if unidades_detalle == 0:
                continue
            unidades_facturas = int(
                FacturaDetallePedido.objects.filter(detallepedido=detalle)
                .aggregate(t=Sum("cantidad_unidades"))["t"] or 0
            )
            faltan = unidades_detalle - unidades_facturas
            if faltan <= 0:
                continue

            try:
                with transaction.atomic():
                    costo_ex, kilos_ex = self._costo_kilos_facturas_existentes(detalle)

                    # Consumir el faltante del stock vivo (descuenta inventario).
                    costo_delta, kilos_delta, facturas_usadas, facturas_cant = consumir_fifo(
                        detalle.producto, faltan
                    )

                    kilos_total = kilos_ex + kilos_delta
                    costo_total = costo_ex + costo_delta
                    if kilos_total <= 0:
                        raise ValueError("kilos_total en 0, no se puede ponderar")

                    costo_por_kilo_nuevo = costo_total / kilos_total

                    self.stdout.write(
                        f"Pedido #{detalle.pedido_id} ({detalle.pedido.estado}) / {detalle.producto.nombre}: "
                        f"faltan {faltan} un. | costo/kg {detalle.costo_por_kilo} -> {costo_por_kilo_nuevo:.2f} "
                        f"| stock descontado: {faltan} un. ({kilos_delta:.2f} kg)"
                    )

                    if dry_run:
                        raise _Rollback()

                    detalle.costo_por_kilo = costo_por_kilo_nuevo
                    detalle.save()  # recalcula total_costo = cantidad_kilos * costo_por_kilo

                    detalle.facturas.add(*facturas_usadas)
                    for factura_id, cantidad in facturas_cant.items():
                        link, created = FacturaDetallePedido.objects.get_or_create(
                            detallepedido=detalle, factura_id=factura_id,
                            defaults={"cantidad_unidades": cantidad},
                        )
                        if not created:
                            link.cantidad_unidades += cantidad
                            link.save()

                corregidas += 1
            except _Rollback:
                corregidas += 1  # en dry-run contamos como "se corregiria"
            except Exception as e:
                sin_stock += 1
                self.stdout.write(self.style.WARNING(
                    f"Pedido #{detalle.pedido_id} / {detalle.producto.nombre}: "
                    f"NO corregible ({e}). Se omite."
                ))

        self.stdout.write(self.style.SUCCESS(
            f"{'[DRY-RUN] ' if dry_run else ''}Lineas corregidas: {corregidas}. "
            f"Omitidas (sin stock/datos): {sin_stock}."
        ))


class _Rollback(Exception):
    """Fuerza rollback de la transaccion en modo dry-run."""
    pass
