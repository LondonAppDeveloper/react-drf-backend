"""Pre-reservas (venta sin stock) y stock congelado, siempre via los endpoints HTTP."""
from decimal import Decimal

from django.contrib.auth.models import User
from django.db.models import Sum
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from .models import (Cliente, DetalleFactura, DetallePedido, EntradaProducto, FacturaDetallePedido,
                     MovimientoCongelado, Pedido, Producto, Proveedor, Vendedor)


class BaseStock(TestCase):
    """Un producto con una factura (100): 10 unidades, 20 kg, 8.000/kg."""

    def setUp(self):
        self.user = User.objects.create_user(username="tester", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.vendedor = Vendedor.objects.create(nombre="Ana", sigla="AN")
        self.cliente = Cliente.objects.create(nombre="Cliente", direccion="x", vendedor=self.vendedor)
        self.proveedor = Proveedor.objects.create(nombre="Frigorífico")
        self.producto = Producto.objects.create(nombre="Lomo", precio_por_kilo=Decimal("12000"))
        r = self.crear_factura("100", 10, 20, 8000, fecha="2026-10-01")
        self.assertEqual(r.status_code, 201, r.content)

    # ---- helpers ----
    def crear_factura(self, numero, unidades, kilos, costo, producto=None, fecha="2026-10-02"):
        producto = producto or self.producto
        return self.client.post(reverse("crear_factura"), {
            "numero_factura": numero, "proveedor": self.proveedor.id, "fecha": fecha,
            "subtotal": 1, "iva": 0, "total": 1,
            "detalles": [{"producto": producto.id, "cantidad_kilos": kilos,
                          "cantidad_unidades": unidades, "costo_por_kilo": costo}],
        }, format="json")

    def pedido(self, unidades, kilos=0, producto=None, pre_reserva=False, **linea):
        producto = producto or self.producto
        detalle = {"producto": producto.id, "cantidad_kilos": kilos, "cantidad_unidades": unidades, **linea}
        payload = {"cliente": self.cliente.id, "detalles": [detalle]}
        if pre_reserva:
            payload["permitir_pre_reserva"] = True
        return self.client.post(reverse("crear_pedido"), payload, format="json")

    def pedido_ok(self, *args, **kwargs):
        r = self.pedido(*args, **kwargs)
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def stock(self, producto=None):
        producto = producto or self.producto
        return next(p for p in self.client.get(reverse("stock_productos")).json() if p["id"] == producto.id)

    def ledger(self, congelado=False, producto=None):
        qs = EntradaProducto.objects.filter(producto=producto or self.producto, congelado=congelado)
        agg = qs.aggregate(u=Sum("cantidad_unidades"), k=Sum("cantidad_kilos"))
        return agg["u"] or 0, agg["k"] or Decimal("0")

    def linea(self, pedido_id):
        return DetallePedido.objects.get(pedido_id=pedido_id)

    def agotar_stock(self):
        """Vende todo el stock normal (10 un) con un pedido normal."""
        self.pedido_ok(10)
        self.assertEqual(self.ledger()[0], 0)

    def mover(self, unidades, direccion="congelar", **extra):
        return self.client.post(reverse("movimientos_congelado"), {
            "producto": self.producto.id, "cantidad_unidades": unidades, "direccion": direccion, **extra,
        }, format="json")

    def put_pedido(self, pedido_id, unidades, kilos=0, **extra):
        det = DetallePedido.objects.get(pedido_id=pedido_id)
        return self.client.put(reverse("pedido-detail", args=[pedido_id]), {
            "detalles": [{"id": det.id, "producto": det.producto_id, "cantidad_unidades": unidades,
                          "cantidad_kilos": kilos}], **extra,
        }, format="json")


class PreReservaPedidoTests(BaseStock):
    def test_sin_flag_pedir_mas_que_el_stock_falla(self):
        r = self.pedido(11)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(Pedido.objects.count(), 0)
        self.assertEqual(DetallePedido.objects.count(), 0)
        self.assertEqual(self.ledger(), (10, Decimal("20")))

    def test_con_flag_toma_lo_disponible_y_deja_pendiente(self):
        p = self.pedido_ok(14, pre_reserva=True)
        self.assertEqual(p["estado"], "Pre-reserva")
        linea = self.linea(p["id"])
        self.assertEqual((linea.cantidad_unidades, linea.unidades_pendientes), (14, 4))
        self.assertEqual(FacturaDetallePedido.objects.get(detallepedido=linea).cantidad_unidades, 10)
        self.assertEqual(self.ledger()[0], 0)
        s = self.stock()
        self.assertEqual((s["disponibles"], s["pre_reservas"], s["reservas"]), (0, 4, 10))

    def test_producto_sin_stock_se_pre_reserva_completo(self):
        self.agotar_stock()
        p = self.pedido_ok(3, pre_reserva=True)
        linea = self.linea(p["id"])
        self.assertEqual(p["estado"], "Pre-reserva")
        self.assertEqual(linea.unidades_pendientes, 3)
        self.assertFalse(FacturaDetallePedido.objects.filter(detallepedido=linea).exists())
        s = self.stock()
        self.assertEqual((s["disponibles"], s["pre_reservas"], s["reservas"]), (0, 3, 10))

    def test_pre_reserva_con_kilos_falla(self):
        r = self.pedido(12, kilos=24, pre_reserva=True)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(Pedido.objects.count(), 0)
        self.assertEqual(self.ledger(), (10, Decimal("20")))

    def test_pre_reserva_solo_con_stock_congelado_no_lo_toca(self):
        self.assertEqual(self.mover(10).status_code, 201)
        p = self.pedido_ok(2, pre_reserva=True)
        self.assertEqual(self.linea(p["id"]).unidades_pendientes, 2)
        self.assertEqual(self.ledger(congelado=True)[0], 10)


class AsignarPreReservasTests(BaseStock):
    def test_factura_nueva_asigna_por_antiguedad(self):
        self.agotar_stock()
        a = self.pedido_ok(4, pre_reserva=True)["id"]
        b = self.pedido_ok(4, pre_reserva=True)["id"]
        r = self.crear_factura("101", 10, 20, 9000)
        self.assertEqual(r.status_code, 201, r.content)
        asign = r.json()["pre_reservas_asignadas"]
        self.assertEqual([(x["pedido"], x["unidades"], x["completa"]) for x in asign],
                         [(a, 4, True), (b, 4, True)])
        for pid in (a, b):
            self.assertEqual(self.linea(pid).unidades_pendientes, 0)
            self.assertEqual(Pedido.objects.get(id=pid).estado, "Reservado")
            link = FacturaDetallePedido.objects.get(detallepedido__pedido_id=pid)
            self.assertEqual((link.factura_id, link.cantidad_unidades), ("101", 4))
        self.assertEqual(self.stock()["disponibles"], 2)
        self.assertEqual(self.ledger()[0], 2)

    def test_asignacion_parcial_sirve_primero_al_mas_antiguo(self):
        self.agotar_stock()
        a = self.pedido_ok(4, pre_reserva=True)["id"]
        b = self.pedido_ok(4, pre_reserva=True)["id"]
        r = self.crear_factura("101", 6, 12, 9000)
        asign = r.json()["pre_reservas_asignadas"]
        self.assertEqual([(x["pedido"], x["unidades"], x["completa"]) for x in asign],
                         [(a, 4, True), (b, 2, False)])
        self.assertEqual(Pedido.objects.get(id=a).estado, "Reservado")
        self.assertEqual(Pedido.objects.get(id=b).estado, "Pre-reserva")
        self.assertEqual(self.linea(b).unidades_pendientes, 2)
        self.assertEqual(self.stock()["disponibles"], 0)
        self.assertEqual(self.stock()["pre_reservas"], 2)

    def test_costo_por_kilo_de_la_linea_queda_ponderado(self):
        p = self.pedido_ok(14, pre_reserva=True)["id"]
        self.assertEqual(self.linea(p).costo_por_kilo, Decimal("8000"))
        self.crear_factura("101", 4, 8, 10000)
        linea = self.linea(p)
        # (10 * 8000 + 4 * 10000) / 14
        self.assertAlmostEqual(float(linea.costo_por_kilo), 8571.43, places=2)
        self.assertEqual(linea.unidades_pendientes, 0)
        self.assertEqual({(f.factura_id, f.cantidad_unidades) for f in FacturaDetallePedido.objects.filter(detallepedido=linea)},
                         {("100", 10), ("101", 4)})
        self.assertEqual(Pedido.objects.get(id=p).estado, "Reservado")

    def test_modo_costo_sin_stock_fija_precio_con_la_factura(self):
        self.agotar_stock()
        p = self.pedido_ok(2, pre_reserva=True, modo_precio="costo")["id"]
        self.assertEqual(self.linea(p).precio_venta, Decimal("12000"))
        self.crear_factura("101", 5, 10, 9000)
        linea = self.linea(p)
        self.assertEqual(linea.precio_venta, Decimal("10710"))  # ceil(9000 * 1,19)
        self.assertEqual(linea.costo_por_kilo, Decimal("9000"))

    def test_editar_factura_subiendo_unidades_asigna_pre_reservas(self):
        otro = Producto.objects.create(nombre="Asado", precio_por_kilo=Decimal("9000"))
        # Factura con línea en 0: el producto existe en la factura pero sin stock.
        self.assertEqual(self.crear_factura("200", 0, 0, 5000, producto=otro).status_code, 201)
        p = self.pedido_ok(3, producto=otro, pre_reserva=True)["id"]
        self.assertEqual(self.linea(p).unidades_pendientes, 3)

        det = DetalleFactura.objects.get(factura_id="200", producto=otro)
        r = self.client.put(reverse("actualizar_factura", args=["200"]), {
            "detalles": [{"id": det.id, "cantidad_unidades": 5, "cantidad_kilos": 10, "costo_por_kilo": 5000}],
        }, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        linea = self.linea(p)
        self.assertEqual(linea.unidades_pendientes, 0)
        self.assertEqual(FacturaDetallePedido.objects.get(detallepedido=linea).factura_id, "200")
        self.assertEqual(Pedido.objects.get(id=p).estado, "Reservado")
        self.assertEqual(self.ledger(producto=otro)[0], 2)


class EditarPedidoPreReservaTests(BaseStock):
    def setUp(self):
        super().setUp()
        self.pid = self.pedido_ok(13, pre_reserva=True)["id"]  # 10 con stock, 3 pendientes

    def test_bajar_unidades_descuenta_primero_pendientes(self):
        r = self.put_pedido(self.pid, 11)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((self.linea(self.pid).unidades_pendientes, self.ledger()[0]), (1, 0))
        self.assertEqual(Pedido.objects.get(id=self.pid).estado, "Pre-reserva")
        r = self.put_pedido(self.pid, 10)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((self.linea(self.pid).unidades_pendientes, self.ledger()[0]), (0, 0))
        self.assertEqual(Pedido.objects.get(id=self.pid).estado, "Reservado")

    def test_subir_unidades_sin_stock_suma_pendientes(self):
        r = self.put_pedido(self.pid, 16)
        self.assertEqual(r.status_code, 200, r.content)
        linea = self.linea(self.pid)
        self.assertEqual((linea.cantidad_unidades, linea.unidades_pendientes), (16, 6))
        self.assertEqual(self.ledger()[0], 0)
        self.assertEqual(self.stock()["pre_reservas"], 6)

    def test_pasar_a_preparado_con_pendientes_falla(self):
        r = self.put_pedido(self.pid, 13, estado="Preparado")
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(Pedido.objects.get(id=self.pid).estado, "Pre-reserva")

    def test_pesar_con_pendientes_falla(self):
        r = self.client.post(reverse("actualizar_kilos_pedido", args=[self.pid]),
                             {"detalles": [{"producto": self.producto.id, "cantidad_kilos": 26}]}, format="json")
        self.assertEqual(r.status_code, 400, r.content)
        r = self.put_pedido(self.pid, 13, kilos=26)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.linea(self.pid).cantidad_kilos, 0)
        self.assertEqual(self.ledger(), (0, Decimal("20")))


class CancelarPreReservaTests(BaseStock):
    def test_cancelar_unica_linea_pendiente_vuelve_a_reservado(self):
        otro = Producto.objects.create(nombre="Asado", precio_por_kilo=Decimal("9000"))
        self.crear_factura("200", 5, 10, 5000, producto=otro)
        r = self.client.post(reverse("crear_pedido"), {"cliente": self.cliente.id, "permitir_pre_reserva": True,
                                                       "detalles": [
            {"producto": otro.id, "cantidad_kilos": 0, "cantidad_unidades": 1},
            {"producto": self.producto.id, "cantidad_kilos": 0, "cantidad_unidades": 12},
        ]}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        pid = r.json()["id"]
        self.assertEqual(r.json()["estado"], "Pre-reserva")
        lomo = DetallePedido.objects.get(pedido_id=pid, producto=self.producto)
        r = self.client.post(reverse("cancelar_producto_pedido"),
                             {"pedido_id": pid, "detalle_id": lomo.id}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["estado"], "Reservado")
        self.assertEqual(self.ledger()[0], 10)
        self.assertEqual(self.stock()["pre_reservas"], 0)

    def test_cancelar_pedido_devuelve_solo_lo_asignado_y_no_recibe_facturas(self):
        pid = self.pedido_ok(13, pre_reserva=True)["id"]
        r = self.client.post(reverse("cancelar_pedido"), {"pedido_id": pid}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.ledger()[0], 10)
        self.assertEqual(Pedido.objects.get(id=pid).estado, "Anulado")
        self.assertEqual(self.stock()["pre_reservas"], 0)

        r = self.crear_factura("101", 5, 10, 9000)
        self.assertEqual(r.json()["pre_reservas_asignadas"], [])
        self.assertEqual(self.ledger()[0], 15)
        self.assertEqual(self.linea(pid).unidades_pendientes, 3)
        self.assertEqual(FacturaDetallePedido.objects.filter(factura_id="101").count(), 0)


class CongelarTests(BaseStock):
    def test_congelar_sin_kilos_usa_promedio_y_mantiene_lote(self):
        r = self.mover(4, razon="camara")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.ledger(), (6, Decimal("12.00")))
        self.assertEqual(self.ledger(congelado=True), (4, Decimal("8.00")))
        lote = EntradaProducto.objects.get(producto=self.producto, congelado=True)
        original = EntradaProducto.objects.get(producto=self.producto, congelado=False)
        self.assertEqual((lote.factura_id, lote.costo_por_kilo, lote.fecha_entrada),
                         ("100", Decimal("8000"), original.fecha_entrada))
        mov = MovimientoCongelado.objects.get()
        self.assertEqual((mov.direccion, mov.cantidad_unidades, mov.cantidad_kilos, mov.usuario), (
            "congelar", 4, Decimal("8.00"), self.user))
        s = self.stock()
        self.assertEqual((s["disponibles"], s["kilos_actuales"], s["congelado_unidades"], s["congelado_kilos"]),
                         (6, 12, 4, 8))

    def test_congelar_con_kilos_explicitos_mueve_exactamente_esos_kilos(self):
        r = self.mover(4, cantidad_kilos="7.35")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Decimal(r.json()["cantidad_kilos"]), Decimal("7.35"))
        self.assertEqual(self.ledger(congelado=True), (4, Decimal("7.35")))
        self.assertEqual(self.ledger(), (6, Decimal("12.65")))

    def test_congelar_es_fifo_entre_lotes_y_conserva_factura_y_costo(self):
        self.crear_factura("101", 5, 12, 9000, fecha="2026-10-05")
        self.assertEqual(self.mover(12).status_code, 201)
        lotes = {e.factura_id: e for e in EntradaProducto.objects.filter(producto=self.producto, congelado=True)}
        self.assertEqual((lotes["100"].cantidad_unidades, lotes["100"].costo_por_kilo), (10, Decimal("8000")))
        self.assertEqual((lotes["101"].cantidad_unidades, lotes["101"].costo_por_kilo), (2, Decimal("9000")))
        self.assertEqual(lotes["101"].cantidad_kilos, Decimal("4.80"))
        self.assertEqual(self.ledger()[0], 3)

    def test_mover_mas_de_lo_disponible_falla(self):
        r = self.mover(11)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.ledger(), (10, Decimal("20")))
        self.assertEqual(MovimientoCongelado.objects.count(), 0)

    def test_unidades_cero_falla(self):
        self.assertEqual(self.mover(0).status_code, 400)
        self.assertEqual(MovimientoCongelado.objects.count(), 0)

    def test_kilos_mayores_a_los_del_lote_fallan(self):
        self.assertEqual(self.mover(2, cantidad_kilos=50).status_code, 400)
        self.assertEqual(self.ledger(), (10, Decimal("20")))

    def test_descongelar_devuelve_al_inventario(self):
        self.mover(4)
        r = self.mover(3, direccion="descongelar")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.ledger(), (9, Decimal("18.00")))
        self.assertEqual(self.ledger(congelado=True), (1, Decimal("2.00")))
        self.assertEqual(MovimientoCongelado.objects.filter(direccion="descongelar").count(), 1)
        self.assertEqual(self.mover(2, direccion="descongelar").status_code, 400)

    def test_descongelar_cubre_pre_reservas_pendientes(self):
        self.mover(10)
        pid = self.pedido_ok(3, pre_reserva=True)["id"]
        r = self.mover(5, direccion="descongelar")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual([(a["pedido"], a["unidades"], a["completa"]) for a in r.json()["pre_reservas_asignadas"]],
                         [(pid, 3, True)])
        self.assertEqual(self.linea(pid).unidades_pendientes, 0)
        self.assertEqual(Pedido.objects.get(id=pid).estado, "Reservado")
        self.assertEqual((self.ledger()[0], self.ledger(congelado=True)[0]), (2, 5))


