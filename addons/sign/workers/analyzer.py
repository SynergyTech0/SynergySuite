#!/usr/bin/env python3
import json, sys, io, os
import contextlib
from pdfminer.high_level import extract_text

def safe_extract_text(filepath: str) -> str:
    # Silence absolutely everything from pdfminer and friends
    stderr = sys.stderr
    stdout = sys.stdout
    sys.stderr = io.StringIO()
    sys.stdout = io.StringIO()
    try:
        text = extract_text(filepath)
    except Exception:
        text = ""
    finally:
        sys.stderr = stderr
        sys.stdout = stdout
    return text or ""

def main():
    if len(sys.argv) < 2:
        sys.stdout.write(json.dumps({"summary": None, "fields": []}))
        sys.stdout.flush()
        return

    file_path = sys.argv[1]
    try:
        text = safe_extract_text(file_path)
        summary = text.strip().replace("\n", " ")[:500]

        # Simple field detection
        fields = []
        for keyword in ["signature", "date", "email", "name"]:
            if keyword.lower() in text.lower():
                fields.append({
                    "label": keyword.title(),
                    "x": 100, "y": 100, "width": 200, "height": 30
                })

        sys.stdout.write(json.dumps({"summary": summary, "fields": fields}))
        sys.stdout.flush()

    except Exception as e:
        sys.stdout.write(json.dumps({
            "summary": None,
            "fields": [],
            "error": str(e)
        }))
        sys.stdout.flush()

if __name__ == "__main__":
    main()
