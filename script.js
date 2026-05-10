let items = [];
let history = [[]];
let historyIndex = 0;

let textareaHistory = [''];
let textareaHistoryIndex = 0;
let textareaActiveLine = 1;
let showUncheckedBrackets = false;

let lists = [];
let activeListId = null;
let renamingListId = null;
let pendingListId = null;
let pendingListPrevActiveId = null;
let deletedListUndo = null;

let listOrderHistory = [[]];
let listOrderHistoryIndex = 0;

let draggingTabEl = null;
let tabTouchStartX = 0;
let tabTouchDragging = false;

let addItemInsertIndex = null; // null = after all items, number = before item at that index
let addItemAbove = localStorage.getItem('addItemAbove') !== '0';

function generateId() {
  return 'list-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

function getActiveList() {
  return lists.find(l => l.id === activeListId);
}

function saveCurrentListItems() {
  const list = getActiveList();
  if (list) list.items = items.map(i => ({ ...i }));
}

function saveCurrentState() {
  if (currentView === 'text') {
    const text = document.getElementById('input').value;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const seen = new Set();
    items = [];
    lines.forEach((line, idx) => {
      const parsed = parseLine(line);
      if (seen.has(parsed.text)) return;
      seen.add(parsed.text);
      items.push({ id: 'item-' + idx + '-' + Date.now(), text: parsed.text, originalIndex: idx, checked: parsed.checked });
    });
  }
  saveCurrentListItems();
}

function loadActiveListState() {
  const list = getActiveList();
  items = list ? list.items.map(i => ({ ...i })) : [];
  history = [items.map(i => ({ ...i }))];
  historyIndex = 0;
  editingId = null;
  pendingId = null;
  if (currentView === 'text') {
    const ta = document.getElementById('input');
    ta.value = serializeList();
    initTextareaHistory();
  } else {
    render();
  }
  updateUndoRedo();
}

function switchList(id) {
  if (id === activeListId) return;
  saveCurrentState();
  saveToStorage();
  activeListId = id;
  loadActiveListState();
  localStorage.setItem('checklist-active', activeListId);
  renderListTabs();
}

function addList() {
  saveCurrentState();
  const id = generateId();
  pendingListId = id;
  pendingListPrevActiveId = activeListId;
  lists.unshift({ id, name: 'List ' + (lists.length + 1), items: [] });
  activeListId = id;
  items = [];
  history = [[]];
  historyIndex = 0;
  editingId = null;
  pendingId = null;
  if (currentView === 'text') {
    document.getElementById('input').value = '';
    initTextareaHistory();
  } else {
    render();
  }
  updateUndoRedo();
  saveToStorage();
  renderListTabs();
  setTimeout(() => startRenameList(id), 0);
}

function deleteList(id) {
  if (lists.length <= 1) return;
  const list = lists.find(l => l.id === id);
  if (!list) return;
  showConfirm(`Delete "${list.name}"?`, () => performDeleteList(id));
}

function performDeleteList(id) {
  if (lists.length <= 1) return;
  const idx = lists.findIndex(l => l.id === id);
  if (idx === -1) return;
  const snapshot = { ...lists[idx], items: lists[idx].items.map(i => ({ ...i })) };
  const wasActive = activeListId === id;
  lists = lists.filter(l => l.id !== id);
  if (wasActive) {
    activeListId = lists[Math.min(idx, lists.length - 1)].id;
    loadActiveListState();
  }
  saveToStorage();
  renderListTabs();
  deletedListUndo = { list: snapshot, idx, wasActive };
  updateUndoRedo();
  showUndoToast(`"${snapshot.name}" deleted`);
}

function undoDeleteList() {
  if (!deletedListUndo) return;
  const { list, idx, wasActive } = deletedListUndo;
  deletedListUndo = null;
  lists.splice(idx, 0, list);
  if (wasActive) {
    activeListId = list.id;
    loadActiveListState();
  }
  saveToStorage();
  renderListTabs();
  updateUndoRedo();
  showToast(`"${list.name}" restored`);
}

function showConfirm(message, onOk) {
  let modal = document.getElementById('confirmModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'confirmModal';
    modal.className = 'confirm-modal';
    modal.innerHTML =
      '<div class="confirm-content">' +
        '<p id="confirmMsg"></p>' +
        '<div class="confirm-actions">' +
          '<button class="secondary" id="confirmCancelBtn">Cancel</button>' +
          '<button class="secondary danger" id="confirmOkBtn">Delete</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
  }
  document.getElementById('confirmMsg').textContent = message;
  modal.style.display = 'flex';
  document.getElementById('confirmOkBtn').onclick = () => { modal.style.display = 'none'; onOk(); };
  document.getElementById('confirmCancelBtn').onclick = () => { modal.style.display = 'none'; };
  modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };

  const handleEscapeKey = (e) => {
    if (e.key === 'Escape' && modal.style.display !== 'none') {
      modal.style.display = 'none';
      document.removeEventListener('keydown', handleEscapeKey);
    }
  };
  document.addEventListener('keydown', handleEscapeKey);
}

function showUndoToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.className = 'toast warning';
  toast.innerHTML = TRASH_ICON + '<span>' + message + '</span>';
  const undoBtn = document.createElement('button');
  undoBtn.className = 'toast-undo';
  undoBtn.textContent = 'Undo';
  undoBtn.addEventListener('click', () => {
    toast.classList.remove('show');
    clearTimeout(toast._hideTimer);
    undoDeleteList();
  });
  toast.appendChild(undoBtn);
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 5000);
}

function measureTextWidth(text, el) {
  const canvas = measureTextWidth._canvas || (measureTextWidth._canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  const style = window.getComputedStyle(el);
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return ctx.measureText(text).width;
}

function startRenameList(id) {
  renamingListId = id;
  renderListTabs();

  const input = document.querySelector('.list-tab-input') || document.querySelector('.list-menu-input');
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function commitRenameList(id, name) {
  if (renamingListId !== id) return;
  const list = lists.find(l => l.id === id);
  if (list) list.name = name.trim() || list.name;
  renamingListId = null;
  pendingListId = null;
  pendingListPrevActiveId = null;
  saveToStorage();
  renderListTabs();
}

function cancelRenameList() {
  if (pendingListId && pendingListId === renamingListId) {
    lists = lists.filter(l => l.id !== pendingListId);
    activeListId = pendingListPrevActiveId || lists[0]?.id;
    pendingListId = null;
    pendingListPrevActiveId = null;
    renamingListId = null;
    loadActiveListState();
    saveToStorage();
    renderListTabs();
    return;
  }
  renamingListId = null;
  renderListTabs();
}

function moveTabOver(targetTab, clientX) {
  if (!draggingTabEl || targetTab === draggingTabEl) return;
  if (targetTab.parentNode !== draggingTabEl.parentNode) return;
  const rect = targetTab.getBoundingClientRect();
  const before = (clientX - rect.left) < rect.width / 2;
  const parent = targetTab.parentNode;
  if (before) {
    if (targetTab.previousSibling !== draggingTabEl) parent.insertBefore(draggingTabEl, targetTab);
  } else {
    if (targetTab.nextSibling !== draggingTabEl) parent.insertBefore(draggingTabEl, targetTab.nextSibling);
  }
}

function moveDropdownItemOver(targetItem, clientY) {
  if (!draggingTabEl || targetItem === draggingTabEl) return;
  if (targetItem.parentNode !== draggingTabEl.parentNode) return;
  const rect = targetItem.getBoundingClientRect();
  const above = (clientY - rect.top) < rect.height / 2;
  const parent = targetItem.parentNode;
  if (above) {
    if (targetItem.previousSibling !== draggingTabEl) parent.insertBefore(draggingTabEl, targetItem);
  } else {
    if (targetItem.nextSibling !== draggingTabEl) parent.insertBefore(draggingTabEl, targetItem.nextSibling);
  }
}

function snapshotListOrder() {
  return lists.map(l => l.id);
}

function pushListOrderHistory() {
  listOrderHistory = listOrderHistory.slice(0, listOrderHistoryIndex + 1);
  listOrderHistory.push(snapshotListOrder());
  listOrderHistoryIndex = listOrderHistory.length - 1;
  updateUndoRedo();
}

function applyListOrder(order) {
  const byId = new Map(lists.map(l => [l.id, l]));
  lists = order.map(id => byId.get(id)).filter(Boolean);
}

function commitTabReorder() {
  const dropdown = document.querySelector('.list-menu-dropdown');
  if (!dropdown) return;
  const items = Array.from(dropdown.querySelectorAll('.list-menu-item'));
  const idOrder = items.map(i => i.dataset.id);
  const changed = idOrder.some((id, idx) => lists[idx]?.id !== id);
  if (changed) {
    applyListOrder(idOrder);
    pushListOrderHistory();
    saveToStorage();
    renderListTabs();
  }
}

function renderListTabs() {
  const container = document.getElementById('listTabs');
  if (!container) {
    setTimeout(() => renderListTabs(), 100);
    return;
  }
  const wasDropdownOpen = document.querySelector('.list-menu-dropdown')?.classList.contains('open') ?? false;
  container.innerHTML = '';

  const listMenuWrapper = document.createElement('div');
  listMenuWrapper.className = 'list-menu-wrapper';

  const listMenuBtn = document.createElement('button');
  listMenuBtn.className = 'secondary list-menu-btn';
  listMenuBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>Lists';
  listMenuBtn.title = 'All lists';

  const dropdown = document.createElement('div');
  dropdown.className = 'list-menu-dropdown';

  lists.forEach(list => {
    const item = document.createElement('button');
    item.className = 'secondary list-menu-item' + (list.id === activeListId ? ' active' : '');
    item.dataset.id = list.id;
    item.draggable = true;

    const handle = document.createElement('span');
    handle.className = 'list-menu-handle';
    handle.innerHTML = GRIP_ICON;
    handle.draggable = true;
    item.appendChild(handle);

    const editBtn = document.createElement('button');
    editBtn.className = 'list-menu-edit-btn';
    editBtn.innerHTML = PENCIL_ICON;
    editBtn.title = 'Rename list';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startRenameList(list.id);
    });
    item.appendChild(editBtn);

    const nameWrap = document.createElement('div');
    nameWrap.className = 'list-menu-name-wrap';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'list-menu-name' + (renamingListId === list.id ? ' renaming' : '');
    nameSpan.textContent = list.name;
    nameWrap.appendChild(nameSpan);

    if (renamingListId === list.id) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'list-menu-input';
      input.value = list.name;
      input.addEventListener('input', () => { nameSpan.textContent = input.value || ' '; });
      input.addEventListener('blur', () => commitRenameList(list.id, input.value));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelRenameList(); }
      });
      input.addEventListener('click', e => e.stopPropagation());
      nameWrap.appendChild(input);
    }

    item.appendChild(nameWrap);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'item-remove';
    removeBtn.innerHTML = TRASH_ICON;
    removeBtn.title = 'Delete list';
    removeBtn.disabled = lists.length <= 1;
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteList(list.id);
    });
    item.appendChild(removeBtn);

    item.addEventListener('click', (e) => {
      if (!tabTouchDragging && !document.body.classList.contains('dragging-list')) {
        switchList(list.id);
      }
    });
    item.addEventListener('dragover', (e) => {
      if (!draggingTabEl || item === draggingTabEl) return;
      e.preventDefault();
      moveDropdownItemOver(item, e.clientY);
    });
    item.addEventListener('drop', (e) => e.preventDefault());

    handle.addEventListener('dragstart', (e) => {
      draggingTabEl = item;
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      commitTabReorder();
      draggingTabEl = null;
    });
    handle.addEventListener('touchstart', (e) => {
      e.preventDefault();
      tabTouchStartX = e.touches[0].clientX;
      draggingTabEl = item;
      tabTouchDragging = true;
      item.classList.add('dragging');
      document.body.classList.add('dragging-list');
    }, { passive: false });
    handle.addEventListener('touchmove', (e) => {
      if (!draggingTabEl) return;
      e.preventDefault();
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetItem = el && el.closest('.list-menu-item');
      if (targetItem && targetItem !== draggingTabEl) moveDropdownItemOver(targetItem, touch.clientY);
    }, { passive: false });
    handle.addEventListener('touchend', () => {
      if (tabTouchDragging) {
        item.classList.remove('dragging');
        commitTabReorder();
      }
      draggingTabEl = null;
      tabTouchDragging = false;
      document.body.classList.remove('dragging-list');
    });
    handle.addEventListener('touchcancel', () => {
      item.classList.remove('dragging');
      draggingTabEl = null;
      tabTouchDragging = false;
      document.body.classList.remove('dragging-list');
    });
    dropdown.appendChild(item);
  });

  function positionDropdown() {
    const rect = listMenuBtn.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.left = rect.left + 'px';
  }

  listMenuBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (dropdown.classList.contains('open')) {
      dropdown.classList.remove('open');
      window.removeEventListener('scroll', positionDropdown);
    } else {
      dropdown.classList.add('open');
      positionDropdown();
      window.addEventListener('scroll', positionDropdown);
    }
  });

  dropdown.addEventListener('dragover', (e) => {
    if (!draggingTabEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const items = Array.from(dropdown.querySelectorAll('.list-menu-item'));
    const lastItem = items[items.length - 1];
    if (lastItem && e.clientY > lastItem.getBoundingClientRect().bottom) {
      if (lastItem.nextSibling !== draggingTabEl) {
        dropdown.insertBefore(draggingTabEl, null);
      }
    }
  });

  dropdown.addEventListener('drop', (e) => e.preventDefault());

  document.addEventListener('click', e => {
    if (!listMenuWrapper.contains(e.target) && !document.body.classList.contains('dragging-list')) {
      dropdown.classList.remove('open');
      window.removeEventListener('scroll', positionDropdown);
    }
  });

  listMenuWrapper.appendChild(listMenuBtn);
  listMenuWrapper.appendChild(dropdown);
  container.appendChild(listMenuWrapper);

  const addBtn = document.createElement('button');
  addBtn.className = 'list-tab-add';
  addBtn.title = 'New list';
  addBtn.textContent = '+';
  addBtn.addEventListener('click', addList);
  container.appendChild(addBtn);

  const tabsScroller = document.createElement('div');
  tabsScroller.className = 'list-tabs-scroller';
  container.appendChild(tabsScroller);

  lists.forEach(list => {
    const tab = document.createElement('div');
    tab.className = 'list-tab' + (list.id === activeListId ? ' active' : '');
    tab.dataset.id = list.id;

    if (renamingListId === list.id && !document.querySelector('.list-menu-input')) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'list-tab-input';
      input.value = list.name;
      input.addEventListener('blur', () => commitRenameList(list.id, input.value));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelRenameList(); }
      });
      input.addEventListener('click', e => e.stopPropagation());
      tab.appendChild(input);
    } else {
      const nameBtn = document.createElement('button');
      nameBtn.className = 'list-tab-btn';
      nameBtn.textContent = list.name;
      nameBtn.title = 'Switch to ' + list.name;
      nameBtn.addEventListener('click', () => switchList(list.id));
      tab.appendChild(nameBtn);
    }

    tabsScroller.appendChild(tab);
  });


  if (wasDropdownOpen) {
    const dropdown = container.querySelector('.list-menu-dropdown');
    if (dropdown) {
      dropdown.classList.add('open');
      const listMenuBtn = container.querySelector('.list-menu-wrapper button');
      if (listMenuBtn) {
        const rect = listMenuBtn.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 4) + 'px';
        dropdown.style.left = rect.left + 'px';
      }
    }
  }
}