class VentaCongeladoTests(BaseStock):
    def setUp(self):
        super().setUp()
        self.mover(4)  # normal: 6 un / 12 kg; congelado: 4 un / 8 kg

    def test_venta_normal_no_consume_congelado(self):
        self.mover(6)
        self.assertEqual(self.ledger()[0], 0)
        r = self.pedido(1)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.ledger(congelado=True)[0], 10)
        self.assertEqual(Pedido.objects.count(), 0)

    def test_venta_congelado_consume_solo_lotes_congelados(self):
        p = self.pedido_ok(2, congelado=True)
        self.assertTrue(self.linea(p["id"]).congelado)
        self.assertEqual(self.ledger(congelado=True)[0], 2)
        self.assertEqual(self.ledger(), (6, Decimal("12.00")))
        s = self.stock()
        self.assertEqual((s["disponibles"], s["congelado_unidades"], s["congelado_reservas"]), (6, 2, 2))

    def test_venta_congelado_mas_de_lo_que_hay_falla_aun_con_pre_reserva(self):
        r = self.pedido(5, congelado=True, pre_reserva=True)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.ledger(congelado=True)[0], 4)

    def test_pesar_descuenta_kilos_solo_del_congelado(self):
        p = self.pedido_ok(2, congelado=True)["id"]
        r = self.client.post(reverse("actualizar_kilos_pedido", args=[p]),
                             {"detalles": [{"producto": self.producto.id, "cantidad_kilos": "3.5"}]}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.ledger(congelado=True), (2, Decimal("4.50")))
        self.assertEqual(self.ledger(), (6, Decimal("12.00")))
        s = self.stock()
        self.assertEqual((s["kilos_actuales"], s["congelado_kilos"]), (12, 4.5))

    def test_cancelar_venta_congelado_devuelve_al_pool_congelado(self):
        p = self.pedido_ok(2, kilos="3.5", congelado=True)["id"]
        self.assertEqual(self.ledger(congelado=True), (2, Decimal("4.50")))
        r = self.client.post(reverse("cancelar_pedido"), {"pedido_id": p}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.ledger(congelado=True)[0], 4)
        self.assertEqual(self.ledger(congelado=True)[1], Decimal("8.00"))
        self.assertEqual(self.ledger(), (6, Decimal("12.00")))
        self.assertFalse(EntradaProducto.objects.filter(producto=self.producto, congelado=False)
                         .exclude(cantidad_unidades=6).exists())

    def test_merma_solo_toca_inventario_normal(self):
        r = self.client.post(reverse("crear_ajuste_inventario"), {
            "producto": self.producto.id, "tipo": "merma", "cantidad_unidades": 2, "cantidad": 3,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.ledger(), (4, Decimal("9.00")))
        self.assertEqual(self.ledger(congelado=True), (4, Decimal("8.00")))

    def test_merma_mayor_al_normal_no_come_congelado(self):
        r = self.client.post(reverse("crear_ajuste_inventario"), {
            "producto": self.producto.id, "tipo": "merma", "cantidad_unidades": 7,
        }, format="json")
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.ledger(congelado=True)[0], 4)


