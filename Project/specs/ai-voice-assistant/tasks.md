# Implementation Plan: AI Voice Assistant

## Overview

This implementation plan converts the AI Voice Assistant design into discrete coding tasks for a Flask/Python backend and vanilla JavaScript frontend. The application enables text and voice chat with Google Gemini, deployed on Render's free tier with zero external dependencies (no database, no Redis, no build pipeline).

The implementation follows the 8-phase development plan outlined in the design document, with each task building incrementally toward a production-ready application. All backend code uses Python with Flask, pytest, and Hypothesis for property-based testing. All frontend code uses vanilla JavaScript (ES modules), HTML/CSS, and vitest with fast-check for property-based testing.

## Tasks

### Phase 1: Project Skeleton and Configuration

- [ ] 1.1 Create project structure and configuration module
  - Create the following directory structure: `project-root/`, `templates/`, `static/css/`, `static/js/`, `tests/`, `tests/frontend/`
  - Create empty files: `app.py`, `gemini_client.py`, `middleware.py`, `.env.example`, `Procfile`, `render.yaml`
  - Implement `config.py` that reads and validates environment variables: `GEMINI_API_KEY` (required), `FLASK_SECRET_KEY` (required), `PORT` (default: 5000), `HOST` (default: 127.0.0.1), `LOG_LEVEL` (default: INFO), `WEB_CONCURRENCY` (default: 2)
  - Raise `EnvironmentError` listing all missing required variables if any are absent
  - Export a `Config` dataclass with all validated values
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ]* 1.2 Write unit tests for configuration module
  - Test that missing `GEMINI_API_KEY` raises `EnvironmentError` with "GEMINI_API_KEY" in the message
  - Test that missing `FLASK_SECRET_KEY` raises `EnvironmentError` with "FLASK_SECRET_KEY" in the message
  - Test that all default values are applied correctly when optional env vars are absent
  - Test that valid environment variables are loaded into the Config dataclass
  - _Requirements: 6.4_


- [ ] 1.3 Create Flask application skeleton
  - Implement `app.py` with Flask app factory function
  - Configure Flask to use the `Config` values from `config.py`
  - Set `app.secret_key` to `FLASK_SECRET_KEY`
  - Set `app.permanent_session_lifetime` to 30 minutes
  - Implement `GET /health` endpoint returning `{"status": "ok"}` with status 200
  - Implement generic 404 handler returning JSON `{"error": "Not found", "code": "NOT_FOUND"}` with status 404
  - Implement generic 500 handler returning JSON `{"error": "An unexpected error occurred. Please try again.", "code": "SERVER_ERROR"}` with status 500
  - Configure Flask to serve static files from `static/` directory
  - _Requirements: 6.1, 6.2, 6.3, 7.6, 7.7, 10.1, 10.2, 10.3, 10.5, 13.1_

- [ ]* 1.4 Write smoke tests for Flask skeleton
  - Test that `GET /health` returns 200 with `{"status": "ok"}`
  - Test that Flask fails to start when `GEMINI_API_KEY` is missing (capture the raised exception)
  - Test that Flask fails to start when `FLASK_SECRET_KEY` is missing
  - Test that a GET request to a non-existent route returns 404 with JSON error body
  - _Requirements: 6.4, 13.1, 10.5_

- [ ] 1.5 Create requirements.txt and deployment configuration
  - Write `requirements.txt` with pinned versions: `Flask==3.0.0`, `google-generativeai==0.3.1`, `gunicorn==21.2.0`, `pytest==7.4.3`, `hypothesis==6.92.1`
  - Write `.env.example` listing all required and optional environment variables with descriptions
  - Write `Procfile` with content: `web: gunicorn --bind 0.0.0.0:$PORT --workers $WEB_CONCURRENCY app:app`
  - Write `render.yaml` specifying Python 3.11 runtime, build command `pip install -r requirements.txt`, and start command from Procfile
  - _Requirements: 9.3, 9.4, 9.5_

- [ ] 1.6 Checkpoint - Verify project skeleton
  - Run `flask run` locally and confirm the server starts
  - Visit `GET /health` and confirm 200 response
  - Confirm missing `GEMINI_API_KEY` crashes with a clear error message naming the variable
  - Ensure all tests pass, ask the user if questions arise.

### Phase 2: Gemini Integration


- [ ] 2.1 Implement Gemini API client with typed exceptions
  - Create `gemini_client.py` that imports `google.generativeai`
  - Initialize the Gemini API with the key from `config.Config.gemini_api_key`
  - Define custom exception classes: `GeminiError` (base), `GeminiAuthError`, `GeminiRateLimitError`, `GeminiAPIError`, `GeminiTimeoutError`
  - Implement function `send_message(history: list[dict], user_message: str) -> str` that accepts a history list and a user message
  - Use `genai.GenerativeModel("gemini-pro").start_chat(history=history)` and call `chat.send_message(user_message)`
  - Extract and return the response text from `response.text`
  - Catch API errors and raise the appropriate typed exception (401/403 → AuthError, 429 → RateLimitError, timeout → TimeoutError, other → APIError)
  - Parse `retry-after` header from 429 responses and include it in the `GeminiRateLimitError` exception
  - Never log the API key in any exception message or log statement
  - _Requirements: 3.1, 3.3, 3.4, 3.6, 3.7, 6.5_

