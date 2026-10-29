from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx


class ProviderUnavailable(RuntimeError):
    """Safe, user-facing error raised when no configured provider can serve a task."""

    def __init__(self, message: str, code: str = "provider_unavailable") -> None:
        super().__init__(message)
        self.code = code


_PROVIDER_STATE: Dict[str, Dict[str, Any]] = {
    "gemini": {"last_success_at": None, "last_success_task": None, "last_latency_ms": None, "last_error_code": None},
    "openrouter": {"last_success_at": None, "last_success_task": None, "last_latency_ms": None, "last_error_code": None},
    "openai": {"last_success_at": None, "last_success_task": None, "last_latency_ms": None, "last_error_code": None},
}
IMAGE_TASKS = {"image_triage", "repair_verification"}
TEXT_TASKS = {"chat", "translation", "health_probe"}


def _enabled(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _priority() -> List[str]:
    raw = os.getenv("AI_PROVIDER_PRIORITY", "gemini,openrouter,openai")
    values = [item.strip().lower() for item in raw.split(",") if item.strip()]
    supported = {"gemini", "openrouter", "openai"}
    ordered = [name for name in values if name in supported]
    for name in ("gemini", "openrouter", "openai"):
        if name not in ordered:
            ordered.append(name)
    return ordered


def _policy_allows(task: str) -> bool:
    if task in IMAGE_TASKS:
        return _enabled("ALLOW_EXTERNAL_IMAGE_AI", False)
    return _enabled("ALLOW_EXTERNAL_TEXT_AI", False)


def _key_for(provider: str) -> str:
    env_name = {"gemini": "GEMINI_API_KEY", "openrouter": "OPENROUTER_API_KEY", "openai": "OPENAI_API_KEY"}[provider]
    return os.getenv(env_name, "").strip()


def _model_for(provider: str, contains_image: bool) -> str:
    if provider == "gemini":
        return os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()
    if provider == "openrouter":
        if contains_image:
            return os.getenv("OPENROUTER_VISION_MODEL", "nvidia/nemotron-3.5-super-vl:free").strip()
        return os.getenv("OPENROUTER_CHAT_MODEL", "nvidia/nemotron-3.5-super-vl:free").strip()
    return os.getenv("OPENAI_VISION_MODEL", "gpt-4.1-mini").strip()


def _message_has_image(messages: List[Dict[str, Any]]) -> bool:
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if isinstance(part, dict) and (part.get("type") == "image_url" or "inline_data" in part or "image" in part):
                return True
    return False


def _extract_json(content: Any) -> Dict[str, Any]:
    if isinstance(content, list):
        text_parts = []
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                text_parts.append(part["text"])
        content = "\n".join(text_parts)
    if not isinstance(content, str) or not content.strip():
        raise ProviderUnavailable("The AI provider returned an empty result.", "empty_response")
    cleaned = content.strip()
    cleaned = re.sub(r"^\s*```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ProviderUnavailable("The AI provider returned invalid structured data.", "invalid_json")
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ProviderUnavailable("The AI provider returned invalid structured data.", "invalid_json") from exc
    if not isinstance(parsed, dict):
        raise ProviderUnavailable("The AI provider returned an unexpected result shape.", "invalid_json")
    return parsed


def _data_url_parts(url: str) -> Tuple[str, str]:
    if not url.startswith("data:") or "," not in url:
        raise ProviderUnavailable("Only validated inline image data is supported.", "invalid_image_payload")
    metadata, data = url.split(",", 1)
    mime = metadata[5:].split(";", 1)[0].strip().lower()
    if "base64" not in metadata.lower() or mime not in {"image/jpeg", "image/png", "image/webp"}:
        raise ProviderUnavailable("Unsupported inline image type.", "invalid_image_payload")
    return mime, data


def _to_gemini_part(part: Dict[str, Any]) -> Dict[str, Any]:
    if part.get("type") == "text" and isinstance(part.get("text"), str):
        return {"text": part["text"]}
    if part.get("type") == "image_url" and isinstance(part.get("image_url"), dict):
        url = str(part["image_url"].get("url", ""))
        mime, data = _data_url_parts(url)
        return {"inline_data": {"mime_type": mime, "data": data}}
    if isinstance(part.get("text"), str):
        return {"text": part["text"]}
    raise ProviderUnavailable("Unsupported message content for Gemini.", "invalid_payload")


def build_gemini_payload(messages: List[Dict[str, Any]], max_tokens: int = 900) -> Dict[str, Any]:
    system_parts: List[Dict[str, str]] = []
    contents: List[Dict[str, Any]] = []
    for message in messages:
        role = str(message.get("role", "user")).lower()
        content = message.get("content", "")
        if role == "system":
            if isinstance(content, str) and content.strip():
                system_parts.append({"text": content})
            elif isinstance(content, list):
                system_parts.extend({"text": str(p.get("text", ""))} for p in content if isinstance(p, dict) and p.get("text"))
            continue
        gemini_role = "model" if role == "assistant" else "user"
        parts: List[Dict[str, Any]] = []
        if isinstance(content, str):
            parts.append({"text": content})
        elif isinstance(content, list):
            parts.extend(_to_gemini_part(part) for part in content if isinstance(part, dict))
        if parts:
            contents.append({"role": gemini_role, "parts": parts})
    payload: Dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": max(32, min(int(max_tokens), 4096)),
            "responseMimeType": "application/json",
        },
    }
    if system_parts:
        payload["systemInstruction"] = {"parts": system_parts}
    return payload


