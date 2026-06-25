"""
Route smoke tests — Phase 1, task 1.4.
Full route tests (Phase 2+) are added incrementally.
"""

import os
import pytest

os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("FLASK_SECRET_KEY", "test-secret")

from app import create_app


@pytest.fixture
def client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_returns_ok_json(self, client):
        response = client.get("/health")
        data = response.get_json()
        assert data == {"status": "ok"}


class TestNotFoundHandler:
    def test_unknown_route_returns_404(self, client):
        response = client.get("/this-route-does-not-exist")
        assert response.status_code == 404

    def test_404_response_is_json(self, client):
        response = client.get("/nonexistent")
        data = response.get_json()
        assert data is not None
        assert "error" in data
        assert data.get("code") == "NOT_FOUND"


class TestMissingEnvVars:
    def test_missing_gemini_api_key_raises_on_load(self):
        """Importing config without GEMINI_API_KEY should raise EnvironmentError."""
        import importlib
        import config as cfg_module

        original = os.environ.pop("GEMINI_API_KEY", None)
        try:
            with pytest.raises(EnvironmentError) as exc_info:
                cfg_module.load_config()
            assert "GEMINI_API_KEY" in str(exc_info.value)
        finally:
            if original is not None:
                os.environ["GEMINI_API_KEY"] = original

    def test_missing_flask_secret_key_raises_on_load(self):
        import config as cfg_module

        original = os.environ.pop("FLASK_SECRET_KEY", None)
        try:
            with pytest.raises(EnvironmentError) as exc_info:
                cfg_module.load_config()
            assert "FLASK_SECRET_KEY" in str(exc_info.value)
        finally:
            if original is not None:
                os.environ["FLASK_SECRET_KEY"] = original


# ------------------------------------------------------------------ #
# Phase 2: /api/chat and /api/clear endpoint tests                    #
# ------------------------------------------------------------------ #

from unittest.mock import patch
import gemini_client as gc


class TestApiChatValidation:
    def test_wrong_content_type_returns_415(self, client):
        response = client.post(
            "/api/chat",
            data="hello",
            content_type="text/plain",
        )
        assert response.status_code == 415
        assert response.get_json()["code"] == "UNSUPPORTED_MEDIA_TYPE"

    def test_empty_message_returns_400(self, client):
        response = client.post(
            "/api/chat",
            json={"message": ""},
        )
        assert response.status_code == 400
        assert response.get_json()["code"] == "VALIDATION_ERROR"

    def test_whitespace_only_message_returns_400(self, client):
        response = client.post(
            "/api/chat",
            json={"message": "   "},
        )
        assert response.status_code == 400
        assert response.get_json()["code"] == "VALIDATION_ERROR"

    def test_missing_message_field_returns_400(self, client):
        response = client.post("/api/chat", json={})
        assert response.status_code == 400
        assert response.get_json()["code"] == "VALIDATION_ERROR"

    def test_message_exceeding_2000_chars_returns_400(self, client):
        response = client.post(
            "/api/chat",
            json={"message": "x" * 2001},
        )
        assert response.status_code == 400
        assert response.get_json()["code"] == "VALIDATION_ERROR"


class TestApiChatSuccess:
    def test_valid_message_returns_200_with_reply(self, client):
        with patch.object(gc, "send_message", return_value="Mocked reply"):
            response = client.post("/api/chat", json={"message": "Hello"})
        assert response.status_code == 200
        data = response.get_json()
        assert data["reply"] == "Mocked reply"

    def test_reply_field_present_in_response(self, client):
        with patch.object(gc, "send_message", return_value="AI says hi"):
            response = client.post("/api/chat", json={"message": "Hi"})
        assert "reply" in response.get_json()

    def test_session_history_grows_after_message(self, client):
        with patch.object(gc, "send_message", return_value="Reply"):
            client.post("/api/chat", json={"message": "First"})
        with client.session_transaction() as sess:
            assert len(sess.get("history", [])) == 2  # user + model


class TestApiChatErrorHandling:
    def test_auth_error_returns_502(self, client):
        with patch.object(gc, "send_message", side_effect=gc.GeminiAuthError("auth")):
            response = client.post("/api/chat", json={"message": "Hi"})
        assert response.status_code == 502
        assert response.get_json()["code"] == "UPSTREAM_ERROR"

    def test_rate_limit_error_returns_429_with_retry_after(self, client):
        err = gc.GeminiRateLimitError("rate limit", retry_after=30)
        with patch.object(gc, "send_message", side_effect=err):
            response = client.post("/api/chat", json={"message": "Hi"})
        assert response.status_code == 429
        data = response.get_json()
        assert data["code"] == "RATE_LIMIT"
        assert data["retry_after"] == 30

    def test_api_error_returns_502(self, client):
        with patch.object(gc, "send_message", side_effect=gc.GeminiAPIError("err")):
            response = client.post("/api/chat", json={"message": "Hi"})
        assert response.status_code == 502

    def test_timeout_error_returns_502(self, client):
        with patch.object(gc, "send_message", side_effect=gc.GeminiTimeoutError("timeout")):
            response = client.post("/api/chat", json={"message": "Hi"})
        assert response.status_code == 502

    def test_unexpected_exception_returns_500(self, client):
        with patch.object(gc, "send_message", side_effect=RuntimeError("boom")):
            response = client.post("/api/chat", json={"message": "Hi"})
        assert response.status_code == 500
        assert response.get_json()["code"] == "SERVER_ERROR"


class TestApiClear:
    def test_clear_returns_200(self, client):
        response = client.post("/api/clear")
        assert response.status_code == 200
        assert response.get_json()["status"] == "cleared"

    def test_clear_empties_session_history(self, client):
        with patch.object(gc, "send_message", return_value="Reply"):
            client.post("/api/chat", json={"message": "Hello"})
        client.post("/api/clear")
        with client.session_transaction() as sess:
            assert sess.get("history", []) == []
