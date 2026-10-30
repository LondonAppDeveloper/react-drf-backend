import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from decimal import Decimal
from core.models import DetallePedido

d = DetallePedido.objects.get(pedido_id=3, producto__nombre='Punta De Ganso')
IVA = Decimal('1.19')

print("Valores guardados en la base (netos, sin IVA):")
print(f"  cantidad_kilos = {d.cantidad_kilos}")
print(f"  costo_por_kilo (neto) = {d.costo_por_kilo}")
print(f"  total_costo (neto, guardado) = {d.total_costo}")
print(f"  Verificacion: kilos * costo_por_kilo = {d.cantidad_kilos * d.costo_por_kilo}")
print()
print("Con IVA (lo que se muestra en pantalla):")
costo_kg_con_iva_exacto = d.costo_por_kilo * IVA
total_con_iva_exacto = d.total_costo * IVA
print(f"  costo_por_kilo * 1.19 (EXACTO) = {costo_kg_con_iva_exacto}")
print(f"  costo_por_kilo * 1.19 (redondeado a display) = {round(costo_kg_con_iva_exacto)}")
print(f"  total_costo * 1.19 (EXACTO) = {total_con_iva_exacto}")
print(f"  total_costo * 1.19 (redondeado a display) = {round(total_con_iva_exacto)}")
print()
print("Lo que hace el usuario manualmente:")
costo_kg_mostrado_redondeado = round(costo_kg_con_iva_exacto)  # $12.309 (lo que ve en pantalla)
print(f"  kilos * costo/kg_MOSTRADO(redondeado a $12.309) = {d.cantidad_kilos} * {costo_kg_mostrado_redondeado} = {d.cantidad_kilos * costo_kg_mostrado_redondeado}")
