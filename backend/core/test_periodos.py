from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from .models import Periodo


class PeriodosTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user('u', password='x'))

    def test_nuevo_periodo_cierra_el_vigente(self):
        self.client.post('/api/periodos/', {'nombre': 'Antes', 'fecha_inicio': '2026-01-01'}, format='json')
        r = self.client.post('/api/periodos/', {'nombre': 'Formal', 'fecha_inicio': '2026-11-01'}, format='json')
        self.assertEqual(r.status_code, 201)
        antes = Periodo.objects.get(nombre='Antes')
        self.assertEqual(str(antes.fecha_fin), '2026-10-31')
        self.assertIsNone(Periodo.objects.get(nombre='Formal').fecha_fin)

    def test_rechaza_inicio_anterior_al_vigente(self):
        self.client.post('/api/periodos/', {'nombre': 'A', 'fecha_inicio': '2026-05-01'}, format='json')
        r = self.client.post('/api/periodos/', {'nombre': 'B', 'fecha_inicio': '2026-04-01'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_borrar_vigente_reabre_el_anterior(self):
        self.client.post('/api/periodos/', {'nombre': 'A', 'fecha_inicio': '2026-01-01'}, format='json')
        r = self.client.post('/api/periodos/', {'nombre': 'B', 'fecha_inicio': '2026-06-01'}, format='json')
        self.client.delete(f"/api/periodos/{r.json()['id']}/")
        self.assertIsNone(Periodo.objects.get(nombre='A').fecha_fin)