class EditarFacturaConCongeladoTests(BaseStock):
    def setUp(self):
        super().setUp()
        self.mover(4)
        self.pedido_ok(3)  # consumidas = 3; congeladas = 4
        self.det = DetalleFactura.objects.get(factura_id="100")

    def editar(self, unidades, costo=8000, kilos=20):
        return self.client.put(reverse("actualizar_factura", args=["100"]), {
            "detalles": [{"id": self.det.id, "cantidad_unidades": unidades,
                          "cantidad_kilos": kilos, "costo_por_kilo": costo}],
        }, format="json")

    def test_bajar_bajo_consumidas_mas_congeladas_falla(self):
        r = self.editar(6)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.ledger()[0], 3)
        self.assertEqual(self.ledger(congelado=True)[0], 4)
        self.assertEqual(DetalleFactura.objects.get(id=self.det.id).cantidad_unidades, 10)

    def test_bajar_hasta_el_piso_es_valido_y_no_toca_lo_congelado(self):
        r = self.editar(7, kilos=14)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.ledger()[0], 0)
        self.assertEqual(self.ledger(congelado=True)[0], 4)

    def test_cambio_de_costo_se_propaga_al_lote_congelado(self):
        r = self.editar(10, costo=9500)
        self.assertEqual(r.status_code, 200, r.content)
        costos = set(EntradaProducto.objects.filter(producto=self.producto, congelado=True)
                     .values_list("costo_por_kilo", flat=True))
        self.assertEqual(costos, {Decimal("9500")})
        self.assertEqual(EntradaProducto.objects.get(producto=self.producto, congelado=False).costo_por_kilo,
                         Decimal("9500"))


