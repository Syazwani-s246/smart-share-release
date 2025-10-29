/* global Summarizer, chrome */
import DOMPurify from "dompurify";
import { marked } from "marked";

// ═══════════════════════════════════════════════════════════
// 🎯 CONSTANTS & CONFIG
// ═══════════════════════════════════════════════════════════

const MAX_MODEL_CHARS = 4000;
const MIN_CONTENT_LENGTH = 100;

const STATES = {
  INITIALIZING: 'initializing',
  READY: 'ready',
  ERROR_UNSUPPORTED: 'error-unsupported',
  ERROR_NO_CONTENT: 'error-no-content',
  ERROR_EXTRACTION: 'error-extraction',
  DOWNLOADING: 'downloading',
  SUMMARIZING: 'summarizing',
  COMPLETE: 'complete',
  CANCELLED: 'cancelled'
};

const UNSUPPORTED_DOMAINS = [
  'mail.google.com',
  'gmail.com',
  'youtube.com',
  'netflix.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'reddit.com',
  'chrome://',
  'chrome-extension://'
];

const GREETINGS = [
  "Hey there! Want me to summarize this article for you?",
  "This looks interesting – should I make it shareable?",
  "Need a quick summary before sharing it?",
  "Got a long read here 😅 want a short version?",
  "✨ Let's make this article LinkedIn-ready – summarize it?"
];

// ═══════════════════════════════════════════════════════════
// 🎨 DOM ELEMENTS
// ═══════════════════════════════════════════════════════════

const summaryElement = document.querySelector("#summary");
const warningElement = document.querySelector("#warning");
const summaryTypeSelect = document.querySelector("#type");
const summaryFormatSelect = document.querySelector("#format");
const summaryLengthSelect = document.querySelector("#length");
const settingsFieldset = document.querySelector("#settings");

const historyList = document.querySelector("#historyList");
const copyBtn = document.querySelector("#copyBtn");
const shareBtn = document.querySelector("#shareBtn");
const toggleHistoryBtn = document.querySelector("#toggleHistory");
const historyPanel = document.querySelector("#historyPanel");

const chatContainer = document.getElementById("chatContainer");
const chatMessage = document.getElementById("chatMessage");
const chatActions = document.getElementById("chatActions");

const settingsCard = document.getElementById("settingsCard");
const summaryCard = document.getElementById("summary");
const actionButtons = document.getElementById("actionButtons");

// ═══════════════════════════════════════════════════════════
// 📊 STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════

let currentState = STATES.INITIALIZING;
let pageContent = "";
let currentUrl = "";
let summarizerInstance = null;
let lastSummary = "";
let validationError = null;

// ═══════════════════════════════════════════════════════════
// 🎬 INITIALIZATION
// ═══════════════════════════════════════════════════════════

async function initialize() {
  console.log('[SmartShare:Panel] Initializing...');
  
  // Collapse sidebar by default
  historyPanel.classList.add('collapsed');
  
  // Load history
  loadHistory();
  
  // Setup event listeners
  setupEventListeners();
  
  // Check for existing content
  const { pageContent: storedContent, pageUrl: storedUrl } = 
    await chrome.storage.session.get(["pageContent", "pageUrl"]);
  
  if (storedContent && storedUrl) {
    console.log('[SmartShare:Panel] Found stored content');
    currentUrl = storedUrl;
    const validation = validateContent(storedContent, storedUrl);
    
    if (validation.valid) {
      pageContent = storedContent;
      setState(STATES.READY);
    } else {
      validationError = validation;
      setState(validation.state);
    }
  } else {
    // Extract content from current tab
    console.log('[SmartShare:Panel] No stored content, extracting...');
    updateChatMessage("🔍 Reading this page...");
    await extractCurrentPage();
  }
}

// ═══════════════════════════════════════════════════════════
// 🎯 CONTENT EXTRACTION & VALIDATION
// ═══════════════════════════════════════════════════════════

async function extractCurrentPage() {
  try {
    const response = await chrome.runtime.sendMessage({ 
      action: "extractContent" 
    });
    
    if (!response.success) {
      console.error('[SmartShare:Panel] Extraction failed:', response.error);
      validationError = {
        message: "Our model is still learning how to read this page 🧠",
        state: STATES.ERROR_EXTRACTION
      };
      setState(STATES.ERROR_EXTRACTION);
      return;
    }
    
    currentUrl = response.url;
    const validation = validateContent(response.content, response.url);
    
    if (validation.valid) {
      pageContent = response.content;
      setState(STATES.READY);
    } else {
      validationError = validation;
      setState(validation.state);
    }
    
  } catch (error) {
    console.error('[SmartShare:Panel] Extract error:', error);
    validationError = {
      message: "Our model is still learning how to read this page 🧠",
      state: STATES.ERROR_EXTRACTION
    };
    setState(STATES.ERROR_EXTRACTION);
  }
}

