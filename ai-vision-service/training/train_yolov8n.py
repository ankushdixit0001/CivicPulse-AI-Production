#!/usr/bin/env python3
"""Train one category-specific CivicPulse YOLOv8n detector.

The dataset YAML class names and order must exactly match --classes.
Use separate datasets/checkpoints for pothole, garbage, sewage and streetlight.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from ultralytics import YOLO
from validate_dataset import validate_dataset

DEFAULT_CLASSES = {
    "pothole": ["pothole"],
    "garbage": ["garbage"],
    "sewage": ["sewage"],
    "streetlight": ["broken_streetlight"],
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--category", required=True, choices=sorted(DEFAULT_CLASSES))
    parser.add_argument("--data", required=True, help="Category-specific YOLO data.yaml")
    parser.add_argument("--classes", default="", help="Exact comma-separated class names/order; defaults to the canonical category label.")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--device", default="0", help="0 for first GPU, cpu for CPU")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--project", default="runs/civicpulse")
    parser.add_argument("--name", default="")
    args = parser.parse_args()

    if args.epochs < 1 or args.imgsz < 320 or args.batch < 1 or args.workers < 0:
        parser.error("epochs/batch must be positive, imgsz >= 320 and workers >= 0.")
    classes = [item.strip() for item in args.classes.split(",") if item.strip()] or DEFAULT_CLASSES[args.category]
    data_path = Path(args.data).resolve()
    if not data_path.is_file():
        raise FileNotFoundError(f"Dataset YAML not found: {data_path}")
    validate_dataset(data_path, classes)

    run_name = args.name or f"{args.category}-yolov8n"
    model = YOLO("yolov8n.pt")
    results = model.train(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        workers=args.workers,
        project=args.project,
        name=run_name,
        pretrained=True,
        patience=25,
        cache=False,
        plots=True,
        seed=42,
        deterministic=True,
    )

    run_dir = Path(args.project) / run_name
    best = run_dir / "weights" / "best.pt"
    if not best.is_file():
        raise FileNotFoundError(f"Training finished without best weights: {best}")

    # Evaluate only on the held-out test split; never use test metrics to tune training.
    test_metrics = None
    config_text = data_path.read_text(encoding="utf-8")
    if "test:" in config_text:
        evaluator = YOLO(str(best))
        metrics = evaluator.val(data=str(data_path), split="test", imgsz=args.imgsz, device=args.device)
        test_metrics = {
            "precision": float(getattr(metrics.box, "mp", 0.0)),
            "recall": float(getattr(metrics.box, "mr", 0.0)),
            "map50": float(getattr(metrics.box, "map50", 0.0)),
            "map50_95": float(getattr(metrics.box, "map", 0.0)),
        }

    artifact_dir = Path("artifacts")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    target = artifact_dir / f"civicpulse_{args.category}_yolov8n.pt"
    shutil.copy2(best, target)
    report = {
        "category": args.category,
        "classes": classes,
        "artifact": str(target),
        "test_metrics": test_metrics,
        "warning": "Metrics are dataset-specific and do not establish real-world performance outside the held-out test distribution.",
    }
    report_path = artifact_dir / f"civicpulse_{args.category}_evaluation.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print("Configure the matching YOLO_" + args.category.upper() + "_MODEL_PATH in the vision service.")
    print("Do not deploy until a reviewer inspects test images, false positives and local geographic coverage.")


if __text=content; false) {}
