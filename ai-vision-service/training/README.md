# CivicPulse YOLOv8n training

## Important
The stock `yolov8n.pt` model is COCO-pretrained. It is **not** a civic-defect detector.
Train this project-specific model with correctly labelled photos before enabling civic predictions.

## Dataset classes
The class IDs and names must be exactly:

| ID | Class |
|---:|---|
| 0 | pothole |
| 1 | garbage |
| 2 | sewage |
| 3 | streetlight |

Use YOLO detection labels: one text file per image, each line:
`class_id x_center y_center width height`
Coordinates must be normalized to 0..1. Include empty label files for verified images with no target defect. Split by source/location where possible to reduce leakage between train and validation.

Expected folder layout:
```
dataset/
  data.yaml
  images/train/
  images/val/
  images/test/
  labels/train/
  labels/val/
  labels/test/
```

Copy `data.yaml.example` to `dataset/data.yaml` and set its `path` to the dataset root.

## Train on Google Colab
1. Select a GPU runtime.
2. Clone the CivicPulse repository and enter `ai-vision-service`.
3. Install the vision requirements (the service's pinned PyTorch stack may need adjustment for the Colab Python image; install a compatible Ultralytics/PyTorch combination in the notebook runtime).
4. Upload or mount the labelled dataset.
5. Run:

```bash
python training/train_yolov8n.py --data dataset/data.yaml --epochs 100 --imgsz 640 --batch 16 --device 0
```

The script saves `artifacts/civicpulse_yolov8n.pt`.

## Validate before deployment
Run Ultralytics validation on a held-out test set and inspect per-class precision, recall, mAP50 and mAP50-95 plus the confusion matrix and false positives. Do not deploy a model that has not been reviewed on representative local images. Keep a human reviewer in the reporting workflow.

## Connect to Render

For the reviewed public pothole candidate, configure:
- `YOLO_POTHOLE_MODEL_URL=https://huggingface.co/peterhdd/pothole-detection-yolov8/resolve/main/best.pt`
- `YOLO_POTHOLE_MODEL_PATH=models/pothole_yolov8s.pt`
- `YOLO_CONFIDENCE=0.35` as an initial threshold, not a validated production threshold.
- Keep `VISION_API_TOKEN` unchanged.

The service downloads configured model artifacts at startup, follows HTTPS redirects (required by Hugging Face's large-file hosting), caps each file at 200 MB and stores it under the configured model path. Render's local filesystem may be ephemeral, so startup may need to download the artifact again after a restart. For production reliability, consider moving the verified checkpoint to durable private object storage.

The old `YOLO_MODEL_URL` and `YOLO_MODEL_PATH` variables remain available for a legacy unified model. Do not configure both legacy and category-specific checkpoints unless you intentionally want to keep both paths available.

## API
The existing authenticated `POST /analyze` endpoint accepts multipart fields `file` and `defect_type`. When custom weights are loaded, inference runs locally inside the Render service and returns `model_source: yolov8_vision` and normalized `[x1,y1,x2,y2]` boxes in 0..1 coordinates. No image is sent to a third-party model provider by this YOLO path.

`GET /health` reports `civic_yolo_loaded` and treats the local detector as configured/available. `GET /health/live` remains a liveness check.

## Limitations
- Bounding boxes locate model predictions; they do not prove severity or establish legal responsibility.
- Empty detections do not prove that no defect exists.
- All AI results require municipal human review.
- Training data quality and geographic coverage determine real-world performance.


## Multi-model inference registry

The FastAPI service can load independent checkpoints per category using
`YOLO_POTHOLE_MODEL_URL`, `YOLO_GARBAGE_MODEL_URL`,
`YOLO_SEWAGE_MODEL_URL`, and `YOLO_STREETLIGHT_MODEL_URL`.
Each URL must be HTTPS and point directly to a checkpoint under 200 MB. Set `YOLO_SEWAGE_CLASS_NAMES` and `YOLO_STREETLIGHT_CLASS_NAMES` to exact normalized class names from the respective trained checkpoint. At startup, the service checks that a checkpoint contains at least one configured category label; mismatched checkpoints are rejected.
Artifacts are downloaded at service startup and stored at the corresponding
`*_MODEL_PATH`. Do not commit model binaries or secrets to Git.

### Current model-selection status

- **Pothole:** `peterhdd/pothole-detection-yolov8`, YOLOv8s, one class named `pothole`, Apache-2.0 model card. The direct Hugging Face checkpoint URL is now in `.env.example`. This is not YOLOv8n. Real-world accuracy on local roads remains unverified.
- **Garbage:** configured to use `tanmay9132/civic-eye-pothole-garbage`,
  an Apache-2.0 model card documenting exactly two classes: `Pothole` and
  `Garbage`. The service maps only the `garbage` output from this checkpoint
  to garbage reports. Its weights and actual runtime class metadata have not
  been loaded or independently validated yet; do not interpret this as
  production accuracy evidence.
- **Sewage / drain overflow:** no ready-to-download trained checkpoint is verified. A Roboflow dataset lists six drain/manhole classes, including `open drainage (overflowing)` and `drainage overflow(repair)`, under MIT; it contains only 302 images and lists zero trained models. Treat it as a small research seed, not a production detector. A separate Indian road-hazard YOLOv8n project detects waterlogging, but reports test mAP@0.5 of 0.177 and uses a CC BY-NC-SA 4.0 dataset; it is not suitable as a production default without licensing review and substantial retraining.
- **Streetlight:** a Hugging Face CC-BY-4.0 dataset provides 8,428 manually annotated lamp-bulb images with `lamp_on`, `lamp_off`, and `lamp_occluded` labels, but no ready-made YOLO checkpoint was verified. It was collected on Moscow routes, so local Indian-road generalization is unknown. `lamp_off` alone is not proof of a fault: inference needs capture time/day-night context and human review. A small Roboflow dataset has a `broken_streetlight` class but only 273 images and no trained model. Keep both categories on the approved vision-provider/manual-review path until a properly licensed, locally evaluated checkpoint is trained.

The authenticated `GET /health` response includes `civic_yolo_category_status`
with `loaded`, `load_failed`, or `not_configured` for each category. This is
a model-loading signal only; it does not certify accuracy or suitability.

For `defect_type=unknown`, the service runs all configured category models.
For a specific category, it runs only that category's checkpoint. All detections
are normalized to the existing `bounding_boxes` response format and require
human review. Missing model weights do not count as a negative detection.
