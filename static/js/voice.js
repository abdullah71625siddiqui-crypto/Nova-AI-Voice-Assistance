/**
 * voice.js — Nova Voice Module (Phase 6)
 *
 * Responsibilities:
 *  - Integrates Web Speech API for Voice Input (Speech Recognition / STT) and Voice Output (Speech Synthesis / TTS).
 *  - Programmatically activates and enables the HTML voice settings and microphone button on load.
 *  - Toggles recording states and animates the microphone button using existing style sheets.
 *  - Utilizes a MutationObserver to listen for new AI responses and read them aloud.
 *  - Stops active audio output when a new message is sent or the conversation is cleared.
 */

import { getVoiceSettings } from './settings.js';
import { showToast } from './ui.js';

// ─── DOM References ───────────────────────────────────────────────────────────
const dom = {
  micBtn:           document.getElementById('mic-btn'),
  voiceToggle:      document.getElementById('voice-toggle'),
  speechRateSlider: document.getElementById('speech-rate-slider'),
  voiceSelect:      document.getElementById('voice-select'),
  messageInput:     document.getElementById('message-input'),
  chatMessages:     document.getElementById('chat-messages'),
  clearBtn:         document.getElementById('clear-btn'),
  newChatBtn:       document.getElementById('new-chat-btn'),
};

// ─── State Management ─────────────────────────────────────────────────────────
let _recognition = null;
let _isListening = false;

/**
 * Programmatically removes disabled attributes and styles from the voice settings
 * and microphone button elements, activating Phase 6 features on load.
 */
function enableVoiceControls() {
  // Enable the input microphone button
  if (dom.micBtn) {
    dom.micBtn.removeAttribute('disabled');
    dom.micBtn.setAttribute('title', 'Voice input');
    dom.micBtn.setAttribute('aria-label', 'Voice input');
  }

  // Enable the settings panel inputs
  if (dom.voiceToggle)      dom.voiceToggle.removeAttribute('disabled');
  if (dom.speechRateSlider) dom.speechRateSlider.removeAttribute('disabled');
  if (dom.voiceSelect)      dom.voiceSelect.removeAttribute('disabled');

  // Remove the disabled row styles in the settings panel
  document.querySelectorAll('.settings-row--disabled').forEach(row => {
    row.classList.remove('settings-row--disabled');
  });
}

/**
 * Toggles the visual state of the microphone button.
 * Applies the existing pulse animation and highlights the button when listening.
 * @param {boolean} isListening - The active recording state.
 */
function setMicVisualState(isListening) {
  if (!dom.micBtn) return;

  if (isListening) {
    dom.micBtn.classList.add('recording');
    dom.micBtn.style.color = 'var(--color-error)';
    dom.micBtn.style.background = 'var(--color-error-bg)';
    dom.micBtn.style.animation = 'pulse-dot 1.5s infinite';
  } else {
    dom.micBtn.classList.remove('recording');
    dom.micBtn.style.color = '';
    dom.micBtn.style.background = '';
    dom.micBtn.style.animation = '';
  }
}

// ─── Speech Recognition (Speech-to-Text) ──────────────────────────────────────

/**
 * Initializes the Speech Recognition interface if supported by the browser.
 */
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech Recognition is not supported by this browser.');
    return;
  }

  _recognition = new SpeechRecognition();
  _recognition.continuous = false;     // Stop capturing automatically when the user pauses
  _recognition.interimResults = false; // Return only finalized text transcriptions
  _recognition.lang = 'en-US';

  _recognition.onstart = () => {
    _isListening = true;
    setMicVisualState(true);

    // Cancel active TTS speaking when starting voice input
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }

    showToast('Listening... Speak now', 'info', 2000);

    if (dom.messageInput) {
      dom.messageInput.placeholder = 'Listening...';
    }
  };

  _recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    if (transcript && dom.messageInput) {
      const currentVal = dom.messageInput.value.trim();
      dom.messageInput.value = currentVal ? `${currentVal} ${transcript}` : transcript;
      
      // Dispatch input event to automatically resize text area and update counter
      dom.messageInput.dispatchEvent(new Event('input'));
    }
  };

  _recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    if (event.error !== 'no-speech') {
      showToast(`Voice input error: ${event.error}`, 'error');
    }
  };

  _recognition.onend = () => {
    _isListening = false;
    setMicVisualState(false);

    if (dom.messageInput) {
      dom.messageInput.placeholder = 'Ask Nova anything...';
    }
  };
}

/**
 * Starts or stops the speech recognition capture loop.
 */
function toggleListening() {
  if (!_recognition) {
    showToast('Speech recognition is not supported in this browser.', 'warning');
    return;
  }

  if (_isListening) {
    _recognition.stop();
  } else {
    try {
      _recognition.start();
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
    }
  }
}

// ─── Speech Synthesis (Text-to-Speech) ────────────────────────────────────────

/**
 * Reads the specified text aloud using the Web Speech API.
 * @param {string} text - The raw text content to speak.
 */
function speakText(text) {
  if (typeof speechSynthesis === 'undefined') return;

  const settings = getVoiceSettings();
  if (!settings.voiceEnabled) return;

  // Interrupt any active voice synthesis to prevent overlapping speech
  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = settings.speechRate;

  // Match and apply the saved voice profile if specified
  if (settings.voiceName) {
    const voices = speechSynthesis.getVoices();
    const matchedVoice = voices.find(v => v.name === settings.voiceName);
    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }
  }

  speechSynthesis.speak(utterance);
}

/**
 * Sets up a MutationObserver on the chat messages container.
 * When a new AI message row is added, it extracts the spoken text (excluding code blocks)
 * and reads it aloud.
 */
function initChatObserver() {
  if (!dom.chatMessages) return;

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        // 1. If an AI message bubble is added, read its text aloud
        if (node.classList.contains('message-row') && node.classList.contains('ai')) {
          const bubble = node.querySelector('.bubble.ai');
          if (bubble) {
            // Clone the bubble node to strip non-readable code elements safely
            const clone = bubble.cloneNode(true);
            clone.querySelectorAll('pre, code, .code-header, .code-copy-btn, button').forEach(el => el.remove());
            
            const textToSpeak = clone.textContent.trim();
            if (textToSpeak) {
              // Wait slightly for DOM layouts to settle, then speak
              setTimeout(() => speakText(textToSpeak), 150);
            }
          }
        }
        // 2. If a new user message is added, immediately halt any ongoing speech
        else if (node.classList.contains('message-row') && node.classList.contains('user')) {
          if (typeof speechSynthesis !== 'undefined') {
            speechSynthesis.cancel();
          }
        }
      });
    });
  });

  observer.observe(dom.chatMessages, { childList: true });
}

// ─── Initialization ───────────────────────────────────────────────────────────

function init() {
  // 1. Programmatically activate voice controls
  enableVoiceControls();

  // 2. Initialize Speech-to-Text
  initSpeechRecognition();

  // 3. Initialize Text-to-Speech observer
  initChatObserver();

  // 4. Bind event listeners
  dom.micBtn?.addEventListener('click', toggleListening);

  // Stop active speech if the user manually clears the conversation
  const stopSpeech = () => {
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }
  };
  dom.clearBtn?.addEventListener('click', stopSpeech);
  dom.newChatBtn?.addEventListener('click', stopSpeech);
}

// Run initialization
init();
