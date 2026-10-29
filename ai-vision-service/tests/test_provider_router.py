import os
import unittest
from unittest.mock import patch

from app import provider_router


class FakeResponse:
    def __init__(self, status_code, content=None):
        self.status_code = status_code
        self._content = content or {}

    def json(self):
        return self._content


class FakeClient:
    responses = []
    calls = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, endpoint, **kwargs):
        self.__class__.calls.append((endpoint, kwargs))
        return self.__class__.responses.pop(0)


class ProviderRouterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeClient.responses = []
        FakeClient.calls = []
        for name, state in provider_router._STATE.items():
            state.update({
                "status": "unknown",
                "provider": None,
                "model": None,
                "last_checked_at": None,
                "last_success_at": None,
                "reason": "No successful request has been recorded.",
            })

    def test_keyless_provider_is_configured_but_not_claimed_healthy(self):
        env = {
            "LLMFAUCET_ENABLED": "true",
            "AI_PROVIDER_ORDER": "llmfaucet",
        }
        with patch.dict(os.environ, env, clear=True):
            providers = provider_router.configured_providers()
            self.assertEqual([item.provider_id for item in providers], ["llmfaucet"])
            health = provider_router.capability_health()
            self.assertTrue(health["vision_analysis"]["configured"])
            self.assertFalse(health["vision_analysis"]["available"])
            self.assertEqual(health["vision_analysis"]["status"], "unknown")

    def test_json_parser_rejects_non_object_responses(self):
        with self.assertRaises(ValueError):
            provider_router._extract_json("plain text, no JSON")
        with self.assertRaises(ValueError):
            provider_router._extract_json("[1, 2, 3]")

    async def test_provider_fallbacks_after_rate_limit_and_returns_actual_provider(self):
        env = {
            "GEMINI_API_KEY": "test-only",
            "GEMINI_MODEL": "test-gemini",
            "LLMFAUCET_ENABLED": "true",
            "LLMFAUCET_MODEL": "test-free",
            "AI_PROVIDER_ORDER": "gemini,llmfaucet",
        }
        FakeClient.responses = [
            FakeResponse(429, {}),
            FakeResponse(200, {
                "choices": [{
                    "message": {
                        "content": '{"reply":"Test response","confidence":0.91}'
                    }
                }]
            }),
        ]
        with patch.dict(os.environ, env, clear=True):
            with patch.object(provider_router.httpx, "AsyncClient", FakeClient):
                result, provider_id, model_id = await provider_router.complete_json(
                    messages=[{"role": "user", "content": "test"}],
                    max_tokens=100,
                    capability="chat",
                )
        self.assertEqual(result["reply"], "Test response")
        self.assertEqual(provider_id, "llmfaucet")
        self.assertEqual(model_id, "test-free")
        self.assertEqual(len(FakeClient.calls), 2)
        self.assertTrue(provider_router.capability_health()["chat"]["available"])

    async def test_all_provider_errors_return_safe_failure(self):
        env = {
            "LLMFAUCET_ENABLED": "true",
            "AI_PROVIDER_ORDER": "llmfaucet",
        }
        FakeClient.responses = [FakeResponse(503, {"error": "private upstream detail"})]
        with patch.dict(os.environ, env, clear=True):
            with patch.object(provider_router.httpx, "AsyncClient", FakeClient):
                with self.assertRaisesRegex(RuntimeError, "AI providers unavailable for chat"):
                    await provider_router.complete_json(
                        messages=[{"role": "user", "content": "test"}],
                        max_tokens=100,
                        capability="chat",
                    )
        self.assertNotIn("private upstream detail", provider_router.capability_health()["chat"]["reason"])


if __name__ == "__main__":
    unittest.main()
