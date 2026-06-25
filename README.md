Design Document: AI Voice Assistant
Overview
The AI Voice Assistant is a single-page web application that lets users converse with Google Gemini through typed or spoken input, with responses rendered in a chat interface and optionally read aloud via browser Text-to-Speech. The system is intentionally simple — a Flask server acts as a thin proxy to the Gemini API and serves the static frontend assets. No database is required; session state is held in the Flask server-side session store (cookie-backed with a secret key).

Design Goals
Minimal moving parts: one Python process, no external data stores, no message queues.
Free tier friendly: runs on Render's free plan with Gunicorn, zero paid dependencies.
Security first: API keys stay server-side; all user content is sanitised before rendering.
Progressive enhancement: core text chat works in every modern browser; voice is layered on top and degrades gracefully.
Research Summary
Key technology decisions informed by documentation review:

Google Gemini Python SDK (google-generativeai): Provides genai.GenerativeModel.start_chat() which manages the history list natively. We pass the rolling window of the last 50 messages by slicing the session list before constructing the chat object.
Web Speech API: SpeechRecognition for STT and SpeechSynthesis for TTS. Both are available on Chrome 90+, Edge 90+, and Safari 14.1+. Firefox 88 supports TTS but STT is behind a flag — we handle this with feature detection.
Flask-Session / cookie sessions: We use Flask's built-in client-side signed cookie session (no Flask-Session extension) to avoid requiring Redis. Messages are stored as a list under session["history"].
Render deployment: Render injects PORT as an environment variable and terminates TLS at its edge, so the app only needs to trust X-Forwarded-Proto.
Architecture

Loading
Request flow (text message):

User types a message and presses Enter.
chat.js validates the input client-side and issues POST /api/chat with a JSON body.
Flask session middleware reads the conversation history from the signed cookie.
gemini_client.py constructs a GenerativeModel chat with the history slice and calls send_message.
The response text is appended to session history and returned as {"reply": "..."}.
chat.js appends the reply bubble to the DOM, triggers TTS if active.
Request flow (voice message):

User clicks the mic button; voice.js calls SpeechRecognition.start().
On onresult, the transcript populates the text input and is auto-submitted.
The rest follows the text flow above.
Components and Interfaces
Backend Components
app.py — Flask Application Entry Point
Responsibilities:

Register routes (/, /api/chat, /health)
Apply security headers middleware
Configure logging
Read environment variables and fail fast if required ones are absent
Start Gunicorn (via Procfile / render.yaml, not called by the module directly)
Key routes:

Route	Method	Description
/	GET	Serve templates/index.html
/api/chat	POST	Accept message, return Gemini reply
/health	GET	Return {"status": "ok"}
gemini_client.py — Gemini API Wrapper
Responsibilities:

Initialise google.generativeai with the API key from env
Expose a single function send_message(history: list[dict], user_message: str) -> str
Handle API-level errors (rate limit, auth, network) and raise typed exceptions
Never log the API key
# Public interface
def send_message(history: list[dict], user_message: str) -> str:
    """
    Send user_message to Gemini with the provided history context.
    history: list of {"role": "user"|"model", "parts": [{"text": str}]}
    Returns the response text string.
    Raises GeminiRateLimitError, GeminiAuthError, GeminiAPIError on failure.
    """
config.py — Environment Configuration
Responsibilities:

Read and validate all environment variables at import time
Raise EnvironmentError with a clear message listing missing variables
Expose a Config dataclass consumed by app.py
@dataclass
class Config:
    gemini_api_key: str      # GEMINI_API_KEY (required)
    flask_secret_key: str    # FLASK_SECRET_KEY (required)
    port: int                # PORT (default: 5000)
    host: str                # HOST (default: 127.0.0.1)
    log_level: str           # LOG_LEVEL (default: INFO)
    gunicorn_workers: int    # WEB_CONCURRENCY (default: 2)
middleware.py — Security Headers
A WSGI middleware (or @app.after_request handler) that injects:

Content-Security-Policy
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Frontend Components
static/js/chat.js — Chat Controller
Responsibilities:

Manage the message input and send button state
Issue fetch requests to /api/chat
Render user and assistant message bubbles
Display and dismiss loading indicator
Display and dismiss error messages
Expose submitMessage(text: string): Promise<void> used by voice.js
static/js/voice.js — Voice Input Module
Responsibilities:

Feature-detect SpeechRecognition and SpeechSynthesis
Manage microphone activation / deactivation and visual feedback
On transcript completion, populate the text input and call chat.submitMessage()
Manage TTS: start utterance when new reply arrives if TTS is enabled; stop on toggle/stop button
static/js/ui.js — UI Utilities
Responsibilities:

DOM helper functions: appendMessage, scrollToBottom, showError, dismissError
HTML escaping: escapeHtml(str: string): string — encodes <, >, &, ", '
All message text rendered via escapeHtml before DOM insertion
static/css/style.css — Styles
CSS custom properties for theme colours
Responsive layout using flexbox
.message-user (right-aligned, accent background) vs .message-assistant (left-aligned, neutral background)
.message-error (red/warning background, bold "Error:" label)
Mobile-first with media queries above 480px
Templates
templates/index.html
Single HTML file with:

Chat message container #chat-messages
Input row: text field #message-input + send button #send-btn + mic button #mic-btn
Speaker toggle button #tts-toggle
Clear conversation button #clear-btn
Notification area #notification
Data Models
Session History (server-side, Flask cookie)
# session["history"] is a list of message dicts:
[
    {"role": "user",  "parts": [{"text": "Hello"}]},
    {"role": "model", "parts": [{"text": "Hi there! How can I help?"}]},
    ...  # max 50 entries; older entries are dropped when limit reached
]
API Request Schema
POST /api/chat

{
  "message": "string (1–2000 characters)"
}
API Response Schemas
200 OK

{
  "reply": "string"
}
400 Bad Request

{
  "error": "string (human-readable description)",
  "code": "VALIDATION_ERROR"
}
415 Unsupported Media Type

{
  "error": "Content-Type must be application/json",
  "code": "UNSUPPORTED_MEDIA_TYPE"
}
429 Rate Limited

{
  "error": "Rate limit reached. Please wait N seconds before sending another message.",
  "code": "RATE_LIMIT",
  "retry_after": 30
}
502 Bad Gateway

{
  "error": "The AI service is currently unavailable. Please try again.",
  "code": "UPSTREAM_ERROR"
}
500 Internal Server Error

{
  "error": "An unexpected error occurred. Please try again.",
  "code": "SERVER_ERROR"
}
Log Entry Schema (JSON structured logging)
{
  "timestamp": "2024-01-15T10:30:00.123Z",
  "level": "INFO",
  "event": "http_request",
  "method": "POST",
  "path": "/api/chat",
  "status": 200,
  "duration_ms": 1234
}
{
  "timestamp": "2024-01-15T10:30:01.456Z",
  "level": "ERROR",
  "event": "gemini_api_error",
  "failure_type": "RATE_LIMIT",
  "error_message": "Resource exhausted"
}
Correctness Properties
A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

Property 1: Input validation rejects all invalid messages
For any string that is empty, composed entirely of whitespace, or exceeds 10,000 characters, the /api/chat endpoint SHALL return a 400 status code and the Chat Interface SHALL not submit the message.

Validates: Requirements 1.3, 11.3

Property 2: Valid message submission clears the input field
For any valid (non-empty, ≤10,000 char) message string, after a successful submission the text input field SHALL be empty.

Validates: Requirements 1.4

Property 3: User message appears in conversation history after submission
For any valid message string submitted by the user, that exact string SHALL appear as a user-role bubble in the Chat Interface conversation history.

Validates: Requirements 1.6, 13.3

Property 4: Network failure preserves input content
For any valid message string that is submitted when the backend is unreachable, the text input field SHALL still contain the original message text after the failure is detected.

Validates: Requirements 1.5

Property 5: Whitespace transcriptions are rejected without submission
For any string composed entirely of whitespace characters that the Voice Input Module produces as a transcript, the system SHALL not submit a message and SHALL display an error.

Validates: Requirements 2.7

Property 6: Transcribed text populates the input field
For any non-empty, non-whitespace string produced by the Voice Input Module as a transcript, the text input field SHALL be populated with that exact string.

Validates: Requirements 2.5, 2.6

Property 7: Session history window sent to Gemini
For any session containing N messages (where 1 ≤ N ≤ 49), all N messages SHALL be included in the context sent to the Gemini API with the next request.

Validates: Requirements 3.2, 7.2, 7.3

Property 8: Successful Gemini response shows no error message
For any valid Gemini API response containing non-empty text, the Chat Interface SHALL not display any error message and SHALL display the response text as an assistant bubble.

Validates: Requirements 3.5, 3.3

Property 9: Rate-limit retry-after value is faithfully displayed
For any 429 response from the Gemini API that includes a retry-after header with an integer value N, the displayed user-facing message SHALL contain that same value N.

Validates: Requirements 3.7, 8.3

