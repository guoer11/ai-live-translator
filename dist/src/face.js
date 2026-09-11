import { prepareTranscript } from './language.js';

const HISTORY_KEY = 'translator.history.v1';
const LABELS = { en: 'English', ja: '日本語', ko: '한국어' };
const $ = id => document.getElementById(id);

function latestHistoryItem() {
  try {
    const items = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(items)) return null;
    return [...items].reverse().find(item => item && (String(item.original || '').trim() || String(item.translated || '').trim())) || null;
  } catch {
    return null;
  }
}

export function splitFaceTexts(row, pair = 'en') {
  const original = String(row?.original || '').trim();
  const translated = String(row?.translated || '').trim();
  if (!original && !translated) return { chinese: '', foreign: '' };

  const parsed = prepareTranscript(original, pair);
  if (parsed?.sourceLanguage === 'zh') {
    return { chinese: original, foreign: translated };
  }
  if (parsed?.sourceLanguage) {
    return { chinese: translated, foreign: original };
  }

  return { chinese: translated, foreign: original };
}

function refreshFace() {
  const pair = $('language')?.value || 'en';
  const item = latestHistoryItem();
  const { chinese, foreign } = splitFaceTexts(item, pair);
  const pending = item?.status === 'pending';

  $('face-foreign-label').textContent = `對方閱讀 · ${LABELS[pair]}`;
  $('face-chinese-label').textContent = '我閱讀 · 繁體中文';
  $('face-foreign-text').textContent = foreign || (pending ? '翻譯中…' : '對方語言會顯示在這裡');
  $('face-chinese-text').textContent = chinese || (pending ? '翻譯中…' : '繁體中文會顯示在這裡');
}

function setFaceMode(enabled) {
  const facePanel = $('face-panel');
  const conversationPanel = document.querySelector('.conversation-panel');
  const toggle = $('display-toggle');
  if (!facePanel || !conversationPanel || !toggle) return;

  conversationPanel.hidden = enabled;
  facePanel.hidden = !enabled;
  document.body.classList.toggle('face-mode', enabled);
  toggle.classList.toggle('active', enabled);
  toggle.setAttribute('aria-pressed', String(enabled));
  toggle.setAttribute('aria-label', enabled ? '切換一般字幕顯示' : '切換面對面顯示');
  toggle.title = enabled ? '切換一般字幕顯示' : '切換面對面顯示';
  if (enabled) refreshFace();
}

function initFaceDisplay() {
  const toggle = $('display-toggle');
  const history = $('history');
  const language = $('language');
  if (!toggle || !history || !language) return;

  toggle.addEventListener('click', () => setFaceMode(!$('face-panel').hidden));
  language.addEventListener('change', refreshFace);
  new MutationObserver(refreshFace).observe(history, { childList: true, subtree: true, characterData: true });
  refreshFace();
}

if (typeof document !== 'undefined') initFaceDisplay();
