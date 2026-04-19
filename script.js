let items = [];
let history = [[]];
let historyIndex = 0;

function snapshot() {
  return items.map(i => ({ ...i }));
}

function pushHistory() {
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot());
  historyIndex = history.length - 1;
  updateUndoRedo();
}

function applyHistory() {
  items = history[historyIndex].map(i => ({ ...i }));
  render();
  updateUndoRedo();
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    applyHistory();
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    applyHistory();
  }
}

function updateUndoRedo() {
  document.getElementById('undoBtn').disabled = historyIndex <= 0;
  document.getElementById('redoBtn').disabled = historyIndex >= history.length - 1;
}

function parseLine(line) {
  const m = line.match(/^\[([ xX])\]\s*(.*)$/);
  if (m) return { text: m[2], checked: m[1].toLowerCase() === 'x' };
  return { text: line, checked: false };
}

function createList() {
  const text = document.getElementById('input').value;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  lines.forEach(line => {
    const parsed = parseLine(line);
    if (seen.has(parsed.text)) { duplicates++; return; }
    seen.add(parsed.text);
    unique.push(parsed);
  });
  items = unique.map((parsed, idx) => ({
    id: 'item-' + idx + '-' + Date.now(),
    text: parsed.text,
    originalIndex: idx,
    checked: parsed.checked,
  }));
  applyCheckedVisibility(false);
  pushHistory();
  render();
  if (duplicates > 0) {
    showToast(`${duplicates} duplicate${duplicates > 1 ? 's' : ''} skipped`, 'warning');
  }
}

function toggle(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  item.checked = !item.checked;
  pushHistory();
  render();
}

let editingId = null;
let pendingId = null;

function render() {
  const list = document.getElementById('list');
  list.innerHTML = '';

  const ordered = [...items].sort((a, b) => a.originalIndex - b.originalIndex);
  ordered.forEach(i => list.appendChild(renderItem(i)));

  if (editingId) {
    const input = list.querySelector('.edit-input');
    if (input) { input.focus(); input.select(); }
  }
}

function renderItem(item) {
  const div = document.createElement('div');
  div.className = 'item' + (item.checked ? ' checked' : '');
  div.dataset.id = item.id;

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.title = 'Drag to reorder';
  handle.innerHTML = GRIP_ICON;
  handle.draggable = true;
  handle.addEventListener('dragstart', (e) => onDragStart(e, item.id, div));
  handle.addEventListener('dragend', () => onDragEnd(div));
  div.appendChild(handle);

  div.addEventListener('dragover', (e) => onDragOver(e, div));
  div.addEventListener('drop', (e) => e.preventDefault());

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = item.id;
  cb.checked = item.checked;
  cb.addEventListener('change', () => toggle(item.id));
  div.appendChild(cb);

  if (editingId === item.id) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input';
    input.value = item.text;
    input.addEventListener('blur', () => commitEdit(item.id, input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { cancelEdit(item.id); }
    });
    div.appendChild(input);
  } else {
    const label = document.createElement('label');
    label.htmlFor = item.id;
    label.textContent = item.text;
    label.addEventListener('mousedown', (e) => {
      if (editingId && editingId !== item.id) {
        e.preventDefault();
        switchEditTo(item.id);
      }
    });
    label.addEventListener('click', (e) => {
      e.preventDefault();
      if (editingId !== item.id) {
        editingId = item.id;
        render();
      }
    });
    div.appendChild(label);
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'item-remove';
  removeBtn.title = 'Remove';
  removeBtn.innerHTML = TRASH_ICON;
  removeBtn.addEventListener('click', () => removeItem(item.id));
  div.appendChild(removeBtn);

  return div;
}

function switchEditTo(newId) {
  const currentInput = document.querySelector('.edit-input');
  if (currentInput && editingId) {
    const oldId = editingId;
    const oldItem = items.find(i => i.id === oldId);
    const trimmed = currentInput.value.trim();
    const wasPending = pendingId === oldId;
    pendingId = null;
    if (oldItem) {
      if (!trimmed) {
        items = items.filter(i => i.id !== oldId);
        if (!wasPending) pushHistory();
      } else if (trimmed !== oldItem.text || wasPending) {
        oldItem.text = trimmed;
        pushHistory();
      }
    }
  }
  editingId = newId;
  render();
}