- [ ]* 2.2 Write unit tests for Gemini client
  - Mock `google.generativeai` to return a successful response, verify `send_message` extracts text correctly
  - Mock a 401 error response, verify `GeminiAuthError` is raised
  - Mock a 429 error response with `retry-after: 30`, verify `GeminiRateLimitError` is raised with retry_after=30
  - Mock a timeout, verify `GeminiTimeoutError` is raised
  - Mock a 500 error, verify `GeminiAPIError` is raised
  - Verify that API key is never logged when exceptions are raised
  - _Requirements: 3.4, 3.7, 6.5_

- [ ] 2.3 Implement session history and POST /api/chat endpoint
  - In `app.py`, implement `POST /api/chat` route
  - Check `Content-Type` header; if not `application/json`, return 415 with JSON error body
  - Parse JSON body and extract `"message"` field
  - Validate message: reject if empty, only whitespace, or exceeds 2000 characters (return 400 with validation error JSON)
  - Initialize `session["history"]` as an empty list if not present
  - Trim `session["history"]` to the last 50 messages if it exceeds 50 entries
  - Call `gemini_client.send_message(session["history"], user_message)`
  - Append user message to `session["history"]` as `{"role": "user", "parts": [{"text": user_message}]}`
  - Append Gemini reply to `session["history"]` as `{"role": "model", "parts": [{"text": reply_text}]}`
  - Return 200 with `{"reply": reply_text}`
  - Handle exceptions: `GeminiAuthError` → 502, `GeminiRateLimitError` → 429 with retry_after in JSON, `GeminiAPIError`/`GeminiTimeoutError` → 502, any other exception → 500
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 7.1, 7.2, 7.3, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7_


- [ ]* 2.4 Write property test for input validation
  - **Property 1: Input validation rejects all invalid messages**
  - **Validates: Requirements 1.3, 11.3**
  - Use `hypothesis` with `@given(st.one_of(st.just(""), st.text(alphabet=st.characters(whitelist_categories=("Zs","Cc")), min_size=1), st.text(min_size=2001)))`
  - For each generated invalid message, POST to `/api/chat` and assert response is 400
  - Run minimum 100 iterations

- [ ]* 2.5 Write property test for session history window
  - **Property 7: Session history window sent to Gemini**
  - **Validates: Requirements 3.2, 7.2, 7.3**
  - Use `hypothesis` with `@given(st.lists(st.fixed_dictionaries({"role": st.sampled_from(["user", "model"]), "parts": st.just([{"text": "test"}])}), min_size=1, max_size=49))`
  - Mock `gemini_client.send_message` to capture the history argument
  - For each generated history list, store it in session, POST a new message, and verify all messages from history are passed to the mocked client
  - Run minimum 100 iterations

- [ ]* 2.6 Write property test for valid message acceptance
  - **Property 19: /api/chat accepts any valid message length (1–2000 chars)**
  - **Validates: Requirements 11.1, 11.2**
  - Use `hypothesis` with `@given(st.text(min_size=1, max_size=2000).filter(lambda s: s.strip()))`
  - Mock Gemini client to return a fixed reply
  - For each generated message, POST to `/api/chat` and assert response is 200 with a `reply` field
  - Run minimum 100 iterations

- [ ] 2.7 Checkpoint - Verify Gemini integration
  - Use `curl` or Postman to POST a message to `/api/chat` with a valid `GEMINI_API_KEY`
  - Confirm a Gemini reply is returned
  - Confirm that a second message includes the first exchange in the context
  - Ensure all tests pass, ask the user if questions arise.

### Phase 3: Security and Middleware

- [ ] 3.1 Implement security headers middleware
  - In `middleware.py`, create an `@app.after_request` handler or WSGI middleware
  - Add the following headers to every response: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
  - Register the middleware in `app.py`
  - _Requirements: 14.3_


- [ ] 3.2 Add CORS header to /api/chat endpoint
  - In the `/api/chat` route handler, add `Access-Control-Allow-Origin` header to all responses (success, error, validation failure)
  - Set the header value to the request origin or `*` for same-origin requests
  - _Requirements: 11.6_

- [ ]* 3.3 Write property test for security headers presence
  - **Property 13: Security headers present on all responses**
  - **Validates: Requirements 14.3**
  - Use `hypothesis` with `@given(st.sampled_from(["/", "/api/chat", "/health", "/nonexistent"]))`
  - For each path, send a GET or POST request and verify the response includes all four required headers
  - Run minimum 100 iterations

- [ ]* 3.4 Write property test for CORS header presence
  - **Property 12: /api/chat responses include CORS header**
  - **Validates: Requirements 11.6**
  - Use `hypothesis` with `@given(st.text(min_size=1, max_size=2000).filter(lambda s: s.strip()))`
  - Mock Gemini client
  - For each generated message (valid or triggering error), POST to `/api/chat` and verify `Access-Control-Allow-Origin` header is present
  - Run minimum 100 iterations

- [ ] 3.5 Implement HTTPS redirect for production
  - In `middleware.py`, add logic to check the `X-Forwarded-Proto` header
  - If the value is `http` and the app is in production mode (detected via env var or config), redirect to the HTTPS URL with status 301
  - _Requirements: 9.6, 14.5_

- [ ]* 3.6 Write integration test for HTTPS redirect
  - Send a GET request to `/` with header `X-Forwarded-Proto: http` in production config
  - Verify the response is a 301 redirect to the HTTPS URL
  - _Requirements: 9.6, 14.5_

- [ ] 3.7 Checkpoint - Verify security middleware
  - Use browser DevTools to inspect response headers for `/` and `/api/chat`
  - Confirm all four security headers are present
  - Confirm `Access-Control-Allow-Origin` is present on `/api/chat`
  - Ensure all tests pass, ask the user if questions arise.

### Phase 4: Structured Logging


