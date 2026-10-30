from datetime import date
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from .contabilidad import resumen_mensual
from .models import (AsignacionMovimiento, Cobro, ConfiguracionContable, DocumentoTributario, Factura,
                     MovimientoBancario, Pedido)
from .test_finanzas import BaseFinanzas


def csv(*filas):
    return SimpleUploadedFile("RCV.csv", "\n".join(";".join(map(str, f)) for f in filas).encode("latin-1"))


VENTAS_ENC = ["Nro", "Tipo Doc", "Tipo Venta", "Rut cliente", "Razon Social", "Folio", "Fecha Docto",
              "Fecha Recepcion", "Monto Exento", "Monto Neto", "Monto IVA", "Monto total"]
COMPRAS_ENC = ["Nro", "Tipo Doc", "Tipo Compra", "RUT Proveedor", "Razon Social", "Folio", "Fecha Docto",
               "Monto Exento", "Monto Neto", "Monto IVA Recuperable", "Monto Iva No Recuperable", "Monto Total",
               "Codigo Otro Impuesto", "Valor Otro Impuesto", "Tasa Otro Impuesto"]


class CierreBase(BaseFinanzas):
    def setUp(self):
        super().setUp()
        self.pedido = Pedido.objects.get(id=self.crear_pedido().json()["id"])  # total 24.000
        self.fecha = self.pedido.fecha.astimezone(ZoneInfo("America/Santiago")).date()
        self.mes = self.fecha.strftime("%Y-%m")

    def ventas(self, **params):
        r = self.client.get(reverse("cierre_ventas"), {"mes": self.mes, **params})
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()


class VentasMesTests(CierreBase):
    def test_venta_sin_cobro_ni_documento(self):
        datos = self.ventas()
        p = datos["pedidos"][0]
        self.assertEqual(p["estado_cobro"], "pendiente")
        self.assertEqual(p["estado_tributario"], "pendiente")
        self.assertEqual(Decimal(p["neto"]), Decimal("20168"))  # 24.000 / 1,19
        self.assertEqual(Decimal(p["costo"]), Decimal("16000"))
        self.assertEqual(datos["resumen"]["sin_documento"], 1)
        self.assertEqual(Decimal(datos["resumen"]["saldo_pendiente"]), Decimal("24000"))

    def test_cobro_parcial_va_al_vendedor_por_defecto(self):
        r = self.client.post(reverse("cierre_cobros"), {"pedido": self.pedido.id, "monto": 10000,
                                                        "fecha": "2026-10-05", "medio": "efectivo"})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["receptor"], "vendedor")
        self.assertEqual(r.json()["vendedor"], self.vendedor.id)
        p = self.ventas()["pedidos"][0]
        self.assertEqual(p["estado_cobro"], "parcial")
        self.assertEqual(Decimal(p["saldo"]), Decimal("14000"))

    def test_receptor_configurable_a_empresa(self):
        ConfiguracionContable.objects.update_or_create(pk=1, defaults={"receptor_cobro": "empresa"})
        r = self.client.post(reverse("cierre_cobros"), {"pedido": self.pedido.id, "monto": 24000,
                                                        "marcar_pagado": "true"})
        self.assertEqual(r.json()["receptor"], "empresa")
        self.assertIsNone(r.json()["vendedor"])
        self.pedido.refresh_from_db()
        self.assertEqual(self.pedido.estado, "Pagado")

    def test_pagado_sin_cobro_se_avisa(self):
        Pedido.objects.filter(pk=self.pedido.pk).update(estado="Pagado")
        datos = self.ventas()
        self.assertEqual(datos["pedidos"][0]["estado_cobro"], "pendiente")
        self.assertIn("Marcado Pagado sin cobro registrado", datos["pedidos"][0]["alertas"])
        self.assertEqual(datos["resumen"]["pagado_sin_cobro"], 1)

    def test_documento_manual_marca_emitido(self):
        r = self.client.post(reverse("cierre_documentos"), {
            "tipo": 39, "folio": 1501, "fecha_emision": str(self.fecha), "total": 24000, "pedido": self.pedido.id})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Decimal(r.json()["iva"]), Decimal("3832"))
        datos = self.ventas()
        self.assertEqual(datos["pedidos"][0]["estado_tributario"], "emitido")
        self.assertEqual(Decimal(datos["resumen"]["iva_debito_documentos"]), Decimal("3832"))
        # Mismo folio dos veces no.
        r = self.client.post(reverse("cierre_documentos"), {
            "tipo": 39, "folio": 1501, "fecha_emision": str(self.fecha), "total": 1000})
        self.assertEqual(r.status_code, 400)

    def test_documento_no_acepta_fecha_futura(self):
        r = self.client.post(reverse("cierre_documentos"), {
            "tipo": 39, "folio": 1, "fecha_emision": "2999-01-01", "total": 24000})
        self.assertEqual(r.status_code, 400)

    def test_factura_si_se_pidio_boleta_queda_por_revisar(self):
        self.client.post(reverse("cierre_documentos"), {
            "tipo": 33, "folio": 9, "fecha_emision": str(self.fecha), "total": 24000, "pedido": self.pedido.id})
        p = self.ventas()["pedidos"][0]
        self.assertEqual(p["estado_tributario"], "por_revisar")

    def test_filtro_vendedor(self):
        self.assertEqual(len(self.ventas(vendedor=self.vendedor.id + 99)["pedidos"]), 0)


