/**
 * settings.js — Nova Settings Module
 *
 * Responsibilities:
 *  - Manages voice-specific configuration settings (Voice activation, Speech Rate, Voice profile).
 *  - Synchronizes voice settings with the shared localStorage object.
 *  - Dynamically queries and populates the system's text-to-speech voices using the Web Speech API.
 *  - Exports getter functions for other modules (such as voice.js in Phase 6).
 */

const STORAGE_KEY = 'nova_settings';

// ─── DOM References ───────────────────────────────────────────────────────────
const dom = {
  voiceToggle:      document.getElementById('voice-toggle'),
  speechRateSlider: document.getElementById('speech-rate-slider'),
  speechRateValue:  document.getElementById('speech-rate-value'),
  voiceSelect:      document.getElementById('voice-select'),
  settingsSaveBtn:  document.getElementById('settings-save-btn'),
};

// ─── Core Storage Access ──────────────────────────────────────────────────────

/**
 * Loads all settings from localStorage.
 * @returns {Object} The complete settings object.
 */
function loadAllSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Persists voice-specific settings by merging them into the shared storage.
 * @param {Object} voicePatch - The voice settings fields to update.
 */
function saveVoiceSettings(voicePatch) {
  const current = loadAllSettings();
  const merged = { ...current, ...voicePatch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch (e) {
    console.error('Failed to save voice settings to localStorage:', e);
  }
}

// ─── Public API (consumed by voice.js in Phase 6) ─────────────────────────────

/**
 * Returns the currently active voice and speech rate settings.
 * @returns {Object} `{ voiceEnabled: boolean, speechRate: number, voiceName: string }`
 */
export function getVoiceSettings() {
  const s = loadAllSettings();
  return {
    voiceEnabled: s.voiceEnabled ?? false,
    speechRate:   parseFloat(s.speechRate) || 1.0,
    voiceName:    s.voiceName || '',
  };
}

// ─── Speech Synthesis Voice Population ────────────────────────────────────────

/**
 * Queries the Web Speech API for available system voices and populates the select element.
 */
function populateSystemVoices() {
  if (typeof speechSynthesis === 'undefined' || !dom.voiceSelect) return;

  const voices = speechSynthesis.getVoices();
  
  // Retain the default system option
  dom.voiceSelect.innerHTML = '<option value="">Default System Voice</option>';

  voices.forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.name;
    // Format label with voice name and language code
    option.textContent = `${voice.name} (${voice.lang})`;
    dom.voiceSelect.appendChild(option);
  });

  // Restore the previously saved voice selection
  const saved = getVoiceSettings();
  if (saved.voiceName) {
    dom.voiceSelect.value = saved.voiceName;
  }
}

// ─── Initialization & Event Binding ───────────────────────────────────────────

/**
 * Initializes settings values from storage and binds interactive events.
 */
function init() {
  const saved = getVoiceSettings();

  // 1. Initialize UI values from storage
  if (dom.voiceToggle) {
    dom.voiceToggle.checked = saved.voiceEnabled;
    dom.voiceToggle.setAttribute('aria-checked', String(saved.voiceEnabled));
  }

  if (dom.speechRateSlider) {
    dom.speechRateSlider.value = saved.speechRate;
    dom.speechRateSlider.setAttribute('aria-valuenow', String(saved.speechRate));
  }

  if (dom.speechRateValue) {
    dom.speechRateValue.textContent = `${saved.speechRate.toFixed(1)}×`;
  }

  // 2. Populate voices and bind Web Speech API load event
  populateSystemVoices();
  if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = populateSystemVoices;
  }

  // 3. Bind slider drag interactions for real-time value preview
  dom.speechRateSlider?.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value) || 1.0;
    if (dom.speechRateValue) {
      dom.speechRateValue.textContent = `${value.toFixed(1)}×`;
    }
    e.target.setAttribute('aria-valuenow', String(value));
  });

  // 4. Bind save button click to commit voice settings alongside appearance settings
  dom.settingsSaveBtn?.addEventListener('click', () => {
    const voiceEnabled = dom.voiceToggle ? dom.voiceToggle.checked : false;
    const speechRate   = dom.speechRateSlider ? parseFloat(dom.speechRateSlider.value) : 1.0;
    const voiceName    = dom.voiceSelect ? dom.voiceSelect.value : '';

    saveVoiceSettings({
      voiceEnabled,
      speechRate,
      voiceName
    });
  });
}

// Run initialization
init();
