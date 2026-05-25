"""
Refuerza las categorías que tienen pocas imágenes usando consultas directas a Bing
(sin icrawler, usando urllib directo como hicimos en descargar_no_extintores_rapido.py).
"""
import urllib.request
import urllib.parse
import re
import os
import pathlib
import time
import random
import sys
from PIL import Image
import io

BASE_DIR = pathlib.Path('dataset/no_extintores')

# Categorías débiles con las queries que mejor funcionan
REFUERZO = {
    'tree':      ['arbol bosque naturaleza', 'forest nature landscape', 'arbol parque verde'],
    'food':      ['comida plato restaurante', 'delicious food meal', 'plato de comida casera'],
    'office':    ['oficina escritorio trabajo', 'office desk computer', 'sala de reuniones trabajo'],
    'furniture': ['muebles sala de estar', 'living room sofa furniture', 'dormitorio muebles'],
    'building':  ['edificio ciudad arquitectura', 'city buildings architecture', 'rascacielos ciudad'],
}
TARGET_PER_CATEGORY = 40  # descargar hasta tener este numero


def count_images(folder: pathlib.Path) -> int:
    if not folder.exists():
        return 0
    return sum(1 for f in folder.rglob('*') if f.is_file())


def get_bing_urls(query: str, num: int = 60) -> list:
    urls = []
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    for start in range(0, num * 2, 30):
        try:
            encoded = urllib.parse.quote(query)
            url = f'https://www.bing.com/images/async?q={encoded}&first={start}&count=30'
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as r:
                html = r.read().decode('utf-8', errors='ignore')
            found = re.findall(r'murl&quot;:&quot;(https?://[^&"]+)&quot;', html)
            urls.extend(found)
            if len(urls) >= num:
                break
            time.sleep(random.uniform(0.5, 1.2))
        except Exception as e:
            print(f'  [WARN] Error fetching page start={start}: {e}')
            break
    return list(dict.fromkeys(urls))[:num]  # deduplicar


def download_image(url: str, dest: pathlib.Path) -> bool:
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as r:
            data = r.read()
        img = Image.open(io.BytesIO(data))
        img.verify()
        # Volver a abrir tras verify (verify cierra el stream)
        img = Image.open(io.BytesIO(data)).convert('RGB')
        img.save(dest, 'JPEG')
        return True
    except Exception:
        return False


def reforzar_categoria(cat: str, queries: list, target: int):
    folder = BASE_DIR / cat
    folder.mkdir(parents=True, exist_ok=True)
    actual = count_images(folder)
    if actual >= target:
        print(f'[OK] {cat}: ya tiene {actual} imagenes, no necesita refuerzo.')
        return
    needed = target - actual
    print(f'[INFO] {cat}: tiene {actual} imagenes, necesita {needed} mas.')
    saved = 0
    idx = actual + 1
    for query in queries:
        if saved >= needed:
            break
        print(f'  Buscando: "{query}"...')
        urls = get_bing_urls(query, num=needed * 3)
        for url in urls:
            if saved >= needed:
                break
            ext = '.jpg'
            dest = folder / f'refuerzo_{idx:04d}{ext}'
            if download_image(url, dest):
                saved += 1
                idx += 1
                if saved % 5 == 0:
                    print(f'  -> {saved}/{needed} descargadas')
            time.sleep(random.uniform(0.1, 0.4))
    print(f'  Total final en {cat}: {count_images(folder)} imagenes')


def main():
    for cat, queries in REFUERZO.items():
        reforzar_categoria(cat, queries, TARGET_PER_CATEGORY)
    total = sum(count_images(BASE_DIR / cat) for cat in REFUERZO)
    print(f'\nRefuerzo completo. Categorias reforzadas suman: {total} imagenes.')


if __name__ == '__main__':
    main()