class CobrosBancoTests(CierreBase):
    def test_asignar_cartola_crea_cobro_y_quitarla_lo_borra(self):
        m = MovimientoBancario.objects.create(fecha=date(2026, 10, 6), descripcion="Transf", monto=24000, huella="h1")
        r = self.client.post(reverse("movimiento_asignar", args=[m.id]), {"pedido": self.pedido.id, "monto": 24000},
                             format="json")
        self.assertEqual(r.status_code, 201, r.content)
        cobro = Cobro.objects.get(pedido=self.pedido)
        self.assertEqual(cobro.monto, Decimal("24000"))
        self.assertEqual(self.ventas()["pedidos"][0]["estado_cobro"], "pagado")
        # No se puede borrar desde el cierre; sí al quitar la asociación.
        self.assertEqual(self.client.delete(reverse("cierre_cobro", args=[cobro.id])).status_code, 400)
        AsignacionMovimiento.objects.all().delete()
        self.assertFalse(Cobro.objects.exists())


class ImportacionSIITests(CierreBase):
    def test_ventas_rcv_crea_y_asocia_factura(self):
        self.cliente.rut = "76.123.456-7"
        self.cliente.save()
        f = self.fecha.strftime("%d/%m/%Y")
        archivo = csv(VENTAS_ENC,
                      [1, 33, "Del Giro", "76123456-7", "Restaurante SpA", 501, f, f, 0, 20168, 3832, 24000],
                      [2, 33, "Del Giro", "11111111-1", "Otro", 502, f, f, 0, 1000, 190, 1190])
        r = self.client.post(reverse("cierre_sii"), {"archivo": archivo})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["tipo"], "ventas")
        self.assertEqual(r.json()["resultado"]["nuevos"], 2)
        self.assertEqual(r.json()["resultado"]["asociados"], 1)
        self.assertEqual(DocumentoTributario.objects.get(folio=501).pedido_id, self.pedido.id)
        datos = self.ventas()
        self.assertEqual(len(datos["documentos_sin_pedido"]), 1)
        # Subirlo de nuevo no duplica.
        archivo.seek(0)
        r = self.client.post(reverse("cierre_sii"), {"archivo": archivo})
        self.assertEqual(r.json()["actualizados"], 2)
        self.assertEqual(DocumentoTributario.objects.count(), 2)

    def test_documento_del_sii_no_se_borra(self):
        f = self.fecha.strftime("%d/%m/%Y")
        self.client.post(reverse("cierre_sii"), {"archivo": csv(
            VENTAS_ENC, [1, 33, "Del Giro", "1-9", "X", 7, f, f, 0, 100, 19, 119])})
        doc = DocumentoTributario.objects.get()
        self.assertEqual(self.client.delete(reverse("cierre_documento", args=[doc.id])).status_code, 400)
        # La fecha del SII no se edita a mano.
        self.client.patch(reverse("cierre_documento", args=[doc.id]), {"fecha_emision": "2026-01-01"}, format="json")
        doc.refresh_from_db()
        self.assertEqual(doc.fecha_emision, self.fecha)

    def test_compras_rcv_detecta_anticipo_faltante(self):
        archivo = csv(COMPRAS_ENC,
                      [1, 33, "Del Giro", "77.777.777-7", "Frigorífico", 100, "01/10/2026", 0, 160000, 30400, 0,
                       198400, 18, 8000, 5],
                      [2, 33, "Del Giro", "77.777.777-7", "Frigorífico", 999, "02/10/2026", 0, 1000, 190, 0,
                       1240, 18, 50, 5])
        r = self.client.post(reverse("cierre_sii"), {"archivo": archivo})
        self.assertEqual(r.status_code, 201, r.content)
        res = r.json()["resultado"]
        self.assertEqual(r.json()["tipo"], "compras")
        self.assertEqual([d["folio"] for d in res["diferencias"]], [100])
        self.assertIn("Anticipo", res["diferencias"][0]["motivo"])
        self.assertEqual([d["folio"] for d in res["faltan_en_sistema"]], [999])
        self.assertEqual(res["ruts_completados"][0]["rut"], "77.777.777-7")

    def test_resumen_boletas(self):
        archivo = csv(["Tipo Documento", "Total Documentos", "Monto Exento", "Monto Neto", "Monto IVA", "Monto Total"],
                      ["Boleta Electronica (39)", 12, 0, 100840, 19160, 120000])
        r = self.client.post(reverse("cierre_sii"), {"archivo": archivo, "mes": self.mes})
        self.assertEqual(r.status_code, 201, r.content)
        tipo = r.json()["resultado"]["tipos"][0]
        self.assertEqual((tipo["tipo"], tipo["cantidad_sii"], tipo["cantidad_registrada"]), (39, 12, 0))

    def test_archivo_que_no_es_rcv(self):
        r = self.client.post(reverse("cierre_sii"), {"archivo": csv(["a", "b"], [1, 2])})
        self.assertEqual(r.status_code, 400)


