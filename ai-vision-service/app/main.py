from __future__ import annotations

import asyncio
import base64
import io
import json
import math
import os
from typing import Any, Dict, List, Optional, Tuple

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from ultralytics import YOLO

APP_TITLE = "CivicPulse AI Vision Service"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_SIDE = 6000
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-4.1-mini").strip()
VISION_API_TOKEN = os.getenv("VISION_API_TOKEN", "").strip()
CATEGORY_WEIGHTS = {"pothole": 1.2, "garbage": 1.1, "sewage": 1.5, "streetlight": 1.0, "unknown": 1.0}
ALLOWED_CATEGORIES = set(CATEGORY_WEIGHTS)
app = FastAPI(title=APP_TITLE, version="2.0.0")

# COCO YOLO is used only for generic object context. It is NOT a civic-defect model.
try:
    model = YOLO(os.getenv("YOLO_MODEL_PATH", "yolov8n.pt"))
except Exception:
    model = None


def _check_token(token: Optional[str]) -> None:
    if not VISION_API_TOKEN:
        raise HTTPException(status_code=503, detail="VISION_API_TOKEN is not configured; vision inference is disabled.")
    if token != VISION_API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid vision-service token.")


def _load_image(data: bytes) -> Tuple[Image.Image, np.ndarray]:
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be between 1 byte and 8 MB.")
    try:
        image = Image.open(io.BytesIO(data))
        image.verify()
        image = Image.open(io.BytesIO(data))
        image = ImageOps.exif_transpose(image).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid image.") from exc
    if image.width > MAX_IMAGE_SIDE or image.height > MAX_IMAGE_SIDE:
        raise HTTPException(status_code=400, detail="Image dimensions must be 6000 x 6000 pixels or smaller.")
    array = np.asarray(image)
    return image, cv2.cvtColor(array, cv2.COLOR_RGB2BGR)


def _data_url(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=88, optimize=True)
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return "data:image/jpeg;base64," + encoded


def _parse_json_content(content: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(content)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Vision model returned invalid JSON.") from exc
    if not isinstance(parsed, dict):
        raise ValueError("Vision model returned an unexpected response.")
    return parsed


async def _openai_vision(messages: List[Dict[str, Any]], max_tokens: int = 900) -> Dict[str, Any]:
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": OPENAI_MODEL,
                "temperature": 0,
                "max_tokens": max_tokens,
                "response_format": {"type": "json_object"},
                "messages": messages,
            },
        )
    if response.status_code >= 400:
        # Avoid returning provider response bodies that may contain operational details.
        raise RuntimeError(f"Vision provider returned HTTP {response.status_code}")
    payload = response.json()
    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    return _parse_json_content(content)


def _quality_metrics(image_bgr: np.ndarray) -> Dict[str, Any]:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(np.mean(gray))
    contrast = float(np.std(gray))
    height, width = gray.shape
    issues: List[str] = []
    if min(width, height) < 320:
        issues.append("low_resolution")
    if blur_score < 70:
        issues.append("blurry")
    if brightness < 45:
        issues.append("too_dark")
    elif brightness > 220:
        issues.append("overexposed")
    if contrast < 18:
        issues.append("low_contrast")
    quality = "good" if not issues else ("poor" if len(issues) >= 2 else "review")
    return {
        "width": int(width),
        "height": int(height),
        "blur_score": round(blur_score, 2),
        "brightness": round(brightness, 2),
        "contrast": round(contrast, 2),
        "quality": quality,
        "quality_flags": issues,
    }


def _generic_objects(image_bgr: np.ndarray) -> List[Dict[str, Any]]:
    if model is None:
        return []
    try:
        results = model(image_bgr, conf=0.3, verbose=False)
    except Exception:
        return []
    objects: List[Dict[str, Any]] = []
    for result in results:
        for box in result.boxes:
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
            objects.append({
                "label": str(result.names.get(int(box.cls[0]), "object")),
                "confidence": round(float(box.conf[0]), 3),
                "bbox": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
            })
    return sorted(objects, key=lambda item: item["confidence"], reverse=True)[:30]