function validateContent(content, url) {
  // Check 1: URL supported?
  try {
    const domain = new URL(url).hostname;
    const isUnsupported = UNSUPPORTED_DOMAINS.some(blocked => 
      domain.includes(blocked) || blocked.includes(domain)
    );
    
    if (isUnsupported) {
      return {
        valid: false,
        state: STATES.ERROR_UNSUPPORTED,
        message: `It looks like you're on ${domain} - we can't summarize this yet 😅`
      };
    }
  } catch (e) {
    return {
      valid: false,
      state: STATES.ERROR_UNSUPPORTED,
      message: "This page can't be summarized 😅"
    };
  }
  
  // Check 2: Enough content?
  if (!content || content.trim().length < MIN_CONTENT_LENGTH) {
    return {
      valid: false,
      state: STATES.ERROR_NO_CONTENT,
      message: "Hmm, there's too little text here to summarize 🤔"
    };
  }
  
  return { valid: true };
}

// ═══════════════════════════════════════════════════════════
// 🎨 STATE MANAGEMENT & UI UPDATES
// ═══════════════════════════════════════════════════════════

function setState(newState) {
  console.log('[SmartShare:State]', currentState, '→', newState);
  currentState = newState;
  updateUI();
}

function updateUI() {
  switch (currentState) {
    case STATES.INITIALIZING:
      showInitializing();
      break;
    case STATES.READY:
      showReady();
      break;
    case STATES.ERROR_UNSUPPORTED:
    case STATES.ERROR_NO_CONTENT:
    case STATES.ERROR_EXTRACTION:
      showError();
      break;
    case STATES.DOWNLOADING:
      showDownloading();
      break;
    case STATES.SUMMARIZING:
      showSummarizing();
      break;
    case STATES.COMPLETE:
      showComplete();
      break;
    case STATES.CANCELLED:
      showCancelled();
      break;
  }
}

function showInitializing() {
  chatContainer.className = 'card chat-section';
  chatActions.innerHTML = '';
  chatActions.hidden = true;
  hideMainUI();
}

function showReady() {
  chatContainer.className = 'card chat-section';
  const randomGreeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  updateChatMessage(randomGreeting);
  
  chatActions.innerHTML = `
    <button id="chatYes" class="btn-primary">✨ Yes, summarize it!</button>
    <button id="chatNo" class="btn">No, maybe later</button>
  `;
  chatActions.hidden = false;
  
  // Re-attach event listeners
  document.getElementById('chatYes').addEventListener('click', handleYesClick);
  document.getElementById('chatNo').addEventListener('click', handleNoClick);
  
  hideMainUI();
}

function showError() {
  chatContainer.className = 'card error-section';
  updateChatMessage(validationError.message);
  
  chatActions.innerHTML = `
    <button id="retryBtn" class="btn-primary">🔄 Try Again</button>
  `;
  chatActions.hidden = false;
  
  document.getElementById('retryBtn').addEventListener('click', handleRetry);
  
  hideMainUI();
}

function showDownloading() {
  chatContainer.className = 'card chat-section compact';
  updateChatMessage("📦 Downloading AI model...");
  
  chatActions.innerHTML = `
    <div class="progress-bar"><div id="progressFill" class="progress-fill" style="width: 0%"></div></div>
    <button id="cancelBtn" class="btn outline small">Cancel</button>
  `;
  chatActions.hidden = false;
  
  document.getElementById('cancelBtn').addEventListener('click', handleCancel);
  
  showMainUI(true); // Show but disabled
}

function showSummarizing() {
  chatContainer.className = 'card chat-section compact';
  updateChatMessage("🧠 Summarizing... please wait");
  
  chatActions.innerHTML = `
    <button id="cancelBtn" class="btn outline small">Cancel</button>
  `;
  chatActions.hidden = false;
  
  document.getElementById('cancelBtn').addEventListener('click', handleCancel);
  
  showMainUI(true); // Show but disabled
  summaryElement.textContent = "⏳ Working on it...";
  summaryCard.hidden = false;
}

