import unittest

from app.main import _normalise_analysis, _priority_from_ai


class ImageTriageIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.good_quality = {
            "width": 1280,
            "height": 720,
            "blur_score": 120.0,
            "brightness": 110.0,
            "contrast": 45.0,
            "quality": "good",
            "quality_flags": [],
        }

    def test_qwen_analysis_is_always_marked_for_human_review(self):
        result = _normalise_analysis({
            "defect_type": "pothole",
            "confidence": 0.99,
            "severity": "MEDIUM",
            "damage_coverage_pct": 12,
            "summary": "Visible road damage",
            "human_review_required": False,
        }, "pothole", self.good_quality)

        self.assertEqual(result["defect_type"], "pothole")
        self.assertEqual(result["confidence"], 0.99)
        self.assertTrue(result["human_review_required"])

    def test_model_bounding_boxes_are_normalized_to_zero_to_one(self):
        result = _normalise_analysis({
            "defect_type": "pothole",
            "confidence": 0.9,
            "bounding_boxes": [
                {"label": "pothole", "confidence": 0.9, "bbox": [100, 200, 700, 800]},
                {"label": "invalid", "confidence": 0.8, "bbox": [900, 800, 200, 100]},
                {"label": "out-of-range", "confidence": 0.8, "bbox": [-1, 0, 500, 500]},
            ],
        }, "pothole", self.good_quality)

        self.assertEqual(len(result["bounding_boxes"]), 1)
        self.assertEqual(result["bounding_boxes"][0]["bbox"], [0.1, 0.2, 0.7, 0.8])

    def test_unknown_model_category_is_safely_normalized(self):
        result = _normalise_analysis({
            "defect_type": "unrelated",
            "confidence": 0.8,
            "human_review_required": False,
        }, "pothole", self.good_quality)

        self.assertEqual(result["defect_type"], "unknown")
        self.assertTrue(result["human_review_required"])

    def test_priority_is_computed_server_side_not_from_confidence(self):
        low_confidence = _priority_from_ai({
            "defect_type": "sewage",
            "confidence": 0.2,
            "damage_coverage_pct": 10,
            "safety_risk": False,
        }, "sewage")
        high_confidence = _priority_from_ai({
            "defect_type": "sewage",
            "confidence": 0.99,
            "damage_coverage_pct": 10,
            "safety_risk": False,
        }, "sewage")

        self.assertEqual(low_confidence["priority_score"], high_confidence["priority_score"])
        self.assertEqual(low_confidence["priority_score"], 30.0)

    def test_safety_risk_can_raise_server_priority(self):
        result = _priority_from_ai({
            "defect_type": "pothole",
            "confidence": 0.4,
            "damage_coverage_pct": 1,
            "safety_risk": True,
        }, "pothole")

        self.assertGreaterEqual(result["priority_score"], 75.0)
        self.assertEqual(result["severity"], "CRITICAL")


if __name__ == "__main__":
    unittest.main()