function initTextareaHistory() {
  const val = document.getElementById('input').value;
  textareaHistory = [val];
  textareaHistoryIndex = 0;
  textareaActiveLine = 1;
}

function pushTextareaHistory(val) {
  if (val === textareaHistory[textareaHistoryIndex]) return;
  textareaHistory = textareaHistory.slice(0, textareaHistoryIndex + 1);
  textareaHistory.push(val);
  textareaHistoryIndex = textareaHistory.length - 1;
  updateUndoRedo();
}

function getTextareaLine() {
  const ta = document.getElementById('input');
  return ta.value.substring(0, ta.selectionStart).split('\n').length;
}

function onTextareaInput() {
  const val = document.getElementById('input').value;
  const prevLines = textareaHistory[textareaHistoryIndex].split('\n').length;
  const currLines = val.split('\n').length;
  if (currLines !== prevLines) {
    textareaActiveLine = getTextareaLine();
    pushTextareaHistory(val);
  }
}

function onTextareaCursorMove() {
  const line = getTextareaLine();
  if (line !== textareaActiveLine) {
    textareaActiveLine = line;
    pushTextareaHistory(document.getElementById('input').value);
  }
}

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
  if (deletedListUndo) {
    undoDeleteList();
    return;
  }
  if (listOrderHistoryIndex > 0) {
    listOrderHistoryIndex--;
    applyListOrder(listOrderHistory[listOrderHistoryIndex]);
    saveToStorage();
    renderListTabs();
    updateUndoRedo();
    return;
  }
  if (currentView === 'text') {
    if (textareaHistoryIndex > 0) {
      textareaHistoryIndex--;
      document.getElementById('input').value = textareaHistory[textareaHistoryIndex];
      updateUndoRedo();
    }
    return;
  }
  if (historyIndex > 0) {
    historyIndex--;
    applyHistory();
  }
}

