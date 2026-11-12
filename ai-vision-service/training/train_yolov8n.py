#!/usr/bin/env python3
"""Train CivicPulse's custom YOLOv8n civic-defect detector.

Dataset labels must use Ultralytics YOLO detection format:
<class_id> <x_center> <y_center> <width> <height>, normalized to 0..1.
Expected class order: pothole, garbage, sewage, streetlight.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO

CLASSES = ["pothole", "garbage", "sewage", "streetlight"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="dataset/data.yaml")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--device", default="0", help="0 for first GPU, cpu for CPU")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--project", default="runs/civicpulse")
    parser.add_argument("--name", default="yolov8n")
    args = parser.parse_args()

    data_path = Path(args.data).resolve()
    if not data_path.is_file():
        raise FileNotFoundError(f"Dataset YAML not found: {data_path}")
    model = YOLO("yolov8n.pt")
    model.train(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        workers=args.workers,
        project=args.project,
        name=args.name,
        pretrained=True,
        patience=25,
        cache=False,
        plots=True,
        seed=42,
    )
    run_dir = Path(args.project) / args.name
    best = run_dir / "weights" / "best.pt"
    if not best.is_file():
        raise FileNotFoundError(f"Training finished without best weights: {best}")
    artifact_dir = Path("artifacts")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    target = artifact_dir / "civicpulse_yolov8n.pt"
    shutil.copy2(best, target)
    print(f"Best model copied to: {target.resolve()}")
    print("Class order expected by CivicPulse:", ", ".join(CLASSES))
    print("Next: validate on a held-out test set before deploying this artifact.")


if __name__ == "__main__":
    main()
