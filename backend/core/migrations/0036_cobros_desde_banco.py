from django.db import migrations


def crear_cobros(apps, schema_editor):
    """Las asociaciones de cartola a pedidos ya eran cobros: se les crea su Cobro
    para que el Cierre de mes las cuente una sola vez."""
    Asignacion = apps.get_model('core', 'AsignacionMovimiento')
    Cobro = apps.get_model('core', 'Cobro')
    for a in Asignacion.objects.filter(pedido__isnull=False).select_related('movimiento', 'pedido'):
        Cobro.objects.create(
            pedido=a.pedido, fecha=a.movimiento.fecha, monto=a.monto, medio='transferencia',
            receptor='vendedor', vendedor_id=a.pedido.vendedor_id, asignacion=a,
            comentario='Desde cartola bancaria',
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0035_cierre_mes_cobros_documentos'),
    ]

    operations = [
        migrations.RunPython(crear_cobros, migrations.RunPython.noop),
    ]
