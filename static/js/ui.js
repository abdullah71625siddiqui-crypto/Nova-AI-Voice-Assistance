/**
 * ui.js — Nova UI module
 *
 * Responsibilities:
 *  - Theme toggle (dark / light / system) with localStorage persistence
 *  - Sidebar collapse, mobile overlay, close button
 *  - Auto-resizing textarea + character counter
 *  - Send-button enable/disable based on input state
 *  - Toast notification system
 *  - Typing indicator show/hide
 *  - Settings panel & About dialog open/close
 *  - Keyboard shortcuts: Enter=send, Shift+Enter=newline, Ctrl+K=focus
 *  - Lucide icon rendering after DOM ready
 *  - Online/offline status badge
 *  - Ripple click effect on buttons
 *  - HTML escaping helper (used by chat.js)
 *  - appendMessage helper (used by chat.js)
 *  - scrollToBottom helper (used by chat.js)
 *
 * Exports (consumed by chat.js):
 *   escapeHtml, appendMessage, showTypingIndicator, hideTypingIndicator,
 *   showToast, scrollToBottom, setSendLoading, setInputDisabled,
 *   showOfflineBanner, hideOfflineBanner, hideWelcomeScreen
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_CHARS = 2000;
const STORAGE_KEY_THEME    = 'nova_theme';
const STORAGE_KEY_SETTINGS = 'nova_settings';

// ─── DOM References ───────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  html:            document.documentElement,
  sidebar:         $('sidebar'),
  sidebarToggle:   $('sidebar-toggle'),
  sidebarClose:    $('sidebar-close-btn'),
  sidebarOverlay:  $('sidebar-overlay'),
  mainArea:        $('main-area'),
  themeToggleBtn:  $('theme-toggle-btn'),
  themeIcon:       $('theme-icon'),
  headerSettingsBtn: $('header-settings-btn'),
  settingsBtn:     $('settings-btn'),
  settingsPanel:   $('settings-panel'),
  settingsOverlay: $('settings-overlay'),
  settingsClose:   $('settings-close-btn'),
  settingsSave:    $('settings-save-btn'),
  themeSelect:     $('theme-select'),
  fontSizeSelect:  $('font-size-select'),
  animationsToggle:$('animations-toggle'),
  aboutBtn:        $('about-btn'),
  aboutDialog:     $('about-dialog'),
  aboutOverlay:    $('about-overlay'),
  aboutClose:      $('about-close-btn'),
  chatMessages:    $('chat-messages'),
  chatContainer:   $('chat-container'),
  welcomeScreen:   $('welcome-screen'),
  messageInput:    $('message-input'),
  sendBtn:         $('send-btn'),
  micBtn:          $('mic-btn'),
  charCounter:     $('char-counter'),
  inputHintText:   $('input-hint-text'),
  toastContainer:  $('toast-container'),
  offlineBanner:   $('offline-banner'),
  statusDot:       $('status-dot'),
  statusText:      $('status-text'),
};

// ─── State ────────────────────────────────────────────────────────────────────
let _sidebarOpen  = window.innerWidth >= 768;
let _isSending    = false;
let _typingRow    = null;
let _toastTimer   = {};

// ─── Theme ────────────────────────────────────────────────────────────────────

/** Return the effective theme, resolving 'system' to 'dark'|'light'. */
function resolveTheme(theme) {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme === 'light' ? 'light' : 'dark';
}

/** Apply a theme to <html data-theme> and update the toggle icon. */
function applyTheme(theme) {
  const resolved = resolveTheme(theme);
  dom.html.setAttribute('data-theme', resolved);
  localStorage.setItem(STORAGE_KEY_THEME, theme); // store original (may be 'system')

  // Swap moon ↔ sun icon
  if (dom.themeIcon) {
    dom.themeIcon.setAttribute('data-lucide', resolved === 'dark' ? 'moon' : 'sun');
    if (window.lucide) lucide.createIcons({ nodes: [dom.themeIcon] });
  }

  // Sync settings select if open
  if (dom.themeSelect) dom.themeSelect.value = theme;
}