let draggingDiv = null;

function onDragStart(e, id, div) {
  draggingDiv = div;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  setTimeout(() => div.classList.add('dragging'), 0);
}

function onDragEnd(div) {
  div.classList.remove('dragging');
  if (draggingDiv) {
    const list = document.getElementById('list');
    const order = Array.from(list.children).map(el => el.dataset.id);
    const byId = new Map(items.map(i => [i.id, i]));
    const reordered = order.map(id => byId.get(id)).filter(Boolean);
    const changed = reordered.some((i, idx) => items[idx]?.id !== i.id);
    items = reordered;
    reindex();
    if (changed) pushHistory();
  }
  draggingDiv = null;
}

function onDragOver(e, div) {
  if (!draggingDiv || div === draggingDiv) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const rect = div.getBoundingClientRect();
  const above = (e.clientY - rect.top) < rect.height / 2;
  const parent = div.parentNode;
  if (above) {
    if (div.previousSibling !== draggingDiv) parent.insertBefore(draggingDiv, div);
  } else {
    if (div.nextSibling !== draggingDiv) parent.insertBefore(draggingDiv, div.nextSibling);
  }
}

function reindex() {
  items.forEach((i, idx) => { i.originalIndex = idx; });
}

function commitEdit(id, value) {
  const item = items.find(i => i.id === id);
  if (!item) { editingId = null; pendingId = null; return; }
  const trimmed = value.trim();
  const wasPending = pendingId === id;
  editingId = null;
  pendingId = null;
  if (!trimmed) {
    items = items.filter(i => i.id !== id);
    if (!wasPending) pushHistory();
    render();
    return;
  }
  if (trimmed === item.text && !wasPending) { render(); return; }
  if (items.some(i => i.id !== id && i.text === trimmed)) {
    if (wasPending) {
      items = items.filter(i => i.id !== id);
    }
    showToast('Duplicate item not allowed', 'warning');
    render();
    return;
  }
  item.text = trimmed;
  pushHistory();
  render();
}

function cancelEdit(id) {
  if (pendingId === id) {
    items = items.filter(i => i.id !== id);
    pendingId = null;
  }
  editingId = null;
  render();
}

function addItem() {
  const newItem = {
    id: 'item-new-' + Date.now(),
    text: '',
    originalIndex: 0,
    checked: false,
  };
  items.unshift(newItem);
  reindex();
  editingId = newItem.id;
  pendingId = newItem.id;
  render();
}

function removeItem(id) {
  const item = items.find(i => i.id === id);
  items = items.filter(i => i.id !== id);
  pushHistory();
  render();
  if (item) showToast('Item removed: ' + item.text, 'warning', TRASH_ICON);
}

function serializeList() {
  return [...items]
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map(i => `[${i.checked ? 'x' : ' '}] ${i.text}`)
    .join('\n');
}

async function copyToClipboard() {
  const content = serializeList();
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = content;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  showToast('List copied to clipboard');
}

async function pasteFromClipboard() {
  const input = document.getElementById('input');
  try {
    const text = await navigator.clipboard.readText();
    input.value = text;
    showToast('Pasted from clipboard');
  } catch {
    input.focus();
    document.execCommand('paste');
    showToast('Pasted from clipboard');
  }
}

const SUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.77 19.77 0 0 1 4.22-5.38"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.77 19.77 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
const GRIP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 7"/></svg>';
const WARN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const ARROW_UP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
const ARROW_DOWN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  btn.innerHTML = theme === 'dark' ? SUN_ICON : MOON_ICON;
  btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  btn.title = theme === 'dark' ? 'Light' : 'Dark';
  localStorage.setItem('theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function applyEditorVisibility(hidden) {
  const layout = document.getElementById('layout');
  layout.classList.toggle('editor-hidden', hidden);
  const btn = document.getElementById('editorToggle');
  btn.innerHTML = (hidden ? EYE_ICON : EYE_OFF_ICON) +
    '<span>' + (hidden ? 'Show text input' : 'Hide text input') + '</span>';
  localStorage.setItem('editorHidden', hidden ? '1' : '0');
}