def _provider_error_code(status_code: Optional[int]) -> str:
    if status_code == 429:
        return "provider_rate_limited"
    if status_code in (401, 403):
        return "provider_auth_failed"
    if status_code is not None and status_code >= 500:
        return "provider_server_error"
    if status_code is not None:
        return "provider_request_rejected"
    return "provider_transport_error"


async def _request_json(provider: str, messages: List[Dict[str, Any]], max_tokens: int) -> Dict[str, Any]:
    model = _model_for(provider, _message_has_image(messages))
    timeout = httpx.Timeout(
        float(os.getenv("AI_PROVIDER_TIMEOUT_SECONDS", "35")),
        connect=float(os.getenv("AI_PROVIDER_CONNECT_TIMEOUT_SECONDS", "8")),
    )
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        if provider == "gemini":
            key = _key_for(provider)
            if not key:
                raise ProviderUnavailable("Gemini is not configured.", "not_configured")
            if not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", model):
                raise ProviderUnavailable("The configured Gemini model ID is invalid.", "invalid_model")
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            response = await client.post(
                url,
                headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                json=build_gemini_payload(messages, max_tokens),
            )
            if response.status_code >= 400:
                raise ProviderUnavailable(
                    f"Gemini request failed ({_provider_error_code(response.status_code)}).",
                    _provider_error_code(response.status_code),
                )
            payload = response.json()
            candidates = payload.get("candidates") or []
            parts = (candidates[0].get("content") or {}).get("parts") or [] if candidates else []
            content = "\n".join(str(part.get("text", "")) for part in parts if isinstance(part, dict))
        else:
            key = _key_for(provider)
            if not key:
                raise ProviderUnavailable(f"{provider} is not configured.", "not_configured")
            base_url = "https://openrouter.ai/api/v1/chat/completions" if provider == "openrouter" else "https://api.openai.com/v1/chat/completions"
            headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
            if provider == "openrouter":
                headers["HTTP-Referer"] = os.getenv("OPENROUTER_SITE_URL", "https://civicpulse-ai-production.vercel.app")
                headers["X-Title"] = "CivicPulse AI"
            body: Dict[str, Any] = {
                "model": model,
                "messages": messages,
                "temperature": 0,
                "max_tokens": max(32, min(int(max_tokens), 4096)),
                "response_format": {"type": "json_object"},
            }
            response = await client.post(base_url, headers=headers, json=body)
            if response.status_code >= 400:
                raise ProviderUnavailable(
                    f"{provider} request failed ({_provider_error_code(response.status_code)}).",
                    _provider_error_code(response.status_code),
                )
            payload = response.json()
            content = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
    result = _extract_json(content)
    result["_provider"] = provider
    result["_model"] = model
    return result