- [ ] 4.1 Implement JSON structured logging
  - Create a custom `JSONFormatter` class extending `logging.Formatter`
  - Format each log record as a JSON object with fields: `timestamp`, `level`, `event`, and any additional context fields
  - Configure the root logger in `app.py` to use the `JSONFormatter`
  - Set the log level from `config.Config.log_level` (DEBUG, INFO, WARNING, ERROR)
  - Ensure API keys and authentication tokens are never included in any log output
  - _Requirements: 15.4, 15.5, 6.5, 14.6_

- [ ] 4.2 Add HTTP request/response logging
  - In `app.py`, implement an `@app.after_request` handler that logs each HTTP request
  - Log entry must include: `timestamp`, `level: "INFO"`, `event: "http_request"`, `method`, `path`, `status`, and `duration_ms`
  - Use `time.time()` or similar to measure request duration
  - _Requirements: 15.1, 15.4_

- [ ] 4.3 Add Gemini API error logging
  - In `gemini_client.py`, when any exception is raised (AuthError, RateLimitError, APIError, TimeoutError), log a structured entry
  - Log entry must include: `timestamp`, `level`, `event: "gemini_api_error"`, `failure_type`, `error_message`
  - Use appropriate log levels: AuthError → WARNING, RateLimitError → INFO, APIError/TimeoutError → ERROR
  - Never log the API key in the error message
  - _Requirements: 3.4, 15.3, 15.4, 6.5_

- [ ]* 4.4 Write property test for HTTP request log format
  - **Property 16: HTTP request log entries contain required fields**
  - **Validates: Requirements 15.1, 15.4**
  - Use `hypothesis` with `@given(st.sampled_from([("GET", "/"), ("POST", "/api/chat"), ("GET", "/health")]))`
  - Capture log output for each generated HTTP request
  - Parse log entry as JSON and verify it contains `timestamp`, `level`, `event`, `method`, `path`, `status` fields
  - Run minimum 100 iterations

- [ ]* 4.5 Write property test for Gemini error log format
  - **Property 17: Gemini API failure log entries contain required fields**
  - **Validates: Requirements 15.3, 15.4**
  - Use `hypothesis` with `@given(st.sampled_from(["RATE_LIMIT", "AUTH_ERROR", "API_ERROR", "TIMEOUT"]))`
  - Mock Gemini client to raise each error type
  - Capture log output and parse as JSON
  - Verify log entry contains `failure_type` and `error_message` fields
  - Run minimum 100 iterations


- [ ]* 4.6 Write property test for log level filtering
  - **Property 18: Log level filtering works correctly**
  - **Validates: Requirements 15.5**
  - Use `hypothesis` with `@given(st.sampled_from(["DEBUG", "INFO", "WARNING", "ERROR"]))`
  - For each log level, configure the application with that level and emit log events at each severity
  - Verify that only entries at or above the configured level appear in output
  - Run minimum 100 iterations

- [ ] 4.7 Checkpoint - Verify structured logging
  - Make HTTP requests and confirm JSON log lines are emitted with all required fields
  - Trigger a Gemini API error and confirm the error log contains `failure_type` and `error_message`
  - Set `LOG_LEVEL=WARNING` and confirm DEBUG and INFO entries are suppressed
  - Ensure all tests pass, ask the user if questions arise.

### Phase 5: Frontend Chat Interface

- [ ] 5.1 Implement HTML shell with premium structure
  - Create `templates/index.html` with semantic HTML5 structure
  - Set `data-theme="dark"` attribute on `<html>` tag (default dark mode) and `lang` attribute
  - Include the following elements with exact IDs: `#chat-messages` (message container), `#message-input` (text input), `#send-btn` (send button), `#mic-btn` (microphone button), `#tts-toggle` (speaker toggle), `#clear-btn` (clear conversation button), `#notification` (notification area), `#stop-speaking-btn` (stop TTS button, hidden by default), `#voice-status` (voice status text indicator), `#settings-btn` (gear icon), `#theme-toggle-btn` (moon/sun icon), `#settings-panel` (slide-in panel), `#settings-overlay` (backdrop)
  - Load `static/js/ui.js`, `static/js/chat.js`, `static/js/voice.js`, `static/js/settings.js` as ES modules (`<script type="module">`)
  - Link `static/css/style.css` (which imports `static/css/theme.css`)
  - Load Lucide icons from CDN: `<script src="https://unpkg.com/lucide@latest"></script>`
  - Load Google Fonts (Inter or Poppins) via `<link>` in `<head>`
  - Render sticky glassmorphism header containing: "VoiceAI" brand name with gradient text, settings button (gear icon, `aria-label="Open settings"`), theme toggle button (moon/sun icon, `aria-label="Toggle theme"`), about/info icon button
  - Render centered conversation layout wrapper with `max-width: 800px` and horizontal centering
  - Sticky input area at the bottom using fixed positioning
  - Do not include any inline JavaScript or API key references
  - Add `GET /` route in `app.py` using `render_template("index.html")`
  - _Requirements: 1.1, 2.1, 4.1, 4.2, 5.2, 7.4, 10.1, 14.1_

