from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from .cartola import normalizar_filas, parse_fecha, parse_monto
from .models import (Cliente, DetallePedido, MovimientoBancario, Pedido, Producto, Proveedor,
                     Vendedor)


class BaseFinanzas(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="tester", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.vendedor = Vendedor.objects.create(nombre="Ana", sigla="AN")
        self.cliente = Cliente.objects.create(nombre="Cliente", direccion="x", vendedor=self.vendedor)
        self.proveedor = Proveedor.objects.create(nombre="Frigorífico")
        self.producto = Producto.objects.create(nombre="Lomo", precio_por_kilo=Decimal("12000"))
        # 10 piezas, 20 kg, costo neto 8.000/kg.
        r = self.client.post(reverse("crear_factura"), {
            "numero_factura": "100", "proveedor": self.proveedor.id, "fecha": "2026-10-01",
            "fecha_vencimiento": "2026-10-31", "subtotal": 160000, "iva": 30400, "total": 190400,
            "detalles": [{"producto": self.producto.id, "cantidad_kilos": 20, "cantidad_unidades": 10,
                          "costo_por_kilo": 8000}],
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)

    def crear_pedido(self, **linea):
        detalle = {"producto": self.producto.id, "cantidad_kilos": 2, "cantidad_unidades": 1, **linea}
        return self.client.post(reverse("crear_pedido"), {"cliente": self.cliente.id, "detalles": [detalle]},
                                format="json")


class PrecioPedidoTests(BaseFinanzas):
    def test_lista_por_defecto(self):
        r = self.crear_pedido()
        self.assertEqual(r.status_code, 201, r.content)
        d = r.json()["detalles"][0]
        self.assertEqual(Decimal(d["precio_venta"]), Decimal("12000"))
        self.assertEqual(Decimal(r.json()["total"]), Decimal("24000"))

    def test_descuento_por_kilo_en_pesos(self):
        r = self.crear_pedido(modo_precio="descuento", descuento_por_kilo="1500")
        d = r.json()["detalles"][0]
        self.assertEqual(Decimal(d["precio_venta"]), Decimal("10500"))
        self.assertEqual(Decimal(r.json()["total"]), Decimal("21000"))

    def test_a_costo_incluye_iva(self):
        r = self.crear_pedido(modo_precio="costo")
        d = r.json()["detalles"][0]
        self.assertEqual(Decimal(d["precio_venta"]), Decimal("9520"))  # 8000 * 1,19
        linea = DetallePedido.objects.get(id=d["id"])
        self.assertAlmostEqual(float(linea.total_venta / Decimal("1.19") - linea.total_costo), 0, places=2)

    def test_personalizado_acepta_coma(self):
        r = self.crear_pedido(modo_precio="personalizado", precio_personalizado="11000,5", cantidad_kilos="1,5")
        self.assertEqual(r.status_code, 201, r.content)
        d = r.json()["detalles"][0]
        self.assertEqual(Decimal(d["precio_venta"]), Decimal("11000.5"))
        self.assertEqual(Decimal(d["cantidad_kilos"]), Decimal("1.5"))

    def test_estado_reservado_si_alguna_linea_sin_pesar(self):
        otro = Producto.objects.create(nombre="Asado", precio_por_kilo=Decimal("9000"))
        self.client.post(reverse("crear_factura"), {
            "numero_factura": "101", "proveedor": self.proveedor.id, "fecha": "2026-10-01",
            "subtotal": 1, "iva": 0, "total": 1,
            "detalles": [{"producto": otro.id, "cantidad_kilos": 5, "cantidad_unidades": 5, "costo_por_kilo": 5000}],
        }, format="json")
        r = self.client.post(reverse("crear_pedido"), {"cliente": self.cliente.id, "detalles": [
            {"producto": otro.id, "cantidad_kilos": 0, "cantidad_unidades": 1},
            {"producto": self.producto.id, "cantidad_kilos": 2, "cantidad_unidades": 1},
        ]}, format="json")
        self.assertEqual(r.json()["estado"], "Reservado")

    def test_editar_a_cero_kilos_no_deja_costo_pegado(self):
        pid = self.crear_pedido().json()["id"]
        pedido = self.client.get(reverse("pedidos")).json()[0]
        pedido["detalles"][0]["cantidad_kilos"] = 0
        r = self.client.put(reverse("pedido-detail", args=[pid]), pedido, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(DetallePedido.objects.get(pedido_id=pid).total_costo, 0)
        self.assertEqual(Decimal(r.json()["total"]), 0)

    def test_anular_por_put_devuelve_stock(self):
        pid = self.crear_pedido().json()["id"]
        self.client.put(reverse("pedido-detail", args=[pid]), {"estado": "Anulado"}, format="json")
        stock = next(p for p in self.client.get(reverse("stock_productos")).json() if p["id"] == self.producto.id)
        self.assertEqual(stock["disponibles"], 10)
        r = self.client.put(reverse("pedido-detail", args=[pid]), {"estado": "Pagado"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_actualizar_kilos_recalcula_venta(self):
        pid = self.crear_pedido(cantidad_kilos=0).json()["id"]
        self.client.post(reverse("actualizar_kilos_pedido", args=[pid]),
                         {"detalles": [{"producto": self.producto.id, "cantidad_kilos": 2}]}, format="json")
        self.assertEqual(Pedido.objects.get(id=pid).total, Decimal("24000"))


class ContabilidadTests(BaseFinanzas):
    def test_iva_credito_sale_de_compras_y_notas_de_credito(self):
        self.crear_pedido()  # venta 24.000 con IVA
        r = self.client.post(reverse("notas_credito", args=["100"]),
                             {"numero": "NC1", "fecha": "2026-10-05", "neto": 10000}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        mes = self.client.get(reverse("contabilidad")).json()["meses"][-1]
        self.assertAlmostEqual(float(mes["iva_credito"]), 30400 - 1900, places=0)
        self.assertAlmostEqual(float(mes["iva_debito"]), 24000 - 24000 / 1.19, places=0)
        self.assertEqual(float(mes["iva_a_pagar"]), 0)
        self.assertGreater(float(mes["remanente"]), 0)
        factura = self.client.get(reverse("facturas")).json()[0]
        self.assertEqual(Decimal(factura["total_a_pagar"]), Decimal("190400") - Decimal("11900"))

    def test_merma_neta_y_en_piezas(self):
        self.client.post(reverse("crear_ajuste_inventario"),
                         {"producto": self.producto.id, "tipo": "merma", "cantidad_unidades": 1}, format="json")
        total = self.client.get(reverse("reporte_perdidas")).json()["total"]
        self.assertAlmostEqual(float(total["valor"]), 2 * 8000, places=0)  # 1 pieza ≈ 2 kg, sin IVA


class CartolaTests(BaseFinanzas):
    FILAS = [
        ["Banco Estado - Cartola", None, None, None, None],
        ["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"],
        ["01/10/2026", "Saldo inicial", "", "", "100.000"],
        ["02/10/2026", "TRANSF DE JUAN PEREZ", "", "24.000", "124.000"],
        ["02/10/2026", "TRANSF DE JUAN PEREZ", "", "24.000", "148.000"],
        ["03/10/2026", "PAGO FRIGORIFICO", "190.400", "", "-42.400"],
    ]

    def test_parsers(self):
        self.assertEqual(parse_monto("1.234.567"), Decimal("1234567"))
        self.assertEqual(parse_monto("$ -1.234,50"), Decimal("-1234.50"))
        self.assertEqual(parse_monto("(5.000)"), Decimal("-5000"))
        self.assertEqual(str(parse_fecha("3 oct 2026")), "2026-10-03")
        self.assertEqual(str(parse_fecha(46297)), "2026-10-02")

    def test_detecta_columnas_y_signos(self):
        movs, cols = normalizar_filas(self.FILAS)
        self.assertEqual(len(movs), 3)
        self.assertEqual([m["monto"] for m in movs], [Decimal("24000"), Decimal("24000"), Decimal("-190400")])
        self.assertNotEqual(movs[0]["huella"], movs[1]["huella"])

    def test_sin_encabezado(self):
        movs, _ = normalizar_filas([r for r in self.FILAS[2:]])
        self.assertEqual(len(movs), 3)

    def test_subir_dos_veces_no_duplica_y_asigna_pedido(self):
        previa = self.client.post(reverse("cartola_analizar"), {"filas": self.FILAS}, format="json").json()
        r = self.client.post(reverse("cartola_importar"), {"movimientos": previa["movimientos"]}, format="json")
        self.assertEqual(r.json()["nuevos"], 3)
        previa2 = self.client.post(reverse("cartola_analizar"), {"filas": self.FILAS}, format="json").json()
        self.assertTrue(all(m["duplicado"] for m in previa2["movimientos"]))
        r2 = self.client.post(reverse("cartola_importar"), {"movimientos": previa2["movimientos"]}, format="json")
        self.assertEqual(r2.json()["nuevos"], 0)
        self.assertEqual(MovimientoBancario.objects.count(), 3)

        pid = self.crear_pedido().json()["id"]
        abono = MovimientoBancario.objects.filter(monto__gt=0).first()
        r = self.client.post(reverse("movimiento_asignar", args=[abono.id]),
                             {"pedido": pid, "monto": 24000, "marcar_pagado": True}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Pedido.objects.get(id=pid).estado, "Pagado")
        r = self.client.post(reverse("movimiento_asignar", args=[abono.id]),
                             {"pedido": pid, "monto": 1000}, format="json")
        self.assertEqual(r.status_code, 400)
