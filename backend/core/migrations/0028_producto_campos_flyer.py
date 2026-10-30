from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0027_vendedor_telefono'),
    ]

    operations = [
        migrations.AddField(
            model_name='producto',
            name='venta_por_unidad',
            field=models.BooleanField(default=False, help_text="Si está marcado, el flyer muestra el precio como 'c/u' en vez de por kilo", verbose_name='Precio por unidad en el flyer'),
        ),
        migrations.AddField(
            model_name='producto',
            name='peso_flyer',
            field=models.CharField(blank=True, default='', help_text="Texto fijo (ej: 'paquete de 1 kg'). Vacío = se calcula desde el stock", max_length=50, verbose_name='Peso aproximado en el flyer'),
        ),
    ]