class AnticipoCarneTests(BaseFinanzas):
    def test_anticipo_suma_al_total_y_al_credito(self):
        r = self.client.post(reverse("crear_factura"), {
            "numero_factura": "200", "proveedor": self.proveedor.id, "fecha": "2026-09-10",
            "subtotal": 100000, "iva": 19000, "anticipo_iva": 5000, "total": 124000,
            "detalles": [{"producto": self.producto.id, "cantidad_kilos": 10, "cantidad_unidades": 5,
                          "costo_por_kilo": 10000}],
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        fila = next(f for f in resumen_mensual()[0] if f["mes"] == "2026-09")
        self.assertEqual(fila["iva_credito_anticipo"], Decimal("5000"))
        self.assertEqual(fila["iva_credito"], Decimal("24000"))

    def test_editar_lineas_recalcula_anticipo(self):
        Factura.objects.filter(pk="100").update(anticipo_iva=8000, total=198400)
        r = self.client.put(reverse("actualizar_factura", args=["100"]), {
            "detalles": [{"producto": self.producto.id, "cantidad_kilos": 20, "cantidad_unidades": 10,
                          "costo_por_kilo": 9000}]}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        f = Factura.objects.get(pk="100")
        self.assertEqual((f.subtotal, f.iva, f.anticipo_iva, f.total),
                         (Decimal("180000"), Decimal("34200"), Decimal("9000"), Decimal("223200")))

    def test_configuracion_tasas(self):
        r = self.client.put(reverse("configuracion_contable"), {"tasa_anticipo_carne": "5", "tasa_iva": "19",
                                                                 "receptor_cobro": "empresa"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["receptor_cobro"], "empresa")
        self.assertEqual(self.client.put(reverse("configuracion_contable"), {"tasa_iva": "90"},
                                         format="json").status_code, 400)
