import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from core.models import Producto, Factura
print("Producto TEST-PROD-TMP existe:", Producto.objects.filter(nombre='TEST-PROD-TMP').exists())
print("Factura TESTF1/TESTF2 existen:", Factura.objects.filter(numero_factura__in=['TESTF1','TESTF2']).exists())