- [ ] 5.2 Implement premium CSS theme and base styles
  - Create `static/css/theme.css` with CSS custom properties for dark and light themes
  - Define dark theme variables on `[data-theme="dark"]` (or `:root` as default): `--color-bg: #0a0b0f`, `--color-surface: #12141a`, `--color-surface-2: #1a1d26`, `--color-accent-start: #7c3aed`, `--color-accent-end: #2563eb`, `--color-text: #e2e8f0`, `--color-text-muted: #94a3b8`, `--color-border: rgba(255,255,255,0.08)`, `--color-glass: rgba(255,255,255,0.05)`, `--color-error: #ef4444`, `--color-error-bg: rgba(239,68,68,0.1)`, `--shadow-lg`, `--shadow-glass`, `--radius-sm: 12px`, `--radius-md: 16px`, `--radius-lg: 18px`
  - Define light theme overrides on `[data-theme="light"]`: `--color-bg: #f8fafc`, `--color-surface: #ffffff`, `--color-surface-2: #f1f5f9`, `--color-text: #0f172a`, `--color-text-muted: #64748b`, `--color-border: rgba(0,0,0,0.08)`, `--color-glass: rgba(255,255,255,0.7)`
  - Create `static/css/style.css` that `@import './theme.css'` at the top
  - In `style.css`: apply `font-family: 'Inter', 'Poppins', sans-serif`; use 8px grid spacing throughout; set `box-sizing: border-box` globally
  - Implement mobile-first responsive layout using flexbox; add media queries for viewports ≥ 480px
  - Style sticky glassmorphism header: `backdrop-filter: blur(16px)`, `background: var(--color-glass)`, `border-bottom: 1px solid var(--color-border)`, gradient text for `.brand-name` using `--color-accent-start` and `--color-accent-end`
  - Style `.message-user`: right-aligned, gradient background from `--color-accent-start` to `--color-accent-end`, `border-radius: var(--radius-md)`, layered `box-shadow`
  - Style `.message-assistant`: left-aligned, `background: var(--color-surface-2)`, glassmorphism card effect, `border-radius: var(--radius-md)`
  - Style `.message-error`: `background: var(--color-error-bg)`, `border: 1px solid var(--color-error)`, includes "Error:" label
  - Style `.loading-indicator`: three animated dots using CSS `@keyframes` bounce/pulse; or pulsing gradient spinner
  - Add `.message-enter` animation: slide-in + fade (translate Y + opacity, `0.25s ease`)
  - Add smooth `transition: 0.2s–0.3s ease` on all interactive elements (`:hover`, `:focus`)
  - Add `.typing-indicator` with three bouncing dots for "waiting for response" state
  - Ensure no horizontal scroll at 320px viewport width
  - _Requirements: 4.1, 4.2, 4.6, 4.7, 8.5, 12.7_


- [ ] 5.3 Implement premium UI utilities module
  - Create `static/js/ui.js` as an ES module
  - Implement `escapeHtml(str)` that encodes `<`, `>`, `&`, `"`, `'` to HTML entities
  - Implement `appendMessage(role, text, options = {})` that:
    - Creates a message bubble element with the correct CSS class (`message-user`, `message-assistant`, `message-error`)
    - Inserts escaped text via `textContent` (NOT `innerHTML`)
    - Adds `data-timestamp` attribute with current ISO timestamp
    - Renders a timestamp label formatted as "hh:mm AM/PM" inside each bubble
    - For `role === "assistant"`: appends a "Copy" button (clipboard icon from Lucide) that copies message text to clipboard and shows brief "Copied!" tooltip feedback for 1.5s
    - Applies `.message-enter` CSS animation class on insertion
    - Appends to `#chat-messages` and calls `scrollToBottom()`
  - Implement `scrollToBottom()` that scrolls `#chat-messages` to the bottom
  - Implement `showError(message)` that renders an error bubble via `appendMessage("error", message)` and scrolls to bottom
  - Implement `dismissError()` that removes the most recent error bubble if present
  - Implement `showNotification(message, durationMs)` that displays text in `#notification` and auto-dismisses after `durationMs`
  - Implement `showTypingIndicator()` and `hideTypingIndicator()` that show/hide the `.typing-indicator` element in `#chat-messages`
  - Export all functions
  - _Requirements: 4.3, 4.4, 8.5, 14.4_

- [ ]* 5.4 Write property test for HTML escaping
  - **Property 14: HTML special characters are encoded in rendered messages**
  - **Validates: Requirements 14.4**
  - In `tests/frontend/ui.test.js` using `vitest` and `fast-check`
  - Use `fc.string()` with characters including `<`, `>`, `&`, `"`, `'`
  - For each generated string, call `escapeHtml(s)` and assert the result does not contain raw `<`, `>`, or unencoded `&` characters
  - Run minimum 100 iterations

- [ ]* 5.5 Write property test for message insertion order
  - **Property 10: Messages displayed in insertion order**
  - **Validates: Requirements 4.3**
  - In `tests/frontend/ui.test.js` using `vitest` and `fast-check` with jsdom environment
  - Use `fc.array(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 20 })`
  - Append each message via `appendMessage`, then query all message elements
  - Assert messages appear in the same order they were added, with the last one at the bottom
  - Run minimum 100 iterations

