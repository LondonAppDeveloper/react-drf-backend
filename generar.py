import os
from pathlib import Path

def generar_estructura(ruta, nivel=0, archivo_salida=None):
    """Genera estructura de directorios excluyendo carpetas no relevantes"""
    ruta = Path(ruta)
    texto = []
    
    # Directorios a ignorar (case-insensitive)
    IGNORAR = {
        'node_modules', 'venv', 'env',
        '__pycache__', '.git', '.idea',
        'dist', 'build', '.vscode','myenv'
    }
    
    if nivel == 0:
        texto.append(f"ESTRUCTURA DE: {ruta.resolve()}\n")
    
    for item in sorted(ruta.iterdir()):
        if item.name.lower() in IGNORAR or item.name.startswith('.'):
            continue
            
        indent = "    " * nivel
        if item.is_dir():
            texto.append(f"{indent}📁 {item.name}/")
            texto.append(generar_estructura(item, nivel + 1, archivo_salida))
        else:
            texto.append(f"{indent}📄 {item.name}")
    
    if nivel == 0 and archivo_salida:
        with open(archivo_salida, 'w', encoding='utf-8') as f:
            f.write("\n".join(line for line in texto if line))
        return f"✓ Guardado en: {archivo_salida}"
    
    return "\n".join(line for line in texto if line)

if __name__ == "__main__":
    directorio_actual = Path(__file__).parent
    salida = "estructura.txt"
    
    try:
        print(generar_estructura(directorio_actual, archivo_salida=salida))
        print(f"Directorio base: {directorio_actual.resolve()}")
    except Exception as e:
        print(f"Error: {e}")