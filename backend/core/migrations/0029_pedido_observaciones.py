from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0028_producto_campos_flyer'),
    ]

    operations = [
        migrations.AddField(
            model_name='pedido',
            name='observaciones',
            field=models.TextField(blank=True, default='', verbose_name='Observaciones'),
        ),
    ]