# ---------------------------------------------------------------------------
# Auditoría (RegistroPreReserva) y asignación al volver stock al inventario
# ---------------------------------------------------------------------------
class BaseAuditoria(BaseStock):
    def auditoria(self, **params):
        r = self.client.get(reverse("auditoria_pre_reservas"), params)
        self.assertEqual(r.status_code, 200, r.content)
        # el endpoint entrega lo más reciente primero; se devuelve en orden cronológico
        return sorted(r.json(), key=lambda x: x["id"])

    def resumen(self, **params):
        return [(f["pedido"], f["evento"], f["origen"], f["unidades"], f["pendientes_despues"])
                for f in self.auditoria(**params)]

    def anular(self, pid):
        r = self.client.post(reverse("cancelar_pedido"), {"pedido_id": pid}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        return r

    def estado(self, pid):
        return Pedido.objects.get(id=pid).estado

    def cancelar_linea(self, pid, producto=None):
        det = DetallePedido.objects.get(pedido_id=pid, producto=producto or self.producto)
        r = self.client.post(reverse("cancelar_producto_pedido"),
                             {"pedido_id": pid, "detalle_id": det.id}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        return r

    def ajuste(self, tipo, unidades, kilos=0):
        r = self.client.post(reverse("crear_ajuste_inventario"), {
            "producto": self.producto.id, "tipo": tipo, "cantidad_unidades": unidades, "cantidad": kilos,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()


class AuditoriaCreacionTests(BaseAuditoria):
    def test_pedido_con_pendientes_registra_creada(self):
        pid = self.pedido_ok(13, pre_reserva=True)["id"]
        filas = self.auditoria()
        self.assertEqual(len(filas), 1)
        f = filas[0]
        self.assertEqual((f["pedido"], f["evento"], f["origen"], f["unidades"], f["pendientes_despues"]),
                         (pid, "creada", "creacion_pedido", 3, 3))
        self.assertIsNone(f["factura"])
        self.assertIsNone(f["proveedor_nombre"])
        self.assertEqual(f["usuario_nombre"], "tester")
        self.assertEqual(f["cliente_nombre"], "Cliente")
        self.assertEqual(f["producto_nombre"], "Lomo")
        self.assertEqual(f["producto"], self.producto.id)
        self.assertEqual(f["detalle"], self.linea(pid).id)
        self.assertEqual(f["evento_display"], "Pre-reserva creada")
        self.assertEqual(f["origen_display"], "Creación del pedido")

    def test_pedido_sin_pendientes_no_escribe_filas(self):
        self.pedido_ok(10)
        self.assertEqual(self.auditoria(), [])

    def test_pre_reserva_con_stock_suficiente_no_escribe_filas(self):
        self.pedido_ok(4, pre_reserva=True)
        self.assertEqual(self.auditoria(), [])

    def test_agregar_producto_con_pendientes_registra_creada_agregar_producto(self):
        otro = Producto.objects.create(nombre="Asado", precio_por_kilo=Decimal("9000"))
        self.crear_factura("200", 5, 10, 5000, producto=otro)
        pid = self.pedido_ok(1, producto=otro)["id"]
        r = self.client.post(reverse("agregar_producto_pedido"), {
            "pedido_id": pid, "producto_id": self.producto.id, "cantidad_unidades": 12,
            "cantidad_kilos": 0, "permitir_pre_reserva": True,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        filas = self.auditoria(pedido=pid)
        self.assertEqual(len(filas), 1)
        self.assertEqual((filas[0]["evento"], filas[0]["origen"], filas[0]["unidades"],
                          filas[0]["pendientes_despues"], filas[0]["producto"]),
                         ("creada", "agregar_producto", 2, 2, self.producto.id))
        self.assertEqual(filas[0]["usuario_nombre"], "tester")
        self.assertEqual(filas[0]["origen_display"], "Producto agregado al pedido")

    def test_filtros_pedido_producto_evento(self):
        otro = Producto.objects.create(nombre="Asado", precio_por_kilo=Decimal("9000"))
        a = self.pedido_ok(13, pre_reserva=True)["id"]
        b = self.pedido_ok(2, producto=otro, pre_reserva=True)["id"]  # otro: sin stock -> 2 pendientes
        self.assertEqual(len(self.auditoria()), 2)
        self.assertEqual([f["pedido"] for f in self.auditoria(pedido=a)], [a])
        self.assertEqual([f["pedido"] for f in self.auditoria(pedido=b)], [b])
        self.assertEqual([f["pedido"] for f in self.auditoria(producto=otro.id)], [b])
        self.assertEqual(len(self.auditoria(evento="creada")), 2)
        self.assertEqual(self.auditoria(evento="asignada"), [])
        self.assertEqual(self.auditoria(pedido=a, producto=otro.id), [])
        self.crear_factura("201", 5, 10, 5000, producto=otro)
        self.assertEqual([f["pedido"] for f in self.auditoria(evento="asignada")], [b])
        self.assertEqual(len(self.auditoria(pedido=b)), 2)

    def test_endpoint_exige_autenticacion(self):
        r = APIClient().get(reverse("auditoria_pre_reservas"))
        self.assertIn(r.status_code, (401, 403))


class AuditoriaAsignacionFacturaTests(BaseAuditoria):
    def test_factura_nueva_registra_asignada_con_factura_y_proveedor(self):
        pid = self.pedido_ok(13, pre_reserva=True)["id"]
        self.assertEqual(self.crear_factura("101", 5, 10, 9000).status_code, 201)
        filas = self.auditoria(evento="asignada")
        self.assertEqual(len(filas), 1)
        f = filas[0]
        self.assertEqual((f["pedido"], f["origen"], f["unidades"], f["pendientes_despues"]),
                         (pid, "factura", 3, 0))
        self.assertEqual(f["factura"], "101")
        self.assertEqual(f["proveedor_nombre"], "Frigorífico")
        self.assertEqual(f["referencia"], "Factura 101")
        self.assertEqual(f["evento_display"], "Unidades asignadas desde stock")
        self.assertEqual(f["origen_display"], "Ingreso de factura")
        self.assertEqual(f["usuario_nombre"], "tester")
        self.assertEqual(self.estado(pid), "Reservado")

    def test_asignacion_que_cruza_dos_facturas_genera_dos_filas(self):
        # 13 pedidas: 10 salen de la factura 100 al crear el pedido, 3 quedan pendientes.
        # Se vende el stock nuevo de a poco para que la pre-reserva quede repartida en 2 lotes.
        pid = self.pedido_ok(25, pre_reserva=True)["id"]  # 15 pendientes
        self.assertEqual(self.linea(pid).unidades_pendientes, 15)
        self.assertEqual(self.crear_factura("101", 4, 8, 9000).status_code, 201)
        self.assertEqual(self.linea(pid).unidades_pendientes, 11)
        self.assertEqual(self.crear_factura("102", 6, 12, 9500).status_code, 201)
        self.assertEqual(self.linea(pid).unidades_pendientes, 5)
        self.assertEqual(self.resumen(evento="asignada"), [
            (pid, "asignada", "factura", 4, 11),
            (pid, "asignada", "factura", 6, 5),
        ])

    def test_asignacion_de_un_mismo_evento_con_dos_lotes_en_el_ledger(self):
        # Dos lotes quedan en el inventario normal (100 con 10 y 101 con 5) y se descongela/anula
        # de forma que una única asignación toma de ambos.
        self.assertEqual(self.crear_factura("101", 5, 10, 9000).status_code, 201)
        a = self.pedido_ok(15)["id"]  # consume 10 de la 100 y 5 de la 101
        b = self.pedido_ok(12, pre_reserva=True)["id"]
        self.assertEqual(self.linea(b).unidades_pendientes, 12)
        self.anular(a)  # vuelven 10 (lote 100) y 5 (lote 101)
        filas = [f for f in self.auditoria(pedido=b, evento="asignada")]
        self.assertEqual(len(filas), 2)
        self.assertEqual({f["factura"] for f in filas}, {"100", "101"})
        self.assertEqual(sum(f["unidades"] for f in filas), 12)
        self.assertEqual([f["pendientes_despues"] for f in filas],
                         sorted([f["pendientes_despues"] for f in filas], reverse=True))
        self.assertEqual(filas[-1]["pendientes_despues"], 0)
        self.assertTrue(all(f["origen"] == "anulacion_pedido" for f in filas))
        self.assertEqual(self.estado(b), "Reservado")
        self.assertEqual(self.ledger()[0], 3)

    def test_editar_factura_registra_edicion_factura(self):
        # (una línea totalmente consumida está bloqueada: se edita una factura en 0)
        otro = Producto.objects.create(nombre="Asado", precio_por_kilo=Decimal("9000"))
        self.assertEqual(self.crear_factura("200", 0, 0, 5000, producto=otro).status_code, 201)
        pid = self.pedido_ok(3, producto=otro, pre_reserva=True)["id"]
        det = DetalleFactura.objects.get(factura_id="200", producto=otro)
        r = self.client.put(reverse("actualizar_factura", args=["200"]), {
            "detalles": [{"id": det.id, "cantidad_unidades": 5, "cantidad_kilos": 10, "costo_por_kilo": 5000}],
        }, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        filas = self.auditoria(evento="asignada")
        self.assertEqual([(f["pedido"], f["origen"], f["unidades"], f["pendientes_despues"], f["factura"],
                           f["referencia"]) for f in filas],
                         [(pid, "edicion_factura", 3, 0, "200", "Factura 200 editada")])
        self.assertEqual(filas[0]["origen_display"], "Edición de factura")
        self.assertEqual(self.estado(pid), "Reservado")

    def test_descongelar_registra_origen_descongelar(self):
        self.assertEqual(self.mover(10).status_code, 201)
        pid = self.pedido_ok(4, pre_reserva=True)["id"]
        self.assertEqual(self.mover(4, "descongelar").status_code, 201)
        self.assertEqual(self.resumen(evento="asignada"), [(pid, "asignada", "descongelar", 4, 0)])
        f = self.auditoria(evento="asignada")[0]
        self.assertEqual(f["factura"], "100")
        self.assertEqual(f["origen_display"], "Stock descongelado")


class AnulacionPedidoAsignaTests(BaseAuditoria):
    def escenario(self):
        a = self.pedido_ok(10)["id"]
        b = self.pedido_ok(3, pre_reserva=True)["id"]
        self.assertEqual(self.estado(b), "Pre-reserva")
        self.assertEqual(self.linea(b).unidades_pendientes, 3)
        self.assertEqual(self.ledger()[0], 0)
        return a, b

    def verificar(self, a, b):
        self.assertEqual(self.estado(a), "Anulado")
        self.assertEqual(self.estado(b), "Reservado")
        self.assertEqual(self.linea(b).unidades_pendientes, 0)
        self.assertEqual(self.ledger()[0], 7)
        s = self.stock()
        self.assertEqual((s["disponibles"], s["pre_reservas"]), (7, 0))
        filas = self.auditoria(pedido=b)
        self.assertEqual(len(filas), 2)
        creada, asignada = filas
        self.assertEqual((creada["evento"], creada["origen"], creada["unidades"], creada["pendientes_despues"]),
                         ("creada", "creacion_pedido", 3, 3))
        self.assertEqual((asignada["evento"], asignada["origen"], asignada["unidades"],
                          asignada["pendientes_despues"]), ("asignada", "anulacion_pedido", 3, 0))
        self.assertEqual(asignada["factura"], "100")
        self.assertEqual(asignada["proveedor_nombre"], "Frigorífico")
        self.assertEqual(asignada["referencia"], f"Pedido #{a} anulado")
        self.assertEqual(asignada["origen_display"], "Anulación de otro pedido")
        self.assertEqual(asignada["usuario_nombre"], "tester")
        # el pedido anulado no tenía pendientes: no se le escribe nada
        self.assertEqual(self.auditoria(pedido=a), [])

    def test_cancelar_pedido_endpoint_asigna_a_la_pre_reserva_de_otro(self):
        a, b = self.escenario()
        self.anular(a)
        self.verificar(a, b)

    def test_put_pedido_anulado_asigna_a_la_pre_reserva_de_otro(self):
        a, b = self.escenario()
        r = self.put_pedido(a, 10, estado="Anulado")
        self.assertEqual(r.status_code, 200, r.content)
        self.verificar(a, b)

    def test_anulacion_asigna_la_mas_antigua_primero(self):
        a = self.pedido_ok(10)["id"]
        b = self.pedido_ok(4, pre_reserva=True)["id"]
        c = self.pedido_ok(4, pre_reserva=True)["id"]
        d = self.pedido_ok(4, pre_reserva=True)["id"]
        self.anular(a)
        self.assertEqual([self.linea(x).unidades_pendientes for x in (b, c, d)], [0, 0, 2])
        self.assertEqual([self.estado(x) for x in (b, c, d)], ["Reservado", "Reservado", "Pre-reserva"])
        self.assertEqual(self.ledger()[0], 0)
        self.assertEqual(self.resumen(evento="asignada"), [
            (b, "asignada", "anulacion_pedido", 4, 0),
            (c, "asignada", "anulacion_pedido", 4, 0),
            (d, "asignada", "anulacion_pedido", 2, 2),
        ])

    def test_pedido_anulado_con_pendientes_registra_cancelada(self):
        a = self.pedido_ok(13, pre_reserva=True)["id"]   # 10 asignadas, 3 pendientes
        b = self.pedido_ok(2, pre_reserva=True)["id"]    # 2 pendientes
        self.anular(a)
        # las 10 devueltas se asignan a b (2); a no recibe nada aunque tenga pendientes
        self.assertEqual(self.linea(b).unidades_pendientes, 0)
        self.assertEqual(self.estado(b), "Reservado")
        self.assertEqual(self.ledger()[0], 8)
        self.assertEqual(self.linea(a).unidades_pendientes, 3)
        self.assertEqual([f["evento"] for f in self.auditoria(pedido=a)], ["creada", "cancelada"])
        cancelada = self.auditoria(pedido=a, evento="cancelada")[0]
        self.assertEqual((cancelada["unidades"], cancelada["pendientes_despues"]), (3, 3))
        self.assertEqual(cancelada["evento_display"], "Pre-reserva cancelada")
        self.assertEqual(self.auditoria(pedido=a, evento="asignada"), [])
        self.assertEqual(self.resumen(pedido=b), [
            (b, "creada", "creacion_pedido", 2, 2),
            (b, "asignada", "anulacion_pedido", 2, 0),
        ])

    def test_anular_con_pendientes_del_mismo_pedido_no_se_reasigna_a_si_mismo(self):
        a = self.pedido_ok(13, pre_reserva=True)["id"]
        self.anular(a)
        self.assertEqual(self.ledger()[0], 10)
        self.assertEqual(self.auditoria(pedido=a, evento="asignada"), [])

    def test_put_anulado_con_pendientes_registra_cancelada(self):
        a = self.pedido_ok(13, pre_reserva=True)["id"]
        r = self.put_pedido(a, 13, estado="Anulado")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.estado(a), "Anulado")
        self.assertEqual(len(self.auditoria(pedido=a, evento="cancelada")), 1)
        self.assertEqual(self.ledger()[0], 10)

    def test_anulacion_de_otro_producto_no_asigna(self):
        otro = Producto.objects.create(nombre="Asado", precio_por_kilo=Decimal("9000"))
        self.crear_factura("200", 5, 10, 5000, producto=otro)
        a = self.pedido_ok(5, producto=otro)["id"]
        self.agotar_stock()
        b = self.pedido_ok(3, pre_reserva=True)["id"]
        self.anular(a)
        self.assertEqual(self.linea(b).unidades_pendientes, 3)
        self.assertEqual(self.auditoria(evento="asignada"), [])


class CancelarLineaAsignaTests(BaseAuditoria):
    def test_cancelar_linea_asigna_a_otros(self):
        a = self.pedido_ok(10)["id"]
        b = self.pedido_ok(3, pre_reserva=True)["id"]
        r = self.cancelar_linea(a)
        self.assertEqual(self.estado(b), "Reservado")
        self.assertEqual(self.linea(b).unidades_pendientes, 0)
        self.assertEqual(self.ledger()[0], 7)
        filas = self.auditoria(pedido=b, evento="asignada")
        self.assertEqual(len(filas), 1)
        f = filas[0]
        self.assertEqual((f["origen"], f["unidades"], f["pendientes_despues"], f["factura"]),
                         ("cancelacion_linea", 3, 0, "100"))
        self.assertEqual(f["origen_display"], "Cancelación de una línea")
        self.assertTrue(f["referencia"])

    def test_cancelar_linea_con_pendientes_registra_cancelada(self):
        otro = Producto.objects.create(nombre="Asado", precio_por_kilo=Decimal("9000"))
        self.crear_factura("200", 5, 10, 5000, producto=otro)
        r = self.client.post(reverse("crear_pedido"), {"cliente": self.cliente.id, "permitir_pre_reserva": True,
                                                       "detalles": [
            {"producto": otro.id, "cantidad_kilos": 0, "cantidad_unidades": 1},
            {"producto": self.producto.id, "cantidad_kilos": 0, "cantidad_unidades": 12},
        ]}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        pid = r.json()["id"]
        self.cancelar_linea(pid)
        filas = self.auditoria(pedido=pid, producto=self.producto.id)
        self.assertEqual([(f["evento"], f["unidades"]) for f in filas], [("creada", 2), ("cancelada", 2)])
        self.assertEqual(filas[1]["pendientes_despues"], 2)  # la línea conserva su pendiente; solo queda cancelada
        self.assertEqual(self.auditoria(pedido=pid, producto=otro.id), [])
        self.assertEqual(self.estado(pid), "Reservado")
        self.assertEqual(self.ledger()[0], 10)

    def test_cancelar_linea_asigna_a_otros_y_cancelada_en_la_propia(self):
        a = self.pedido_ok(13, pre_reserva=True)["id"]  # 10 + 3 pendientes
        b = self.pedido_ok(4, pre_reserva=True)["id"]   # 4 pendientes
        self.cancelar_linea(a)
        self.assertEqual(self.linea(b).unidades_pendientes, 0)
        self.assertEqual(self.ledger()[0], 6)
        self.assertEqual([f["evento"] for f in self.auditoria(pedido=a)], ["creada", "cancelada"])
        self.assertEqual(self.resumen(pedido=b)[-1], (b, "asignada", "cancelacion_linea", 4, 0))

    def test_cancelar_linea_congelada_no_asigna_y_vuelve_a_congelado(self):
        self.mover(4)  # normal 6, congelado 4
        a = self.pedido_ok(2, congelado=True)["id"]
        self.pedido_ok(6)  # agota el normal
        b = self.pedido_ok(3, pre_reserva=True)["id"]
        self.assertEqual(self.ledger()[0], 0)
        self.cancelar_linea(a)
        self.assertEqual(self.ledger(congelado=True)[0], 4)
        self.assertEqual(self.ledger()[0], 0)
        self.assertEqual(self.linea(b).unidades_pendientes, 3)
        self.assertEqual(self.estado(b), "Pre-reserva")
        self.assertEqual(self.auditoria(evento="asignada"), [])


class EdicionPedidoAsignaTests(BaseAuditoria):
    def test_bajar_unidades_con_stock_asigna_a_otros(self):
        a = self.pedido_ok(10)["id"]
        b = self.pedido_ok(3, pre_reserva=True)["id"]
        r = self.put_pedido(a, 7)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.estado(b), "Reservado")
        self.assertEqual(self.linea(b).unidades_pendientes, 0)
        self.assertEqual(self.ledger()[0], 0)
        self.assertEqual(self.estado(a), "Reservado")
        filas = self.auditoria(pedido=b, evento="asignada")
        self.assertEqual([(f["origen"], f["unidades"], f["pendientes_despues"], f["factura"]) for f in filas],
                         [("edicion_pedido", 3, 0, "100")])
        self.assertEqual(filas[0]["origen_display"], "Edición del pedido")
        # la línea editada no tenía pendientes
        self.assertEqual(self.auditoria(pedido=a), [])

    def test_bajar_parcialmente_deja_pendientes_a_medias(self):
        a = self.pedido_ok(10)["id"]
        b = self.pedido_ok(5, pre_reserva=True)["id"]
        self.put_pedido(a, 8)
        self.assertEqual(self.linea(b).unidades_pendientes, 3)
        self.assertEqual(self.estado(b), "Pre-reserva")
        self.assertEqual(self.resumen(pedido=b)[-1], (b, "asignada", "edicion_pedido", 2, 3))

    def test_bajar_pendientes_registra_reducida_y_no_asigna(self):
        pid = self.pedido_ok(13, pre_reserva=True)["id"]
        self.assertEqual(self.put_pedido(pid, 11).status_code, 200)
        self.assertEqual(self.resumen(pedido=pid), [
            (pid, "creada", "creacion_pedido", 3, 3),
            (pid, "reducida", "edicion_pedido", 2, 1),
        ])
        f = self.auditoria(evento="reducida")[0]
        self.assertEqual(f["evento_display"], "Unidades pendientes reducidas")
        self.assertEqual(f["usuario_nombre"], "tester")
        self.assertEqual(self.auditoria(evento="asignada"), [])
        self.assertEqual(self.ledger()[0], 0)

    def test_bajar_pendientes_y_stock_en_una_edicion(self):
        a = self.pedido_ok(13, pre_reserva=True)["id"]  # 10 + 3 pendientes
        b = self.pedido_ok(2, pre_reserva=True)["id"]
        self.assertEqual(self.put_pedido(a, 8).status_code, 200)  # -3 pendientes, -2 stock
        self.assertEqual(self.linea(a).unidades_pendientes, 0)
        self.assertEqual(self.linea(b).unidades_pendientes, 0)
        self.assertEqual([f["evento"] for f in self.auditoria(pedido=a)], ["creada", "reducida"])
        self.assertEqual(self.resumen(pedido=b)[-1], (b, "asignada", "edicion_pedido", 2, 0))
        self.assertEqual(self.ledger()[0], 0)

    def test_subir_mas_que_el_stock_en_linea_pre_reservada_registra_aumentada(self):
        pid = self.pedido_ok(13, pre_reserva=True)["id"]
        self.assertEqual(self.put_pedido(pid, 16).status_code, 200)
        self.assertEqual(self.resumen(pedido=pid), [
            (pid, "creada", "creacion_pedido", 3, 3),
            (pid, "aumentada", "edicion_pedido", 3, 6),
        ])
        f = self.auditoria(evento="aumentada")[0]
        self.assertEqual(f["evento_display"], "Unidades pendientes aumentadas")
        self.assertEqual(f["origen_display"], "Edición del pedido")
        self.assertEqual(f["usuario_nombre"], "tester")

    def test_subir_unidades_con_stock_disponible_no_escribe_aumentada(self):
        pid = self.pedido_ok(4, pre_reserva=True)["id"]
        self.assertEqual(self.put_pedido(pid, 6).status_code, 200)
        self.assertEqual(self.auditoria(pedido=pid), [])


class AjustesAsignanTests(BaseAuditoria):
    def preparar(self, pendientes=3):
        self.agotar_stock()
        return self.pedido_ok(pendientes, pre_reserva=True)["id"]

    def test_crear_exceso_asigna(self):
        # el exceso suma a un lote existente: hace falta que haya alguno (la factura 100)
        pid = self.preparar(3)
        aj = self.ajuste("exceso", 3, 6)
        filas = self.auditoria(pedido=pid, evento="asignada")
        self.assertEqual(len(filas), 1)
        f = filas[0]
        self.assertEqual((f["origen"], f["unidades"], f["pendientes_despues"], f["factura"]),
                         ("ajuste_inventario", 3, 0, "100"))
        self.assertEqual(f["referencia"], f"Ajuste #{aj['id']} (exceso)")
        self.assertEqual(f["origen_display"], "Ajuste de inventario")
        self.assertEqual(self.estado(pid), "Reservado")
        self.assertEqual(self.ledger()[0], 0)

    def test_exceso_parcial_deja_pendientes(self):
        pid = self.preparar(5)
        self.ajuste("exceso", 2, 4)
        self.assertEqual(self.linea(pid).unidades_pendientes, 3)
        self.assertEqual(self.estado(pid), "Pre-reserva")
        self.assertEqual(self.resumen(pedido=pid)[-1], (pid, "asignada", "ajuste_inventario", 2, 3))

    def test_exceso_solo_kilos_no_asigna(self):
        pid = self.preparar(3)
        self.ajuste("exceso", 0, 5)
        self.assertEqual(self.linea(pid).unidades_pendientes, 3)
        self.assertEqual(self.auditoria(evento="asignada"), [])

    def test_merma_no_asigna(self):
        self.pedido_ok(4)
        pid = self.pedido_ok(8, pre_reserva=True)["id"]  # 6 + 2 pendientes
        self.assertEqual(self.linea(pid).unidades_pendientes, 2)
        self.ajuste("merma", 0, 1)
        self.assertEqual(self.linea(pid).unidades_pendientes, 2)
        self.assertEqual(self.auditoria(evento="asignada"), [])

    def test_editar_ajuste_merma_a_menos_devuelve_y_asigna(self):
        aj = self.ajuste("merma", 4, 8)  # normal 6
        b = self.pedido_ok(9, pre_reserva=True)["id"]  # 6 + 3 pendientes
        self.assertEqual(self.linea(b).unidades_pendientes, 3)
        r = self.client.put(reverse("ajuste-inventario-detail", args=[aj["id"]]), {
            "producto": self.producto.id, "tipo": "merma", "cantidad_unidades": 1, "cantidad": 2,
        }, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.linea(b).unidades_pendientes, 0)
        self.assertEqual(self.estado(b), "Reservado")
        self.assertEqual(self.ledger()[0], 0)
        filas = self.auditoria(pedido=b, evento="asignada")
        self.assertEqual(sum(f["unidades"] for f in filas), 3)
        self.assertTrue(all(f["origen"] == "ajuste_inventario" for f in filas))
        self.assertEqual(filas[-1]["referencia"], f"Ajuste #{aj['id']} editado")
        self.assertEqual(filas[-1]["pendientes_despues"], 0)

    def test_eliminar_merma_asigna(self):
        aj = self.ajuste("merma", 4, 8)  # normal 6
        b = self.pedido_ok(9, pre_reserva=True)["id"]  # 6 + 3 pendientes
        r = self.client.delete(reverse("ajuste-inventario-detail", args=[aj["id"]]))
        self.assertEqual(r.status_code, 204, r.content)
        self.assertEqual(self.linea(b).unidades_pendientes, 0)
        self.assertEqual(self.estado(b), "Reservado")
        self.assertEqual(self.ledger()[0], 1)
        filas = self.auditoria(pedido=b, evento="asignada")
        self.assertEqual(sum(f["unidades"] for f in filas), 3)
        self.assertTrue(all(f["origen"] == "ajuste_inventario" for f in filas))
        self.assertEqual(filas[-1]["referencia"], f"Ajuste #{aj['id']} (merma) eliminado")

    def test_eliminar_merma_parcial(self):
        aj = self.ajuste("merma", 2, 4)  # normal 8
        b = self.pedido_ok(13, pre_reserva=True)["id"]  # 8 + 5 pendientes
        self.assertEqual(self.linea(b).unidades_pendientes, 5)
        r = self.client.delete(reverse("ajuste-inventario-detail", args=[aj["id"]]))
        self.assertEqual(r.status_code, 204)
        self.assertEqual(self.linea(b).unidades_pendientes, 3)
        self.assertEqual(self.estado(b), "Pre-reserva")
        self.assertEqual(self.resumen(pedido=b)[-1], (b, "asignada", "ajuste_inventario", 2, 3))
