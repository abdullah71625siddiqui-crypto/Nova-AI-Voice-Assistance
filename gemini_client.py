"""
Gemini API client wrapper for Nova AI Assistant.

Public interface
----------------
send_message(history, user_message) -> str
    Send a user message to Gemini with conversation history context.
    Returns the response text string.
    Raises GeminiAuthError, GeminiRateLimitError, GeminiAPIError,
           GeminiTimeoutError on failure.

get_ai_response(message) -> str
    Convenience wrapper for single-turn (stateless) calls.
    Accepts a plain string, returns a plain string.
    Raises the same exception hierarchy as send_message.

Uses the google-genai SDK (>= 2.0) and model gemini-2.0-flash.
Never logs the API key.
"""

import logging
import os

from google import genai
from google.genai import errors as genai_errors

logger = logging.getLogger(__name__)

# Latest stable model supported by google-genai SDK 2.x
_MODEL_ID = "gemini-2.5-flash"

# Module-level client — initialised lazily on first use so tests can patch
# os.environ before the client is created.
_client: genai.Client | None = None


# ------------------------------------------------------------------ #
# Custom exception hierarchy                                           #
# ------------------------------------------------------------------ #

class GeminiError(Exception):
    """Base class for all Gemini client errors."""


class GeminiAuthError(GeminiError):
    """Raised when the API key is invalid or missing (HTTP 401 / 403)."""


class GeminiRateLimitError(GeminiError):
    """Raised when the API rate limit is exceeded (HTTP 429)."""

    def __init__(self, message: str, retry_after: int = 60):
        super().__init__(message)
        self.retry_after: int = retry_after


class GeminiAPIError(GeminiError):
    """Raised for generic API errors (HTTP 5xx, unexpected responses)."""


class GeminiTimeoutError(GeminiError):
    """Raised when the API call times out."""


# ------------------------------------------------------------------ #
# Internal helpers                                                     #
# ------------------------------------------------------------------ #

def _get_client() -> genai.Client:
    """Return (or create) the shared Gemini client."""
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise GeminiAuthError(
                "GEMINI_API_KEY is not set. Cannot initialise Gemini client."
            )
        # api_key value is intentionally NOT logged
        _client = genai.Client(api_key=api_key)
    return _client


def _reset_client() -> None:
    """Force recreation of the client (used in tests to pick up patched env)."""
    global _client
    _client = None


def _extract_retry_after(exc: Exception) -> int:
    """
    Extract retry-after seconds from a google-genai 429 exception.
    Parses the retryDelay field from the error details if present.
    Returns 60 as a safe default.
    """
    retry_after = 60
    try:
        # The SDK embeds details as a list inside the response JSON.
        # Look for RetryInfo in the details array.
        details = getattr(exc, "details", None)
        if isinstance(details, list):
            for item in details:
                if isinstance(item, dict):
                    delay = item.get("retryDelay", "")
                    if delay:
                        # retryDelay is a string like "49s"
                        retry_after = max(1, int(str(delay).rstrip("s")))
                        break
        # Also try parsing from the exception message as fallback
        elif not details:
            import re
            match = re.search(r"retry in (\d+)", str(exc), re.IGNORECASE)
            if match:
                retry_after = int(match.group(1))
    except Exception:
        pass
    return retry_after


