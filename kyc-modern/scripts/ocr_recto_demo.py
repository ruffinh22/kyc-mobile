import sys
import os
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
import easyocr


def preprocess_image(image_path: str):
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f'Image introuvable: {image_path}')

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return thresh


def run_ocr(image_path: str):
    reader = easyocr.Reader(['en', 'fr'], gpu=False)
    result = reader.readtext(image_path, detail=0, paragraph=False)
    return result


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python ocr_recto_demo.py <image_path>')
        sys.exit(1)

    image_path = sys.argv[1]
    print('OCR en cours sur :', image_path)
    try:
        text = run_ocr(image_path)
        print('\n'.join(text))
    except Exception as exc:
        print(f'Erreur OCR: {exc}')
        sys.exit(2)