/** Toggle between dark and light (ignores 'system', toggles resolved value). */
function toggleTheme() {
  const current = dom.html.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function openSidebar() {
  _sidebarOpen = true;
  dom.sidebar.classList.remove('collapsed');
  dom.sidebarToggle?.setAttribute('aria-expanded', 'true');
  if (window.innerWidth < 768) {
    dom.sidebarOverlay.classList.add('active');
    dom.sidebarOverlay.setAttribute('aria-hidden', 'false');
  }
}

function closeSidebar() {
  _sidebarOpen = false;
  dom.sidebar.classList.add('collapsed');
  dom.sidebarToggle?.setAttribute('aria-expanded', 'false');
  dom.sidebarOverlay.classList.remove('active');
  dom.sidebarOverlay.setAttribute('aria-hidden', 'true');
}

function toggleSidebar() {
  _sidebarOpen ? closeSidebar() : openSidebar();
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function openSettings() {
  dom.settingsPanel?.classList.add('open');
  dom.settingsOverlay?.classList.add('active');
  dom.settingsPanel?.setAttribute('aria-hidden', 'false');
  dom.settingsOverlay?.setAttribute('aria-hidden', 'false');
  dom.settingsBtn?.setAttribute('aria-expanded', 'true');
  dom.headerSettingsBtn?.setAttribute('aria-expanded', 'true');
  // Focus first focusable element
  setTimeout(() => dom.settingsPanel?.querySelector('select, input, button')?.focus(), 50);
}

function closeSettings() {
  dom.settingsPanel?.classList.remove('open');
  dom.settingsOverlay?.classList.remove('active');
  dom.settingsPanel?.setAttribute('aria-hidden', 'true');
  dom.settingsOverlay?.setAttribute('aria-hidden', 'true');
  dom.settingsBtn?.setAttribute('aria-expanded', 'false');
  dom.headerSettingsBtn?.setAttribute('aria-expanded', 'false');
}

// ─── About Dialog ─────────────────────────────────────────────────────────────

function openAbout() {
  dom.aboutDialog?.classList.add('open');
  dom.aboutOverlay?.classList.add('active');
  dom.aboutDialog?.setAttribute('aria-hidden', 'false');
  dom.aboutOverlay?.setAttribute('aria-hidden', 'false');
  setTimeout(() => dom.aboutClose?.focus(), 50);
}

function closeAbout() {
  dom.aboutDialog?.classList.remove('open');
  dom.aboutOverlay?.classList.remove('active');
  dom.aboutDialog?.setAttribute('aria-hidden', 'true');
  dom.aboutOverlay?.setAttribute('aria-hidden', 'true');
}

// ─── Textarea auto-resize + char counter ─────────────────────────────────────

function resizeTextarea() {
  const ta = dom.messageInput;
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
}

function updateCharCounter() {
  const ta = dom.messageInput;
  const counter = dom.charCounter;
  if (!ta || !counter) return;

  const len  = ta.value.length;
  const pct  = len / MAX_CHARS;
  counter.textContent = `${len} / ${MAX_CHARS}`;
  counter.classList.toggle('warn',  pct >= 0.8 && pct < 1);
  counter.classList.toggle('error', pct >= 1);
}

function updateSendButton() {
  const ta = dom.messageInput;
  if (!ta || !dom.sendBtn) return;
  const hasContent = ta.value.trim().length > 0 && ta.value.length <= MAX_CHARS;
  dom.sendBtn.disabled = !hasContent || _isSending;
}

// ─── Send loading state ───────────────────────────────────────────────────────

/** Called by chat.js while waiting for API response. */
export function setSendLoading(loading) {
  _isSending = loading;
  if (!dom.sendBtn) return;
  dom.sendBtn.disabled = loading;
  dom.sendBtn.classList.toggle('loading', loading);
  dom.sendBtn.setAttribute('aria-busy', String(loading));
}

/** Disable/enable the whole input area (e.g. during rate-limit wait). */
export function setInputDisabled(disabled, hintMsg = '') {
  if (dom.messageInput) dom.messageInput.disabled = disabled;
  if (dom.sendBtn)      dom.sendBtn.disabled = disabled;
  if (dom.inputHintText) dom.inputHintText.textContent = hintMsg;
}

// ─── Offline banner ───────────────────────────────────────────────────────────

export function showOfflineBanner() {
  if (dom.offlineBanner) dom.offlineBanner.hidden = false;
  if (dom.statusDot)  dom.statusDot.classList.add('offline');
  if (dom.statusText) dom.statusText.textContent = 'Offline';
}

export function hideOfflineBanner() {
  if (dom.offlineBanner) dom.offlineBanner.hidden = true;
  if (dom.statusDot)  dom.statusDot.classList.remove('offline');
  if (dom.statusText) dom.statusText.textContent = 'Online';
}

// ─── Welcome screen ───────────────────────────────────────────────────────────

export function hideWelcomeScreen() {
  if (dom.welcomeScreen) {
    dom.welcomeScreen.style.display = 'none';
  }
}

export function showWelcomeScreen() {
  if (dom.welcomeScreen) {
    dom.welcomeScreen.style.display = '';
  }
}

// ─── HTML Escaping ────────────────────────────────────────────────────────────

/** Encode HTML special characters — prevents XSS. */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Simple Markdown renderer ─────────────────────────────────────────────────

/**
 * Convert a subset of Markdown to safe HTML.
 * Only called on AI (model) responses — user text is always escaped as plain.
 */
function renderMarkdown(raw) {
  // We escape first, then selectively re-introduce safe HTML.
  // Code blocks — extract before other transforms to avoid double-processing.
  const codeBlocks = [];
  let text = raw.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const langLabel = lang ? escapeHtml(lang) : 'code';
    const escaped = escapeHtml(code.trim());
    codeBlocks.push(
      `<div class="code-header">` +
        `<span>${langLabel}</span>` +
        `<button class="code-copy-btn" data-code="${escaped.replace(/"/g, '&quot;')}" aria-label="Copy code">Copy</button>` +
      `</div>` +
      `<pre><code>${escaped}</code></pre>`
    );
    return `\x00CODE${idx}\x00`;
  });

  // Escape remaining HTML (outside code blocks we already extracted)
  text = text.split('\x00CODE').map((part, i) => {
    if (i === 0) return escapeHtml(part); // first segment
    const match = part.match(/^(\d+)\x00([\s\S]*)$/);
    if (!match) return escapeHtml(part);
    return codeBlocks[parseInt(match[1], 10)] + escapeHtml(match[2]);
  }).join('');

  // Inline code
  text = text.replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`);


  // Headings
  text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  text = text.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // Bold / italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g,         '<em>$1</em>');

  // Blockquote
  text = text.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered list
  text = text.replace(/((?:^[-*] .+\n?)+)/gm, block => {
    const items = block.trim().split('\n')
      .map(line => `<li>${line.replace(/^[-*] /, '')}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered list
  text = text.replace(/((?:^\d+\. .+\n?)+)/gm, block => {
    const items = block.trim().split('\n')
      .map(line => `<li>${line.replace(/^\d+\. /, '')}</li>`)
      .join('');
    return `<ol>${items}</ol>`;
  });

  // Horizontal rule
  text = text.replace(/^---+$/gm, '<hr>');

  // Links
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Paragraphs — wrap double-newline separated blocks
  text = text
    .split(/\n{2,}/)
    .map(para => {
      para = para.trim();
      if (!para) return '';
      if (/^<(h[1-6]|ul|ol|blockquote|pre|hr)/.test(para)) return para;
      return `<p>${para.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return text;
}

// ─── Timestamp ────────────────────────────────────────────────────────────────

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Message Rendering ────────────────────────────────────────────────────────

/**
 * Append a message bubble to #chat-messages.
 * @param {'user'|'ai'|'error'} role
 * @param {string} text  — plain text (user) or markdown (ai)
 * @returns {HTMLElement} the created row element
 */
export function appendMessage(role, text) {
  hideWelcomeScreen();

  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  row.setAttribute('role', 'listitem');

  if (role === 'error') {
    const bubble = document.createElement('div');
    bubble.className = 'bubble error';
    bubble.textContent = text;
    row.appendChild(bubble);
    dom.chatMessages.appendChild(row);
    scrollToBottom();
    return row;
  }

  // Avatar
  const avatar = document.createElement('div');
  avatar.className = `avatar ${role === 'user' ? 'user' : 'ai'}`;
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = role === 'user' ? 'U' : 'AI';

  // Bubble wrapper
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap';

  // Bubble content
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role === 'user' ? 'user' : 'ai'}`;

  if (role === 'user') {
    bubble.textContent = text; // plain — no markdown needed
  } else {
    // AI response — render markdown as safe HTML
    bubble.innerHTML = renderMarkdown(text);
    // Wire code-copy buttons
    bubble.querySelectorAll('.code-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-code')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#039;/g, "'");
        copyToClipboard(code, btn);
      });
    });
  }

  // Metadata row (time + copy button)
  const meta = document.createElement('div');
  meta.className = 'bubble-meta';

  const time = document.createElement('span');
  time.className = 'bubble-time';
  time.textContent = formatTime();
  time.setAttribute('aria-label', `Sent at ${formatTime()}`);
  meta.appendChild(time);

  // Copy / Speak / Regenerate buttons on AI messages
  if (role === 'ai') {
    // Speak button
    const speakBtn = document.createElement('button');
    speakBtn.className = 'copy-btn';
    speakBtn.setAttribute('aria-label', 'Read response aloud');
    speakBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right: 3px; vertical-align: middle;">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    </svg>Speak`;
    speakBtn.addEventListener('click', () => {
      if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.cancel();
        const settingsRaw = localStorage.getItem(STORAGE_KEY_SETTINGS);
        let rate = 1;
        let voiceName = '';
        if (settingsRaw) {
          try {
            const parsed = JSON.parse(settingsRaw);
            rate = parsed.speechRate || 1;
            voiceName = parsed.voiceName || '';
          } catch (e) {}
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate;
        if (voiceName) {
          const voices = speechSynthesis.getVoices();
          const matchedVoice = voices.find(v => v.name === voiceName);
          if (matchedVoice) utterance.voice = matchedVoice;
        }
        speechSynthesis.speak(utterance);
      }
    });

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.setAttribute('aria-label', 'Copy response to clipboard');
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right: 3px; vertical-align: middle;">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>Copy`;
    copyBtn.addEventListener('click', () => copyToClipboard(text, copyBtn));

    // Regenerate (Retry) button
    const regenBtn = document.createElement('button');
    regenBtn.className = 'copy-btn';
    regenBtn.setAttribute('aria-label', 'Regenerate response');
    regenBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right: 3px; vertical-align: middle;">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
    </svg>Retry`;
    regenBtn.addEventListener('click', () => {
      const userMessages = document.querySelectorAll('.message-row.user');
      if (userMessages.length > 0) {
        const lastUserMsg = userMessages[userMessages.length - 1];
        const bubble = lastUserMsg.querySelector('.bubble.user');
        if (bubble && dom.messageInput) {
          dom.messageInput.value = bubble.textContent;
          dom.sendBtn.disabled = false;
          dom.sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      }
    });

    meta.appendChild(speakBtn);
    meta.appendChild(copyBtn);
    meta.appendChild(regenBtn);
  }

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  row.appendChild(avatar);
  row.appendChild(wrap);

  dom.chatMessages.appendChild(row);
  scrollToBottom();
  return row;
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

function copyToClipboard(text, triggerEl) {
  navigator.clipboard.writeText(text).then(() => {
    if (!triggerEl) return;
    const original = triggerEl.innerHTML;
    triggerEl.classList.add('copied');
    triggerEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"></polyline></svg> Copied!`;
    setTimeout(() => {
      triggerEl.classList.remove('copied');
      triggerEl.innerHTML = original;
    }, 1500);
  }).catch(() => showToast('Failed to copy to clipboard', 'error'));
}

