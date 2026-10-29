import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.providers import (
    ProviderUnavailable,
    _PROVIDER_STATE,
    _extract_json,
    build_gemini_payload,
    provider_configuration,
    task_configured,
    task_recently_successful,
)


class ProviderPayloadTests(unittest.TestCase):
    def test_gemini_payload_moves_system_message_to_system_instruction(self):
        payload = build_gemini_payload([
            {"role": "system", "content": "Be a careful civic assistant."},
            {"role": "user", "content": "Summarize the issue."},
        ])
        self.assertEqual(payload["systemInstruction"]["parts"][0]["text"], "Be a careful civic assistant.")
        self.assertEqual(payload["contents"][0]["role"], "user")
        self.assertEqual(payload["contents"][0]["parts"][0]["text"], "Summarize the issue.")

    def test_gemini_payload_converts_inline_image_data_url(self):
        payload = build_gemini_payload([{
            "role": "user",
            "content": [
                {"type": "text", "text": "Inspect this photo."},
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,YWJj", "detail": "high"}},
            ],
        }])
        parts = payload["contents"][0]["parts"]
        self.assertEqual(parts[0]["text"], "Inspect this photo.")
        self.assertEqual(parts[1]["inline_data"], {"mime_type": "image/jpeg", "data": "YWJj"})

    def test_gemini_rejects_non_inline_image_url(self):
        with self.assertRaises(ProviderUnavailable):
            build_gemini_payload([{
                "role": "user",
                "content": [{"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}],
            }])

    def test_extracts_json_from_fenced_response(self):
        result = _extract_json(' ```json\n{"reply":"hello"}\n``` ')
        self.assertEqual(result, {"reply": "hello"})

    def test_extracts_json_object_from_surrounding_text(self):
        result = _extract_json('Result follows: {"ok": true} thanks')
        self.assertEqual(result, {"ok": True})

    def test_rejects_non_object_json(self):
        with self.assertRaises(ProviderUnavailable):
            _extract_json('[1, 2, 3]')


class ProviderPolicyTests(unittest.IsolatedAsyncioTestCase):

    def test_recent_success_is_tracked_independently_for_each_task(self):
        state = _PROVIDER_STATE["gemini"]
        previous = dict(state)
        try:
            state["last_success_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            state["last_success_task"] = "chat"
            state["last_success_by_task"] = {
                "chat": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            }
            self.assertTrue(task_recently_successful("chat"))
            self.assertFalse(task_recently_successful("image_triage"))
            state["last_success_by_task"]["image_triage"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            self.assertTrue(task_recently_successful("image_triage"))
            self.assertTrue(task_recently_successful("chat"))
        finally:
            state.clear()
            state.update(previous)

    async def test_provider_router_falls_back_after_rate_limit(self):
        import asyncio
        from unittest.mock import patch
        from app.providers import generate_json

        async def fake_request(provider, messages, max_tokens):
            if provider == "gemini":
                raise ProviderUnavailable("rate limited", "provider_rate_limited")
            return {"reply": "grounded response", "_provider": provider, "_model": "test-model"}

        with patch.dict(os.environ, {
            "ALLOW_EXTERNAL_TEXT_AI": "true",
            "ALLOW_OPENROUTER_TEXT_FALLBACK": "true",
            "AI_PROVIDER_PRIORITY": "gemini,openrouter",
            "GEMINI_API_KEY": "test-gemini-key",
            "OPENROUTER_API_KEY": "test-openrouter-key",
        }, clear=True):
            with patch("app.providers._request_json", side_effect=fake_request):
                result = await generate_json(
                    [{"role": "user", "content": "How do I report a pothole?"}],
                    task="chat",
                )
        self.assertEqual(result["_provider"], "openrouter")
        self.assertEqual(result["reply"], "grounded response")

    async def test_explicit_provider_priority_does_not_enable_unlisted_fallbacks(self):
        from unittest.mock import patch
        from app.providers import generate_json, _priority

        with patch.dict(os.environ, {
            "AI_PROVIDER_PRIORITY": "gemini",
            "GEMINI_API_KEY": "test-gemini-key",
            "OPENROUTER_API_KEY": "test-openrouter-key",
            "ALLOW_EXTERNAL_TEXT_AI": "true",
            "ALLOW_OPENROUTER_TEXT_FALLBACK": "true",
        }, clear=True):
            self.assertEqual(_priority(), ["gemini"])
            async def fake_request(provider, messages, max_tokens):
                raise ProviderUnavailable("gemini unavailable", "provider_rate_limited")
            with patch("app.providers._request_json", side_effect=fake_request):
                with self.assertRaises(ProviderUnavailable):
                    await generate_json([{"role": "user", "content": "hello"}], task="chat")

    async def test_configured_keys_do_not_bypass_disabled_privacy_policy(self):
        from unittest.mock import patch
        from app.providers import generate_json

        with patch.dict(os.environ, {
            "GEMINI_API_KEY": "test-key",
            "ALLOW_EXTERNAL_TEXT_AI": "false",
        }, clear=True):
            with self.assertRaises(ProviderUnavailable) as ctx:
                await generate_json([{"role": "user", "content": "hello"}], task="chat")
        self.assertEqual(ctx.exception.code, "external_text_ai_disabled")

    def test_no_key_is_not_configured_and_policy_defaults_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(task_configured("image_triage"))
            self.assertFalse(task_configured("chat"))
            config = provider_configuration()
            self.assertFalse(config["policy"]["external_image_ai_enabled"])
            self.assertFalse(config["policy"]["external_text_ai_enabled"])
            self.assertFalse(config["providers"]["gemini"]["configured"])

    def test_gemini_requires_key_and_explicit_image_policy(self):
        with patch.dict(os.environ, {
            "GEMINI_API_KEY": "test-only",
            "ALLOW_EXTERNAL_IMAGE_AI": "false",
            "AI_PROVIDER_PRIORITY": "gemini",
        }, clear=True):
            self.assertFalse(task_configured("image_triage"))
        with patch.dict(os.environ, {
            "GEMINI_API_KEY": "test-only",
            "ALLOW_EXTERNAL_IMAGE_AI": "true",
            "AI_PROVIDER_PRIORITY": "gemini",
        }, clear=True):
            self.assertTrue(task_configured("image_triage"))

    def test_openrouter_requires_specific_fallback_policy(self):
        with patch.dict(os.environ, {
            "OPENROUTER_API_KEY": "test-only",
            "ALLOW_EXTERNAL_IMAGE_AI": "true",
            "ALLOW_OPENROUTER_IMAGE_FALLBACK": "false",
            "AI_PROVIDER_PRIORITY": "openrouter",
        }, clear=True):
            self.assertFalse(task_configured("image_triage"))
        with patch.dict(os.environ, {
            "OPENROUTER_API_KEY": "test-only",
            "ALLOW_EXTERNAL_IMAGE_AI": "true",
            "ALLOW_OPENROUTER_IMAGE_FALLBACK": "true",
            "AI_PROVIDER_PRIORITY": "openrouter",
        }, clear=True):
            self.assertTrue(task_configured("image_triage"))


if __name__ == "__main__":
    unittest.main()