function toggleEditor() {
  const hidden = !document.getElementById('layout').classList.contains('editor-hidden');
  applyEditorVisibility(hidden);
}

let sortDirection = 'asc';

function updateSortButton() {
  const btn = document.getElementById('sortBtn');
  const asc = sortDirection === 'asc';
  btn.innerHTML = (asc ? ARROW_UP_ICON : ARROW_DOWN_ICON) +
    '<span>' + (asc ? 'Sort A-Z' : 'Sort Z-A') + '</span>';
}

function toggleSort() {
  const asc = sortDirection === 'asc';
  items.sort((a, b) => asc
    ? a.text.localeCompare(b.text)
    : b.text.localeCompare(a.text));
  reindex();
  pushHistory();
  render();
  sortDirection = asc ? 'desc' : 'asc';
  updateSortButton();
}

function applyCheckedVisibility(hidden) {
  document.getElementById('list').classList.toggle('hide-checked', hidden);
  const btn = document.getElementById('checkedToggle');
  btn.innerHTML = (hidden ? EYE_ICON : EYE_OFF_ICON) +
    '<span>' + (hidden ? 'Show checked' : 'Hide checked') + '</span>';
  localStorage.setItem('checkedHidden', hidden ? '1' : '0');
}

function toggleCheckedVisibility() {
  const hidden = !document.getElementById('list').classList.contains('hide-checked');
  applyCheckedVisibility(hidden);
}

function createQrCode() {
  const content = serializeList();
  if (!content) return;
  const container = document.getElementById('qrCode');
  container.innerHTML = '';
  const portrait = window.innerHeight >= window.innerWidth || window.innerWidth <= 600;
  const vw = window.innerWidth;
  const size = portrait
    ? Math.min(420, Math.floor(vw * 0.9) - 56)
    : 280;
  new QRCode(container, {
    text: content,
    width: size,
    height: size,
    correctLevel: QRCode.CorrectLevel.M,
  });
  document.getElementById('qrText').textContent = content;
  document.getElementById('qrModal').style.display = 'flex';
}

async function copyQrText() {
  const content = document.getElementById('qrText').textContent;
  if (!content) return;
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = content;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  showToast('Text copied to clipboard');
}

async function copyQrCode() {
  const canvas = document.querySelector('#qrCode canvas');
  if (!canvas) return;
  const padding = 24;
  const padded = document.createElement('canvas');
  padded.width = canvas.width + padding * 2;
  padded.height = canvas.height + padding * 2;
  const ctx = padded.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, padded.width, padded.height);
  ctx.drawImage(canvas, padding, padding);
  padded.toBlob(async (blob) => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      showToast('QR code copied to clipboard');
    } catch (err) {
      console.error('Could not copy QR image:', err);
    }
  }, 'image/png');
}

function showToast(message, type = 'success', iconOverride = null) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.className = 'toast ' + (type === 'warning' ? 'warning' : '');
  const icon = iconOverride || (type === 'warning' ? WARN_ICON : CHECK_ICON);
  toast.innerHTML = icon + '<span>' + message + '</span>';
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function closeQrCode() {
  document.getElementById('qrModal').style.display = 'none';
  document.getElementById('qrCode').innerHTML = '';
  document.getElementById('qrText').textContent = '';
}

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (e.key === 'Escape') closeQrCode();
});

applyEditorVisibility(localStorage.getItem('editorHidden') === '1');
applyCheckedVisibility(localStorage.getItem('checkedHidden') === '1');
updateSortButton();
(function initTheme() {
  const saved = localStorage.getItem('theme');
  applyTheme(saved || 'dark');
})();