def _normalise_analysis(result: Dict[str, Any], requested_category: str, quality: Dict[str, Any]) -> Dict[str, Any]:
    category = str(result.get("defect_type", requested_category)).lower().strip()
    if category not in ALLOWED_CATEGORIES:
        category = "unknown"
    confidence = max(0.0, min(1.0, float(result.get("confidence", 0) or 0)))
    damage = max(0.0, min(100.0, float(result.get("damage_coverage_pct", 0) or 0)))
    score = max(0.0, min(100.0, float(result.get("priority_score", 0) or 0)))
    severity = str(result.get("severity", "LOW")).upper()
    if severity not in {"LOW", "MEDIUM", "CRITICAL"}:
        severity = "LOW"
    boxes = result.get("bounding_boxes", [])
    if not isinstance(boxes, list):
        boxes = []
    clean_boxes = []
    for item in boxes[:30]:
        if not isinstance(item, dict):
            continue
        bbox = item.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            continue
        try:
            coords = [max(0.0, min(1.0, float(value))) for value in bbox]
            # Model prompt returns normalized 0..1000 coordinates.
            if max(coords) > 1:
                coords = [value / 1000.0 for value in coords]
            clean_boxes.append({
                "label": str(item.get("label", "damage"))[:80],
                "confidence": round(max(0.0, min(1.0, float(item.get("confidence", confidence)))), 3),
                "bbox": coords,
            })
        except (TypeError, ValueError):
            continue
    return {
        "status": "success",
        "model": OPENAI_MODEL,
        "model_source": "openai_vision",
        "defect_type": category,
        "confidence": round(confidence, 3),
        "severity": severity,
        "priority_score": round(score, 2),
        "damage_coverage_pct": round(damage, 2),
        "summary": str(result.get("summary", ""))[:500],
        "visible_evidence": [str(x)[:180] for x in result.get("visible_evidence", [])[:8] if isinstance(x, str)],
        "recommended_action": str(result.get("recommended_action", "Manual inspection recommended."))[:500],
        "human_review_required": bool(result.get("human_review_required", confidence < 0.75 or quality["quality"] != "good")),
        "bounding_boxes": clean_boxes,
        "image_quality": quality,
        "limitations": ["AI output is an estimate; a city employee must confirm the defect and priority."],
    }


def _fallback_analysis(requested_category: str, quality: Dict[str, Any], objects: List[Dict[str, Any]]) -> Dict[str, Any]:
    # No fake defect boxes or invented confidence: generic COCO detections cannot prove civic damage.
    return {
        "status": "partial",
        "model": "yolov8n-coco" if model is not None else "opencv-quality-checks",
        "model_source": "generic_object_context" if model is not None else "computer_vision_quality_only",
        "defect_type": requested_category,
        "confidence": 0.0,
        "severity": "LOW",
        "priority_score": 0,
        "damage_coverage_pct": 0,
        "summary": "Civic-defect classification is unavailable. Image quality checks completed; the selected category has not been independently verified.",
        "visible_evidence": [],
        "recommended_action": "Review the photo and issue description manually. Configure OPENAI_API_KEY for defect-specific visual reasoning.",
        "human_review_required": True,
        "bounding_boxes": [],
        "generic_objects": objects,
        "image_quality": quality,
        "limitations": ["Generic YOLO object detection is not trained to identify potholes, sewage, or broken streetlights."],
    }


def _priority_from_ai(result: Dict[str, Any], requested_category: str) -> Dict[str, Any]:
    category = str(result.get("defect_type", requested_category)).lower()
    if category not in ALLOWED_CATEGORIES:
        category = requested_category
    damage = max(0.0, min(100.0, float(result.get("damage_coverage_pct", 0) or 0)))
    confidence = max(0.0, min(1.0, float(result.get("confidence", 0) or 0)))
    # Keep urgency separate from confidence. Never boost an issue solely because the model is confident.
    weight = CATEGORY_WEIGHTS.get(category, 1.0)
    priority = min(100.0, damage * weight + (15.0 if category == "sewage" else 0.0))
    if result.get("safety_risk") is True:
        priority = max(priority, 75.0)
    severity = "CRITICAL" if priority >= 75 else "MEDIUM" if priority >= 35 else "LOW"
    return {"defect_type": category, "confidence": confidence, "damage_coverage_pct": damage,
            "priority_score": round(priority, 2), "severity": severity}


def _normalise_boxes(boxes: Any) -> List[Dict[str, Any]]:
    if not isinstance(boxes, list):
        return []
    clean = []
    for item in boxes[:30]:
        if not isinstance(item, dict) or not isinstance(item.get("bbox"), list) or len(item["bbox"]) != 4:
            continue
        try:
            coords = [max(0.0, min(1000.0, float(value))) for value in item["bbox"]]
            clean.append({"label": str(item.get("label", "damage"))[:80],
                          "confidence": round(max(0.0, min(1.0, float(item.get("confidence", 0) or 0))), 3),
                          "bbox": coords})
        except (TypeError, ValueError):
            continue
    return clean


@app.get("/health")
def healthcheck() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": APP_TITLE,
        "version": "2.0.0",
        "generic_detector_loaded": model is not None,
        "defect_reasoning_configured": bool(OPENAI_API_KEY),
        "repair_verification_configured": bool(OPENAI_API_KEY),
    }


