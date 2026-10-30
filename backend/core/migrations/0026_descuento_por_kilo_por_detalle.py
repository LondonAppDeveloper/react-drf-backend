from django.db import migrations, models


def copiar_descuento_a_detalles(apps, schema_editor):
    # Los pedidos existentes tenian un unico descuento aplicado a todas sus
    # lineas: se copia a cada detalle para conservar el historial.
    Pedido = apps.get_model('core', 'Pedido')
    DetallePedido = apps.get_model('core', 'DetallePedido')
    for pedido in Pedido.objects.exclude(descuento_por_kilo=0):
        DetallePedido.objects.filter(pedido=pedido).update(descuento_por_kilo=pedido.descuento_por_kilo)


def copiar_descuento_a_pedido(apps, schema_editor):
    Pedido = apps.get_model('core', 'Pedido')
    DetallePedido = apps.get_model('core', 'DetallePedido')
    for detalle in DetallePedido.objects.exclude(descuento_por_kilo=0):
        Pedido.objects.filter(id=detalle.pedido_id).update(descuento_por_kilo=detalle.descuento_por_kilo)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0025_pedido_descuento_por_kilo'),
    ]

    operations = [
        migrations.AddField(
            model_name='detallepedido',
            name='descuento_por_kilo',
            field=models.DecimalField(decimal_places=2, default=0, help_text='Monto descontado del precio por kilo de ESTE producto en este pedido (precio_venta ya lo refleja). No cambia el precio general del producto.', max_digits=10, verbose_name='Descuento por kilo'),
        ),
        migrations.RunPython(copiar_descuento_a_detalles, copiar_descuento_a_pedido),
        migrations.RemoveField(
            model_name='pedido',
            name='descuento_por_kilo',
        ),
    ]
