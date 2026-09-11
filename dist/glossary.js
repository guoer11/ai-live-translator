import { config } from './config.js';
import { authorize } from './src/auth.js';

const $ = id => document.getElementById(id);
let token = '';
let items = [];
let filtered = [];

function message(text = '', error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}

async function api(path = '', options = {}) {
  const response = await fetch(`${config.sessionEndpoint}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '操作失敗，請稍後再試。');
  return data;
}

function resetForm() {
  $('id').value = '';
  $('source').value = '';
  $('target').value = '';
  $('language').value = 'ja';
  $('category').value = '寶可夢名稱';
  $('note').value = '';
  $('enabled').checked = true;
  $('form-title').textContent = '新增詞彙';
  message();
}

function render() {
  const q = $('search').value.trim().toLowerCase();
  filtered = items.filter(item => !q || [item.source_text, item.target_text, item.category, item.note, item.language]
    .some(value => String(value || '').toLowerCase().includes(q)));
  $('count').textContent = String(items.length);
  const frag = document.createDocumentFragment();
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = q ? '找不到符合的詞彙' : '目前沒有詞彙';
    frag.append(empty);
  }
  for (const item of filtered) {
    const card = document.createElement('article');
    card.className = `term${item.enabled ? '' : ' off'}`;

    const main = document.createElement('div');
    main.className = 'term-main';
    const source = document.createElement('div'); source.className = 'term-source'; source.textContent = item.source_text;
    const arrow = document.createElement('div'); arrow.className = 'arrow'; arrow.textContent = '→';
    const target = document.createElement('div'); target.className = 'term-target'; target.textContent = item.target_text;
    main.append(source, arrow, target);

    const meta = document.createElement('div'); meta.className = 'meta';
    for (const text of [item.language === 'ja' ? '日文' : item.language === 'en' ? '英文' : item.language === 'ko' ? '韓文' : '共用', item.category || '其他', item.enabled ? '啟用' : '停用']) {
      const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = text; meta.append(badge);
    }
    if (item.note) { const note = document.createElement('span'); note.textContent = item.note; meta.append(note); }

    const actions = document.createElement('div'); actions.className = 'term-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary'; edit.textContent = '編輯';
    edit.onclick = () => editItem(item);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'danger'; del.textContent = '刪除';
    del.onclick = () => removeItem(item);
    actions.append(edit, del);
    card.append(main, meta, actions);
    frag.append(card);
  }
  $('list').replaceChildren(frag);
}

function editItem(item) {
  $('id').value = String(item.id);
  $('source').value = item.source_text || '';
  $('target').value = item.target_text || '';
  $('language').value = item.language || 'ja';
  $('category').value = item.category || '其他';
  $('note').value = item.note || '';
  $('enabled').checked = item.enabled !== false;
  $('form-title').textContent = '編輯詞彙';
  message(`正在編輯：${item.source_text}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('source').focus({ preventScroll: true });
}

async function load() {
  message('正在載入詞彙…');
  const data = await api('?action=glossary.list');
  items = Array.isArray(data.items) ? data.items : [];
  message();
  render();
}

async function removeItem(item) {
  if (!confirm(`確定刪除「${item.source_text} → ${item.target_text}」？`)) return;
  try {
    message('正在刪除…');
    await api('', { method: 'POST', body: JSON.stringify({ action: 'glossary.delete', id: item.id }) });
    if ($('id').value === String(item.id)) resetForm();
    await load();
    message('詞彙已刪除。');
  } catch (error) { message(error.message, true); }
}

$('form').onsubmit = async event => {
  event.preventDefault();
  const item = {
    id: $('id').value ? Number($('id').value) : null,
    source_text: $('source').value,
    target_text: $('target').value,
    language: $('language').value,
    category: $('category').value,
    note: $('note').value,
    enabled: $('enabled').checked,
  };
  try {
    message('正在儲存…');
    await api('', { method: 'POST', body: JSON.stringify({ action: 'glossary.save', item }) });
    resetForm();
    await load();
    message('詞彙已儲存，下次建立翻譯連線就會套用。');
  } catch (error) { message(error.message, true); }
};

$('search').oninput = render;
$('new').onclick = resetForm;
$('cancel').onclick = resetForm;

(async () => {
  try {
    const verified = await authorize();
    token = verified.token;
    $('account').textContent = `${verified.email} · 詞彙管理`;
    await load();
  } catch (error) {
    $('account').textContent = '無法開啟詞彙管理';
    message(`${error.message} 請先返回翻譯首頁登入。`, true);
    $('form').querySelectorAll('input,select,button').forEach(el => el.disabled = true);
  }
})();