def provider_configuration() -> Dict[str, Any]:
    allow_image = _enabled("ALLOW_EXTERNAL_IMAGE_AI", False)
    allow_text = _enabled("ALLOW_EXTERNAL_TEXT_AI", False)
    allow_openrouter_image = _enabled("ALLOW_OPENROUTER_IMAGE_FALLBACK", False)
    allow_openrouter_text = _enabled("ALLOW_OPENROUTER_TEXT_FALLBACK", False)
    providers: Dict[str, Any] = {}
    for name in ("gemini", "openrouter", "openai"):
        configured = bool(_key_for(name))
        allowed_tasks: List[str] = []
        if configured and allow_image and (name != "openrouter" or allow_openrouter_image):
            allowed_tasks.extend(["image_triage", "repair_verification"])
        if configured and allow_text and (name != "openrouter" or allow_openrouter_text):
            allowed_tasks.extend(["chat", "translation", "health_probe"])
        providers[name] = {
            "configured": configured,
            "allowed_tasks": allowed_tasks,
            "last_success_at": _PROVIDER_STATE[name]["last_success_at"],
            "last_success_task": _PROVIDER_STATE[name]["last_success_task"],
            "last_latency_ms": _PROVIDER_STATE[name]["last_latency_ms"],
            "last_error_code": _PROVIDER_STATE[name]["last_error_code"],
            "model": _model_for(name, contains_image=True),
        }
    return {
        "policy": {
            "external_image_ai_enabled": allow_image,
            "external_text_ai_enabled": allow_text,
            "openrouter_image_fallback_enabled": allow_openrouter_image,
            "openrouter_text_fallback_enabled": allow_openrouter_text,
        },
        "providers": providers,
    }


def task_configured(task: str) -> bool:
    if not _policy_allows(task):
        return False
    for provider in _priority():
        if not _key_for(provider):
            continue
        if provider == "openrouter":
            if task in IMAGE_TASKS and not _enabled("ALLOW_OPENROUTER_IMAGE_FALLBACK", False):
                continue
            if task not in IMAGE_TASKS and not _enabled("ALLOW_OPENROUTER_TEXT_FALLBACK", False):
                continue
        return True
    return False


def task_recently_successful(task: str, max_age_seconds: int = 900) -> bool:
    now = time.time()
    for name, state in _PROVIDER_STATE.items():
        if state.get("last_success_task") != task or not state.get("last_success_at"):
            continue
        try:
            last = datetime.fromisoformat(state["last_success_at"].replace("Z", "+00:00")).timestamp()
        except (ValueError, TypeError):
            continue
        if now - last <= max_age_seconds:
            return True
    return False


async def generate_json(messages: List[Dict[str, Any]], max_tokens: int = 900, task: str = "chat") -> Dict[str, Any]:
    contains_image = _message_has_image(messages)
    if contains_image and not _enabled("ALLOW_EXTERNAL_IMAGE_AI", False):
        raise ProviderUnavailable("External image processing is disabled by the current privacy policy.", "external_image_ai_disabled")
    if not contains_image and not _enabled("ALLOW_EXTERNAL_TEXT_AI", False):
        raise ProviderUnavailable("External text processing is disabled by the current privacy policy.", "external_text_ai_disabled")
    last_code = "provider_unavailable"
    attempted = 0
    for provider in _priority():
        if not _key_for(provider):
            continue
        if provider == "openrouter":
            if contains_image and not _enabled("ALLOW_OPENROUTER_IMAGE_FALLBACK", False):
                continue
            if not contains_image and not _enabled("ALLOW_OPENROUTER_TEXT_FALLBACK", False):
                continue
        attempted += 1
        started = time.perf_counter()
        try:
            result = await _request_json(provider, messages, max_tokens)
            state = _PROVIDER_STATE[provider]
            state["last_success_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            state["last_success_task"] = task
            state["last_latency_ms"] = int((time.perf_counter() - started) * 1000)
            state["last_error_code"] = None
            return result
        except ProviderUnavailable as exc:
            last_code = exc.code
            _PROVIDER_STATE[provider]["last_error_code"] = exc.code
        except httpx.TimeoutException:
            last_code = "provider_timeout"
            _PROVIDER_STATE[provider]["last_error_code"] = last_code
        except httpx.HTTPError:
            last_code = "provider_transport_error"
            _PROVIDER_STATE[provider]["last_error_code"] = last_code
        except (ValueError, json.JSONDecodeError):
            last_code = "provider_invalid_response"
            _PROVIDER_STATE[provider]["last_error_code"] = last_code
    if attempted == 0:
        if not _policy_allows(task):
            raise ProviderUnavailable("External AI processing is disabled by policy.", "external_ai_disabled")
        raise ProviderUnavailable("No allowed AI provider key is configured for this task.", "no_provider_configured")
    raise ProviderUnavailable("All configured AI providers failed or rejected the request.", last_code)