- [ ] 5.6 Implement chat controller module with premium UX features
  - Create `static/js/chat.js` as an ES module
  - Import `appendMessage`, `scrollToBottom`, `showError`, `dismissError`, `showNotification`, `showTypingIndicator`, `hideTypingIndicator` from `ui.js`
  - Implement `submitMessage(text)` async function:
    - Validate input: if empty or only whitespace, do nothing; if > 10000 chars, show inline error
    - Call `appendMessage("user", text)` and scroll to bottom immediately (within 100ms of submission)
    - Show typing indicator via `showTypingIndicator()` while waiting for response
    - Show loading animation (pulsing gradient or spinner) in send button during API call
    - `fetch` POST to `/api/chat` with JSON body `{"message": text}`
    - On success (200): hide typing indicator, call `appendMessage("assistant", data.reply)`, trigger TTS if enabled
    - On 429: hide typing indicator, show error with retry_after value, disable input for the retry duration
    - On other errors: map HTTP status to user-facing message, hide typing indicator, call `showError(message)`
    - On network error: hide typing indicator, show "Could not reach the server. Check your connection."
    - On failure: preserve input field content (do NOT clear it)
    - On success: clear the input field
    - Export `submitMessage`
  - Attach `submit` and `keydown` (Enter key, Shift+Enter for newline) event listeners after DOM loads
  - Implement send button disable/enable based on input value and pending request state
  - Implement clear button: POST to `/api/clear`, clear `#chat-messages`, reset typing indicator state
  - Auto-scroll to latest message after each `appendMessage` call
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 3.4, 3.7, 4.4, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.6, 13.3, 13.5_

- [ ] 5.7 Add POST /api/clear endpoint to Flask
  - Implement `POST /api/clear` in `app.py` that clears `session["history"]` and returns `{"status": "cleared"}` with status 200
  - _Requirements: 7.4, 7.5_

- [ ]* 5.8 Write unit tests for chat controller
  - In `tests/frontend/chat.test.js` using `vitest` and jsdom environment
  - Mock `fetch` to return a 200 response with `{"reply": "hello"}`, verify typing indicator is shown then hidden
  - Mock `fetch` to return a 429 response with `retry_after: 30`, verify error message contains "30" and input is disabled
  - Mock `fetch` to throw a network error, verify error message mentions connection and input content is preserved
  - Test that submitting a valid message clears the input field
  - Test that an empty message does NOT clear the input or call `fetch`
  - Test that the copy button on an assistant message copies text to clipboard and shows "Copied!" feedback
  - _Requirements: 1.4, 1.5, 3.7, 4.5, 8.3_

- [ ]* 5.9 Write property test for user message presence after submission
  - **Property 3: User message appears in conversation history after submission**
  - **Validates: Requirements 1.6, 13.3**
  - In `tests/frontend/chat.test.js` using `fast-check`
  - Use `fc.string({ minLength: 1 }).filter(s => s.trim())`
  - Mock `fetch` to return a successful response
  - For each generated message, call `submitMessage(text)`, then query `#chat-messages`
  - Assert the message text appears in a user message bubble in the DOM
  - Run minimum 100 iterations


- [ ]* 5.10 Write property test for network failure preserving input
  - **Property 4: Network failure preserves input content**
  - **Validates: Requirements 1.5**
  - In `tests/frontend/chat.test.js` using `fast-check`
  - Use `fc.string({ minLength: 1 }).filter(s => s.trim())`
  - Mock `fetch` to throw a network error for each generated message
  - After the failed submission, assert the input field still contains the original message text
  - Run minimum 100 iterations

- [ ] 5.11 Wire Flask to serve static files with Cache-Control headers
  - In `app.py` or `middleware.py`, add an `@app.after_request` handler that sets `Cache-Control: public, max-age=3600` on responses for requests to `/static/`
  - _Requirements: 10.4_

- [ ]* 5.12 Write property test for Cache-Control on static assets
  - **Property 11: Static assets served with Cache-Control max-age ≥ 3600**
  - **Validates: Requirements 10.4**
  - Use `hypothesis` with `@given(st.sampled_from(["css/style.css", "css/theme.css", "js/chat.js", "js/voice.js", "js/ui.js", "js/settings.js"]))`
  - Send a GET to `/static/{filename}` and check the `Cache-Control` header
  - Parse `max-age` from the header value and assert it is ≥ 3600
  - Run minimum 100 iterations

- [ ] 5.13 Implement settings panel module
  - Create `static/js/settings.js` as an ES module
  - On module init, read settings from `localStorage` with key `voiceai_settings`; apply loaded values (TTS enabled, speech rate, selected voice, theme preference)
  - Implement `openSettings()` that adds `.settings-open` class to `#settings-panel` and shows `#settings-overlay`; set `aria-expanded="true"` on `#settings-btn`
  - Implement `closeSettings()` that removes `.settings-open`, hides `#settings-overlay`; set `aria-expanded="false"` on `#settings-btn`
  - Implement `saveSettings(settingsObj)` that writes to `localStorage` key `voiceai_settings` as JSON
  - Populate voice dropdown `#voice-select` from `speechSynthesis.getVoices()` (call on `voiceschanged` event and on init)
  - Wire `#speech-rate-slider` (`min="0.5"`, `max="2"`, `step="0.1"`, default `1`) to update displayed value label and persist to `localStorage`
  - Wire `#voice-select` change to persist selected voice name to `localStorage`
  - Wire `#settings-tts-toggle` (enable/disable TTS) to update TTS state in `voice.js` and persist to `localStorage`
  - Export `openSettings`, `closeSettings`, `saveSettings`, `loadSettings`
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 12.5_

- [ ] 5.14 Implement dark/light mode toggle
  - In `settings.js` (or a dedicated `theme.js` helper), implement `applyTheme(theme)` that sets `document.documentElement.setAttribute("data-theme", theme)`
  - Implement `toggleTheme()` that reads current `data-theme`, switches between `"dark"` and `"light"`, calls `applyTheme`, and persists to `localStorage` key `voiceai_theme`
  - On page load, read `voiceai_theme` from `localStorage` (default `"dark"`) and call `applyTheme`
  - Wire `#theme-toggle-btn` click to `toggleTheme()`; update button icon (moon ↔ sun using Lucide) to reflect current mode
  - Wire `#settings-btn` click to `openSettings()` and `#settings-overlay` click to `closeSettings()`
  - Export `applyTheme`, `toggleTheme`
  - _Requirements: 4.1, 4.2, 4.6_