def _map_exception(exc: Exception) -> GeminiError:
    """
    Map a google-genai SDK exception to a typed GeminiError.
    Never includes the API key in the mapped exception message.

    The google-genai SDK uses:
      exc.code  — integer HTTP status code (e.g. 429)
      exc.status — string status name (e.g. "RESOURCE_EXHAUSTED")
    """
    # google-genai SDK raises google.genai.errors.APIError (and subclasses)
    if isinstance(exc, genai_errors.APIError):
        # Prefer numeric code attribute; status is a string like RESOURCE_EXHAUSTED
        code_raw = getattr(exc, "code", None)
        try:
            status_int = int(code_raw) if code_raw is not None else 0
        except (ValueError, TypeError):
            status_int = 0

        # Also map known string status values when code is missing
        status_str = str(getattr(exc, "status", "") or "").upper()
        if status_int == 0:
            if "UNAUTHENTICATED" in status_str or "PERMISSION" in status_str:
                status_int = 403
            elif "EXHAUSTED" in status_str or "QUOTA" in status_str:
                status_int = 429

        if status_int in (401, 403) or "UNAUTHENTICATED" in status_str:
            logger.warning("Gemini auth error (code=%s)", status_int)
            raise GeminiAuthError("Gemini API authentication failed.") from exc

        if status_int == 429 or "EXHAUSTED" in status_str:
            retry_after = _extract_retry_after(exc)
            logger.info("Gemini rate limit hit. retry_after=%s", retry_after)
            raise GeminiRateLimitError(
                f"Rate limit exceeded. Please wait {retry_after} seconds.",
                retry_after=retry_after,
            ) from exc

        logger.error(
            "Gemini API error (code=%s, status=%s): %s",
            status_int,
            status_str,
            type(exc).__name__,   # class name only — never the full message
        )
        raise GeminiAPIError(
            "The AI service returned an error. Please try again."
        ) from exc

    # Timeout / connection errors
    timeout_types: tuple = (TimeoutError,)
    try:
        import httpx
        timeout_types = (TimeoutError, httpx.TimeoutException)
    except ImportError:
        pass

    if isinstance(exc, timeout_types):
        logger.error("Gemini request timed out: %s", type(exc).__name__)
        raise GeminiTimeoutError(
            "The AI service did not respond in time. Please try again."
        ) from exc

    # Fallback for anything else
    logger.error("Unexpected Gemini error: %s", type(exc).__name__)
    raise GeminiAPIError(
        "An unexpected error occurred communicating with the AI service."
    ) from exc


# ------------------------------------------------------------------ #
# Public API                                                           #
# ------------------------------------------------------------------ #

def send_message(history: list[dict], user_message: str) -> str:
    """
    Send *user_message* to Gemini with *history* as context.

    Parameters
    ----------
    history : list[dict]
        Conversation history in Gemini format:
        [{"role": "user"|"model", "parts": [{"text": str}]}, ...]
        Maximum 50 entries (older entries should be trimmed by the caller).
    user_message : str
        The new user message (non-empty, already validated by caller).

    Returns
    -------
    str
        The response text from Gemini (guaranteed non-empty).

    Raises
    ------
    GeminiAuthError, GeminiRateLimitError, GeminiAPIError, GeminiTimeoutError
    """
    if not user_message or not user_message.strip():
        raise ValueError("user_message must not be empty.")

    client = _get_client()

    # Build contents list: history + new user turn
    contents: list[dict] = []
    for entry in history:
        role = entry.get("role", "user")
        parts = entry.get("parts", [])
        text = parts[0].get("text", "") if parts else ""
        if text:
            contents.append({"role": role, "parts": [{"text": text}]})

    contents.append({"role": "user", "parts": [{"text": user_message}]})

    try:
        response = client.models.generate_content(
            model=_MODEL_ID,
            contents=contents,
        )
    except Exception as exc:
        _map_exception(exc)  # always raises a GeminiError subclass
        raise  # unreachable, satisfies type checkers

    # Extract text — guard against empty / missing response
    text = getattr(response, "text", None)
    if not text or not text.strip():
        raise GeminiAPIError(
            "Gemini returned an empty response. Please try again."
        )

    return text.strip()


def get_ai_response(message: str) -> str:
    """
    Convenience wrapper: single-turn stateless call to Gemini.

    Parameters
    ----------
    message : str
        The user's message (must be non-empty).

    Returns
    -------
    str
        The AI response text.
    """
    return send_message([], message)