// ─── Scroll ───────────────────────────────────────────────────────────────────

export function scrollToBottom(smooth = true) {
  const c = dom.chatContainer;
  if (!c) return;
  c.scrollTo({ top: c.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

export function showTypingIndicator() {
  if (_typingRow) return; // already shown

  const row = document.createElement('div');
  row.className = 'typing-row';
  row.id = 'typing-indicator';
  row.setAttribute('aria-label', 'AI is typing');
  row.setAttribute('aria-live', 'polite');

  const avatar = document.createElement('div');
  avatar.className = 'avatar ai';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'typing-bubble';
  bubble.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'typing-dot';
    bubble.appendChild(dot);
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  dom.chatMessages.appendChild(row);
  _typingRow = row;
  scrollToBottom();
}

export function hideTypingIndicator() {
  if (_typingRow) {
    _typingRow.remove();
    _typingRow = null;
  }
}

// ─── Toast Notifications ──────────────────────────────────────────────────────

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} duration  ms before auto-dismiss (0 = manual only)
 */
export function showToast(message, type = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');

  const icons = { info: 'info', success: 'check-circle', warning: 'alert-triangle', error: 'x-circle' };
  const iconName = icons[type] || 'info';

  toast.innerHTML = `
    <svg class="toast-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      ${_lucidePathFor(iconName)}
    </svg>
    <span class="toast-msg">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Dismiss notification">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>`;

  const dismiss = () => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  dom.toastContainer?.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => toast.classList.add('toast-in'));

  if (duration > 0) {
    const id = setTimeout(dismiss, duration);
    _toastTimer[toast] = id;
  }

  return toast;
}

/** Minimal inline SVG paths for toast icons (avoids CDN dependency). */
function _lucidePathFor(name) {
  const paths = {
    'info':            '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
    'check-circle':    '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
    'alert-triangle':  '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    'x-circle':        '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>',
  };
  return paths[name] || paths['info'];
}

// ─── Ripple Effect ────────────────────────────────────────────────────────────

function addRipple(el) {
  el.addEventListener('click', e => {
    const rect   = el.getBoundingClientRect();
    const size   = Math.max(rect.width, rect.height);
    const x      = e.clientX - rect.left - size / 2;
    const y      = e.clientY - rect.top  - size / 2;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.cssText =
      `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
    el.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  });
}

// ─── Font Size ────────────────────────────────────────────────────────────────

const FONT_SIZES = { sm: '14px', md: '16px', lg: '18px' };

function applyFontSize(size) {
  document.documentElement.style.fontSize = FONT_SIZES[size] || '16px';
  localStorage.setItem('nova_font_size', size);
}

// ─── Settings Persistence ─────────────────────────────────────────────────────

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveSettings(patch = {}) {
  const current = loadSettings();
  const merged  = { ...current, ...patch };
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(merged));
  return merged;
}

function applyLoadedSettings() {
  const s = loadSettings();

  // Font size
  if (s.fontSize && dom.fontSizeSelect) {
    dom.fontSizeSelect.value = s.fontSize;
    applyFontSize(s.fontSize);
  }

  // Animations
  if (s.animations === false) {
    document.documentElement.classList.add('no-animations');
    if (dom.animationsToggle) {
      dom.animationsToggle.checked = false;
      dom.animationsToggle.setAttribute('aria-checked', 'false');
    }
  }
}

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────

function handleKeydown(e) {
  const ta = dom.messageInput;

  // Ctrl+K / Cmd+K — focus input
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    ta?.focus();
    return;
  }

  // Escape — close any open panel
  if (e.key === 'Escape') {
    if (dom.settingsPanel?.classList.contains('open')) { closeSettings(); return; }
    if (dom.aboutDialog?.classList.contains('open'))   { closeAbout();    return; }
    if (_sidebarOpen && window.innerWidth < 768)       { closeSidebar();  return; }
  }
}

function handleTextareaKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!dom.sendBtn?.disabled) {
      dom.sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  }
  // Shift+Enter — default textarea behaviour (newline) — do nothing
}

// ─── Responsive sidebar init ──────────────────────────────────────────────────

function handleResize() {
  if (window.innerWidth >= 768) {
    // Desktop: keep sidebar visible, remove mobile overlay
    dom.sidebarOverlay.classList.remove('active');
    if (!dom.sidebar.classList.contains('collapsed')) _sidebarOpen = true;
  } else {
    // Mobile: always close on resize down
    if (_sidebarOpen) closeSidebar();
  }
}

// ─── Suggestion cards → populate input ───────────────────────────────────────

function wireSuggestionCards() {
  document.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const suggestion = card.getAttribute('data-suggestion');
      if (suggestion && dom.messageInput) {
        dom.messageInput.value = suggestion;
        dom.messageInput.focus();
        resizeTextarea();
        updateCharCounter();
        updateSendButton();
      }
    });
  });
}

// ─── Online / Offline detection ───────────────────────────────────────────────

function initNetworkStatus() {
  window.addEventListener('online',  () => {
    hideOfflineBanner();
    showToast('Connection restored', 'success');
  });
  window.addEventListener('offline', () => {
    showOfflineBanner();
    showToast('You are offline. Messages cannot be sent.', 'warning', 0);
  });

  if (!navigator.onLine) showOfflineBanner();
}

// ─── System theme media query watcher ────────────────────────────────────────

function initSystemThemeWatcher() {
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  mq.addEventListener('change', () => {
    const stored = localStorage.getItem(STORAGE_KEY_THEME) || 'dark';
    if (stored === 'system') applyTheme('system');
  });
}

// ─── Main init ────────────────────────────────────────────────────────────────

function init() {
  // ── Lucide icons ──
  // Lucide is loaded with `defer` so it may already be available.
  // We try immediately, then fall back to DOMContentLoaded timing.
  const renderIcons = () => {
    if (window.lucide) lucide.createIcons();
  };
  renderIcons();
  setTimeout(renderIcons, 200); // safety net for slow CDN

  // ── Theme ──
  const storedTheme = localStorage.getItem(STORAGE_KEY_THEME) || 'dark';
  applyTheme(storedTheme);
  initSystemThemeWatcher();

  // ── Settings persistence ──
  applyLoadedSettings();

  // ── Sidebar initial state ──
  if (window.innerWidth < 768) {
    closeSidebar();
  }

  // ── Event listeners ──

  // Sidebar
  dom.sidebarToggle?.addEventListener('click', toggleSidebar);
  dom.sidebarClose?.addEventListener('click', closeSidebar);
  dom.sidebarOverlay?.addEventListener('click', closeSidebar);

  // Theme toggle button (header)
  dom.themeToggleBtn?.addEventListener('click', toggleTheme);

  // Settings open — both sidebar button and header shortcut
  const openSettingsHandler = () => openSettings();
  dom.settingsBtn?.addEventListener('click', openSettingsHandler);
  dom.headerSettingsBtn?.addEventListener('click', openSettingsHandler);
  dom.settingsClose?.addEventListener('click', closeSettings);
  dom.settingsOverlay?.addEventListener('click', closeSettings);

  // Settings save
  dom.settingsSave?.addEventListener('click', () => {
    const themeVal     = dom.themeSelect?.value    || 'dark';
    const fontSizeVal  = dom.fontSizeSelect?.value || 'md';
    const animVal      = dom.animationsToggle?.checked ?? true;

    applyTheme(themeVal);
    applyFontSize(fontSizeVal);
    document.documentElement.classList.toggle('no-animations', !animVal);
    saveSettings({ theme: themeVal, fontSize: fontSizeVal, animations: animVal });
    closeSettings();
    showToast('Settings saved', 'success');
  });

  // Theme select — live preview
  dom.themeSelect?.addEventListener('change', e => applyTheme(e.target.value));

  // Font size select — live preview
  dom.fontSizeSelect?.addEventListener('change', e => applyFontSize(e.target.value));

  // Animations toggle — live preview
  dom.animationsToggle?.addEventListener('change', e => {
    document.documentElement.classList.toggle('no-animations', !e.target.checked);
    e.target.setAttribute('aria-checked', String(e.target.checked));
  });

  // About dialog
  dom.aboutBtn?.addEventListener('click', openAbout);
  dom.aboutClose?.addEventListener('click', closeAbout);
  dom.aboutOverlay?.addEventListener('click', closeAbout);

  // Textarea
  dom.messageInput?.addEventListener('input', () => {
    resizeTextarea();
    updateCharCounter();
    updateSendButton();
  });
  dom.messageInput?.addEventListener('keydown', handleTextareaKeydown);

  // Global keyboard shortcuts
  document.addEventListener('keydown', handleKeydown);

  // Resize
  window.addEventListener('resize', handleResize);

  // Suggestion cards
  wireSuggestionCards();

  // Network status
  initNetworkStatus();

  // Ripple on interactive buttons
  document.querySelectorAll(
    '.sidebar-btn, .send-btn, .icon-btn, .header-toggle, .panel-save-btn'
  ).forEach(addRipple);

  // Initial state
  updateCharCounter();
  updateSendButton();
  resizeTextarea();
}

// Run after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
