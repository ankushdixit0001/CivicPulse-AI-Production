from types import SimpleNamespace

import numpy as np

from app import main


class Scalar:
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


class Box:
    def __init__(self, class_id=0, confidence=0.91, xyxy=(10, 20, 110, 120)):
        self.cls = [Scalar(class_id)]
        self.conf = [Scalar(confidence)]
        self.xyxy = [SimpleNamespace(tolist=lambda: list(xyxy))]


class FakeDetector:
    def __init__(self, names, boxes):
        self.names = names
        self._boxes = boxes

    def predict(self, **kwargs):
        return [SimpleNamespace(names=self.names, boxes=self._boxes)]


def test_category_registry_runs_only_requested_model(monkeypatch):
    pothole = FakeDetector({0: "pothole"}, [Box()])
    garbage = FakeDetector({0: "trash"}, [Box()])
    monkeypatch.setattr(main, "civic_models", {"pothole": pothole, "garbage": garbage})
    monkeypatch.setattr(main, "civic_model", None)
    image = np.zeros((200, 200, 3), dtype=np.uint8)

    detections = main._civic_defect_detections(image, "pothole")

    assert len(detections) == 1
    assert detections[0]["label"] == "pothole"
    assert detections[0]["bbox"] == [0.05, 0.1, 0.55, 0.6]


def test_unknown_category_combines_configured_models(monkeypatch):
    pothole = FakeDetector({0: "pothole"}, [Box()])
    garbage = FakeDetector({0: "trash"}, [Box(confidence=0.82)])
    monkeypatch.setattr(main, "civic_models", {"pothole": pothole, "garbage": garbage})
    monkeypatch.setattr(main, "civic_model", None)
    image = np.zeros((200, 200, 3), dtype=np.uint8)

    detections = main._civic_defect_detections(image, "unknown")

    assert {item["label"] for item in detections} == {"pothole", "garbage"}


def test_garbage_model_requires_explicit_class_alias(monkeypatch):
    detector = FakeDetector({0: "plastic_bottle"}, [Box()])
    monkeypatch.setattr(main, "civic_models", {"garbage": detector})
    monkeypatch.setattr(main, "civic_model", None)
    monkeypatch.setitem(main.YOLO_MODEL_SPECS["garbage"], "labels", set())
    image = np.zeros((200, 200, 3), dtype=np.uint8)

    assert main._civic_defect_detections(image, "garbage") == []


def test_missing_boxes_are_safe(monkeypatch):
    detector = FakeDetector({0: "pothole"}, None)
    monkeypatch.setattr(main, "civic_models", {"pothole": detector})
    monkeypatch.setattr(main, "civic_model", None)
    image = np.zeros((200, 200, 3), dtype=np.uint8)

    assert main._civic_defect_detections(image, "pothole") == []
