#!/usr/bin/env python3
"""Verify a deployed CivicPulse AI Vision Service without printing secrets.

Examples:
  VISION_API_TOKEN='...' python scripts/smoke_test.py --base-url https://your-service.onrender.com
  VISION_API_TOKEN='...' python scripts/smoke_test.py --base-url https://your-service.onrender.com --image ./sample-pothole.jpg
  VISION_API_TOKEN='...' python scripts/smoke_test.py --base-url https://your-service.onrender.com --before ./before.jpg --after ./after.jpg

The script uses a supplied image for vision checks. Text chat alone does not prove vision support.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, Tuple


def _request(url: str, data: bytes | None = None, headers: Dict[str, str] | None = None, timeout: float = 55) -> Tuple[int, Any]:
    request = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            body = response.read()
    except urllib.error.HTTPError as exc:
        status = exc.code
        body = exc.read()
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"Request failed ({type(exc).__name__}); check service URL, network and timeout.") from None

    try:
        return status, json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return status, {"body_preview": body[:200].decode("utf-8", errors="replace")}


def _multipart(fields: Dict[str, str], files: Dict[str, Path]) -> Tuple[bytes, str]:
    boundary = "----CivicPulseSmoke" + uuid.uuid4().hex
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            value.encode("utf-8"),
            b"\r\n",
        ])
    for field_name, path in files.items():
        data = path.read_bytes()
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{field_name}"; filename="{path.name}"\r\n'.encode(),
            f"Content-Type: {mime}\r\n\r\n".encode(),
            data,
            b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def _post_form(url: str, fields: Dict[str, str], token: str) -> Tuple[int, Any]:
    data, content_type = _multipart(fields, {})
    return _request(url, data, {
        "Content-Type": content_type,
        "x-civicpulse-ai-token": token,
    })


def _post_files(url: str, fields: Dict[str, str], files: Dict[str, Path], token: str) -> Tuple[int, Any]:
    data, content_type = _multipart(fields, files)
    return _request(url, data, {
        "Content-Type": content_type,
        "x-civicpulse-ai-token": token,
    })


def _print_result(name: str, status: int, result: Any) -> bool:
    if not isinstance(result, dict):
        print(f"{name}: HTTP {status}, unexpected response type")
        return False
    print(f"\n{name}: HTTP {status}")
    safe: Dict[str, Any] = {}
    for key in (
        "status", "service", "version", "provider", "model", "model_source",
        "defect_reasoning_configured", "repair_verification_configured",
        "capabilities", "defect_type", "confidence", "severity", "priority_score",
        "damage_coverage_pct", "is_resolved", "resolution_score",
        "human_review_required", "reason", "reply",
    ):
        if key in result:
            safe[key] = result[key]
    print(json.dumps(safe or {"response_keys": list(result)[:25]}, indent=2, ensure_ascii=False))
    return 200 <= status < 300


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.getenv("AI_SERVICE_URL", ""), help="Base URL of deployed FastAPI service")
    parser.add_argument("--token", default=os.getenv("VISION_API_TOKEN", ""), help="Internal service token; preferably use env var")
    parser.add_argument("--image", type=Path, help="Real civic photo for /analyze")
    parser.add_argument("--defect-type", default="pothole", choices=["pothole", "garbage", "sewage", "streetlight", "unknown"])
    parser.add_argument("--before", type=Path, help="Before-repair evidence photo")
    parser.add_argument("--after", type=Path, help="After-repair evidence photo")
    args = parser.parse_args()

    if not args.base_url:
        parser.error("Set --base-url or AI_SERVICE_URL.")
    base = args.base_url.rstrip("/")
    before_after = bool(args.before or args.after)
    if before_after and not (args.before and args.after):
        parser.error("Provide both --before and --after.")
    for path in [args.image, args.before, args.after]:
        if path and (not path.is_file() or path.stat().st_size == 0):
            parser.error(f"Image is missing or empty: {path}")

    passed = True
    try:
        code, result = _request(base + "/health")
        passed = _print_result("health", code, result) and passed
    except RuntimeError as exc:
        print(f"health: FAILED — {exc}")
        return 2

    if not args.token:
        print("\nNo service token supplied; protected AI routes were not tested.")
        print("Set VISION_API_TOKEN privately and rerun this smoke test to validate actual provider calls.")
        # Exit non-zero so a health-only check cannot be mistaken for a full smoke test.
        return 2

    headers_token = args.token
    try:
        code, result = _post_form(base + "/chat", {
            "message": "Reply with a short JSON-compatible status that the CivicPulse help chat is reachable.",
            "context": "",
        }, headers_token)
        passed = _print_result("chat", code, result) and passed
        if not isinstance(result, dict) or result.get("status") != "success" or not result.get("reply"):
            passed = False

        if args.image:
            code, result = _post_files(base + "/analyze", {
                "defect_type": args.defect_type,
            }, {"file": args.image}, headers_token)
            passed = _print_result("vision_analysis", code, result) and passed
            if not isinstance(result, dict) or result.get("status") != "success":
                passed = False
        else:
            print("\nvision_analysis: SKIPPED — supply --image to prove image-provider compatibility.")

        if before_after:
            code, result = _post_files(base + "/verify-resolution", {}, {
                "before": args.before,
                "after": args.after,
            }, headers_token)
            passed = _print_result("repair_verification", code, result) and passed
            if not isinstance(result, dict) or result.get("status") != "success":
                passed = False
        else:
            print("repair_verification: SKIPPED — supply both --before and --after to test comparison.")
    except RuntimeError as exc:
        print(f"\nSmoke test request failed — {exc}")
        return 2

    print("\nRESULT:", "PASS for requested capabilities" if passed else "FAIL — inspect provider/configuration status above.")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
