#!/usr/bin/env python3
"""
OpenCV Image Preprocessing for OCR
Called from Node.js to enhance image quality before Tesseract OCR
"""

import cv2
import numpy as np
import sys
import json
import os

def preprocess_image(input_path, output_path, options=None):
    """
    Preprocess image using OpenCV for better OCR accuracy

    Args:
        input_path: Path to input image
        output_path: Path to save preprocessed image
        options: Dict with preprocessing options

    Returns:
        Dict with processing results
    """
    if options is None:
        options = {}

    # Default options
    deskew = options.get('deskew', True)
    denoise = options.get('denoise', True)
    binarize = options.get('binarize', True)
    enhance_contrast = options.get('enhanceContrast', True)
    remove_background = options.get('removeBackground', False)

    try:
        # Read image
        img = cv2.imread(input_path)
        if img is None:
            return {'error': f'Could not read image: {input_path}'}

        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # 1️⃣ Enhance contrast using CLAHE
        if enhance_contrast:
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            gray = clahe.apply(gray)

        # 2️⃣ Denoise
        if denoise:
            gray = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)

        # 3️⃣ Deskew
        if deskew:
            angle = detect_skew(gray)
            if abs(angle) > 0.5:  # Only rotate if significant skew
                gray = rotate_image(gray, angle)

        # 4️⃣ Remove background
        if remove_background:
            blur = cv2.GaussianBlur(gray, (5, 5), 0)
            gray = cv2.subtract(gray, blur)
            gray = cv2.add(gray, 100)

        # 5️⃣ Binarization
        if binarize:
            gray = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY, 11, 2
            )

        # Save preprocessed image
        cv2.imwrite(output_path, gray)

        return {
            'success': True,
            'outputPath': output_path,
            'skewAngle': angle if deskew else 0,
            'size': {
                'width': gray.shape[1],
                'height': gray.shape[0]
            }
        }

    except Exception as e:
        return {'error': str(e)}


def detect_skew(image):
    """Detect document skew angle using Hough line detection (optimized)"""
    try:
        # Downsample image for faster processing (2x smaller = 4x faster)
        h, w = image.shape
        small = cv2.resize(image, (w // 2, h // 2))

        # Edge detection
        edges = cv2.Canny(small, 50, 150, apertureSize=3)

        # Hough line detection with relaxed parameters for speed
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, 50, minLineLength=50, maxLineGap=20)

        if lines is None or len(lines) == 0:
            return 0

        # Sample max 20 lines for speed (instead of all)
        sample_size = min(20, len(lines))
        sampled_lines = lines[:sample_size] if len(lines) > sample_size else lines

        # Calculate angles
        angles = []
        for line in sampled_lines:
            x1, y1, x2, y2 = line[0]
            angle = np.arctan2(y2 - y1, x2 - x1) * 180.0 / np.pi

            # Only consider nearly horizontal lines
            if abs(angle) < 10:  # Stricter threshold for speed
                angles.append(angle)

        if not angles:
            return 0

        # Return median angle
        return float(np.median(angles))

    except Exception as e:
        print(f"Skew detection failed: {e}", file=sys.stderr)
        return 0


def rotate_image(image, angle):
    """Rotate image by given angle"""
    (h, w) = image.shape[:2]
    center = (w // 2, h // 2)

    # Get rotation matrix
    M = cv2.getRotationMatrix2D(center, angle, 1.0)

    # Rotate image
    rotated = cv2.warpAffine(
        image, M, (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255)
    )

    return rotated


def detect_form_boxes(input_path):
    """Detect checkboxes and form fields using contour detection"""
    try:
        img = cv2.imread(input_path)
        if img is None:
            return {'error': f'Could not read image: {input_path}'}

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Apply binary threshold
        _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY_INV)

        # Find contours
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        boxes = []

        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            area = w * h
            aspect_ratio = w / h if h > 0 else 0

            # Classify based on size and shape
            box_type = None

            # Checkbox: small, square-ish
            if 100 < area < 1000 and 0.8 < aspect_ratio < 1.2:
                box_type = 'checkbox'
            # Text box: medium, horizontal rectangle
            elif 1000 < area < 50000 and 3 < aspect_ratio < 15:
                box_type = 'textbox'
            # Signature area: large, horizontal rectangle
            elif 10000 < area < 100000 and 2 < aspect_ratio < 5:
                box_type = 'signature_area'

            if box_type:
                boxes.append({
                    'x': int(x),
                    'y': int(y),
                    'width': int(w),
                    'height': int(h),
                    'type': box_type,
                    'area': int(area),
                    'aspectRatio': float(aspect_ratio)
                })

        return {
            'success': True,
            'boxes': boxes,
            'count': len(boxes)
        }

    except Exception as e:
        return {'error': str(e)}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: opencv_preprocess.py <command> [args...]'}))
        sys.exit(1)

    command = sys.argv[1]

    if command == 'preprocess':
        if len(sys.argv) < 4:
            print(json.dumps({'error': 'Usage: opencv_preprocess.py preprocess <input> <output> [options_json]'}))
            sys.exit(1)

        input_path = sys.argv[2]
        output_path = sys.argv[3]
        options = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}

        result = preprocess_image(input_path, output_path, options)
        print(json.dumps(result))

    elif command == 'detect_boxes':
        if len(sys.argv) < 3:
            print(json.dumps({'error': 'Usage: opencv_preprocess.py detect_boxes <input>'}))
            sys.exit(1)

        input_path = sys.argv[2]
        result = detect_form_boxes(input_path)
        print(json.dumps(result))

    elif command == 'test':
        # Test OpenCV installation
        print(json.dumps({
            'success': True,
            'opencvVersion': cv2.__version__,
            'pythonVersion': sys.version
        }))

    else:
        print(json.dumps({'error': f'Unknown command: {command}'}))
        sys.exit(1)