Property 10: Messages displayed in insertion order
For any sequence of messages added to the conversation, they SHALL appear in the Chat Interface in the order they were added, with the most recently added message at the bottom.

Validates: Requirements 4.3

Property 11: Static assets served with Cache-Control max-age ≥ 3600
For any GET request to a static asset (CSS, JS, image), the response SHALL include a Cache-Control header with a max-age value of at least 3600 seconds.

Validates: Requirements 10.4

Property 12: /api/chat responses include CORS header
For any request to /api/chat (regardless of success, validation failure, or error), the response SHALL include a Access-Control-Allow-Origin header.

Validates: Requirements 11.6

Property 13: Security headers present on all responses
For any HTTP response from the application, the response SHALL include Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, and Referrer-Policy headers.

Validates: Requirements 14.3

Property 14: HTML special characters are encoded in rendered messages
For any user-supplied message string containing HTML special characters (<, >, &, ", '), those characters SHALL appear HTML-encoded in the DOM and SHALL NOT be interpreted as HTML markup.

Validates: Requirements 14.4

Property 15: API key absent from all HTTP responses
For any HTTP response (including error responses and static assets), the response body and headers SHALL not contain the GEMINI_API_KEY value.

Validates: Requirements 14.1, 6.5, 14.6

Property 16: HTTP request log entries contain required fields
For any HTTP request processed by the application, the produced log entry SHALL be valid JSON and SHALL contain timestamp, level, event, method, path, and status fields.

Validates: Requirements 15.1, 15.4

Property 17: Gemini API failure log entries contain required fields
For any Gemini API call failure (rate limit, auth error, network error, unexpected error), the produced log entry SHALL be valid JSON and SHALL contain failure_type and error_message fields.

Validates: Requirements 15.3, 15.4

Property 18: Log level filtering works correctly
For any configured LOG_LEVEL value from {DEBUG, INFO, WARNING, ERROR}, log entries below that severity SHALL not appear in the output, and entries at or above that severity SHALL appear.

Validates: Requirements 15.5

Property 19: /api/chat accepts any valid message length (1–2000 chars)
For any message string of length 1 to 2000 characters, a POST to /api/chat with that message SHALL return a 200 response with a reply field.

Validates: Requirements 11.1, 11.2

Property 20: Responsive layout at any viewport width ≥ 320px
For any viewport width between 320 and 1920 pixels, the Chat Interface SHALL render all UI elements without horizontal scrolling and all interactive controls SHALL be operable.

Validates: Requirements 4.6, 12.7

Error Handling
Server-Side Error Hierarchy
GeminiError (base)
├── GeminiAuthError       → HTTP 502, log WARN (no key in log)
├── GeminiRateLimitError  → HTTP 429, log INFO, include retry_after
├── GeminiAPIError        → HTTP 502, log ERROR
└── GeminiTimeoutError    → HTTP 502, log ERROR
All unhandled exceptions at the route level are caught by a @app.errorhandler(Exception) handler that:

Logs the full stack trace at ERROR level
Returns HTTP 500 with a generic JSON body
Client-Side Error Handling
chat.js maps HTTP status codes to user-facing messages:

Status	User message
400	"Your message is invalid: {server description}"
415	"Internal error. Please refresh and try again."
429	"Please wait {retry_after}s before sending another message."
502	"The AI service is currently unavailable. Please try again later."
500	"An unexpected error occurred. Please try again."
network error	"Could not reach the server. Check your connection."
Error messages are rendered using .message-error CSS class (distinct red/warning background, bold "Error:" prefix).

Session Expiry
Flask's permanent_session_lifetime is set to 30 minutes. When the session cookie expires, the next request creates a fresh session["history"] list. No explicit server-side cleanup is needed.

Testing Strategy
Overview
The testing strategy uses a dual approach: example-based unit tests for specific scenarios and property-based tests for universal invariants. Property-based testing is appropriate for this feature because the backend has pure-function logic (input validation, history slicing, response parsing, log formatting) and the frontend has testable data-transformation functions.

Backend Testing (Python)
Framework: pytest with hypothesis for property-based tests.

Unit tests cover:

config.py: missing env var raises EnvironmentError naming the missing variable; all defaults applied correctly.
gemini_client.py: each exception type raised for the corresponding API error code; response text extracted correctly.
Route handlers: each HTTP status code returned for each input condition (mocked Gemini client).
Property-based tests (minimum 100 iterations each, using hypothesis):

Each test is tagged with a comment: # Feature: ai-voice-assistant, Property N: <property text>

Property 1 — @given(st.one_of(st.just(""), st.text(alphabet=st.characters(whitelist_categories=("Zs","Cc")), min_size=1), st.text(min_size=10001))) → POST /api/chat returns 400.
Property 7 — @given(st.lists(message_strategy(), min_size=1, max_size=49)) → verify all messages sent to mocked Gemini client.
Property 9 — @given(st.integers(min_value=1, max_value=3600)) → retry-after value in response matches mocked header.
Property 11 — @given(st.sampled_from(["style.css", "js/chat.js", "js/voice.js"])) → Cache-Control max-age ≥ 3600.
Property 12 — @given(st.text(min_size=1, max_size=2000).filter(lambda s: s.strip())) → CORS header present in response.
Property 13 — @given(st.sampled_from(["/", "/api/chat", "/health"])) → all four security headers present.
Property 15 — @given(st.sampled_from(["GEMINI_API_KEY", error scenarios])) → API key value absent from response body.
Property 16 — @given(http_request_strategy()) → log entry is valid JSON with required fields.
Property 17 — @given(st.sampled_from(["RATE_LIMIT", "AUTH_ERROR", "API_ERROR", "TIMEOUT"])) → log entry has failure_type and error_message.
Property 18 — @given(st.sampled_from(["DEBUG", "INFO", "WARNING", "ERROR"]), log_event_strategy()) → filtering works correctly.
Property 19 — @given(st.text(min_size=1, max_size=2000).filter(lambda s: s.strip())) → returns 200 with reply field.
Frontend Testing (JavaScript)
Framework: vitest with @vitest/browser or jsdom environment.

Unit tests cover:

ui.js escapeHtml: specific examples with <script>, &amp;, ", '.
chat.js state machine: loading indicator shown/hidden, error display/dismiss.
Property-based tests using fast-check:

Property 14 — fc.string() containing HTML special chars → escapeHtml(s) does not contain raw <, >, & characters (except as encoded entities).
Property 3 — fc.string({ minLength: 1 }).filter(s => s.trim()) → after calling appendMessage, the message text appears in the DOM.
Property 10 — fc.array(fc.string({ minLength: 1 }), { minLength: 2 }) → messages rendered in correct order.
Property 20 — fc.integer({ min: 320, max: 1920 }) → viewport width simulation, verify no horizontal overflow.
Integration Tests
Full round-trip: POST /api/chat with a real-ish mocked Gemini client returns expected JSON shape.
Session history: N messages stored in session, next request sends all N to client.
Session expiry: after 30 minutes of inactivity (mocked time), session is cleared.
HTTPS redirect: request with X-Forwarded-Proto: http in production config redirects to HTTPS.
Smoke Tests
requirements.txt exists and all entries are pinned with ==.
Procfile / render.yaml exists and contains a gunicorn start command.
GET /health returns 200.
App fails to start when GEMINI_API_KEY or FLASK_SECRET_KEY missing.
Folder / File Structure
project-root/
├── app.py                  # Flask application, routes, app factory
├── gemini_client.py        # Gemini API wrapper
├── config.py               # Environment variable loading and validation
├── middleware.py            # Security headers after_request handler
├── requirements.txt        # Pinned Python dependencies
├── Procfile                # Render/Heroku start command
├── render.yaml             # Render deployment configuration (optional)
├── .env.example            # Template for required environment variables
├── templates/
│   └── index.html          # Single-page HTML shell
├── static/
│   ├── css/
│   │   └── style.css       # All application styles
│   └── js/
│       ├── chat.js         # Chat controller (fetch, DOM updates, error display)
│       ├── voice.js        # Speech recognition + TTS module
│       └── ui.js           # DOM helpers, escapeHtml, scroll utilities
└── tests/
    ├── conftest.py         # Pytest fixtures (app client, mock Gemini)
    ├── test_config.py      # Config loading and validation tests
    ├── test_routes.py      # Route handler unit + property tests
    ├── test_gemini_client.py  # Gemini client unit tests
    ├── test_middleware.py  # Security header property tests
    ├── test_logging.py     # Log format and level property tests
    └── frontend/
        ├── chat.test.js    # chat.js unit + property tests
        ├── voice.test.js   # voice.js unit tests
        └── ui.test.js      # ui.js unit + property tests (escapeHtml)
Key Design Decisions
1. No external session store
Decision: Use Flask's default signed cookie session instead of Redis or a database.

Rationale: The Render free tier does not include Redis. Cookie sessions are sufficient for conversation history up to 50 messages; the 4KB cookie limit is not a concern at that size. The signed cookie prevents tampering without requiring any infrastructure.

Trade-off: Session data is stored client-side; a client that clears cookies loses history. This is acceptable behaviour for a conversational assistant.

2. History window of 50 messages
Decision: Cap context at 50 messages (25 exchanges), dropping older entries beyond that limit.

Rationale: Gemini has a large context window, but sending unbounded history would eventually cause request payload bloat and slower responses. 50 messages covers most practical conversation lengths. The truncation is transparent to the user (older messages remain visible in the UI, only the context window sent to Gemini is trimmed).

3. Frontend-only voice handling
Decision: All speech recognition and TTS logic lives in voice.js; the backend never receives audio.

Rationale: The Web Speech API runs entirely in the browser. There is no need for a server-side speech pipeline, which would add cost and latency. The browser transcribes locally and sends only text to the Flask server.

4. Single-file JS modules (no bundler)
Decision: Three plain JS files loaded via <script type="module"> — no Webpack, Vite, or npm build step.

Rationale: Keeps the project deployable with zero build infrastructure. The JS surface area is small enough that module bundling would add complexity without benefit. ES module syntax is supported in all target browsers (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+).

5. Structured JSON logging
Decision: Use Python's logging module with a custom JSONFormatter instead of a third-party log library.

Rationale: Render's log aggregation works best with structured logs. A custom formatter on the standard library logger avoids adding a dependency (like structlog) for a straightforward requirement.

6. Gunicorn worker count via environment variable
Decision: Gunicorn worker count is read from WEB_CONCURRENCY (Render sets this automatically based on the instance size), defaulting to 2.

Rationale: Render's platform documentation recommends respecting WEB_CONCURRENCY. This makes scaling on Render zero-configuration.

Development Plan
Phase 1 — Project Skeleton and Configuration (Day 1)
Create project structure (all folders and empty files)
Implement config.py: load and validate env vars, raise on missing required vars
Implement app.py skeleton: Flask factory, /health endpoint, 404/500 handlers
Write requirements.txt with pinned versions
Write Procfile and .env.example
Write tests/test_config.py
Deliverable: flask run starts the server; /health returns 200; missing env var crashes with a clear message.

Phase 2 — Gemini Integration (Day 1–2)
Implement gemini_client.py: send_message, typed exceptions
Implement POST /api/chat route with input validation and session history
Implement session history window (50-message cap)
Write tests/test_gemini_client.py and tests/test_routes.py
Deliverable: curl -X POST /api/chat -d '{"message":"hi"}' returns a Gemini reply.

Phase 3 — Security and Middleware (Day 2)
Implement middleware.py: security headers
Implement POST /api/chat CORS header
Implement input sanitisation (length check, script stripping)
Implement HTTPS redirect for production
Write tests/test_middleware.py
Deliverable: All security headers present; escapeHtml and length validation working.

Phase 4 — Structured Logging (Day 2)
Implement JSONFormatter in app.py or a logging_config.py
Hook request/response logging via @app.after_request
Implement log level filtering from LOG_LEVEL env var
Ensure API key never logged
Write tests/test_logging.py
Deliverable: All HTTP requests produce JSON log lines; level filtering works.

Phase 5 — Frontend Chat Interface (Day 3)
Implement templates/index.html with all required elements
Implement static/css/style.css: message bubbles, error styling, responsive layout
Implement static/js/ui.js: DOM helpers, escapeHtml, scroll
Implement static/js/chat.js: fetch, message rendering, loading indicator, error display, clear button
Write tests/frontend/chat.test.js and tests/frontend/ui.test.js
Deliverable: Text chat works end-to-end in the browser.

Phase 6 — Voice Features (Day 4)
Implement static/js/voice.js: SpeechRecognition, TTS, feature detection
Wire mic button, TTS toggle, stop button in chat.js
Handle feature-not-available fallback (disable buttons, show notice)
Write tests/frontend/voice.test.js
Deliverable: Voice input and TTS work in Chrome; graceful fallback in Firefox.

Phase 7 — Property-Based Tests (Day 4–5)
Write all Hypothesis property tests in tests/test_routes.py and tests/test_logging.py
Write all fast-check property tests in tests/frontend/
Ensure all properties run minimum 100 iterations
Deliverable: All 20 correctness properties covered by automated tests.

Phase 8 — Deployment and Final Polish (Day 5)
Write render.yaml
Test full deployment on Render free tier
Verify HTTPS redirect, X-Forwarded-Proto handling, PORT binding
Performance check: /health < 500ms, page load < 2s under light load
Final cross-browser smoke test (Chrome, Firefox, Edge, Safari)
Deliverable: Live production URL on Render.
