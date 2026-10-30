from datetime import date, timedelta

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Periodo


def _serializar(p):
    return {
        'id': p.id,
        'nombre': p.nombre,
        'fecha_inicio': p.fecha_inicio.isoformat(),
        'fecha_fin': p.fecha_fin.isoformat() if p.fecha_fin else None,
    }


def _fecha(valor):
    try:
        return date.fromisoformat(str(valor))
    except ValueError:
        return None


class PeriodoListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response([_serializar(p) for p in Periodo.objects.all()])

    def post(self, request):
        """Abre un período nuevo. Si hay uno vigente, lo cierra el día anterior."""
        nombre = (request.data.get('nombre') or '').strip()
        inicio = _fecha(request.data.get('fecha_inicio'))
        if not nombre or not inicio:
            return Response({'error': 'Indica un nombre y una fecha de inicio válida'},
                            status=status.HTTP_400_BAD_REQUEST)
        vigente = Periodo.objects.filter(fecha_fin__isnull=True).first()
        if vigente:
            if inicio <= vigente.fecha_inicio:
                return Response({'error': f'La fecha debe ser posterior al inicio de "{vigente.nombre}"'},
                                status=status.HTTP_400_BAD_REQUEST)
            vigente.fecha_fin = inicio - timedelta(days=1)
            vigente.save(update_fields=['fecha_fin'])
        p = Periodo.objects.create(nombre=nombre, fecha_inicio=inicio)
        return Response(_serializar(p), status=status.HTTP_201_CREATED)


class PeriodoDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        try:
            p = Periodo.objects.get(pk=pk)
        except Periodo.DoesNotExist:
            return Response({'error': 'Período no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        if 'nombre' in request.data:
            nombre = (request.data.get('nombre') or '').strip()
            if not nombre:
                return Response({'error': 'El nombre no puede quedar vacío'}, status=status.HTTP_400_BAD_REQUEST)
            p.nombre = nombre
        if 'fecha_inicio' in request.data:
            inicio = _fecha(request.data.get('fecha_inicio'))
            if not inicio:
                return Response({'error': 'Fecha de inicio inválida'}, status=status.HTTP_400_BAD_REQUEST)
            p.fecha_inicio = inicio
        if p.fecha_fin and p.fecha_fin < p.fecha_inicio:
            return Response({'error': 'El inicio no puede ser posterior al fin'}, status=status.HTTP_400_BAD_REQUEST)
        p.save()
        return Response(_serializar(p))

    def delete(self, request, pk):
        """Quita el período (no borra pedidos ni pagos). Si era el vigente, reabre el anterior."""
        try:
            p = Periodo.objects.get(pk=pk)
        except Periodo.DoesNotExist:
            return Response({'error': 'Período no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        era_vigente = p.fecha_fin is None
        p.delete()
        if era_vigente:
            anterior = Periodo.objects.first()
            if anterior:
                anterior.fecha_fin = None
                anterior.save(update_fields=['fecha_fin'])
        return Response(status=status.HTTP_204_NO_CONTENT)
