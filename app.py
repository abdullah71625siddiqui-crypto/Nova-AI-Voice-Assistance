"""
Flask application entry point for Nova AI Assistant.

Routes
------
GET  /          — Serve the single-page HTML shell
GET  /health    — Health check
POST /api/chat  — Accept user message, return Gemini reply  (Phase 2)
POST /api/clear — Clear session conversation history        (Phase 2)
"""

import os
from datetime import timedelta

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session

# Load .env before config validation so env vars are available
load_dotenv()

from config import load_config
import gemini_client as gc


def create_app() -> Flask:
    """Application factory."""
    config = load_config()

    app = Flask(__name__, template_folder="templates", static_folder="static")

    # Core Flask config
    app.secret_key = config.flask_secret_key
    app.permanent_session_lifetime = timedelta(minutes=30)

    # ------------------------------------------------------------------ #
    # Routes                                                               #
    # ------------------------------------------------------------------ #

    @app.route("/")
    def index():
        """Serve the single-page HTML shell."""
        return render_template("index.html")

    @app.route("/health")
    def health():
        """Health check endpoint — returns within 500 ms."""
        return jsonify({"status": "ok"}), 200

    # ------------------------------------------------------------------ #
    # Chat API  (Phase 2)                                                  #
    # ------------------------------------------------------------------ #

    @app.route("/api/chat", methods=["POST"])
    def api_chat():
        """
        Accept a user message and return a Gemini reply.

        Request
        -------
        Content-Type: application/json
        Body: {"message": "<string 1–2000 chars>"}

        Responses
        ---------
        200  {"reply": "<string>"}
        400  {"error": "...", "code": "VALIDATION_ERROR"}
        415  {"error": "...", "code": "UNSUPPORTED_MEDIA_TYPE"}
        429  {"error": "...", "code": "RATE_LIMIT", "retry_after": <int>}
        502  {"error": "...", "code": "UPSTREAM_ERROR"}
        500  {"error": "...", "code": "SERVER_ERROR"}
        """
        # --- Content-Type check ---
        if not request.is_json:
            return (
                jsonify(
                    {
                        "error": "Content-Type must be application/json",
                        "code": "UNSUPPORTED_MEDIA_TYPE",
                    }
                ),
                415,
            )

        data = request.get_json(silent=True) or {}
        user_message: str = data.get("message", "")

        # --- Input validation ---
        if not isinstance(user_message, str) or not user_message.strip():
            return (
                jsonify(
                    {
                        "error": "Message must be a non-empty string.",
                        "code": "VALIDATION_ERROR",
                    }
                ),
                400,
            )

        if len(user_message) > 2000:
            return (
                jsonify(
                    {
                        "error": (
                            f"Message exceeds maximum length of 2000 characters "
                            f"(received {len(user_message)})."
                        ),
                        "code": "VALIDATION_ERROR",
                    }
                ),
                400,
            )

        # --- Session history ---
        session.permanent = True
        history: list[dict] = session.get("history", [])

        # Keep only the last 50 messages (rolling window)
        if len(history) > 50:
            history = history[-50:]

        # --- Call Gemini ---
        try:
            reply = gc.send_message(history, user_message.strip())
        except gc.GeminiAuthError:
            return (
                jsonify(
                    {
                        "error": "AI service authentication failed. Contact the administrator.",
                        "code": "UPSTREAM_ERROR",
                    }
                ),
                502,
            )
        except gc.GeminiRateLimitError as exc:
            return (
                jsonify(
                    {
                        "error": (
                            f"Rate limit reached. Please wait {exc.retry_after} "
                            "seconds before sending another message."
                        ),
                        "code": "RATE_LIMIT",
                        "retry_after": exc.retry_after,
                    }
                ),
                429,
            )
        except (gc.GeminiAPIError, gc.GeminiTimeoutError):
            return (
                jsonify(
                    {
                        "error": "The AI service is currently unavailable. Please try again.",
                        "code": "UPSTREAM_ERROR",
                    }
                ),
                502,
            )
        except Exception:
            return (
                jsonify(
                    {
                        "error": "An unexpected error occurred. Please try again.",
                        "code": "SERVER_ERROR",
                    }
                ),
                500,
            )

        # --- Persist to session history ---
        history.append({"role": "user", "parts": [{"text": user_message.strip()}]})
        history.append({"role": "model", "parts": [{"text": reply}]})
        session["history"] = history

        return jsonify({"reply": reply}), 200

    @app.route("/api/clear", methods=["POST"])
    def api_clear():
        """Clear the conversation history for the current session."""
        session["history"] = []
        return jsonify({"status": "cleared"}), 200

    # ------------------------------------------------------------------ #
    # Error handlers                                                       #
    # ------------------------------------------------------------------ #

    @app.errorhandler(404)
    def not_found(error):
        return jsonify({"error": "Not found", "code": "NOT_FOUND"}), 404

    @app.errorhandler(405)
    def method_not_allowed(error):
        return jsonify({"error": "Method not allowed", "code": "METHOD_NOT_ALLOWED"}), 405

    @app.errorhandler(500)
    def internal_error(error):
        return (
            jsonify(
                {
                    "error": "An unexpected error occurred. Please try again.",
                    "code": "SERVER_ERROR",
                }
            ),
            500,
        )

    return app


# ------------------------------------------------------------------ #
# Entry point for `flask run` / direct execution                       #
# ------------------------------------------------------------------ #

# Load config at module level — surfaces missing-env errors early.
_config = load_config()

app = create_app()

if __name__ == "__main__":
    app.run(
        host=_config.host,
        port=_config.port,
        debug=os.environ.get("FLASK_DEBUG", "false").lower() == "true",
    )
