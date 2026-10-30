from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0021_historialprecioproducto'),
    ]

    operations = [
        migrations.AddField(
            model_name='ajusteinventario',
            name='cantidad_unidades',
            field=models.IntegerField(default=0, verbose_name='Unidades ajustadas (puede ser positiva o negativa)'),
        ),
        migrations.AlterField(
            model_name='ajusteinventario',
            name='cantidad',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10, verbose_name='Kilos ajustados (puede ser positiva o negativa)'),
        ),
    ]