@app.post("/analyze")
async def analyze_issue(
    file: UploadFile = File(...),
    defect_type: str = Form("unknown"),
    x_civicpulse_ai_token: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    _check_token(x_civicpulse_ai_token)
    category = defect_type.strip().lower()
    if category not in ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unsupported defect category.")
    raw = await file.read(MAX_IMAGE_BYTES + 1)
    image, image_bgr = _load_image(raw)
    quality = _quality_metrics(image_bgr)
    objects = _generic_objects(image_bgr)

    if OPENAI_API_KEY:
        prompt = (
            "You are a conservative civic-infrastructure photo triage assistant. Inspect the supplied photo for the selected category: "
            + category
            + ". Do not infer damage that is not visible. If the image does not clearly show the selected category, return defect_type='unknown' "
            "and low confidence. This is triage, not a final municipal decision. Do not use EXIF or assume location. "
            "Return ONLY JSON with keys: defect_type (pothole|garbage|sewage|streetlight|unknown), confidence (0..1), "
            "damage_coverage_pct (0..100), safety_risk (boolean), summary (short), visible_evidence (array of short strings), "
            "recommended_action (short), human_review_required (boolean), bounding_boxes (array of {label,confidence,bbox}). "
            "bbox must be [x1,y1,x2,y2] in normalized 0..1000 coordinates. Only include boxes for visible issue evidence. "
            "priority is not supplied; compute it in the server. If uncertain, use confidence below 0.6 and require human review."
        )
        try:
            result = await _openai_vision([{
                "role": "user",
                "content": [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": _data_url(image), "detail": "high"}}],
            }])
            priority = _priority_from_ai(result, category)
            result.update(priority)
            normalised = _normalise_analysis(result, category, quality)
            normalised["generic_objects"] = objects
            normalised["image_quality"]["quality_flags"] = quality["quality_flags"]
            return normalised
        except Exception as exc:
            # Do not silently turn a provider failure into a positive damage classification.
            fallback = _fallback_analysis(category, quality, objects)
            fallback["provider_error"] = str(exc)[:160]
            return fallback

    return _fallback_analysis(category, quality, objects)


@app.post("/verify-resolution")
async def verify_resolution(
    before: UploadFile = File(...),
    after: UploadFile = File(...),
    x_civicpulse_ai_token: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    _check_token(x_civicpulse_ai_token)
    before_raw = await before.read(MAX_IMAGE_BYTES + 1)
    after_raw = await after.read(MAX_IMAGE_BYTES + 1)
    before_image, before_bgr = _load_image(before_raw)
    after_image, after_bgr = _load_image(after_raw)
    before_quality = _quality_metrics(before_bgr)
    after_quality = _quality_metrics(after_bgr)
    if not OPENAI_API_KEY:
        return {
            "status": "unavailable",
            "is_resolved": False,
            "resolution_score": 0,
            "before_image_quality": before_quality,
            "after_image_quality": after_quality,
            "reason": "OPENAI_API_KEY is not configured; automated repair verification is disabled.",
            "human_review_required": True,
        }

    prompt = (
        "Compare the BEFORE and AFTER photos of the same reported civic issue. Decide whether the visible defect is convincingly repaired. "
        "Do not infer repair merely because the images differ, camera angle/lighting changed, or the defect is not visible in the after photo. "
        "If photos do not show comparable scenes or evidence is ambiguous, is_resolved must be false. A human municipal reviewer has final authority. "
        "Return ONLY JSON with keys: is_resolved (boolean), confidence (0..1), resolution_score (0..100), before_damage_pct (0..100), "
        "after_damage_pct (0..100), visible_change (short), evidence (array of short strings), human_review_required (boolean). "
        "Only set is_resolved true when the defect appears clearly repaired and confidence >= 0.85."
    )
    try:
        result = await _openai_vision([{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "text", "text": "BEFORE photo:"},
                {"type": "image_url", "image_url": {"url": _data_url(before_image), "detail": "high"}},
                {"type": "text", "text": "AFTER photo:"},
                {"type": "image_url", "image_url": {"url": _data_url(after_image), "detail": "high"}},
            ],
        }], max_tokens=700)
    except Exception as exc:
        return {
            "status": "unavailable", "is_resolved": False, "resolution_score": 0,
            "before_image_quality": before_quality, "after_image_quality": after_quality,
            "reason": str(exc)[:160], "human_review_required": True,
        }

    confidence = max(0.0, min(1.0, float(result.get("confidence", 0) or 0)))
    score = max(0.0, min(100.0, float(result.get("resolution_score", 0) or 0)))
    before_damage = max(0.0, min(100.0, float(result.get("before_damage_pct", 0) or 0)))
    after_damage = max(0.0, min(100.0, float(result.get("after_damage_pct", 0) or 0)))
    # A model verdict is evidence for staff, not sole legal/operational authority.
    verified = bool(result.get("is_resolved") is True and confidence >= 0.85 and score >= 85
                     and before_quality["quality"] != "poor" and after_quality["quality"] != "poor")
    return {
        "status": "success",
        "is_resolved": verified,
        "confidence": round(confidence, 3),
        "resolution_score": round(score, 2),
        "before_damage_pct": round(before_damage, 2),
        "after_damage_pct": round(after_damage, 2),
        "visible_change": str(result.get("visible_change", ""))[:500],
        "evidence": [str(x)[:180] for x in result.get("evidence", [])[:8] if isinstance(x, str)],
        "before_image_quality": before_quality,
        "after_image_quality": after_quality,
        "human_review_required": not verified or bool(result.get("human_review_required", True)),
        "limitations": ["AI comparison is assistive evidence; staff must inspect the photos and confirm the repair."],
    }
