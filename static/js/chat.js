/**
 * chat.js — Nova Chat Controller
 *
 * Responsibilities:
 *  - Orchestrates the chat flow between the frontend UI and the Flask backend.
 *  - Handles sending messages to POST /api/chat.
 *  - Handles clearing history via POST /api/clear.
 *  - Leverages ui.js helper functions for rendering, animations, and toasts.
 *  - Manages the sidebar history items dynamically.
 */

import {
  appendMessage,
  showTypingIndicator,
  hideTypingIndicator,
  showToast,
  scrollToBottom,
  setSendLoading,
  setInputDisabled,
  showWelcomeScreen,
  escapeHtml
} from './ui.js';

// ─── DOM References ───────────────────────────────────────────────────────────
const dom = {
  messageInput:   document.getElementById('message-input'),
  sendBtn:        document.getElementById('send-btn'),
  clearBtn:       document.getElementById('clear-btn'),
  newChatBtn:     document.getElementById('new-chat-btn'),
  chatMessages:   document.getElementById('chat-messages'),
  sidebarHistory: document.getElementById('sidebar-history'),
};

// ─── State Management ─────────────────────────────────────────────────────────
let _isFirstMessage = true;

/**
 * Updates the sidebar history list with a new conversation item.
 * @param {string} firstMessageText - The text of the first user message.
 */
function updateSidebarHistory(firstMessageText) {
  if (!dom.sidebarHistory) return;

  // Remove the "No recent chats" placeholder if it exists
  const placeholder = dom.sidebarHistory.querySelector('.history-placeholder');
  if (placeholder) {
    placeholder.remove();
  }

  // Truncate text for the sidebar preview
  const maxLength = 24;
  const titleText = firstMessageText.length > maxLength
    ? firstMessageText.substring(0, maxLength).trim() + '...'
    : firstMessageText;

  // Create the history item button
  const itemBtn = document.createElement('button');
  itemBtn.className = 'history-item';
  itemBtn.setAttribute('role', 'listitem');
  itemBtn.setAttribute('title', firstMessageText); // Full text on hover

  // Construct standard history item with a Lucide message icon
  itemBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" 
         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" 
         stroke-linejoin="round" class="lucide lucide-message-square" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
    <span class="history-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
      ${escapeHtml(titleText)}
    </span>
  `;

  // Clicking the history item indicates it is the current conversation
  itemBtn.addEventListener('click', () => {
    showToast('This is your active conversation', 'info');
  });

  // Insert at the top of the history list
  dom.sidebarHistory.insertBefore(itemBtn, dom.sidebarHistory.firstChild);
}

/**
 * Resets the sidebar history view to show the default placeholder.
 */
function resetSidebarHistory() {
  if (!dom.sidebarHistory) return;

  dom.sidebarHistory.innerHTML = `
    <div class="history-placeholder" aria-label="No previous chats">
      <span class="history-placeholder-text">No recent chats</span>
    </div>
  `;
  _isFirstMessage = true;
}

/**
 * Sends the user message to the Flask backend and handles the AI response.
 */
async function handleSendMessage() {
  if (!dom.messageInput) return;

  const text = dom.messageInput.value.trim();
  
  // Guard against empty submissions
  if (!text) return;

  // Clear the input immediately and trigger the input event to reset textarea height and character count
  dom.messageInput.value = '';
  dom.messageInput.dispatchEvent(new Event('input'));

  // If this is the first message of the session, update the sidebar history
  if (_isFirstMessage) {
    updateSidebarHistory(text);
    _isFirstMessage = false;
  }

  // Append user message bubble to the chat container
  appendMessage('user', text);
  scrollToBottom();

  // Enter loading state and show typing indicator
  setSendLoading(true);
  showTypingIndicator();
  scrollToBottom();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: text })
    });

    // Hide typing indicator before rendering response or error
    hideTypingIndicator();

    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      if (data.reply) {
        appendMessage('ai', data.reply);
      } else {
        throw new Error('Received an empty reply from the server.');
      }
    } else {
      // Handle specific HTTP errors returned by the server
      const errorMsg = data.error || `Server error (Status: ${response.status})`;
      appendMessage('error', errorMsg);
      showToast(errorMsg, 'error');

      // If rate limited, temporarily disable inputs as a premium UX safeguard
      if (response.status === 429 && data.retry_after) {
        const retrySeconds = parseInt(data.retry_after, 10) || 60;
        setInputDisabled(true, `Rate limit reached. Retry in ${retrySeconds}s.`);
        
        setTimeout(() => {
          setInputDisabled(false, '');
          dom.messageInput?.focus();
        }, retrySeconds * 1000);
      }
    }
  } catch (error) {
    // Handle connection timeouts or offline statuses
    hideTypingIndicator();
    
    let errorMsg = 'Failed to communicate with the server. Please try again.';
    if (!navigator.onLine) {
      errorMsg = 'You are offline. Messages cannot be sent.';
    }

    appendMessage('error', errorMsg);
    showToast(errorMsg, 'error');
  } finally {
    // Exit loading state
    setSendLoading(false);
    scrollToBottom();
  }
}

/**
 * Clears the conversation history on both the backend and frontend.
 * @param {boolean} focusInput - Whether to refocus the text input after clearing.
 */
async function handleClearConversation(focusInput = false) {
  try {
    const response = await fetch('/api/clear', {
      method: 'POST'
    });

    if (response.ok) {
      // Remove all message bubbles and the typing row
      const messages = dom.chatMessages.querySelectorAll('.message-row, .typing-row, #typing-indicator');
      messages.forEach(msg => msg.remove());

      // Re-show the welcome screen and reset sidebar history
      showWelcomeScreen();
      resetSidebarHistory();

      // Reset the textarea state
      if (dom.messageInput) {
        dom.messageInput.value = '';
        dom.messageInput.dispatchEvent(new Event('input'));
        if (focusInput) {
          dom.messageInput.focus();
        }
      }

      showToast('Chat history cleared', 'success');
    } else {
      const data = await response.json().catch(() => ({}));
      const errorMsg = data.error || 'Failed to clear conversation history.';
      showToast(errorMsg, 'error');
    }
  } catch (error) {
    showToast('Network error: Failed to clear conversation.', 'error');
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function init() {
  // Bind send button click
  dom.sendBtn?.addEventListener('click', handleSendMessage);

  // Bind clear chat button
  dom.clearBtn?.addEventListener('click', () => handleClearConversation(false));

  // Bind new chat button (clears history and focuses input)
  dom.newChatBtn?.addEventListener('click', () => handleClearConversation(true));
}

// Run initialization
init();
