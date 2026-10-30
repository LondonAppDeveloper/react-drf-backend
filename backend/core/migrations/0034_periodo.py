from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0033_merge_pre_reservas_conteo"),
    ]

    operations = [
        migrations.CreateModel(
            name="Periodo",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("nombre", models.CharField(max_length=100)),
                ("fecha_inicio", models.DateField()),
                ("fecha_fin", models.DateField(blank=True, null=True)),
                ("creado", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["-fecha_inicio", "-id"]},
        ),
    ]
