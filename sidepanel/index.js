/* global Summarizer */
import DOMPurify from 'dompurify';
import { marked } from 'marked';

const MAX_MODEL_CHARS = 4000;

let pageContent = '';
let pageUrl = '';

const summaryElement = document.querySelector('#summary');
const warningElement = document.querySelector('#warning');
const summaryTypeSelect = document.querySelector('#type');
const summaryFormatSelect = document.querySelector('#format');
const summaryLengthSelect = document.querySelector('#length');
const copyBtn = document.querySelector('#copyBtn');
const shareBtn = document.querySelector('#shareBtn');

[summaryTypeSelect, summaryFormatSelect, summaryLengthSelect].forEach((e) =>
  e.addEventListener('change', onConfigChange)
);

copyBtn.addEventListener('click', copySummary);
shareBtn.addEventListener('click', shareOnLinkedIn);

chrome.storage.session.get(['pageContent', 'pageUrl'], ({ pageContent, pageUrl: url }) => {
  pageUrl = url || '';
  onContentChange(pageContent);
});

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.pageContent) onContentChange(changes.pageContent.newValue);
  if (changes.pageUrl) pageUrl = changes.pageUrl.newValue;
});

function onConfigChange() {
  const oldContent = pageContent;
  pageContent = '';
  onContentChange(oldContent);
}

async function onContentChange(newContent) {
  if (pageContent === newContent) return;
  pageContent = newContent;

  if (!newContent) {
    showSummary("There's nothing to summarize.");
    return;
  }

  if (newContent.length > MAX_MODEL_CHARS) {
    updateWarning(`⚠️ Text too long (${newContent.length} chars, max ~4000).`);
  } else {
    updateWarning('');
  }

  showSummary('Loading summary...');
  const summary = await generateSummary(newContent);
  showSummary(summary);
}

async function generateSummary(text) {
  try {
    if (!('Summarizer' in self)) return 'Summarizer API not available in this browser.';

    const options = {
      type: summaryTypeSelect.value,
      format: summaryFormatSelect.value,
      length: summaryLengthSelect.value,
      expectedInputLanguages: ['en'],
      outputLanguage: 'en',
      expectedContextLanguages: ['en'],
      sharedContext: 'Summarizing online articles for sharing.',
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          showSummary(`Downloading model... ${(e.loaded * 100).toFixed(1)}%`);
        });
      },
    };

    const availability = await Summarizer.availability();
    if (availability === 'unavailable') return 'Summarizer API is unavailable.';
    if (availability === 'after-download' && !navigator.userActivation.isActive)
      return 'User interaction required to download model.';

    const summarizer = await Summarizer.create(options);
    const summary = await summarizer.summarize(text, {
      context: 'Summarizing webpage content for quick sharing.',
    });
    summarizer.destroy();
    return summary;
  } catch (e) {
    console.error('Summary generation failed:', e);
    return `Error: ${e.message}`;
  }
}

function showSummary(text) {
  summaryElement.innerHTML = DOMPurify.sanitize(marked.parse(text));
}

function updateWarning(warning) {
  warningElement.textContent = warning;
  warning ? warningElement.removeAttribute('hidden') : warningElement.setAttribute('hidden', '');
}

async function copySummary() {
  const text = summaryElement.innerText.trim();
  if (!text) return alert('No summary to copy!');
  await navigator.clipboard.writeText(`${text}\n\nRead full article: ${pageUrl}`);
  alert('✅ Summary copied to clipboard!');
}

function shareOnLinkedIn() {
  const summaryText = summaryElement.innerText.trim();
  if (!summaryText) return alert('No summary to share!');
  const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
    pageUrl
  )}&summary=${encodeURIComponent(summaryText)}`;
  window.open(linkedInUrl, '_blank');
}
