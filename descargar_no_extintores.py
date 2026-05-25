import os
from icrawler.builtin import BingImageCrawler
from PIL import Image
import pathlib
import logging

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')

# Base directory for the dataset
BASE_DIR = pathlib.Path('dataset/no_extintores')
BASE_DIR.mkdir(parents=True, exist_ok=True)

# Categories of non-extinguisher images to download
CATEGORIES = [
    'dog', 'cat', 'person', 'bicycle', 'motorcycle',
    'building', 'food', 'furniture', 'tree', 'office'
]
# Number of images per category (adjust as needed)
IMAGES_PER_CATEGORY = 60  # total 600 images

def is_image_valid(path: pathlib.Path) -> bool:
    """Check if an image can be opened without errors.
    """
    try:
        with Image.open(path) as img:
            img.verify()
        return True
    except Exception as e:
        logging.warning(f'Corrupt image detected and will be removed: {path} ({e})')
        return False

def download_category(category: str, num_images: int):
    target_dir = BASE_DIR / category
    target_dir.mkdir(parents=True, exist_ok=True)
    logging.info(f'Downloading {num_images} images for category "{category}" into {target_dir}')
    crawler = BingImageCrawler(storage={'root_dir': str(target_dir)})
    # Use a broad query to increase diversity
    query = f'{category} high resolution'
    crawler.crawl(keyword=query, max_num=num_images, min_size=(200, 200), filters={'type': 'photo'})
    # Validate and remove corrupted files
    for img_path in target_dir.iterdir():
        if img_path.is_file() and not is_image_valid(img_path):
            img_path.unlink()

def main():
    for cat in CATEGORIES:
        download_category(cat, IMAGES_PER_CATEGORY)
    logging.info('Download completed.')

if __name__ == '__main__':
    main()
