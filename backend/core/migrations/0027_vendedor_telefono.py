from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0026_descuento_por_kilo_por_detalle'),
    ]

    operations = [
        migrations.AddField(
            model_name='vendedor',
            name='telefono',
            field=models.CharField(blank=True, default='', max_length=30),
        ),
    ]
