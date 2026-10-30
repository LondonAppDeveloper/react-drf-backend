from django.db import migrations


class Migration(migrations.Migration):
    # Une las ramas de pre-reservas/congelado y de conteo de inventario.

    dependencies = [
        ("core", "0032_auditoria_pre_reservas"),
        ("core", "0032_conteo_inventario"),
    ]

    operations = []
