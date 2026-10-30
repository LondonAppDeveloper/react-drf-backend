from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import DetallePedido
from core.utils import costo_por_kilo_ponderado


class Command(BaseCommand):
    """Recalcula DetallePedido.costo_por_kilo (y por ende total_costo, derivado
    en save()) usando el modelo de costo elegido: promedio ponderado por
    unidades del costo/kg de los lotes de compra vinculados (ver
    costo_por_kilo_ponderado en utils.py).

    Robusto: solo usa el costo/kg del proveedor y las unidades, nunca los pesos
    por pieza (corruptos en ~30% de los historicos). El costo/kg resultante
    siempre queda entre el min y max de los lotes, asi que nunca produce valores
    absurdos. Tras correr esto, el desglose "Facturas asociadas" de Movimientos
    cuadra exacto con total_costo.

    Solo toca lineas con al menos una factura vinculada; el resto queda intacto.
    """

    help = "Recalcula costo_por_kilo como promedio ponderado de los lotes (modelo robusto)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Simula sin guardar.")
        parser.add_argument("--pedido", type=int, default=None, help="Limitar a un Pedido por ID.")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        pedido_id = options["pedido"]

        qs = DetallePedido.objects.exclude(pedido__estado="Anulado").select_related("pedido", "producto")
        if pedido_id:
            qs = qs.filter(pedido_id=pedido_id)

        actualizadas = 0
        sin_factura = 0

        for detalle in qs:
            cpk = costo_por_kilo_ponderado(detalle)
            if cpk is None:
                sin_factura += 1
                continue

            cpk = cpk.quantize(Decimal("0.01"))
            if cpk == detalle.costo_por_kilo:
                continue

            total_nuevo = (Decimal(str(detalle.cantidad_kilos or 0)) * cpk).quantize(Decimal("0.01"))
            self.stdout.write(
                f"Pedido #{detalle.pedido_id} / {detalle.producto.nombre}: "
                f"costo/kg {detalle.costo_por_kilo} -> {cpk} | "
                f"total_costo {detalle.total_costo} -> {total_nuevo}"
            )

            if not dry_run:
                with transaction.atomic():
                    detalle.costo_por_kilo = cpk
                    detalle.save()  # deriva total_costo = costo/kg * kilos

            actualizadas += 1

        self.stdout.write(self.style.SUCCESS(
            f"{'[DRY-RUN] ' if dry_run else ''}Lineas actualizadas: {actualizadas}. "
            f"Sin factura vinculada (intactas): {sin_factura}."
        ))
