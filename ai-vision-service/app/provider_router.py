"""Capability-aware routing for OpenAI-compatible chat/vision providers.

Configured is not the same as healthy: availability requires a recent successful
request for the specific capability. Provider errors are sanitized by design.
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("civicpulse.providers")


@dataclass(frozen=True)
class ProviderConfig:
    provider_id: str
    endpoint: str
    api_key: str
    model: str
    supports_text: bool = True
    supports_vision: bool = True


_CAPABILITIES = ("chat", "vision_analysis", "repair_verification")
_STATE: Dict[str, Dict[str, Any]] = {
    key: {
        "status": "unknown",
        "provider": None,
        "model": None,
        "last_checked_at": None,
        "last_success_at": None,
        "reason": "No successful capability-specific request has been recorded in this process.",
    }
    for key in _CAPABILITIES
}
_RECENT_SUCCESS_SECONDS = 15 * 60


def _enabled(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    return default if raw is None else raw.strip().lower() in {"1", "true", "yes", "on"}


def configured_providers() -> List[ProviderConfig]:
    """Return configured providers in operator-selected order."""
    providers: List[ProviderConfig] = []

    # Optional, key-based providers are preferred when configured.
    gemini_key = (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()
    if gemini_key:
        providers.append(ProviderConfig(
            "gemini",
            os.getenv(
                "GEMINI_OPENAI_BASE_URL",
                "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            ).rstrip("/"),
            gemini_key,
            os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip(),
        ))

    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if groq_key:
        providers.append(ProviderConfig(
            "groq",
            os.getenv("GROQ_CHAT_COMPLETIONS_URL", "https://api.groq.com/openai/v1/chat/completions").rstrip("/"),
            groq_key,
            os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b").strip(),
        ))

    # Shared anonymous capacity is for prototype/demo use, never assumed healthy.
    if _enabled("LLMFAUCET_ENABLED", True):
        providers.append(ProviderConfig(
            "llmfaucet",
            os.getenv("LLMFAUCET_CHAT_COMPLETIONS_URL", "https://api.llmfaucet.dev/v1/chat/completions").rstrip("/"),
            (os.getenv("LLMFAUCET_API_KEY") or "free").strip(),
            os.getenv("LLMFAUCET_MODEL", "auto:smart").strip(),
        ))

    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    if openai_key:
        providers.append(ProviderConfig(
            "openai",
            os.getenv("OPENAI_CHAT_COMPLETIONS_URL", "https://api.openai.com/v1/chat/completions").rstrip("/"),
            openai_key,
            os.getenv("OPENAI_VISION_MODEL", "gpt-4.1-mini").strip(),
        ))

    priority = [
        item.strip().lower()
        for item in os.getenv("AI_PROVIDER_ORDER", "gemini,groq,openai,llmfaucet").split(",")
        if item.strip()
    ]
    priority_index = {provider_id: index for index, provider_id in enumerate(priority)}
    return sorted(providers, key=lambda item: priority_index.get(item.provider_id, len(priority_index)))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _record(
    capability: str,
    status: str,
    provider: Optional[str],
    model: Optional[str],
    reason: str = "",
) -> None:
    if capability not in _STATE:
        return
    current = _STATE[capability]
    timestamp = _now()
    current.update({
        "status": status,
        "provider": provider,
        "model": model,
        "last_checked_at": timestamp,
        "reason": reason[:180] if reason else "",
    })
    if status == "available":
        current["last_success_at"] = timestamp


def capability_health() -> Dict[str, Dict[str, Any]]:
    """Return honest per-task status; unknown is not rendered as healthy."""
    configured = configured_providers()
    now = time.time()
    result: Dict[str, Dict[str, Any]] = {}
    for capability in _CAPABILITIES:
        needs_vision = capability in {"vision_analysis", "repair_verification"}
        candidates = [
            item for item in configured
            if item.supports_text and (not needs_vision or item.supports_vision)
        ]
        last = dict(_STATE[capability])
        recent_success = False
        success_at = last.get("last_success_at")
        if success_at:
            try:
                recent_success = now - datetime.fromisoformat(success_at).timestamp() <= _RECENT_SUCCESS_SECONDS
            except (ValueError, TypeError, OSError):
                recent_success = False

        if not candidates:
            status = "unavailable"
            reason = "No provider is configured for this capability."
        elif last.get("status") == "available" and recent_success:
            status = "available"
            reason = ""
        elif last.get("status") == "unavailable":
            status = "unavailable"
            reason = last.get("reason") or "The last request for this capability failed."
        else:
            status = "unknown"
            reason = "Provider configuration exists, but this capability has not passed a recent real request."

        result[capability] = {
            "configured": bool(candidates),
            "available": status == "available",
            "status": status,
            "providers": [item.provider_id for item in candidates],
            "provider": last.get("provider"),
            "model": last.get("model"),
            "last_checked_at": last.get("last_checked_at"),
            "last_success_at": last.get("last_success_at"),
            "reason": reason,
        }
    return result


def _extract_json(content: Any) -> Dict[str, Any]:
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Provider returned empty content.")
    cleaned = content.strip()
    # Handle common Markdown fenced responses without relying on model-specific JSON mode.
    if cleaned.startswith(chr(96) * 3):
        cleaned = cleaned.strip(chr(96))
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Provider response did not contain a JSON object.")
    parsed = json.loads(cleaned[start:end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("Provider JSON must be an object.")
    return parsed


async def complete_json(
    messages: List[Dict[str, Any]],
    max_tokens: int,
    capability: str,
) -> Tuple[Dict[str, Any], str, str]:
    """Try configured providers sequentially; return parsed JSON, provider ID and model."""
    if capability not in _STATE:
        raise ValueError("Unsupported AI capability.")

    candidates = configured_providers()
    if capability in {"vision_analysis", "repair_verification"}:
        candidates = [item for item in candidates if item.supports_vision]

    if not candidates:
        _record(capability, "unavailable", None, None, "No provider is configured.")
        raise RuntimeError("No AI provider is configured for this capability.")

    failures: List[str] = []
    try:
        per_provider_timeout = float(os.getenv("AI_PROVIDER_TIMEOUT_SECONDS", "14"))
    except ValueError:
        per_provider_timeout = 14.0
    per_provider_timeout = max(5.0, min(per_provider_timeout, 18.0))
    try:
        total_timeout = float(os.getenv("AI_PROVIDER_TOTAL_TIMEOUT_SECONDS", "40"))
    except ValueError:
        total_timeout = 40.0
    deadline = time.monotonic() + max(8.0, min(total_timeout, 40.0))

    for provider in candidates:
        remaining = deadline - time.monotonic()
        if remaining < 2.0:
            failures.append("fallback_budget_exhausted")
            break
        timeout_seconds = min(per_provider_timeout, remaining)
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(timeout_seconds, connect=min(5.0, timeout_seconds))
            ) as client:
                response = await client.post(
                    provider.endpoint,
                    headers={
                        "Authorization": "Bearer " + provider.api_key,
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": provider.model,
                        "temperature": 0,
                        "max_tokens": max_tokens,
                        "response_format": {"type": "json_object"},
                        "messages": messages,
                    },
                )

            if response.status_code >= 400:
                code = response.status_code
                reason = "provider_rate_limited" if code == 429 else (
                    "provider_upstream_error" if code >= 500 else "provider_request_rejected"
                )
                failures.append(provider.provider_id + ":" + reason)
                _record(capability, "unavailable", provider.provider_id, provider.model, reason)
                logger.warning(
                    "AI provider failed capability=%s provider=%s status=%s",
                    capability, provider.provider_id, code,
                )
                continue

            payload = response.json()
            choices = payload.get("choices") if isinstance(payload, dict) else None
            message = choices[0].get("message", {}) if isinstance(choices, list) and choices else {}
            parsed = _extract_json(message.get("content"))
            _record(capability, "available", provider.provider_id, provider.model)
            logger.info(
                "AI provider succeeded capability=%s provider=%s model=%s",
                capability, provider.provider_id, provider.model,
            )
            return parsed, provider.provider_id, provider.model

        except (httpx.TimeoutException, httpx.NetworkError):
            failures.append(provider.provider_id + ":provider_timeout_or_network")
            _record(capability, "unavailable", provider.provider_id, provider.model, "Provider timeout or network error.")
            logger.warning("AI provider network failure capability=%s provider=%s", capability, provider.provider_id)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            failures.append(provider.provider_id + ":invalid_response")
            _record(capability, "unavailable", provider.provider_id, provider.model, "Provider returned an invalid response.")
            logger.warning("AI provider response failed validation capability=%s provider=%s", capability, provider.provider_id)
        except Exception as exc:
            failures.append(provider.provider_id + ":provider_error")
            _record(capability, "unavailable", provider.provider_id, provider.model, "Provider request failed.")
            logger.warning(
                "AI provider unexpected failure capability=%s provider=%s error_type=%s",
                capability, provider.provider_id, type(exc).__name__,
            )

    _record(capability, "unavailable", None, None, "All configured providers failed for this capability.")
    summary = ", ".join(failures[:4]) if failures else "No compatible provider responded."
    raise RuntimeError("AI providers unavailable for " + capability + ": " + summary)