- [ ] 5.15 Checkpoint - Verify premium UI theme and layout
  - Open browser and confirm dark theme is applied by default (deep navy background)
  - Toggle to light mode and confirm theme switches; reload and confirm preference is restored from localStorage
  - Open settings panel and confirm voice dropdown, speech rate slider, and TTS toggle are functional
  - Confirm header has glassmorphism effect and "VoiceAI" brand with gradient text
  - Confirm message bubbles have rounded corners, shadows, and entrance animations
  - Ensure all tests pass, ask the user if questions arise.

### Phase 6: Voice Features

- [ ] 6.1 Implement voice input module with feature detection and premium indicators
  - Create `static/js/voice.js` as an ES module
  - At module initialization, feature-detect `window.SpeechRecognition` or `window.webkitSpeechRecognition`
  - Feature-detect `window.speechSynthesis`
  - If STT is unavailable: disable `#mic-btn`, call `showNotification("Voice input is not supported in this browser.", 5000)`
  - If TTS is unavailable: disable `#tts-toggle`, call `showNotification("Text-to-speech is not supported in this browser.", 5000)`
  - If both are unavailable: show a combined notice and disable both controls
  - Export `setTtsEnabled(bool)` and `setVoiceSettings({ rate, voiceName })` for `settings.js` to call
  - _Requirements: 5.5, 12.5, 12.6_

- [ ] 6.2 Implement SpeechRecognition activation/deactivation with animated mic
  - When `#mic-btn` is clicked and recognition is not active: request microphone permission by calling `recognition.start()`
  - If permission is denied (`onerror` with `not-allowed`): show error "Microphone access is required for voice input."
  - While listening: add `.mic-active` CSS class to `#mic-btn` (pulsing ring animation, button color transitions to gradient accent); update `#voice-status` text to "Listening..."
  - Configure `recognition.continuous = false` and `recognition.interimResults = false`
  - On `onresult`: update `#voice-status` to "Processing..."; extract transcript from `event.results[0][0].transcript`
  - If transcript is empty or only whitespace: clear `#voice-status`, show error "No speech was detected." and do NOT submit
  - If transcript is valid: populate `#message-input` with transcript text and call `chat.submitMessage(transcript)`; clear `#voice-status` after submission
  - On `onerror` (other than not-allowed): show error "Voice transcription failed.", remove `.mic-active`, clear `#voice-status`
  - When `#mic-btn` is clicked while recognition is active: call `recognition.stop()`, remove `.mic-active`, clear `#voice-status`
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

- [ ]* 6.3 Write unit tests for voice input module
  - In `tests/frontend/voice.test.js` using `vitest`
  - Mock `SpeechRecognition` to simulate a successful transcript "hello world"
  - Verify `#message-input` is populated, `submitMessage` is called, and `#voice-status` is cleared after submission
  - Mock `SpeechRecognition` to simulate a blank transcript
  - Verify no submission is made, an error message is shown, and `#voice-status` is cleared
  - Mock `SpeechRecognition` to trigger `onerror` with `not-allowed`
  - Verify the error message about microphone access is displayed and `.mic-active` class is removed
  - Verify `#voice-status` shows "Listening..." when recognition starts and "Processing..." on result
  - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9_

- [ ]* 6.4 Write property test for whitespace transcript rejection
  - **Property 5: Whitespace transcriptions are rejected without submission**
  - **Validates: Requirements 2.7**
  - In `tests/frontend/voice.test.js` using `fast-check`
  - Use `fc.string({ alphabet: ' \t\n\r', minLength: 1 })` to generate whitespace-only strings
  - Mock `SpeechRecognition` to return each generated string as the transcript
  - Verify `fetch` is never called and an error message is displayed
  - Run minimum 100 iterations

- [ ]* 6.5 Write property test for transcribed text populating input field
  - **Property 6: Transcribed text populates the input field**
  - **Validates: Requirements 2.5, 2.6**
  - In `tests/frontend/voice.test.js` using `fast-check`
  - Use `fc.string({ minLength: 1 }).filter(s => s.trim())`
  - Mock `SpeechRecognition` to return each generated non-empty string as the transcript
  - Verify `#message-input.value` equals the transcript before submission
  - Run minimum 100 iterations

- [ ] 6.6 Implement Text-to-Speech playback with premium controls
  - In `voice.js`, track TTS enabled state (default: true) and speech rate/voice from settings in module-level variables
  - Expose `setTtsEnabled(bool)` and `setVoiceSettings({ rate, voiceName })` for `settings.js` to call
  - When `#tts-toggle` is clicked: toggle TTS state; update button icon (Lucide volume-2 ↔ volume-x); apply `.tts-active` or `.tts-inactive` CSS class
  - Export `speakText(text)` function:
    - If TTS is disabled or `speechSynthesis` is unavailable, return immediately
    - If speech is currently playing, call `speechSynthesis.cancel()` first
    - Create a new `SpeechSynthesisUtterance(text)`; apply `utterance.rate` from settings, apply `utterance.voice` from settings if set
    - Call `speechSynthesis.speak(utterance)`
    - Update `#voice-status` text to "Speaking..."; show `#stop-speaking-btn`
    - While speaking: add `.tts-speaking` class to `#tts-toggle` (pulsing animation)
    - On utterance `onend` or `onerror`: remove `.tts-speaking`, clear `#voice-status`, hide `#stop-speaking-btn`
  - Wire `speakText` to be called from `chat.js` when a Gemini reply arrives and TTS is enabled
  - When `#stop-speaking-btn` is clicked: call `speechSynthesis.cancel()`, clear `#voice-status`, hide `#stop-speaking-btn`
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ]* 6.7 Write unit tests for TTS controls
  - In `tests/frontend/voice.test.js`
  - Mock `speechSynthesis.speak`, `speechSynthesis.cancel`, and `speechSynthesis.getVoices`
  - Test that `speakText("hello")` calls `speechSynthesis.speak` when TTS is enabled and `#voice-status` shows "Speaking..."
  - Test that `speakText("hello")` does NOT call `speechSynthesis.speak` when TTS is toggled off
  - Test that calling `speakText` while speech is already playing first calls `cancel` then `speak`
  - Test that clicking `#stop-speaking-btn` calls `speechSynthesis.cancel`, clears `#voice-status`, and hides `#stop-speaking-btn`
  - Test that `setVoiceSettings({ rate: 1.5, voiceName: "Google US English" })` applies the rate to the next utterance
  - _Requirements: 5.1, 5.4_

