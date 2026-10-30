from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import DetallePedido, DetalleFactura, FacturaDetallePedido


class Command(BaseCommand):
    """Reconstruye el costo de lineas de DetallePedido que quedaron con
    total_costo/costo_por_kilo en $0 por el bug del flujo "Reservado" (ver
    CrearPedido en views.py): el costo se calculaba bien via FIFO pero se
    descartaba a proposito si el pedido se creaba sin kilos todavia.

    Esas lineas SI tienen su vinculo a la(s) factura(s) de compra que las
    abastecio (via FacturaDetallePedido), asi que el costo se puede
    reconstruir desde DetalleFactura (que a diferencia de EntradaProducto
    nunca se borra/decrementa al vender).

    Por cada FacturaDetallePedido de la linea rota:
      peso_promedio_lote = DetalleFactura.cantidad_kilos / DetalleFactura.cantidad_unidades
      kilos_atribuidos    = unidades_consumidas_de_esa_factura * peso_promedio_lote
      costo_atribuido     = kilos_atribuidos * DetalleFactura.costo_por_kilo

    Sumando esto sobre todas las facturas vinculadas se obtiene un costo por
    kilo ponderado real, que se aplica a los kilos reales de la venta
    (DetallePedido.cantidad_kilos, el peso de bascula, no el de la factura).

    Lineas que NO tengan ninguna factura vinculada quedan intactas: no hay
    forma honesta de inventarles un costo.
    """

    help = "Reconstruye total_costo/costo_por_kilo en $0 de DetallePedido usando las facturas vinculadas."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Solo muestra que se cambiaria, sin guardar nada.",
        )
        parser.add_argument(
            "--pedido",
            type=int,
            default=None,
            help="Limitar el backfill a un solo Pedido por su ID (ej. --pedido 109).",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        pedido_id = options["pedido"]

        qs = DetallePedido.objects.filter(
            total_costo=0,
            cantidad_kilos__gt=0,
        ).select_related("pedido", "producto")

        if pedido_id:
            qs = qs.filter(pedido_id=pedido_id)

        arregladas = 0
        sin_factura = 0

        for detalle in qs:
            links = FacturaDetallePedido.objects.filter(detallepedido=detalle)
            if not links.exists():
                sin_factura += 1
                continue

            costo_reconstruido = Decimal("0.00")
            kilos_atribuidos_total = Decimal("0.00")

            for link in links:
                detalle_factura = (
                    DetalleFactura.objects.filter(
                        factura=link.factura_id, producto=detalle.producto_id
                    )
                    .first()
                )
                if not detalle_factura or not detalle_factura.cantidad_unidades:
                    continue

                peso_promedio = (
                    Decimal(detalle_factura.cantidad_kilos)
                    / Decimal(detalle_factura.cantidad_unidades)
                )
                kilos_atribuidos = Decimal(link.cantidad_unidades) * peso_promedio
                costo_reconstruido += kilos_atribuidos * detalle_factura.costo_por_kilo
                kilos_atribuidos_total += kilos_atribuidos

            if kilos_atribuidos_total <= 0:
                sin_factura += 1
                continue

            costo_por_kilo_nuevo = costo_reconstruido / kilos_atribuidos_total
            total_costo_nuevo = detalle.cantidad_kilos * costo_por_kilo_nuevo

            self.stdout.write(
                f"Pedido #{detalle.pedido_id} / {detalle.producto.nombre}: "
                f"costo_por_kilo $0 -> ${costo_por_kilo_nuevo:.2f}, "
                f"total_costo $0 -> ${total_costo_nuevo:.2f}"
            )

            if not dry_run:
                with transaction.atomic():
                    detalle.costo_por_kilo = costo_por_kilo_nuevo
                    detalle.save()

            arregladas += 1

        self.stdout.write(self.style.SUCCESS(
            f"{'[DRY-RUN] ' if dry_run else ''}Lineas reconstruidas: {arregladas}. "
            f"Sin factura vinculada o sin datos suficientes (sin tocar): {sin_factura}."
        ))
