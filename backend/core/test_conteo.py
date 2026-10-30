from decimal import Decimal

from django.urls import reverse

from .models import AjusteInventario, DetalleConteo
from .test_finanzas import BaseFinanzas
from .views_conteo import stock_fisico


class ConteoInventarioTests(BaseFinanzas):
    def contar(self, **linea):
        return self.client.post(
            reverse("conteos_inventario"),
            {"lineas": [{"producto": self.producto.id, **linea}]},
            format="json",
        )

    def test_conteo_que_calza_no_registra_diferencias(self):
        r = self.contar(contado_kilos="20", contado_unidades=10)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["productos_con_diferencia"], 0)
        self.assertFalse(AjusteInventario.objects.exists())

    def test_faltante_registra_diferencia_y_ajusta_stock(self):
        r = self.contar(contado_kilos="18,5", contado_unidades=9)
        self.assertEqual(r.status_code, 201, r.content)
        d = DetalleConteo.objects.get()
        self.assertEqual(d.diferencia_kilos, Decimal("-1.5"))
        self.assertEqual(d.diferencia_unidades, -1)
        self.assertEqual(AjusteInventario.objects.get().tipo, "ajuste")
        self.assertEqual(stock_fisico(self.producto), (Decimal("18.5"), 9))

    def test_sobrante_suma_stock(self):
        self.contar(contado_unidades=12)
        self.assertEqual(stock_fisico(self.producto), (Decimal("20"), 12))

    def test_unidades_reservadas_cuentan_como_stock_fisico(self):
        self.crear_pedido(cantidad_kilos=0)  # reserva 1 unidad
        self.assertEqual(stock_fisico(self.producto)[1], 10)
        r = self.contar(contado_unidades=10)
        self.assertEqual(r.json()["productos_con_diferencia"], 0)

    def test_sin_cantidades_se_rechaza(self):
        self.assertEqual(self.contar().status_code, 400)
