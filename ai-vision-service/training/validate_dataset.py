#!/usr/bin/env python3
"""Validate a YOLO detection dataset before training.

Expected layout: images/{train,val,test} and labels/{train,val,test}.
Every image must have a matching .txt label file; use an empty file for
verified negative images. Label rows use normalized YOLO xywh coordinates.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

import yaml

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}


def _names_in_order(names):
    if isinstance(names, dict):
        try:
            return [str(names[index]) for index in range(len(names))]
        except KeyError as exc:
            raise ValueError("Dataset class IDs in names must be contiguous from 0.") from exc
    if isinstance(names, list):
        return [str(item) for item in names]
    raise ValueError("data.yaml must define names as a list or contiguous ID-to-name mapping.")


def validate_dataset(data_yaml: Path, expected_classes: list[str] | None = None) -> list[str]:
    config = yaml.safe_load(data_yaml.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise ValueError("Dataset YAML must contain a mapping.")
    root_value = config.get("path", ".")
    root = Path(root_value)
    if not root.is_absolute():
        root = (data_yaml.parent / root).resolve()
    names = _names_in_order(config.get("names"))
    if not names or any(not name.strip() for name in names):
        raise ValueError("Dataset class names cannot be empty.")
    if len({name.strip().lower() for name in names}) != len(names):
        raise ValueError("Dataset class names must be unique.")
    if expected_classes and [n.strip().lower() for n in names] != [n.strip().lower() for n in expected_classes]:
        raise ValueError(f"Class order mismatch. Expected {expected_classes}, found {names}.")

    errors: list[str] = []
    totals = {}
    for split in ("train", "val", "test"):
        split_value = config.get(split)
        if not split_value:
            if split in ("train", "val"):
                errors.append(f"Missing required '{split}' split in YAML.")
            continue
        image_dir = (root / split_value).resolve()
        if not image_dir.is_dir():
            errors.append(f"{split}: image directory not found: {image_dir}")
            continue
        label_value = config.get(f"{split}_labels")
        label_dir = (root / label_value).resolve() if label_value else (root / "labels" / split)
        if not label_dir.is_dir():
            errors.append(f"{split}: label directory not found: {label_dir}")
            continue
        images = sorted(p for p in image_dir.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS)
        if not images:
            errors.append(f"{split}: no supported images found in {image_dir}")
            continue
        image_stems = {p.relative_to(image_dir).with_suffix("").as_posix() for p in images}
        label_files = {p.relative_to(label_dir).with_suffix("").as_posix(): p for p in label_dir.rglob("*.txt")}
        missing = sorted(image_stems - set(label_files))
        orphaned = sorted(set(label_files) - image_stems)
        if missing:
            errors.append(f"{split}: {len(missing)} images have no label file (use empty .txt for negatives).")
        if orphaned:
            errors.append(f"{split}: {len(orphaned)} label files have no matching image.")
        rows_checked = 0
        for relative, label_path in label_files.items():
            if relative not in image_stems:
                continue
            for line_number, raw in enumerate(label_path.read_text(encoding="utf-8").splitlines(), 1):
                parts = raw.split()
                if len(parts) != 5:
                    errors.append(f"{label_path}:{line_number}: expected 5 values, found {len(parts)}.")
                    continue
                try:
                    class_id = int(parts[0])
                    x, y, width, height = map(float, parts[1:])
                except ValueError:
                    errors.append(f"{label_path}:{line_number}: non-numeric label value.")
                    continue
                if class_id < 0 or class_id >= len(names):
                    errors.append(f"{label_path}:{line_number}: class ID {class_id} outside 0..{len(names)-1}.")
                if not all(0.0 <= value <= 1.0 for value in (x, y, width, height)):
                    errors.append(f"{label_path}:{line_number}: coordinates must be within 0..1.")
                if width <= 0 or height <= 0 or x - width / 2 < 0 or y - height / 2 < 0 or x + width / 2 > 1 or y + height / 2 > 1:
                    errors.append(f"{label_path}:{line_number}: invalid or out-of-image bounding box.")
                rows_checked += 1
        totals[split] = (len(images), rows_checked)
    if errors:
        raise ValueError("\\n".join(errors))
    print("Dataset validation passed.")
    for split, (image_count, box_count) in totals.items():
        print(f"{split}: {image_count} images, {box_count} annotated boxes")
    print("Classes:", ", ".join(names))
    return names


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default="dataset/data.yaml")
    parser.add_argument("--expected-classes", default="", help="Optional comma-separated exact class order.")
    args = parser.parse_args()
    expected = [item.strip() for item in args.expected_classes.split(",") if item.strip()] or None
    try:
        validate_dataset(Path(args.data).resolve(), expected)
    except (OSError, ValueError, yaml.YAMLError) as exc:
        print(f"DATASET INVALID: {exc}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