- [ ] 6.8 Checkpoint - Verify premium voice features
  - Click the mic button in Chrome and speak a phrase; confirm `.mic-active` pulsing animation appears and `#voice-status` shows "Listening..." then "Processing..."
  - Confirm TTS reads the Gemini response aloud; `#voice-status` shows "Speaking..." and `#stop-speaking-btn` is visible
  - Toggle TTS off and send a message; confirm no speech occurs and icon updates to muted state
  - Confirm `#stop-speaking-btn` halts speech, clears status, and hides itself
  - Open settings panel, change speech rate slider and voice; confirm next TTS uses the new settings
  - Test in Firefox and confirm graceful degradation (mic disabled, notice shown)
  - Ensure all tests pass, ask the user if questions arise.

### Phase 7: Property-Based Test Coverage

- [ ] 7.1 Write remaining backend property tests in tests/conftest.py and test files
  - Create `tests/conftest.py` with pytest fixtures: `app_client` (Flask test client with mocked Gemini), `mock_gemini` (patch `gemini_client.send_message` to return "mocked reply"), `env_vars` (set required env vars in os.environ)
  - Ensure all existing property tests in Phase 2 and Phase 3 are wired to use these fixtures
  - Verify each test runs minimum 100 Hypothesis iterations (`settings(max_examples=100)`)
  - _Requirements: 3.1, 3.2, 3.7, 6.1, 6.2_

- [ ]* 7.2 Write property test for retry-after value in rate-limit response
  - **Property 9: Rate-limit retry-after value is faithfully displayed**
  - **Validates: Requirements 3.7, 8.3**
  - In `tests/test_routes.py` using `hypothesis` with `@given(st.integers(min_value=1, max_value=3600))`
  - Mock Gemini client to raise `GeminiRateLimitError` with the generated `retry_after` value
  - POST to `/api/chat` and verify the response JSON contains the exact same integer in the `retry_after` field
  - Run minimum 100 iterations

- [ ]* 7.3 Write property test for API key absence from all responses
  - **Property 15: API key absent from all HTTP responses**
  - **Validates: Requirements 14.1, 6.5, 14.6**
  - In `tests/test_middleware.py` using `hypothesis` with `@given(st.sampled_from(["/", "/api/chat", "/health"]))`
  - Set a recognizable test value for `GEMINI_API_KEY` (e.g., "TEST_SECRET_KEY_12345")
  - For each path, send a request and verify the response body string does not contain "TEST_SECRET_KEY_12345"
  - Run minimum 100 iterations


- [ ] 7.4 Set up frontend test infrastructure
  - Create `package.json` in `tests/frontend/` with `vitest`, `@vitest/browser` (or `jsdom`), and `fast-check` as dev dependencies
  - Configure `vitest.config.js` with environment `jsdom`
  - Ensure tests are runnable with `npx vitest --run`
  - _Requirements: (testing infrastructure)_

- [ ]* 7.5 Write property test for valid message submission clears input
  - **Property 2: Valid message submission clears the input field**
  - **Validates: Requirements 1.4**
  - In `tests/frontend/chat.test.js` using `fast-check`
  - Use `fc.string({ minLength: 1 }).filter(s => s.trim() && s.length <= 10000)`
  - Mock `fetch` to return 200 with `{"reply": "ok"}`
  - After `submitMessage(text)` resolves, assert `#message-input.value === ""`
  - Run minimum 100 iterations

- [ ] 7.6 Checkpoint - Verify full property-based test suite
  - Run `pytest tests/ -v` and confirm all property tests pass
  - Run `npx vitest --run tests/frontend/` and confirm all frontend property tests pass
  - Confirm Hypothesis max_examples is set to at least 100 for each property test
  - Ensure all tests pass, ask the user if questions arise.

### Phase 8: Deployment Configuration and Final Polish

- [ ] 8.1 Configure Render deployment settings
  - Update `render.yaml` with: service type `web`, runtime `python-3.11`, build command `pip install -r requirements.txt`, start command `gunicorn --bind 0.0.0.0:$PORT --workers $WEB_CONCURRENCY app:app`
  - Ensure `PORT` and `WEB_CONCURRENCY` are read from environment in `config.py`
  - Confirm `app.py` uses `config.Config.host = "0.0.0.0"` when deployed (Render sets `HOST` to `0.0.0.0`)
  - _Requirements: 9.1, 9.2, 9.4, 9.5_

