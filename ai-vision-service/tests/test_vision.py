"""Regression tests for CivicPulse's image-analysis safety and normalization."""
import os
import unittest
from io import BytesIO

# Avoid downloading the generic YOLO weights during unit tests. The service intentionally
# degrades to quality-only mode when this optional detector is unavailable.
os.environ["YOLO_MODEL_PATH"] = "/tmp/civicpulse-test-model-does-not-exist.pt"
os.environ.pop("OPENAI_API_KEY", None)
os.environ.pop("VISION_API_TOKEN", None)

from fastapi import HTTPException
from PIL import Image

from app import main


class VisionNormalizationTests(unittest.TestCase):
    def setUp(self):
        self.quality = {
            "width": 640, "height": 480, "blur_score": 120.0,
            "brightness": 110.0, "contrast": 40.0,
            "quality": "good", "quality_flags": [],
        }

    def test_bbox_1000_scale_is_scaled_before_clamping(self):
        result = main._normalise_analysis({
            "defect_type": "pothole",
            "confidence": 0.91,
            "bounding_boxes": [{"label": "pothole", "confidence": 0.8,
                                "bbox": [100, 200, 600, 700]}],
            "visible_evidence": ["visible road cavity"],
        }, "pothole", self.quality)
        self.assertEqual(result["bounding_boxes"][0]["bbox"], [0.1, 0.2, 0.6, 0.7])
        self.assertEqual(result["visible_evidence"], ["visible road cavity"])

    def test_unit_normalized_bbox_is_preserved(self):
        result = main._normalise_analysis({
            "bounding_boxes": [{"bbox": [0.1, 0.2, 0.6, 0.7]}],
        }, "pothole", self.quality)
        self.assertEqual(result["bounding_boxes"][0]["bbox"], [0.1, 0.2, 0.6, 0.7])

    def test_reversed_or_out_of_range_bbox_is_discarded(self):
        result = main._normalise_analysis({
            "bounding_boxes": [
                {"bbox": [0.8, 0.2, 0.1, 0.7]},
                {"bbox": [0, 0, 1001, 500]},
                {"bbox": [0, 0, float("nan"), 1]},
            ],
        }, "pothole", self.quality)
        self.assertEqual(result["bounding_boxes"], [])

    def test_malformed_evidence_does_not_turn_string_into_characters(self):
        result = main._normalise_analysis({
            "visible_evidence": "not an array",
        }, "pothole", self.quality)
        self.assertEqual(result["visible_evidence"], [])

    def test_poor_quality_forces_human_review_even_if_model_says_no(self):
        poor_quality = {**self.quality, "quality": "poor", "quality_flags": ["blurry", "too_dark"]}
        result = main._normalise_analysis({
            "confidence": 0.99,
            "human_review_required": False,
        }, "pothole", poor_quality)
        self.assertTrue(result["human_review_required"])

    def test_non_finite_confidence_defaults_to_zero(self):
        result = main._normalise_analysis({
            "confidence": float("nan"),
            "damage_coverage_pct": float("inf"),
            "priority_score": float("nan"),
        }, "pothole", self.quality)
        self.assertEqual(result["confidence"], 0.0)
        self.assertEqual(result["damage_coverage_pct"], 0.0)
        self.assertEqual(result["priority_score"], 0.0)

    def test_non_finite_damage_does_not_escalate_priority(self):
        result = main._priority_from_ai({
            "defect_type": "pothole",
            "damage_coverage_pct": float("nan"),
            "confidence": float("inf"),
        }, "pothole")
        self.assertEqual(result["priority_score"], 0.0)
        self.assertEqual(result["confidence"], 0.0)
        self.assertEqual(result["severity"], "LOW")

    def test_category_is_sanitized(self):
        result = main._normalise_analysis({
            "defect_type": "made-up-category",
        }, "pothole", self.quality)
        self.assertEqual(result["defect_type"], "unknown")

    def test_unknown_model_category_is_not_promoted_to_requested_category(self):
        result = main._priority_from_ai({
            "defect_type": "invented-label",
            "damage_coverage_pct": 50,
            "confidence": 0.9,
        }, "pothole")
        self.assertEqual(result["defect_type"], "unknown")
        self.assertEqual(result["priority_score"], 50.0)

    def test_sewage_safety_priority_is_critical(self):
        result = main._priority_from_ai({
            "defect_type": "sewage",
            "damage_coverage_pct": 50,
            "confidence": 0.9,
        }, "sewage")
        self.assertEqual(result["priority_score"], 90.0)
        self.assertEqual(result["severity"], "CRITICAL")

    def test_resolution_requires_substantial_damage_reduction(self):
        before = {**self.quality, "quality": "good"}
        after = {**self.quality, "quality": "good"}
        model_result = {"is_resolved": True}
        self.assertTrue(main._resolution_passes(model_result, 0.95, 92, 40, 5, before, after))
        self.assertFalse(main._resolution_passes(model_result, 0.95, 92, 40, 35, before, after))

    def test_resolution_rejects_poor_quality_evidence(self):
        before = {**self.quality, "quality": "poor"}
        after = {**self.quality, "quality": "good"}
        self.assertFalse(main._resolution_passes({"is_resolved": True}, 0.99, 99, 50, 2, before, after))

    def test_resolution_rejects_nonfinite_confidence(self):
        before = {**self.quality, "quality": "good"}
        after = {**self.quality, "quality": "good"}
        confidence = main._bounded_number(float("nan"), 0.0, 1.0)
        self.assertFalse(main._resolution_passes({"is_resolved": True}, confidence, 99, 50, 2, before, after))

    def test_invalid_image_bytes_are_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            main._load_image(b"not an image")
        self.assertEqual(raised.exception.status_code, 400)

    def test_image_over_byte_limit_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            main._load_image(b"x" * (main.MAX_IMAGE_BYTES + 1))
        self.assertEqual(raised.exception.status_code, 413)

    def test_image_over_dimension_limit_is_rejected(self):
        stream = BytesIO()
        Image.new("RGB", (6001, 1), "white").save(stream, format="PNG")
        with self.assertRaises(HTTPException) as raised:
            main._load_image(stream.getvalue())
        self.assertEqual(raised.exception.status_code, 400)

    def test_missing_service_token_fails_closed(self):
        from unittest.mock import patch
        with patch.object(main, "VISION_API_TOKEN", ""):
            with self.assertRaises(HTTPException) as raised:
                main._check_token(None)
        self.assertEqual(raised.exception.status_code, 503)

    def test_wrong_service_token_is_rejected(self):
        from unittest.mock import patch
        with patch.object(main, "VISION_API_TOKEN", "expected-token"):
            with self.assertRaises(HTTPException) as raised:
                main._check_token("wrong-token")
        self.assertEqual(raised.exception.status_code, 401)

    def test_correct_service_token_is_accepted(self):
        from unittest.mock import patch
        with patch.object(main, "VISION_API_TOKEN", "expected-token"):
            self.assertIsNone(main._check_token("expected-token"))

    def test_valid_image_is_loaded_and_converted(self):
        stream = BytesIO()
        Image.new("RGB", (640, 480), "blue").save(stream, format="PNG")
        image, bgr = main._load_image(stream.getvalue())
        self.assertEqual(image.size, (640, 480))
        self.assertEqual(tuple(bgr.shape), (480, 640, 3))

    def test_dark_low_contrast_image_is_flagged_for_review(self):
        image = Image.new("RGB", (640, 480), (0, 0, 0))
        array = __import__("numpy").asarray(image)
        import cv2
        bgr = cv2.cvtColor(array, cv2.COLOR_RGB2BGR)
        quality = main._quality_metrics(bgr)
        self.assertIn("too_dark", quality["quality_flags"])
        self.assertIn("low_contrast", quality["quality_flags"])
        self.assertEqual(quality["quality"], "poor")


if __name__ == "__main__":
    unittest.main()