function showComplete() {
  chatContainer.className = 'card chat-section compact';
  updateChatMessage("✅ Summary ready! Share it below 👇");
  
  chatActions.innerHTML = `
    <button id="summarizeAgain" class="btn outline small">🔄 Summarize Again</button>
  `;
  chatActions.hidden = false;
  
  document.getElementById('summarizeAgain').addEventListener('click', handleSummarizeAgain);
  
  showMainUI(false); // Show and enabled
  
  // Fade in animation
  summaryCard.classList.add('fade-in');
  setTimeout(() => summaryCard.classList.remove('fade-in'), 400);
  
  // Auto-scroll to summary
  setTimeout(() => {
    summaryCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function showCancelled() {
  chatContainer.className = 'card chat-section';
  updateChatMessage("Cancelled. Want to try again?");
  
  chatActions.innerHTML = `
    <button id="restartBtn" class="btn-primary">✨ Yes, summarize it!</button>
    <button id="cancelledNo" class="btn">No thanks</button>
  `;
  chatActions.hidden = false;
  
  document.getElementById('restartBtn').addEventListener('click', handleYesClick);
  document.getElementById('cancelledNo').addEventListener('click', handleNoClick);
  
  showMainUI(false);
  summaryCard.hidden = true;
  actionButtons.hidden = true;
}

function updateChatMessage(text) {
  chatMessage.textContent = text;
}

function hideMainUI() {
  settingsCard.hidden = true;
  summaryCard.hidden = true;
  actionButtons.hidden = true;
}

function showMainUI(disabled = false) {
  settingsCard.hidden = false;
  summaryCard.hidden = false;
  actionButtons.hidden = false;
  settingsFieldset.disabled = disabled;
}

// ═══════════════════════════════════════════════════════════
// 🎬 EVENT HANDLERS
// ═══════════════════════════════════════════════════════════

function setupEventListeners() {
  // Settings changes
  [summaryTypeSelect, summaryFormatSelect, summaryLengthSelect].forEach((e) =>
    e.addEventListener("change", handleSettingsChange)
  );
  
  // Buttons
  copyBtn.addEventListener("click", copySummary);
  shareBtn.addEventListener("click", shareOnLinkedIn);
  toggleHistoryBtn.addEventListener("click", () => {
    historyPanel.classList.toggle("collapsed");
  });
}

async function handleYesClick() {
  console.log('[SmartShare:Action] User clicked Yes');
  setState(STATES.DOWNLOADING);
  await startSummarization();
}

function handleNoClick() {
  console.log('[SmartShare:Action] User clicked No');
  updateChatMessage("No worries 😊 I'll be here when you need me!");
  chatActions.hidden = true;
}

async function handleRetry() {
  console.log('[SmartShare:Action] User clicked Retry');
  setState(STATES.INITIALIZING);
  updateChatMessage("🔍 Reading this page...");
  await extractCurrentPage();
}

function handleCancel() {
  console.log('[SmartShare:Action] User cancelled');
  if (summarizerInstance) {
    summarizerInstance.destroy();
    summarizerInstance = null;
  }
  setState(STATES.CANCELLED);
}

async function handleSummarizeAgain() {
  console.log('[SmartShare:Action] User wants to summarize again');
  if (pageContent) {
    setState(STATES.DOWNLOADING);
    await startSummarization();
  }
}

async function handleSettingsChange() {
  if (currentState === STATES.COMPLETE && pageContent) {
    console.log('[SmartShare:Action] Settings changed, re-summarizing');
    setState(STATES.SUMMARIZING);
    await generateAndShowSummary();
  }
}

// ═══════════════════════════════════════════════════════════
// 🤖 SUMMARIZATION ENGINE
// ═══════════════════════════════════════════════════════════

async function startSummarization() {
  if (!pageContent) {
    console.error('[SmartShare:AI] No content to summarize');
    setState(STATES.ERROR_NO_CONTENT);
    return;
  }
  
  // Check content length warning
  if (pageContent.length > MAX_MODEL_CHARS) {
    updateWarning(`⚠️ Text too long (${pageContent.length} chars, max ~4000).`);
  } else {
    updateWarning("");
  }
  
  await generateAndShowSummary();
}

async function generateAndShowSummary() {
  try {
    if (!("Summarizer" in self)) {
      showSummary("Summarizer API unavailable in this browser.");
      setState(STATES.COMPLETE);
      return;
    }
    
    // Check availability
    const availability = await Summarizer.availability();
    console.log('[SmartShare:AI] Availability:', availability);
    
    if (availability === "unavailable") {
      showSummary("Summarizer API is unavailable.");
      setState(STATES.COMPLETE);
      return;
    }
    
    // Setup options with progress monitoring
    const options = {
      type: summaryTypeSelect.value,
      format: summaryFormatSelect.value,
      length: summaryLengthSelect.value,
      expectedInputLanguages: ["en"],
      outputLanguage: "en",
      expectedContextLanguages: ["en"],
      sharedContext: "Summarizing online articles for sharing.",
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          const progress = Math.round(e.loaded * 100);
          console.log('[SmartShare:AI] Download progress:', progress + '%');
          
          if (currentState === STATES.DOWNLOADING) {
            updateChatMessage(`📦 Downloading AI model... ${progress}%`);
            const progressBar = document.getElementById('progressFill');
            if (progressBar) {
              progressBar.style.width = progress + '%';
            }
          }
        });
      },
    };
    
    // Create summarizer
    console.log('[SmartShare:AI] Creating summarizer...');
    summarizerInstance = await Summarizer.create(options);
    
    // Start summarizing
    setState(STATES.SUMMARIZING);
    console.log('[SmartShare:AI] Summarizing...');
    
    const summary = await summarizerInstance.summarize(pageContent, {
      context: "Summarizing webpage content for quick sharing.",
    });
    
    summarizerInstance.destroy();
    summarizerInstance = null;
    
    console.log('[SmartShare:AI] Summary generated:', summary.length, 'chars');
    lastSummary = summary;
    showSummary(summary);
    setState(STATES.COMPLETE);
    
    // Save to history
    await saveToHistory(summary, 'success');
    
  } catch (error) {
    console.error('[SmartShare:AI] Error:', error);
    showSummary(`Error: ${error.message}`);
    setState(STATES.COMPLETE);
    await saveToHistory(error.message, 'error');
  }
}