function redo() {
  if (listOrderHistoryIndex < listOrderHistory.length - 1) {
    listOrderHistoryIndex++;
    applyListOrder(listOrderHistory[listOrderHistoryIndex]);
    saveToStorage();
    renderListTabs();
    updateUndoRedo();
    return;
  }
  if (currentView === 'text') {
    if (textareaHistoryIndex < textareaHistory.length - 1) {
      textareaHistoryIndex++;
      document.getElementById('input').value = textareaHistory[textareaHistoryIndex];
      updateUndoRedo();
    }
    return;
  }
  if (historyIndex < history.length - 1) {
    historyIndex++;
    applyHistory();
  }
}

function updateUndoRedo() {
  const canUndo = !!deletedListUndo || listOrderHistoryIndex > 0 || (currentView === 'text' ? textareaHistoryIndex > 0 : historyIndex > 0);
  const canRedo = listOrderHistoryIndex < listOrderHistory.length - 1 || (currentView === 'text'
    ? textareaHistoryIndex < textareaHistory.length - 1
    : historyIndex < history.length - 1);
  document.getElementById('undoBtn').disabled = !canUndo;
  document.getElementById('redoBtn').disabled = !canRedo;
}

function parseLine(line) {
  const m = line.match(/^\[([ xX])\]\s*(.*)$/);
  if (m) return { text: m[2], checked: m[1].toLowerCase() === 'x' };
  return { text: line, checked: false };
}

