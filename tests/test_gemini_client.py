"""
Unit tests for gemini_client.py — Phase 2, task 2.2.

All tests mock google.genai so no real API calls are made.
The API key is never asserted in test output.
"""

import os
import pytest
from unittest.mock import MagicMock, patch

os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")
os.environ.setdefault("FLASK_SECRET_KEY", "test-flask-secret")

import gemini_client as gc


# ------------------------------------------------------------------ #
# Helpers                                                              #
# ------------------------------------------------------------------ #

def _mock_response(text: str) -> MagicMock:
    """Return a mock Gemini response object with .text set."""
    resp = MagicMock()
    resp.text = text
    return resp


def _make_client_mock(text: str = "Hello from Gemini") -> MagicMock:
    """Return a mock genai.Client whose generate_content returns *text*."""
    client = MagicMock()
    client.models.generate_content.return_value = _mock_response(text)
    return client


@pytest.fixture(autouse=True)
def reset_gc_client():
    """Reset the module-level client before every test."""
    gc._reset_client()
    yield
    gc._reset_client()


# ------------------------------------------------------------------ #
# send_message — happy path                                            #
# ------------------------------------------------------------------ #

class TestSendMessageSuccess:
    def test_returns_response_text(self):
        with patch.object(gc, "_get_client", return_value=_make_client_mock("Hi there!")):
            result = gc.send_message([], "Hello")
        assert result == "Hi there!"

    def test_history_forwarded_to_api(self):
        mock_client = _make_client_mock("OK")
        history = [
            {"role": "user",  "parts": [{"text": "First message"}]},
            {"role": "model", "parts": [{"text": "First reply"}]},
        ]
        with patch.object(gc, "_get_client", return_value=mock_client):
            gc.send_message(history, "Second message")

        call_kwargs = mock_client.models.generate_content.call_args
        contents = call_kwargs.kwargs.get("contents") or call_kwargs.args[0] if call_kwargs.args else call_kwargs.kwargs["contents"]
        # Verify the user message was appended
        assert any(
            c.get("parts", [{}])[0].get("text") == "Second message"
            for c in contents
        )

    def test_strips_leading_trailing_whitespace_from_response(self):
        with patch.object(gc, "_get_client", return_value=_make_client_mock("  trimmed  ")):
            result = gc.send_message([], "Hi")
        assert result == "trimmed"


# ------------------------------------------------------------------ #
# send_message — empty response                                        #
# ------------------------------------------------------------------ #

class TestSendMessageEmptyResponse:
    def test_empty_text_raises_api_error(self):
        with patch.object(gc, "_get_client", return_value=_make_client_mock("")):
            with pytest.raises(gc.GeminiAPIError):
                gc.send_message([], "Hello")

    def test_whitespace_only_text_raises_api_error(self):
        with patch.object(gc, "_get_client", return_value=_make_client_mock("   ")):
            with pytest.raises(gc.GeminiAPIError):
                gc.send_message([], "Hello")


# ------------------------------------------------------------------ #
# send_message — input validation                                      #
# ------------------------------------------------------------------ #

class TestSendMessageInputValidation:
    def test_empty_user_message_raises_value_error(self):
        with pytest.raises(ValueError):
            gc.send_message([], "")

    def test_whitespace_only_message_raises_value_error(self):
        with pytest.raises(ValueError):
            gc.send_message([], "   ")


# ------------------------------------------------------------------ #
# Exception mapping                                                    #
# ------------------------------------------------------------------ #

class TestExceptionMapping:
    def _api_error(self, status_code: int) -> Exception:
        """Create a mock google.genai APIError with the given status code."""
        from google.genai import errors as genai_errors
        err = MagicMock(spec=genai_errors.APIError)
        err.status = status_code
        err.code = status_code
        # Make isinstance check work
        err.__class__ = genai_errors.APIError
        return err

    def test_401_raises_auth_error(self):
        from google.genai import errors as genai_errors
        exc = genai_errors.APIError(401, "Unauthorized")
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = exc
        with patch.object(gc, "_get_client", return_value=mock_client):
            with pytest.raises(gc.GeminiAuthError):
                gc.send_message([], "Hi")

    def test_403_raises_auth_error(self):
        from google.genai import errors as genai_errors
        exc = genai_errors.APIError(403, "Forbidden")
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = exc
        with patch.object(gc, "_get_client", return_value=mock_client):
            with pytest.raises(gc.GeminiAuthError):
                gc.send_message([], "Hi")

    def test_429_raises_rate_limit_error(self):
        from google.genai import errors as genai_errors
        exc = genai_errors.APIError(429, "Too Many Requests")
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = exc
        with patch.object(gc, "_get_client", return_value=mock_client):
            with pytest.raises(gc.GeminiRateLimitError) as exc_info:
                gc.send_message([], "Hi")
        # retry_after should be set (default 60)
        assert exc_info.value.retry_after >= 1

    def test_500_raises_api_error(self):
        from google.genai import errors as genai_errors
        exc = genai_errors.APIError(500, "Internal Server Error")
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = exc
        with patch.object(gc, "_get_client", return_value=mock_client):
            with pytest.raises(gc.GeminiAPIError):
                gc.send_message([], "Hi")

    def test_timeout_raises_timeout_error(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = TimeoutError("timed out")
        with patch.object(gc, "_get_client", return_value=mock_client):
            with pytest.raises(gc.GeminiTimeoutError):
                gc.send_message([], "Hi")

    def test_api_key_not_in_exception_message(self):
        """The API key value must never appear in raised exception messages."""
        from google.genai import errors as genai_errors
        exc = genai_errors.APIError(500, "Internal Server Error")
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = exc
        test_key = os.environ.get("GEMINI_API_KEY", "test-gemini-key")
        with patch.object(gc, "_get_client", return_value=mock_client):
            with pytest.raises(gc.GeminiError) as exc_info:
                gc.send_message([], "Hi")
        assert test_key not in str(exc_info.value)


# ------------------------------------------------------------------ #
# get_ai_response convenience wrapper                                  #
# ------------------------------------------------------------------ #

class TestGetAiResponse:
    def test_delegates_to_send_message(self):
        with patch.object(gc, "_get_client", return_value=_make_client_mock("Hello!")):
            result = gc.get_ai_response("Test")
        assert result == "Hello!"

    def test_empty_input_raises(self):
        with pytest.raises(ValueError):
            gc.get_ai_response("")
