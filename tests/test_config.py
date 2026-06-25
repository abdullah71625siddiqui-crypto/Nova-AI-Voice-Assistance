"""
Unit tests for config.py — Phase 1, task 1.2.

Tests:
- Missing GEMINI_API_KEY raises EnvironmentError naming the variable
- Missing FLASK_SECRET_KEY raises EnvironmentError naming the variable
- Both missing raises EnvironmentError naming both variables
- All defaults applied when optional vars are absent
- Valid environment loads correctly into Config dataclass
"""

import os
import pytest

from config import load_config, Config


def _set_env(**kwargs):
    """Helper: set env vars and return them as a dict for cleanup."""
    for k, v in kwargs.items():
        os.environ[k] = v


def _clear_env(*keys):
    """Helper: remove env vars without raising if not present."""
    for k in keys:
        os.environ.pop(k, None)


ALL_REQUIRED = ("GEMINI_API_KEY", "FLASK_SECRET_KEY")
ALL_OPTIONAL = ("PORT", "HOST", "LOG_LEVEL", "WEB_CONCURRENCY")


@pytest.fixture(autouse=True)
def clean_env():
    """Remove all config-related env vars before each test, restore after."""
    saved = {k: os.environ.get(k) for k in ALL_REQUIRED + ALL_OPTIONAL}
    _clear_env(*ALL_REQUIRED, *ALL_OPTIONAL)
    yield
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


# ------------------------------------------------------------------ #
# Required variable validation                                         #
# ------------------------------------------------------------------ #

class TestMissingRequired:
    def test_missing_gemini_api_key_raises_with_name(self):
        os.environ["FLASK_SECRET_KEY"] = "secret"
        with pytest.raises(EnvironmentError) as exc_info:
            load_config()
        assert "GEMINI_API_KEY" in str(exc_info.value)

    def test_missing_flask_secret_key_raises_with_name(self):
        os.environ["GEMINI_API_KEY"] = "key"
        with pytest.raises(EnvironmentError) as exc_info:
            load_config()
        assert "FLASK_SECRET_KEY" in str(exc_info.value)

    def test_both_missing_raises_naming_both(self):
        with pytest.raises(EnvironmentError) as exc_info:
            load_config()
        msg = str(exc_info.value)
        assert "GEMINI_API_KEY" in msg
        assert "FLASK_SECRET_KEY" in msg

    def test_empty_string_gemini_key_treated_as_missing(self):
        os.environ["GEMINI_API_KEY"] = ""
        os.environ["FLASK_SECRET_KEY"] = "secret"
        with pytest.raises(EnvironmentError) as exc_info:
            load_config()
        assert "GEMINI_API_KEY" in str(exc_info.value)


# ------------------------------------------------------------------ #
# Default values                                                       #
# ------------------------------------------------------------------ #

class TestDefaults:
    def setup_method(self):
        os.environ["GEMINI_API_KEY"] = "test-gemini-key"
        os.environ["FLASK_SECRET_KEY"] = "test-flask-secret"

    def test_port_defaults_to_5000(self):
        config = load_config()
        assert config.port == 5000

    def test_host_defaults_to_127_0_0_1(self):
        config = load_config()
        assert config.host == "127.0.0.1"

    def test_log_level_defaults_to_info(self):
        config = load_config()
        assert config.log_level == "INFO"

    def test_gunicorn_workers_defaults_to_2(self):
        config = load_config()
        assert config.gunicorn_workers == 2


# ------------------------------------------------------------------ #
# Valid environment loads correctly                                    #
# ------------------------------------------------------------------ #

class TestValidLoad:
    def test_all_values_loaded_into_config(self):
        os.environ["GEMINI_API_KEY"] = "my-gemini-key"
        os.environ["FLASK_SECRET_KEY"] = "my-flask-secret"
        os.environ["PORT"] = "8080"
        os.environ["HOST"] = "0.0.0.0"
        os.environ["LOG_LEVEL"] = "DEBUG"
        os.environ["WEB_CONCURRENCY"] = "4"

        config = load_config()

        assert isinstance(config, Config)
        assert config.gemini_api_key == "my-gemini-key"
        assert config.flask_secret_key == "my-flask-secret"
        assert config.port == 8080
        assert config.host == "0.0.0.0"
        assert config.log_level == "DEBUG"
        assert config.gunicorn_workers == 4

    def test_invalid_port_falls_back_to_default(self):
        os.environ["GEMINI_API_KEY"] = "key"
        os.environ["FLASK_SECRET_KEY"] = "secret"
        os.environ["PORT"] = "not-a-number"
        config = load_config()
        assert config.port == 5000

    def test_invalid_log_level_falls_back_to_info(self):
        os.environ["GEMINI_API_KEY"] = "key"
        os.environ["FLASK_SECRET_KEY"] = "secret"
        os.environ["LOG_LEVEL"] = "VERBOSE"
        config = load_config()
        assert config.log_level == "INFO"