let currentView = localStorage.getItem('currentView') || 'text';

function applyView() {
  const layout = document.getElementById('layout');
  layout.dataset.view = currentView;
  document.getElementById('tabText').classList.toggle('active', currentView === 'text');
  document.getElementById('tabChecklist').classList.toggle('active', currentView === 'checklist');
  document.querySelectorAll('[data-text-only]').forEach(el => {
    el.style.display = currentView === 'text' ? '' : 'none';
  });
  document.querySelectorAll('[data-checklist-only]').forEach(el => {
    el.style.display = currentView === 'checklist' ? '' : 'none';
  });
}

function switchView(view) {
  if (view === 'checklist') {
    parseTextToList();
  } else {
    const ta = document.getElementById('input');
    ta.value = serializeList();
    initTextareaHistory();
  }
  currentView = view;
  updateUndoRedo();
  updateClearBtn();
  localStorage.setItem('currentView', view);
  applyView();
}

function parseTextToList() {
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
  render();
  if (duplicates > 0) {
    showToast(`${duplicates} duplicate${duplicates > 1 ? 's' : ''} skipped`, 'warning');
  }
}

function createList() {
  switchView('checklist');
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
let cursorPosition = null;

function saveToStorage() {
  saveCurrentListItems();
  localStorage.setItem('checklist-lists', JSON.stringify(lists));
  localStorage.setItem('checklist-active', activeListId);
  if (addItemInsertIndex !== null) {
    localStorage.setItem('checklist-add-row', addItemInsertIndex);
  } else {
    localStorage.removeItem('checklist-add-row');
  }
}

function loadFromStorage() {
  try {
    const savedLists = localStorage.getItem('checklist-lists');
    const savedActive = localStorage.getItem('checklist-active');
    if (savedLists) {
      lists = JSON.parse(savedLists);
    } else {
      const oldItems = localStorage.getItem('checklist-items');
      const id = generateId();
      lists = [{ id, name: 'Today', items: oldItems ? JSON.parse(oldItems) : [] }];
    }
    if (!lists.length) {
      lists = [{ id: generateId(), name: 'Today', items: [] }];
    }
    activeListId = (savedActive && lists.find(l => l.id === savedActive)) ? savedActive : lists[0].id;
    const savedAddRow = localStorage.getItem('checklist-add-row');
    addItemInsertIndex = savedAddRow !== null ? Number(savedAddRow) : null;
    listOrderHistory = [snapshotListOrder()];
    listOrderHistoryIndex = 0;
    loadActiveListState();
    renderListTabs();
  } catch {
    lists = [{ id: generateId(), name: 'Today', items: [] }];
    activeListId = lists[0].id;
    listOrderHistory = [snapshotListOrder()];
    listOrderHistoryIndex = 0;
    renderListTabs();
  }
}

function render() {
  saveToStorage();
  const list = document.getElementById('list');
  const addRow = list.querySelector('.add-item-row');

  Array.from(list.querySelectorAll('.item')).forEach(el => el.remove());

  const ordered = [...items].sort((a, b) => a.originalIndex - b.originalIndex);
  const splitAt = addItemInsertIndex !== null ? Math.min(addItemInsertIndex, ordered.length) : ordered.length;

  ordered.slice(0, splitAt).forEach(i => list.insertBefore(renderItem(i), addRow));
  ordered.slice(splitAt).forEach(i => list.appendChild(renderItem(i)));

  if (editingId) {
    const input = list.querySelector('.edit-input');
    if (input) {
      input.focus();
      if (cursorPosition !== null) {
        input.setSelectionRange(cursorPosition, cursorPosition);
        cursorPosition = null;
      } else {
        input.select();
      }
    }
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
  handle.addEventListener('touchstart', (e) => onTouchStart(e, div), { passive: false });
  handle.addEventListener('touchmove', (e) => onTouchMove(e), { passive: false });
  handle.addEventListener('touchend', () => onTouchEnd(div));
  handle.addEventListener('touchcancel', () => onTouchEnd(div));
  div.appendChild(handle);

  div.addEventListener('dragover', (e) => onDragOver(e, div));
  div.addEventListener('drop', (e) => e.preventDefault());

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = item.id;
  cb.checked = item.checked;
  cb.addEventListener('change', () => toggle(item.id));
  div.appendChild(cb);

  const wrap = document.createElement('div');
  wrap.className = 'item-label-wrap';

  const label = document.createElement('label');
  label.htmlFor = item.id;
  label.textContent = item.text;
  label.addEventListener('click', (e) => {
    e.preventDefault();

    const rect = label.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const canvas = measureTextWidth._canvas || (measureTextWidth._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    const style = window.getComputedStyle(label);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

    let pos = 0;
    for (let i = 0; i <= item.text.length; i++) {
      const width = ctx.measureText(item.text.substring(0, i)).width;
      if (width > clickX) break;
      pos = i;
    }

    cursorPosition = pos;

    if (editingId === item.id) {
      const input = document.querySelector('.edit-input');
      if (input) input.setSelectionRange(pos, pos);
    } else if (editingId) {
      switchEditTo(item.id);
    } else {
      editingId = item.id;
      render();
    }
  });
  wrap.appendChild(label);

  if (editingId === item.id) {
    label.classList.add('editing');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input';
    input.value = item.text;
    input.addEventListener('blur', () => commitEdit(item.id, input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { cancelEdit(item.id); }
    });
    wrap.appendChild(input);
  }

  div.appendChild(wrap);

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

    const addRow = list.querySelector('.add-item-row');
    if (addRow) {
      const siblings = Array.from(list.children);
      const countBefore = siblings.slice(0, siblings.indexOf(addRow)).filter(el => el.classList.contains('item')).length;
      addItemInsertIndex = countBefore < reordered.length ? countBefore : null;
    }

    const changed = reordered.some((i, idx) => items[idx]?.id !== i.id);
    items = reordered;
    reindex();
    if (changed) pushHistory();
    saveToStorage();
  }
  draggingDiv = null;
}

function onDragOver(e, div) {
  if (!draggingDiv || div === draggingDiv) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  moveDraggingOver(div, e.clientY);
}

function moveDraggingOver(div, clientY) {
  const rect = div.getBoundingClientRect();
  const above = (clientY - rect.top) < rect.height / 2;
  const parent = div.parentNode;
  if (above) {
    if (div.previousSibling !== draggingDiv) parent.insertBefore(draggingDiv, div);
  } else {
    if (div.nextSibling !== draggingDiv) parent.insertBefore(draggingDiv, div.nextSibling);
  }
}

function onTouchStart(e, div) {
  e.preventDefault();
  draggingDiv = div;
  div.classList.add('dragging');
}

function onTouchMove(e) {
  if (!draggingDiv) return;
  e.preventDefault();
  const touch = e.touches[0];
  const target = document.elementFromPoint(touch.clientX, touch.clientY);
  if (!target) return;
  const targetItem = target.closest('.item, .add-item-row');
  if (!targetItem || targetItem === draggingDiv) return;
  if (targetItem.parentNode !== draggingDiv.parentNode) return;
  moveDraggingOver(targetItem, touch.clientY);
}

function onTouchEnd(div) {
  if (!draggingDiv) return;
  onDragEnd(div);
}

function reindex() {
  items.forEach((i, idx) => { i.originalIndex = idx; });
}

function commitEdit(id, value) {
  const item = items.find(i => i.id === id);
  if (!item) {
    if (editingId === id) editingId = null;
    if (pendingId === id) pendingId = null;
    return;
  }
  const trimmed = value.trim();
  const wasPending = pendingId === id;
  if (editingId === id) editingId = null;
  if (pendingId === id) pendingId = null;
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

function addItemFromInput(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (items.some(i => i.text === trimmed)) {
    showToast('Duplicate item not allowed', 'warning');
    return false;
  }

  const newItem = { id: 'item-' + Date.now(), text: trimmed, originalIndex: 0, checked: false };
  const currentIdx = addItemInsertIndex !== null ? Math.min(addItemInsertIndex, items.length) : items.length;
  items.splice(currentIdx, 0, newItem);
  addItemInsertIndex = addItemAbove ? currentIdx + 1 : currentIdx;
  reindex();
  pushHistory();
  render();
  return true;
}

function submitAddItem() {
  const input = document.getElementById('addItemInput');
  if (addItemFromInput(input.value)) {
    input.value = '';
    input.focus();
  }
}

function updateAddDirectionBtn() {
  const btn = document.getElementById('addDirectionBtn');
  if (!btn) return;
  btn.innerHTML = addItemAbove ? ADD_DIR_UP_ICON : ADD_DIR_DOWN_ICON;
  btn.title = addItemAbove ? 'Adding above' : 'Adding below';
}

function toggleAddDirection() {
  addItemAbove = !addItemAbove;
  localStorage.setItem('addItemAbove', addItemAbove ? '1' : '0');
  updateAddDirectionBtn();
}

function clearDone() {
  if (currentView === 'text') {
    const ta = document.getElementById('input');
    const lines = ta.value.split('\n');
    const filtered = lines.filter(l => !/^\[[xX]\]/.test(l));
    const count = lines.length - filtered.length;
    if (count === 0) return;
    ta.value = filtered.join('\n');
    pushTextareaHistory(ta.value);
    showToast(`${count} done item${count > 1 ? 's' : ''} removed`, 'warning', TRASH_ICON);
    return;
  }
  const count = items.filter(i => i.checked).length;
  if (count === 0) return;
  items = items.filter(i => !i.checked);
  reindex();
  pushHistory();
  render();
  showToast(`${count} done item${count > 1 ? 's' : ''} removed`, 'warning', TRASH_ICON);
}

function positionDropdown() {
  const dropdown = document.getElementById('dropdown');
  const menuBtn = document.getElementById('menuBtn');
  if (!dropdown || !menuBtn) return;

  const rect = menuBtn.getBoundingClientRect();
  const dropdownHeight = dropdown.offsetHeight;
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const padding = 8;

  if (spaceBelow < dropdownHeight + padding && spaceAbove > spaceBelow) {
    dropdown.style.bottom = (window.innerHeight - rect.top + padding) + 'px';
    dropdown.style.top = 'auto';
  } else {
    dropdown.style.top = (rect.bottom + padding) + 'px';
    dropdown.style.bottom = 'auto';
  }

  const menuContainer = document.getElementById('menuContainer');
  const right = window.innerWidth - rect.right;
  dropdown.style.right = Math.max(padding, right) + 'px';
}

function toggleMenu() {
  const dropdown = document.getElementById('dropdown');
  dropdown.classList.toggle('open');
  if (dropdown.classList.contains('open')) {
    positionDropdown();
    window.addEventListener('scroll', positionDropdown);
  } else {
    window.removeEventListener('scroll', positionDropdown);
  }
}

function closeMenu() {
  const dropdown = document.getElementById('dropdown');
  dropdown.classList.remove('open');
  window.removeEventListener('scroll', positionDropdown);
}

function updateClearBtn() {
  const btn = document.getElementById('clearBtn');
  if (btn) btn.textContent = currentView === 'text' ? 'Clear text' : 'Clear list';
}

function clearAction() {
  if (currentView === 'text') clearText();
  else clearList();
  closeMenu();
}

function clearText() {
  const ta = document.getElementById('input');
  if (!ta.value) return;
  ta.value = '';
  pushTextareaHistory('');
  showToast('Text cleared', 'warning', TRASH_ICON);
}

function clearList() {
  if (items.length === 0) return;
  items = [];
  pushHistory();
  render();
  showToast('List cleared', 'warning', TRASH_ICON);
}

function removeItem(id) {
  const item = items.find(i => i.id === id);
  if (item && addItemInsertIndex !== null) {
    const rank = [...items].sort((a, b) => a.originalIndex - b.originalIndex).findIndex(i => i.id === id);
    if (rank < addItemInsertIndex) addItemInsertIndex--;
  }
  items = items.filter(i => i.id !== id);
  pushHistory();
  render();
  if (item) showToast('Item removed: ' + item.text, 'warning', TRASH_ICON);
}

function serializeList() {
  return [...items]
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map(i => i.checked ? `[x] ${i.text}` : showUncheckedBrackets ? `[ ] ${i.text}` : i.text)
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


function toggleCheckboxFormat() {
  const ta = document.getElementById('input');
  const lines = ta.value.split('\n');
  showUncheckedBrackets = !showUncheckedBrackets;
  ta.value = lines.map(l => {
    if (/^\[[xX]\]/.test(l)) return l;
    if (showUncheckedBrackets) {
      return l.length && !/^\[[ ]\]/.test(l) ? '[ ] ' + l : l;
    } else {
      return l.replace(/^\[ \]\s?/, '');
    }
  }).join('\n');
  pushTextareaHistory(ta.value);
}

async function pasteFromClipboard() {
  const input = document.getElementById('input');
  try {
    const text = await navigator.clipboard.readText();
    input.value = text;
  } catch {
    input.focus();
    document.execCommand('paste');
  }
  showToast('Pasted from clipboard');
}

const SUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.77 19.77 0 0 1 4.22-5.38"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.77 19.77 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
const GRIP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
const PENCIL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 7"/></svg>';
const WARN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ARROW_UP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
const ARROW_DOWN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';
const ADD_DIR_UP_ICON = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12,5 21,18 3,18" fill="transparent"/></svg>';
const ADD_DIR_DOWN_ICON = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12,19 21,6 3,6" fill="transparent"/></svg>';

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


let sortDirection = 'asc';

function updateSortButton() {
  const btn = document.getElementById('sortBtn');
  const asc = sortDirection === 'asc';
  btn.innerHTML = (asc ? ARROW_UP_ICON : ARROW_DOWN_ICON) +
    '<span>' + (asc ? 'Sort A-Z' : 'Sort Z-A') + '</span>';
}

function toggleSort() {
  const asc = sortDirection === 'asc';
  if (currentView === 'text') {
    const ta = document.getElementById('input');
    const sorted = ta.value.split('\n')
      .filter(l => l.trim())
      .sort((a, b) => asc ? a.localeCompare(b) : b.localeCompare(a));
    ta.value = sorted.join('\n');
    pushTextareaHistory(ta.value);
  } else {
    items.sort((a, b) => asc
      ? a.text.localeCompare(b.text)
      : b.text.localeCompare(a.text));
    reindex();
    pushHistory();
    render();
  }
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

document.addEventListener('click', (e) => {
  const container = document.getElementById('menuContainer');
  if (container && !container.contains(e.target)) closeMenu();
});

window.addEventListener('resize', () => {
  if (document.getElementById('dropdown')?.classList.contains('open')) {
    positionDropdown();
  }
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (e.key === 'Escape') closeQrCode();
});

function init() {
  applyCheckedVisibility(localStorage.getItem('checkedHidden') === '1');
  updateSortButton();
  updateAddDirectionBtn();
  const addItemBtn = document.getElementById('addItemBtn');
  if (addItemBtn) addItemBtn.innerHTML = PLUS_ICON;
  (function initTheme() {
    const saved = localStorage.getItem('theme');
    applyTheme(saved || 'dark');
  })();
  applyView();
  loadFromStorage();
  initTextareaHistory();
  updateUndoRedo();
  updateClearBtn();
  (function initTextareaListeners() {
    const ta = document.getElementById('input');
    if (ta) {
      ta.addEventListener('blur', () => pushTextareaHistory(ta.value));
      ta.addEventListener('keyup', onTextareaCursorMove);
      ta.addEventListener('mouseup', onTextareaCursorMove);
    }
  })();
  (function initAddItemInput() {
    const input = document.getElementById('addItemInput');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (addItemFromInput(input.value)) {
            input.value = '';
            input.focus();
          }
        }
      });
      input.addEventListener('blur', () => {
        if (input.value.trim()) {
          if (addItemFromInput(input.value)) {
            input.value = '';
          }
        }
      });

      const addRow = input.closest('.add-item-row');
      const grip = addRow?.querySelector('.add-item-grip');
      if (grip && addRow) {
        grip.draggable = true;
        grip.addEventListener('dragstart', (e) => onDragStart(e, 'add-item-row', addRow));
        grip.addEventListener('dragend', () => onDragEnd(addRow));
        grip.addEventListener('touchstart', (e) => onTouchStart(e, addRow), { passive: false });
        grip.addEventListener('touchmove', (e) => onTouchMove(e), { passive: false });
        grip.addEventListener('touchend', () => onTouchEnd(addRow));
        grip.addEventListener('touchcancel', () => onTouchEnd(addRow));
        addRow.addEventListener('dragover', (e) => onDragOver(e, addRow));
        addRow.addEventListener('drop', (e) => e.preventDefault());
      }
    }
  })();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./serviceworker.js');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