function showSummary(text) {
  // Clean up duplicated "Read full article" lines
  const cleaned = (text || "")
    .replace(/Read full article[:\-]?.*/gi, "")
    .trim();
  
  const cleanHTML = DOMPurify.sanitize(marked.parse(cleaned));
  summaryElement.innerHTML = cleanHTML;
}

function updateWarning(msg) {
  warningElement.textContent = msg;
  warningElement.hidden = !msg;
}

// ═══════════════════════════════════════════════════════════
// 📚 HISTORY MANAGEMENT
// ═══════════════════════════════════════════════════════════

async function saveToHistory(summary, status = 'success') {
  if (!currentUrl) return;
  
  const newItem = {
    url: currentUrl,
    summary,
    status, // 'success' or 'error'
    date: new Date().toLocaleString(),
    settings: {
      type: summaryTypeSelect.value,
      format: summaryFormatSelect.value,
      length: summaryLengthSelect.value
    }
  };
  
  const { history = [] } = await chrome.storage.local.get("history");
  const updated = [newItem, ...history].slice(0, 20);
  await chrome.storage.local.set({ history: updated });
  loadHistory();
}

async function loadHistory() {
  const { history = [] } = await chrome.storage.local.get("history");
  historyList.innerHTML = "";
  
  if (!history.length) {
    historyList.innerHTML = `<p class="empty" style="color: var(--text-2); font-size: 0.85rem; padding: var(--size-2);">No summaries yet.</p>`;
    return;
  }
  
  history.forEach((item) => {
    const domain = item.url.split("/")[2] || "Unknown site";
    const firstLine = item.summary.split("\n")[0].slice(0, 80);
    const statusIcon = item.status === 'success' ? '✅' : '⚠️';
    
    const el = document.createElement("div");
    el.className = "history-item";
    el.innerHTML = `
      <b>${statusIcon} ${domain}</b><br/>
      <small style="color: var(--text-2);">${item.date}</small><br/>
      <p style="margin: 0.25rem 0 0 0; font-size: 0.8rem;">${firstLine}...</p>
    `;
    
    el.addEventListener("click", () => {
      showSummary(item.summary);
      currentUrl = item.url;
      lastSummary = item.summary;
      
      // Update to complete state
      if (currentState !== STATES.COMPLETE) {
        setState(STATES.COMPLETE);
      }
    });
    
    historyList.appendChild(el);
  });
}

// ═══════════════════════════════════════════════════════════
// 📋 COPY & SHARE FUNCTIONS
// ═══════════════════════════════════════════════════════════

async function copySummary() {
  const text = summaryElement.innerText.trim();
  if (!text) return alert("No summary to copy!");
  
  const copyText = `${text}\n\nRead full article: ${currentUrl}`;
  await navigator.clipboard.writeText(copyText);
  alert("✅ Summary copied to clipboard!");
}

async function shareOnLinkedIn() {
  const summaryText = summaryElement.innerText.trim();
  if (!summaryText) return alert("No summary to share!");
  
  const caption = `${summaryText}\n\nRead full article: ${currentUrl}`;
  await navigator.clipboard.writeText(caption);
  
  const linkedInUrl = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(caption)}`;
  window.open(linkedInUrl, "_blank");
  alert("✅ Summary copied and opened in LinkedIn. You can paste if needed!");
}

// ═══════════════════════════════════════════════════════════
// 🚀 START THE APP
// ═══════════════════════════════════════════════════════════

initialize();