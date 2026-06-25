"""
Configuration module for Nova AI Assistant.
Reads and validates all environment variables at import time.
Raises EnvironmentError with a clear message if required variables are missing.
"""

import os
from dataclasses import dataclass


@dataclass
class Config:
    gemini_api_key: str      # GEMINI_API_KEY (required)
    flask_secret_key: str    # FLASK_SECRET_KEY (required)
    port: int                # PORT (default: 5000)
    host: str                # HOST (default: 127.0.0.1)
    log_level: str           # LOG_LEVEL (default: INFO)
    gunicorn_workers: int    # WEB_CONCURRENCY (default: 2)


def load_config() -> Config:
    """
    Load and validate environment variables.
    Raises EnvironmentError naming every missing required variable.
    """
    missing: list[str] = []

    gemini_api_key = os.environ.get("GEMINI_API_KEY", "")
    flask_secret_key = os.environ.get("FLASK_SECRET_KEY", "")

    if not gemini_api_key:
        missing.append("GEMINI_API_KEY")
    if not flask_secret_key:
        missing.append("FLASK_SECRET_KEY")

    if missing:
        raise EnvironmentError(
            f"Missing required environment variables: {', '.join(missing)}. "
            "Please set them before starting the application."
        )

    # Optional variables with defaults
    try:
        port = int(os.environ.get("PORT", "5000"))
    except ValueError:
        port = 5000

    host = os.environ.get("HOST", "127.0.0.1")

    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    if log_level not in ("DEBUG", "INFO", "WARNING", "ERROR"):
        log_level = "INFO"

    try:
        gunicorn_workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
    except ValueError:
        gunicorn_workers = 2

    return Config(
        gemini_api_key=gemini_api_key,
        flask_secret_key=flask_secret_key,
        port=port,
        host=host,
        log_level=log_level,
        gunicorn_workers=gunicorn_workers,
    )