- [ ] 8.2 Implement X-Forwarded-Proto handling for HTTPS enforcement
  - In `app.py`, configure `ProxyFix` middleware from `werkzeug.middleware.proxy_fix` with `x_proto=1`
  - In `middleware.py`, redirect HTTP to HTTPS when `X-Forwarded-Proto` is `http` and `FLASK_ENV` is `production`
  - _Requirements: 9.6, 14.5_

- [ ]* 8.3 Write integration tests for deployment configuration
  - Test that a request with `X-Forwarded-Proto: http` in production config returns 301 redirect to HTTPS
  - Test that `GET /health` returns 200 within simulated load
  - Test that `requirements.txt` exists and all entries use `==` pinning (read file and assert with regex)
  - Test that `Procfile` or `render.yaml` exists and contains the string "gunicorn"
  - _Requirements: 9.3, 9.4, 9.6, 13.1_

- [ ] 8.4 Final cross-browser and responsive layout verification
  - In `tests/frontend/ui.test.js`, add tests simulating viewport widths 320px, 480px, 768px, 1280px using jsdom
  - Assert that the chat container does not overflow horizontally at each viewport width
  - Assert all interactive controls (`#send-btn`, `#mic-btn`, `#tts-toggle`, `#clear-btn`) are within the viewport
  - _Requirements: 4.6, 12.7_

- [ ]* 8.5 Write property test for responsive layout at all viewport widths
  - **Property 20: Responsive layout at any viewport width ≥ 320px**
  - **Validates: Requirements 4.6, 12.7**
  - In `tests/frontend/ui.test.js` using `fast-check`
  - Use `fc.integer({ min: 320, max: 1920 })`
  - For each generated viewport width, set `document.documentElement.style.width` and check that `#chat-messages` scrollWidth does not exceed clientWidth
  - Run minimum 100 iterations

- [ ] 8.6 Implement network offline detection
  - In `chat.js`, add an event listener for `window.addEventListener("offline", ...)` 
  - When offline event fires, show a persistent notification in `#notification`: "You are offline. Messages cannot be sent."
  - When `window.addEventListener("online", ...)` fires, dismiss the offline notification
  - _Requirements: 8.6_


- [ ] 8.7 Final integration round-trip tests
  - In `tests/test_routes.py`, add a full round-trip integration test:
    - POST `/api/chat` with message "hello", mocked Gemini returns "world"
    - Assert 200 response with `{"reply": "world"}`
    - Assert session history now contains one user entry and one model entry
  - Add session history carryover test:
    - POST 3 messages in sequence using the same test client session
    - Mock Gemini client to capture the `history` argument on the 3rd call
    - Assert history passed to Gemini contains all 4 previous turns (3 user + 2 model)
  - Add session expiry test with mocked `permanent_session_lifetime` of 0 seconds
  - _Requirements: 3.2, 7.1, 7.2, 7.3, 7.6, 7.7_

- [ ] 8.8 Final checkpoint - Full end-to-end verification
  - Run `pytest tests/ -v --tb=short` and confirm all tests pass
  - Run `npx vitest --run` and confirm all frontend tests pass
  - Confirm the app starts successfully on `PORT=5000` with valid env vars
  - Confirm missing `GEMINI_API_KEY` fails with a clear error
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All property-based tests use `@settings(max_examples=100)` for Hypothesis and equivalent for fast-check
- Property test task comments must include: `# Feature: ai-voice-assistant, Property N: <property text>`
- Each task references specific requirements for traceability
- Checkpoints validate incremental progress; skip if running in fully automated mode
- The frontend uses no build tools (no npm build step, no bundler) — plain ES modules only
- Backend Python version: 3.11; all `requirements.txt` entries pinned with `==`
- Session data is stored in signed cookies (no Redis); the 4KB cookie limit is not a concern at 50 messages
- **Premium UI additions**: `static/css/theme.css` holds all CSS custom properties for dark/light themes; `static/js/settings.js` manages the settings panel and persists preferences to `localStorage`; Lucide icons are loaded from CDN; Google Fonts (Inter/Poppins) loaded via `<link>` in `<head>`
- Dark/light theme is toggled via `data-theme` attribute on `<html>` and persisted to `localStorage` key `voiceai_theme`
- All new icon buttons must include `aria-label` attributes for accessibility
- `#stop-speaking-btn` is hidden by default and shown only while TTS is actively speaking


## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.5"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4", "2.5", "2.6", "3.1"] },
    { "id": 5, "tasks": ["3.2", "3.3", "3.4", "4.1"] },
    { "id": 6, "tasks": ["3.5", "3.6", "4.2", "4.3"] },
    { "id": 7, "tasks": ["4.4", "4.5", "4.6", "5.1"] },
    { "id": 8, "tasks": ["5.2", "5.7", "5.11"] },
    { "id": 9, "tasks": ["5.3", "5.14"] },
    { "id": 10, "tasks": ["5.4", "5.5", "5.6", "5.12", "5.13"] },
    { "id": 11, "tasks": ["5.8", "5.9", "5.10", "6.1"] },
    { "id": 12, "tasks": ["6.2"] },
    { "id": 13, "tasks": ["6.3", "6.4", "6.5", "6.6"] },
    { "id": 14, "tasks": ["6.7", "7.1", "7.4"] },
    { "id": 15, "tasks": ["7.2", "7.3", "7.5"] },
    { "id": 16, "tasks": ["8.1", "8.2"] },
    { "id": 17, "tasks": ["8.3", "8.4", "8.6"] },
    { "id": 18, "tasks": ["8.5", "8.7"] }
  ]
}
```
