from decimal import Decimal

from django.test import TestCase
from django.urls import reverse
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from .models import Producto, Proveedor, Factura, EntradaProducto


class AjusteInventarioExcesoTests(TestCase):
    """Regresion: un ajuste de exceso debe sumar stock real (StockProductos),
    no solo quedar como registro contable."""

    def setUp(self):
        self.user = User.objects.create_user(username="tester", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.producto = Producto.objects.create(
            nombre="Puntas de Ganso", precio_por_kilo=Decimal("10000")
        )
        proveedor = Proveedor.objects.create(nombre="Proveedor Test")
        factura = Factura.objects.create(
            proveedor=proveedor,
            fecha="2026-01-01",
            numero_factura="F-TEST-001",
            subtotal=Decimal("0"),
            iva=Decimal("0"),
            total=Decimal("0"),
        )
        EntradaProducto.objects.create(
            factura=factura,
            producto=self.producto,
            cantidad_kilos=Decimal("100"),
            cantidad_unidades=36,
            costo_por_kilo=Decimal("8000"),
        )

    def test_exceso_suma_stock_real(self):
        stock_antes = self.client.get(reverse("stock_productos")).json()
        unidades_antes = next(p for p in stock_antes if p["id"] == self.producto.id)["stock"]
        self.assertEqual(unidades_antes, 36)

        resp = self.client.post(
            reverse("crear_ajuste_inventario"),
            {"producto": self.producto.id, "tipo": "exceso", "cantidad_unidades": 1},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)

        stock_despues = self.client.get(reverse("stock_productos")).json()
        unidades_despues = next(p for p in stock_despues if p["id"] == self.producto.id)["stock"]
        self.assertEqual(unidades_despues, 37)
