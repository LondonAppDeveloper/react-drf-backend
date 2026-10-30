"""Resincroniza el ledger de stock (EntradaProducto) con la verdad contable.

POR QUE HACE FALTA
El dashboard (StockProductos) muestra Sum(EntradaProducto.cantidad_unidades),
un ledger vivo que se descuenta por FIFO en cada venta. Ese ledger quedo
inflado respecto de la contabilidad real por dos causas historicas:

  1. Ventas que nunca descontaron inventario. Bug de origen ya corregido en
     PedidoDetailView.put (ver el comentario sobre el Pedido #34), pero los
     pedidos anteriores al arreglo dejaron el ledger sin descontar.
  2. Anulaciones que devolvieron de mas, porque CancelarPedido devolvia la suma
     de FacturaDetallePedido sin topearla contra DetallePedido. Ya corregido.

Este comando corrige los DATOS que esos bugs dejaron atras.

VERDAD DE REFERENCIA
    objetivo = Sum(DetalleFactura.cantidad_unidades)              [comprado]
             - Sum(DetallePedido.cantidad_unidades no anulados)   [vendido]

Se recorta el excedente por FIFO (lote mas antiguo primero), la misma politica
que consumir_fifo, arrastrando los kilos proporcionales al peso promedio del
lote. Los lotes que llegan a 0 unidades se borran, igual que en una venta.

Los productos donde el ledger quedo POR DEBAJO del objetivo NO se tocan: subir
el stock exigiria crear un EntradaProducto y su FK a Factura es obligatorio, o
sea que habria que inventar de que lote y a que costo entro. Se reportan para
revision manual.

USO
    python manage.py resincronizar_ledger_stock              # dry-run
    python manage.py resincronizar_ledger_stock --apply      # escribe
    python manage.py resincronizar_ledger_stock --producto 2 --apply
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Sum

from core.models import (
    Producto, DetalleFactura, DetallePedido, EntradaProducto, FacturaDetallePedido,
)


def _sum(qs, campo):
    return qs.aggregate(t=Sum(campo))['t'] or 0


class Command(BaseCommand):
    help = "Resincroniza EntradaProducto con comprado - vendido (dry-run por defecto)."

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Escribe los cambios. Sin este flag solo muestra el plan.',
        )
        parser.add_argument(
            '--producto', type=int, default=None,
            help='Limita la correccion a un id de producto.',
        )
        parser.add_argument(
            '--kilos', action='store_true',
            help='Reconcilia KILOS en vez de unidades (ver _handle_kilos).',
        )
        parser.add_argument(
            '--faltantes', action='store_true',
            help='Repone unidades que faltan en el ledger (ver _handle_faltantes).',
        )

    def handle(self, *args, **options):
        aplicar = options['apply']
        producto_id = options['producto']

        if options['faltantes']:
            return self._handle_faltantes(aplicar, producto_id)
        if options['kilos']:
            return self._handle_kilos(aplicar, producto_id)

        productos = Producto.objects.all().order_by('nombre')
        if producto_id:
            productos = productos.filter(id=producto_id)

        if not aplicar:
            self.stdout.write(self.style.WARNING(
                "DRY-RUN: no se escribe nada. Usa --apply para ejecutar.\n"))

        planes = []
        for p in productos:
            comprado = int(_sum(DetalleFactura.objects.filter(producto=p),
                                'cantidad_unidades'))
            vendido = int(_sum(
                DetallePedido.objects.filter(producto=p)
                .exclude(pedido__estado="Anulado"),
                'cantidad_unidades'))
            objetivo = comprado - vendido
            actual = int(_sum(EntradaProducto.objects.filter(producto=p),
                              'cantidad_unidades'))

            if actual == objetivo:
                continue
            planes.append((p, comprado, vendido, objetivo, actual))

        if not planes:
            self.stdout.write(self.style.SUCCESS("Todo cuadra. Nada que corregir."))
            return

        total_recortado = 0
        pendientes = []

        for p, comprado, vendido, objetivo, actual in planes:
            delta = actual - objetivo
            self.stdout.write(
                f"\n{p.nombre} (id={p.id})\n"
                f"  comprado={comprado}  vendido={vendido}  "
                f"objetivo={objetivo}  ledger={actual}  delta={delta:+d}"
            )

            if delta < 0:
                pendientes.append((p, objetivo, actual))
                self.stdout.write(self.style.WARNING(
                    f"  ledger POR DEBAJO del objetivo en {-delta} un. "
                    f"No se toca (requiere revision manual)."))
                continue

            if objetivo < 0:
                self.stdout.write(self.style.ERROR(
                    f"  objetivo NEGATIVO ({objetivo}): se vendio mas de lo "
                    f"comprado. Se recorta el ledger a 0, pero revisa los datos."))

            recorte = delta
            total_recortado += recorte

            if aplicar:
                with transaction.atomic():
                    self._recortar_fifo(p, recorte, verbose=True)
                nuevo = int(_sum(EntradaProducto.objects.filter(producto=p),
                                 'cantidad_unidades'))
                self.stdout.write(self.style.SUCCESS(
                    f"  -> ledger corregido: {actual} -> {nuevo}"))
            else:
                self._recortar_fifo(p, recorte, verbose=True, simular=True)
                self.stdout.write(f"  -> quedaria en {objetivo}")

        self.stdout.write("\n" + "=" * 60)
        self.stdout.write(f"Productos a corregir : {len(planes) - len(pendientes)}")
        self.stdout.write(f"Unidades recortadas  : {total_recortado}")
        if pendientes:
            self.stdout.write(self.style.WARNING(
                f"Productos con ledger bajo el objetivo (sin tocar): "
                f"{', '.join(p.nombre for p, _, _ in pendientes)}"))
        if not aplicar:
            self.stdout.write(self.style.WARNING(
                "\nDRY-RUN: no se escribio nada. Repite con --apply."))

    def _handle_faltantes(self, aplicar, producto_id):
        """Repone en el ledger las unidades compradas que se perdieron.

        A diferencia del recorte, aca no basta con un total: para crear un
        EntradaProducto hay que saber DE QUE FACTURA salio (el FK es
        obligatorio) y a que costo entro. Se deduce factura por factura:

            gap = comprado - vivas_en_ledger - vendidas_no_anuladas

        Un gap > 0 son unidades que se compraron y que no estan ni en el stock
        ni atribuidas a ninguna venta: se perdieron cuando una venta no
        descontaba el ledger correctamente. Se reponen en su propia factura,
        con el costo_por_kilo de esa compra y los kilos proporcionales del lote.

        La fecha del lote se fija en la fecha REAL de la factura, no en hoy,
        para que el FIFO consuma primero estas compras antiguas (requiere que
        EntradaProducto.fecha_entrada ya NO sea auto_now_add, ver models.py).
        """
        from datetime import datetime, time as _time
        from django.utils import timezone as tz

        productos = Producto.objects.exclude(estado="desactivado").order_by('nombre')
        if producto_id:
            productos = productos.filter(id=producto_id)

        if not aplicar:
            self.stdout.write(self.style.WARNING(
                "DRY-RUN (faltantes): no se escribe nada. Usa --apply.\n"))

        total_repuesto = 0
        for p in productos:
            # TOPE OBLIGATORIO: el gap por factura NO es suficiente para decidir
            # cuanto reponer. Solo cuenta ventas no anuladas, y tras un recorte
            # FIFO (que consume lotes en orden de fecha, cruzando facturas) la
            # correspondencia lote<->factura deja de valer. Un producto que ya
            # cuadra en total puede mostrar gaps por factura que se compensan
            # entre si; reponerlos inventaria stock. Solo se repone hasta lo que
            # falta a nivel PRODUCTO, que es la unica cifra confiable.
            objetivo = (
                int(_sum(DetalleFactura.objects.filter(producto=p), 'cantidad_unidades'))
                - int(_sum(DetallePedido.objects.filter(producto=p)
                           .exclude(pedido__estado="Anulado"), 'cantidad_unidades'))
            )
            actual = int(_sum(EntradaProducto.objects.filter(producto=p),
                              'cantidad_unidades'))
            falta_producto = objetivo - actual
            if falta_producto <= 0:
                continue

            gaps = []
            for d in DetalleFactura.objects.filter(producto=p).select_related('factura'):
                comprado = int(d.cantidad_unidades or 0)
                vivas = int(_sum(EntradaProducto.objects.filter(
                    producto=p, factura=d.factura_id), 'cantidad_unidades'))
                vendidas = int(_sum(FacturaDetallePedido.objects.filter(
                    factura=d.factura_id, detallepedido__producto=p
                ).exclude(detallepedido__pedido__estado="Anulado"), 'cantidad_unidades'))
                gap = comprado - vivas - vendidas
                if gap > 0:
                    gaps.append((d, gap))

            if not gaps:
                continue

            suma_gaps = sum(g for _, g in gaps)
            self.stdout.write(f"\n{p.nombre} (id={p.id})  faltan {falta_producto} un "
                              f"a nivel producto; gaps por factura suman {suma_gaps}")
            if suma_gaps > falta_producto:
                self.stdout.write(self.style.WARNING(
                    "  los gaps exceden lo que falta: se repone solo hasta el tope, "
                    "factura mas antigua primero."))

            restante_producto = falta_producto
            for d, gap in sorted(gaps, key=lambda x: x[0].factura.fecha):
                if restante_producto <= 0:
                    break
                gap = min(gap, restante_producto)
                restante_producto -= gap
                comprado_un = int(d.cantidad_unidades or 0)
                kilos_lote = (
                    (Decimal(str(d.cantidad_kilos)) / comprado_un * gap)
                    .quantize(Decimal('0.01')) if comprado_un else Decimal('0.00')
                )
                fecha = tz.make_aware(datetime.combine(d.factura.fecha, _time.min))

                existente = EntradaProducto.objects.filter(
                    producto=p, factura=d.factura_id).first()
                destino = f"suma al lote id={existente.id}" if existente else "crea lote"

                self.stdout.write(
                    f"  factura {d.factura_id}: +{gap} un  +{kilos_lote} kg  "
                    f"costo/kg={d.costo_por_kilo}  fecha={d.factura.fecha}  ({destino})")
                total_repuesto += gap

                if aplicar:
                    with transaction.atomic():
                        if existente:
                            existente.cantidad_unidades = (
                                int(existente.cantidad_unidades or 0) + gap)
                            existente.cantidad_kilos = (
                                Decimal(str(existente.cantidad_kilos)) + kilos_lote)
                            existente.save()
                        else:
                            EntradaProducto.objects.create(
                                producto=p,
                                factura=d.factura,
                                cantidad_unidades=gap,
                                cantidad_kilos=kilos_lote,
                                costo_por_kilo=d.costo_por_kilo,
                                fecha_entrada=fecha,
                            )

        self.stdout.write("\n" + "=" * 60)
        self.stdout.write(f"Unidades repuestas: {total_repuesto}")
        if not aplicar:
            self.stdout.write(self.style.WARNING(
                "DRY-RUN: no se escribio nada. Repite con --apply."))

    def _handle_kilos(self, aplicar, producto_id):
        """Reconcilia los KILOS del ledger contra su propio objetivo.

        Los kilos NO se pueden derivar de las unidades: en este ledger las dos
        magnitudes quedaron desacopladas porque las devoluciones de anulacion se
        crearon con unidades pero 0.00 kg (el fallback roto de CancelarPedido,
        ver views.py). Por eso recortar un lote por unidades se llevaba todos sus
        kilos aunque los kilos no sobraran.

            objetivo_kg = Sum(DetalleFactura.cantidad_kilos)
                        - Sum(DetallePedido.cantidad_kilos no anulados)

        Si faltan kilos se reparten entre los lotes vivos en proporcion a sus
        unidades (el lote con mas piezas carga mas peso); si un solo lote queda,
        se le asignan todos. Si sobran, se recortan por FIFO.
        """
        productos = Producto.objects.exclude(estado="desactivado").order_by('nombre')
        if producto_id:
            productos = productos.filter(id=producto_id)

        if not aplicar:
            self.stdout.write(self.style.WARNING(
                "DRY-RUN (kilos): no se escribe nada. Usa --apply para ejecutar.\n"))

        sin_lotes = []
        for p in productos:
            comprado = Decimal(str(_sum(
                DetalleFactura.objects.filter(producto=p), 'cantidad_kilos')))
            vendido = Decimal(str(_sum(
                DetallePedido.objects.filter(producto=p)
                .exclude(pedido__estado="Anulado"), 'cantidad_kilos')))
            objetivo = (comprado - vendido).quantize(Decimal('0.01'))

            lotes = list(EntradaProducto.objects.filter(producto=p)
                         .order_by('fecha_entrada'))
            actual = sum((Decimal(str(l.cantidad_kilos)) for l in lotes),
                         Decimal('0.00'))
            if actual == objetivo:
                continue

            self.stdout.write(
                f"\n{p.nombre} (id={p.id})\n"
                f"  comprado={comprado} kg  vendido={vendido} kg  "
                f"objetivo={objetivo} kg  ledger={actual} kg  "
                f"delta={actual - objetivo:+}")

            if not lotes:
                sin_lotes.append(p)
                self.stdout.write(self.style.WARNING(
                    "  sin lotes vivos donde poner los kilos. No se toca."))
                continue

            if actual > objetivo:
                sobra = actual - objetivo
                self.stdout.write(f"  sobran {sobra} kg -> recorte FIFO")
                if aplicar:
                    with transaction.atomic():
                        self._recortar_kilos_fifo(lotes, sobra)
            else:
                faltan = objetivo - actual
                total_un = sum(int(l.cantidad_unidades or 0) for l in lotes)
                self.stdout.write(f"  faltan {faltan} kg -> se reparten "
                                  f"entre {len(lotes)} lote(s)")
                repartos = self._repartir_kilos(lotes, faltan, total_un)
                for lote, extra in repartos:
                    self.stdout.write(
                        f"     lote id={lote.id} factura={lote.factura_id} "
                        f"un={lote.cantidad_unidades}  "
                        f"kg {lote.cantidad_kilos} -> "
                        f"{Decimal(str(lote.cantidad_kilos)) + extra}")
                if aplicar:
                    with transaction.atomic():
                        for lote, extra in repartos:
                            lote.cantidad_kilos = (
                                Decimal(str(lote.cantidad_kilos)) + extra)
                            lote.save()

            if aplicar:
                nuevo = Decimal(str(_sum(
                    EntradaProducto.objects.filter(producto=p), 'cantidad_kilos')))
                estado = self.style.SUCCESS if nuevo == objetivo else self.style.ERROR
                self.stdout.write(estado(f"  -> ledger corregido: {actual} -> {nuevo} kg"))

        if sin_lotes:
            self.stdout.write(self.style.WARNING(
                f"\nSin lotes vivos: {', '.join(p.nombre for p in sin_lotes)}"))
        if not aplicar:
            self.stdout.write(self.style.WARNING(
                "\nDRY-RUN: no se escribio nada. Repite con --apply."))

    def _repartir_kilos(self, lotes, faltan, total_un):
        """Reparte ``faltan`` kg entre ``lotes`` en proporcion a sus unidades.
        El ultimo lote absorbe el residuo para que la suma cuadre exacta."""
        repartos = []
        asignado = Decimal('0.00')
        for i, lote in enumerate(lotes):
            if i == len(lotes) - 1:
                extra = faltan - asignado
            elif total_un > 0:
                extra = (faltan * int(lote.cantidad_unidades or 0)
                         / total_un).quantize(Decimal('0.01'))
            else:
                extra = (faltan / len(lotes)).quantize(Decimal('0.01'))
            asignado += extra
            repartos.append((lote, extra))
        return repartos

    def _recortar_kilos_fifo(self, lotes, sobra):
        restante = sobra
        for lote in lotes:
            if restante <= 0:
                break
            kilos = Decimal(str(lote.cantidad_kilos))
            if kilos <= 0:
                continue
            quitar = min(kilos, restante)
            lote.cantidad_kilos = kilos - quitar
            lote.save()
            restante -= quitar

    def _recortar_fifo(self, producto, unidades, verbose=False, simular=False):
        """Quita ``unidades`` del ledger, lote mas antiguo primero, arrastrando
        los kilos proporcionales al peso promedio de cada lote."""
        restante = unidades
        entradas = EntradaProducto.objects.filter(
            producto=producto).order_by('fecha_entrada')

        for entrada in entradas:
            if restante <= 0:
                break
            disponibles = int(entrada.cantidad_unidades or 0)
            if disponibles <= 0:
                continue

            quitar = min(disponibles, restante)
            kilos_lote = Decimal(str(entrada.cantidad_kilos))
            if quitar == disponibles:
                # Se lleva el lote entero: evita que un redondeo deje kilos
                # colgando en una fila que igual se borra.
                kilos_quitados = kilos_lote
            else:
                kilos_quitados = (kilos_lote / disponibles * quitar).quantize(
                    Decimal('0.01'))

            if verbose:
                accion = "borra lote" if quitar == disponibles else "recorta"
                self.stdout.write(
                    f"     {accion} factura={entrada.factura_id} "
                    f"un {disponibles}->{disponibles - quitar} "
                    f"kg {entrada.cantidad_kilos}->"
                    f"{Decimal(str(entrada.cantidad_kilos)) - kilos_quitados}")

            if not simular:
                entrada.cantidad_unidades = disponibles - quitar
                entrada.cantidad_kilos = (
                    Decimal(str(entrada.cantidad_kilos)) - kilos_quitados)
                if entrada.cantidad_unidades <= 0:
                    entrada.delete()
                else:
                    entrada.save()

            restante -= quitar

        return unidades - restante
