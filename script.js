let items = [];
let history = [[]];
let historyActions = [null];
let historyIndex = 0;

let textareaHistory = [''];
let textareaHistoryActions = [null];
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

let showArchivedLists = localStorage.getItem('checklist-show-archived') === '1';

let draggingTabEl = null;
let tabTouchStartX = 0;
let tabTouchDragging = false;

let addItemInsertIndex1 = 0; // null = after all items, number = before item at that index
let addItemInsertIndex2 = null;
let addItemAbove1 = localStorage.getItem('addItemAbove1') === '1';
let addItemAbove2 = localStorage.getItem('addItemAbove2') !== '0';

const TOAST_DURATION = 2200;
const TOAST_UNDO_DURATION = 5000;
const RESIZE_DEBOUNCE = 300;

function parseSVG(svgStr) {
  const tmp = document.createElement('div');
  tmp.innerHTML = svgStr;
  return tmp.firstElementChild;
}

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

function parseTextareaLines(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
  const seen = new Map();
  let duplicates = 0;
  const uncheckedDuplicates = [];
  const unique = [];
  lines.forEach(line => {
    const parsed = parseLine(line);
    if (seen.has(parsed.text)) {
      const existing = unique[seen.get(parsed.text)];
      if (existing.checked && !parsed.checked) {
        existing.checked = false;
        uncheckedDuplicates.push(existing.text);
      } else {
        duplicates++;
      }
      return;
    }
    seen.set(parsed.text, unique.length);
    unique.push(parsed);
  });
  return {
    items: unique.map((parsed, idx) => ({
      id: 'item-' + idx + '-' + Date.now(),
      text: parsed.text,
      originalIndex: idx,
      checked: parsed.checked,
    })),
    duplicates,
    uncheckedDuplicates,
  };
}

function saveCurrentState() {
  if (currentView === 'text') {
    ({ items } = parseTextareaLines(document.getElementById('input').value));
  }
  saveCurrentListItems();
}

function loadActiveListState() {
  const list = getActiveList();
  if (editingId) stopEditInDOM(editingId);
  editingId = null;
  pendingId = null;
  items = list ? list.items.map(i => ({ ...i })) : [];
  history = [items.map(i => ({ ...i }))];
  historyActions = [null];
  historyIndex = 0;
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

function updateArchiveListBtn() {
  const btn = document.getElementById('archiveListBtn');
  if (!btn) return;
  const list = lists.find(l => l.id === activeListId);
  const archived = !!list?.archived;
  btn.textContent = archived ? 'Unarchive list' : 'Archive list';
  btn.disabled = !archived && lists.filter(l => !l.archived).length <= 1;
}

function toggleArchiveActiveList() {
  const list = lists.find(l => l.id === activeListId);
  if (!list) return;
  if (!list.archived && lists.filter(l => !l.archived).length <= 1) return;
  list.archived = !list.archived;
  if (list.archived) {
    saveCurrentState();
    const next = lists.find(l => !l.archived);
    activeListId = next.id;
    loadActiveListState();
    localStorage.setItem('checklist-active', activeListId);
  }
  saveToStorage();
  renderListTabs();
}

function uniqueDefaultListName() {
  const existing = new Set(lists.map(l => l.name.toLowerCase()));
  let n = lists.length + 1;
  let name = 'List ' + n;
  while (existing.has(name.toLowerCase())) name = 'List ' + (++n);
  return name;
}

function addList() {
  saveCurrentState();
  const id = generateId();
  pendingListId = id;
  pendingListPrevActiveId = activeListId;
  lists.unshift({ id, name: uniqueDefaultListName(), items: [], archived: false });
  activeListId = id;
  items = [];
  history = [[]];
  historyActions = [null];
  historyIndex = 0;
  if (editingId) stopEditInDOM(editingId);
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
  listOrderHistory = [snapshotListOrder()];
  listOrderHistoryIndex = 0;
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
  requestAnimationFrame(() => {
    const restoredTab = document.querySelector(`.list-tab[data-id="${list.id}"]`);
    if (restoredTab) {
      restoredTab.classList.add('restored');
      restoredTab.addEventListener('animationend', () => restoredTab.classList.remove('restored'), { once: true });
    }
  });
}

function showConfirm(message, onOk) {
  let modal = document.getElementById('confirmModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'confirmModal';
    modal.className = 'confirm-modal';
    const content = document.createElement('div');
    content.className = 'confirm-content';
    const msg = document.createElement('p');
    msg.id = 'confirmMsg';
    content.appendChild(msg);
    const actions = document.createElement('div');
    actions.className = 'confirm-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'secondary';
    cancelBtn.id = 'confirmCancelBtn';
    cancelBtn.textContent = 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.className = 'secondary danger';
    okBtn.id = 'confirmOkBtn';
    okBtn.textContent = 'Delete';
    actions.append(cancelBtn, okBtn);
    content.appendChild(actions);
    modal.appendChild(content);
    document.body.appendChild(modal);
  }
  document.getElementById('confirmMsg').textContent = message;
  modal.style.display = 'flex';
  document.getElementById('confirmOkBtn').onclick = (e) => { e.stopPropagation(); modal.style.display = 'none'; onOk(); };
  document.getElementById('confirmCancelBtn').onclick = (e) => { e.stopPropagation(); modal.style.display = 'none'; };
  modal.onclick = e => { if (e.target === modal) { e.stopPropagation(); modal.style.display = 'none'; } };

  const handleEscapeKey = (e) => {
    if (e.key === 'Escape' && modal.style.display !== 'none') {
      modal.style.display = 'none';
      document.removeEventListener('keydown', handleEscapeKey);
    }
  };
  document.addEventListener('keydown', handleEscapeKey);
}

function showUndoToast(message) {
  showToast(message, 'warning', TRASH_ICON, undoDeleteList);
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

  const input = document.querySelector('.list-menu-input') || document.querySelector('.list-tab-input');
  if (input) {
    input.focus();
    if (id === pendingListId) {
      input.select();
    } else {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function commitRenameList(id, name) {
  if (renamingListId !== id) return;
  const trimmed = name.trim();
  if (trimmed && lists.some(l => l.id !== id && l.name.toLowerCase() === trimmed.toLowerCase())) {
    showToast(`"${trimmed}" already exists`, 'warning');
    renderListTabs();
    const input = document.querySelector('.list-menu-input') || document.querySelector('.list-tab-input');
    if (input) { input.focus(); input.select(); }
    return;
  }
  const list = lists.find(l => l.id === id);
  if (list) list.name = trimmed || list.name;
  renamingListId = null;
  pendingListId = null;
  pendingListPrevActiveId = null;
  saveToStorage();
  renderListTabs();
}

function cancelRenameList() {
  if (pendingListId && pendingListId === renamingListId) {
    lists = lists.filter(l => l.id !== pendingListId);
    activeListId = lists.find(l => l.id === pendingListPrevActiveId)?.id || lists[0]?.id;
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
  const shownIds = items.map(i => i.dataset.id);
  let cursor = 0;
  const idOrder = lists.map(l => shownIds.includes(l.id) ? shownIds[cursor++] : l.id);
  const changed = idOrder.some((id, idx) => lists[idx]?.id !== id);
  if (changed) {
    applyListOrder(idOrder);
    pushListOrderHistory();
    saveToStorage();
    renderListTabs();
  }
}

function moveListToPosition(id, position) {
  const idx = lists.findIndex(l => l.id === id);
  if (idx === -1) return;
  const [list] = lists.splice(idx, 1);
  if (position === 'top') {
    lists.unshift(list);
  } else if (position === 'bottom') {
    lists.push(list);
  } else {
    lists.splice(Math.floor(lists.length / 2), 0, list);
  }
  pushListOrderHistory();
  saveToStorage();
  renderListTabs();
}

let dropdownNeedsRebuild = true;

function buildDropdownContent(dropdown) {
  dropdown.replaceChildren();

  const archiveToggle = document.createElement('button');
  archiveToggle.className = 'secondary theme-toggle list-menu-toggle' + (showArchivedLists ? ' active' : '');
  const archivedCount = lists.filter(l => l.archived).length;
  const chevronLeft = parseSVG(CHEVRON_LEFT_ICON);
  chevronLeft.style.visibility = showArchivedLists ? 'visible' : 'hidden';
  archiveToggle.appendChild(chevronLeft);
  archiveToggle.appendChild(parseSVG(ARCHIVE_ICON));
  archiveToggle.appendChild(document.createTextNode(`Archived Lists (${archivedCount})`));
  const chevronRight = parseSVG(CHEVRON_RIGHT_ICON);
  chevronRight.style.visibility = showArchivedLists ? 'hidden' : 'visible';
  archiveToggle.appendChild(chevronRight);
  archiveToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    showArchivedLists = !showArchivedLists;
    localStorage.setItem('checklist-show-archived', showArchivedLists ? '1' : '0');
    dropdownNeedsRebuild = true;
    buildDropdownContent(dropdown);
  });
  dropdown.appendChild(archiveToggle);

  lists.filter(list => !!list.archived === showArchivedLists).forEach(list => {
    const item = document.createElement('button');
    item.className = 'secondary list-menu-item' + (list.id === activeListId ? ' active' : '');
    item.dataset.id = list.id;
    item.draggable = true;

    const handle = document.createElement('span');
    handle.className = 'list-menu-handle';
    handle.appendChild(parseSVG(GRIP_ICON));
    handle.draggable = true;
    item.appendChild(handle);

    const editBtn = document.createElement('button');
    editBtn.className = 'list-menu-edit-btn';
    editBtn.appendChild(parseSVG(PENCIL_ICON));
    editBtn.title = 'Rename list';
    editBtn.setAttribute('aria-label', 'Rename list');
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

    if (renamingListId === list.id && pendingListId !== list.id) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'list-menu-input';
      input.value = list.name;
      input.addEventListener('input', () => { nameSpan.textContent = input.value || ' '; });
      input.addEventListener('blur', () => commitRenameList(list.id, input.value));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelRenameList(); }
      });
      input.addEventListener('click', e => e.stopPropagation());
      nameWrap.appendChild(input);
    }

    item.appendChild(nameWrap);

    [
      { pos: 'top', icon: ALIGN_TOP_ICON, title: 'Move to top' },
      // { pos: 'middle', icon: ALIGN_MIDDLE_ICON, title: 'Move to middle' },
      { pos: 'bottom', icon: ALIGN_BOTTOM_ICON, title: 'Move to bottom' },
    ].forEach(({ pos, icon, title }) => {
      const btn = document.createElement('button');
      btn.className = 'list-menu-pos-btn';
      btn.appendChild(parseSVG(icon));
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveListToPosition(list.id, pos);
      });
      item.appendChild(btn);
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'item-remove';
    removeBtn.appendChild(parseSVG(TRASH_ICON));
    removeBtn.title = 'Delete list';
    removeBtn.setAttribute('aria-label', 'Delete ' + list.name);
    removeBtn.disabled = lists.length <= 1;
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteList(list.id);
    });
    item.appendChild(removeBtn);

    item.addEventListener('click', (e) => {
      if (!tabTouchDragging && !document.body.classList.contains('dragging-list')) {
        if (list.id === activeListId) {
          dropdown.classList.remove('open');
        } else {
          switchList(list.id);
        }
      }
    });
    item.addEventListener('dragover', (e) => {
      if (!draggingTabEl || item === draggingTabEl) return;
      e.preventDefault();
      moveDropdownItemOver(item, e.clientY);
    });
    item.addEventListener('dragenter', (e) => { if (draggingTabEl) e.preventDefault(); });
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
  dropdownNeedsRebuild = false;
}

function renderListTabs() {
  const container = document.getElementById('listTabs');
  if (!container) {
    setTimeout(() => renderListTabs(), 100);
    return;
  }
  const wasDropdownOpen = document.querySelector('.list-menu-dropdown')?.classList.contains('open') ?? false;
  container.replaceChildren();
  dropdownNeedsRebuild = true;
  document.getElementById('list')?.classList.toggle('single-list', lists.filter(l => !l.archived).length < 2);
  updateArchiveListBtn();

  const listMenuWrapper = document.createElement('div');
  listMenuWrapper.className = 'list-menu-wrapper';

  const listMenuBtn = document.createElement('button');
  listMenuBtn.className = 'secondary list-menu-btn';
  listMenuBtn.replaceChildren(parseSVG(LISTS_ICON), document.createTextNode('Lists'));
  listMenuBtn.title = 'All lists';

  const dropdown = document.createElement('div');
  dropdown.className = 'list-menu-dropdown';

  function positionDropdown() {
    const rect = listMenuBtn.getBoundingClientRect();
    const pad = 8;
    const spaceBelow = window.innerHeight - rect.bottom - pad;
    const spaceAbove = rect.top - pad;
    dropdown.style.left = rect.left + 'px';
    if (spaceAbove > spaceBelow) {
      dropdown.style.top = 'auto';
      dropdown.style.bottom = (window.innerHeight - rect.top + pad) + 'px';
      dropdown.style.maxHeight = spaceAbove + 'px';
    } else {
      dropdown.style.bottom = 'auto';
      dropdown.style.top = (rect.bottom + pad) + 'px';
      dropdown.style.maxHeight = spaceBelow + 'px';
    }
  }

  listMenuBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (dropdown.classList.contains('open')) {
      dropdown.classList.remove('open');
      window.removeEventListener('scroll', positionDropdown);
    } else {
      if (dropdownNeedsRebuild) buildDropdownContent(dropdown);
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

  dropdown.addEventListener('dragenter', (e) => { if (draggingTabEl) e.preventDefault(); });
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
  addBtn.setAttribute('aria-label', 'New list');
  addBtn.textContent = '+';
  addBtn.addEventListener('click', addList);
  container.appendChild(addBtn);

  const tabsScroller = document.createElement('div');
  tabsScroller.className = 'list-tabs-scroller';
  tabsScroller.addEventListener('wheel', e => {
    if (e.deltaY !== 0) {
      e.preventDefault();
      tabsScroller.scrollLeft += e.deltaY;
    }
  }, { passive: false });
  container.appendChild(tabsScroller);

  lists.filter(list => !list.archived).forEach(list => {
    const tab = document.createElement('div');
    tab.className = 'list-tab' + (list.id === activeListId && renamingListId !== list.id ? ' active' : '');
    tab.dataset.id = list.id;

    if (renamingListId === list.id && !wasDropdownOpen) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'list-tab-input';
      input.value = list.name;
      let minInputWidth = 0;
      const resizeTabInput = () => {
        if (!minInputWidth) minInputWidth = measureTextWidth(list.name, input) + 4;
        input.style.width = Math.max(minInputWidth, measureTextWidth(input.value, input) + 4) + 'px';
      };
      input.addEventListener('focus', resizeTabInput);
      input.addEventListener('input', resizeTabInput);
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
    buildDropdownContent(dropdown);
    dropdown.classList.add('open');
    positionDropdown();
    window.addEventListener('scroll', positionDropdown);
  }

  requestAnimationFrame(() => {
    const activeTab = tabsScroller.querySelector('.list-tab.active');
    if (!activeTab) return;
    const tabs = Array.from(tabsScroller.querySelectorAll('.list-tab'));
    const n = tabs.length;
    const i = tabs.indexOf(activeTab);
    const maxScroll = tabsScroller.scrollWidth - tabsScroller.clientWidth;
    if (maxScroll <= 0) return;
    const scrollerLeft = tabsScroller.getBoundingClientRect().left;
    if (i === 0) {
      tabsScroller.scrollLeft = 0;
    } else if (i === n - 1) {
      tabsScroller.scrollLeft = maxScroll;
    } else if (i <= Math.floor(n / 2)) {
      tabsScroller.scrollLeft = tabs[i - 1].getBoundingClientRect().left - scrollerLeft;
    } else {
      const succ = tabs[i + 1];
      const succRect = succ.getBoundingClientRect();
      tabsScroller.scrollLeft = Math.max(0, Math.min(succRect.right - scrollerLeft - tabsScroller.clientWidth, maxScroll));
    }
  });
}

function initTextareaHistory() {
  const val = document.getElementById('input').value;
  textareaHistory = [val];
  textareaHistoryActions = [null];
  textareaHistoryIndex = 0;
  textareaActiveLine = 1;
}

function pushTextareaHistory(val, action = null) {
  if (val === textareaHistory[textareaHistoryIndex]) return;
  textareaHistory = textareaHistory.slice(0, textareaHistoryIndex + 1);
  textareaHistory.push(val);
  textareaHistoryActions = textareaHistoryActions.slice(0, textareaHistoryIndex + 1);
  textareaHistoryActions.push(action);
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

function pushHistory(action = null) {
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot());
  historyActions = historyActions.slice(0, historyIndex + 1);
  historyActions.push(action);
  historyIndex = history.length - 1;
  updateUndoRedo();
}

function applyHistory() {
  if (editingId) stopEditInDOM(editingId);
  editingId = null;
  const prevItems = items;
  items = history[historyIndex].map(i => ({ ...i }));
  saveToStorage();
  render();
  const prevIds = new Set(prevItems.map(i => i.id));
  const restoredIds = new Set();
  items.filter(i => !prevIds.has(i.id)).forEach(i => restoredIds.add(i.id));
  if (document.getElementById('list').classList.contains('hide-checked')) {
    items.filter(i => !i.checked && prevItems.find(p => p.id === i.id && p.checked))
      .forEach(i => restoredIds.add(i.id));
  }
  requestAnimationFrame(() => {
    restoredIds.forEach(id => {
      const el = getItemEl(id);
      if (el) {
        el.classList.add('restored');
        el.addEventListener('animationend', () => el.classList.remove('restored'), { once: true });
      }
    });
  });
  updateUndoRedo();
}

function undoItems() {
  if (currentView === 'text') {
    if (textareaHistoryIndex > 0) {
      const undoneAction = textareaHistoryActions[textareaHistoryIndex];
      textareaHistoryIndex--;
      document.getElementById('input').value = textareaHistory[textareaHistoryIndex];
      updateUndoRedo();
      if (undoneAction === 'reverse') showToast('Reverse undone');
    }
    return;
  }
  if (historyIndex > 0) {
    const undoneAction = historyActions[historyIndex];
    historyIndex--;
    applyHistory();
    if (undoneAction === 'reverse') showToast('Reverse undone');
  }
}

function redoItems() {
  if (currentView === 'text') {
    if (textareaHistoryIndex < textareaHistory.length - 1) {
      textareaHistoryIndex++;
      document.getElementById('input').value = textareaHistory[textareaHistoryIndex];
      updateUndoRedo();
      if (textareaHistoryActions[textareaHistoryIndex] === 'reverse') showToast('Reversed item order');
    }
    return;
  }
  if (historyIndex < history.length - 1) {
    historyIndex++;
    applyHistory();
    if (historyActions[historyIndex] === 'reverse') showToast('Reversed item order');
  }
}

function undoLists() {
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
  }
}

function redoLists() {
  if (listOrderHistoryIndex < listOrderHistory.length - 1) {
    listOrderHistoryIndex++;
    applyListOrder(listOrderHistory[listOrderHistoryIndex]);
    saveToStorage();
    renderListTabs();
    updateUndoRedo();
  }
}

function updateUndoRedo() {
  const canUndoItems = currentView === 'text' ? textareaHistoryIndex > 0 : historyIndex > 0;
  const canRedoItems = currentView === 'text'
    ? textareaHistoryIndex < textareaHistory.length - 1
    : historyIndex < history.length - 1;
  const canUndoLists = !!deletedListUndo || listOrderHistoryIndex > 0;
  const canRedoLists = listOrderHistoryIndex < listOrderHistory.length - 1;
  document.getElementById('undoBtn').disabled = !canUndoItems;
  document.getElementById('redoBtn').disabled = !canRedoItems;
  document.getElementById('listUndoBtn').disabled = !canUndoLists;
  document.getElementById('listRedoBtn').disabled = !canRedoLists;
}

function parseLine(line) {
  if (line.startsWith('- ')) line = line.slice(2);
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
  const { items: parsed, duplicates, uncheckedDuplicates } = parseTextareaLines(document.getElementById('input').value);
  if (editingId) stopEditInDOM(editingId);
  editingId = null;
  items = parsed;
  saveToStorage();
  render();
  const messages = [];
  if (duplicates > 0) {
    messages.push(`${duplicates} duplicate${duplicates > 1 ? 's' : ''} skipped`);
  }
  if (uncheckedDuplicates.length === 1) {
    messages.push(`"${uncheckedDuplicates[0]}" unchecked`);
  } else if (uncheckedDuplicates.length > 1) {
    messages.push(`${uncheckedDuplicates.length} items unchecked`);
  }
  if (messages.length > 0) {
    showToast(messages.join(', '), 'warning');
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
  saveToStorage();
  if (document.getElementById('list').classList.contains('hide-checked')) {
    showToast(`"${item.text}" ${item.checked ? 'checked' : 'unchecked'}`, 'success', null, undoItems);
  }
  const el = getItemEl(id);
  if (el) {
    el.classList.toggle('checked', item.checked);
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = item.checked;
  }
  updateFooter();
}

let editingId = null;
let pendingId = null;
let cursorPosition = null;

function getItemEl(id) {
  return document.querySelector(`#list .item[data-id="${id}"]`);
}

function startEditInDOM(id) {
  const el = getItemEl(id);
  if (!el) return;
  const wrap = el.querySelector('.item-label-wrap');
  const label = el.querySelector('label');
  label.classList.add('editing');
  const input = document.createElement('textarea');
  input.className = 'edit-input';
  input.rows = 1;
  input.value = label.textContent;
  const updateRows = () => {
    const style = getComputedStyle(input);
    const paddingLeft = parseFloat(style.paddingLeft);
    const paddingRight = parseFloat(style.paddingRight);
    const availableWidth = input.clientWidth - paddingLeft - paddingRight;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${style.fontSize} ${style.fontFamily}`;
    const lines = input.value.split('\n');
    let totalRows = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      totalRows += Math.max(1, Math.ceil(w / availableWidth));
    }
    input.rows = Math.max(1, totalRows);
  };
  input.addEventListener('input', updateRows);
  input.addEventListener('paste', () => setTimeout(updateRows, 0));
  let resizeTimer;
  const onWindowResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(updateRows, RESIZE_DEBOUNCE); };
  window.addEventListener('resize', onWindowResize);
  input._onWindowResize = onWindowResize;
  const onBlur = () => commitEdit(id, input.value);
  input.addEventListener('blur', onBlur);
  input._commitBlur = onBlur;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { cancelEdit(id); }
  });
  wrap.appendChild(input);
  updateRows();
  input.focus();
  if (cursorPosition !== null) {
    input.setSelectionRange(cursorPosition, cursorPosition);
    cursorPosition = null;
  } else {
    input.select();
  }
}

function stopEditInDOM(id) {
  const el = getItemEl(id);
  if (!el) return;
  el.querySelector('label')?.classList.remove('editing');
  const input = el.querySelector('.edit-input');
  if (input) {
    if (input._commitBlur) input.removeEventListener('blur', input._commitBlur);
    if (input._onWindowResize) window.removeEventListener('resize', input._onWindowResize);
    input.remove();
  }
}

function updateItemTextInDOM(id, text) {
  const label = getItemEl(id)?.querySelector('label');
  if (label) label.textContent = text;
}

function saveToStorage() {
  saveCurrentListItems();
  localStorage.setItem('checklist-lists', JSON.stringify(lists));
  localStorage.setItem('checklist-active', activeListId);
  localStorage.setItem('checklist-add-row-1', addItemInsertIndex1 === null ? 'end' : addItemInsertIndex1);
  localStorage.setItem('checklist-add-row-2', addItemInsertIndex2 === null ? 'end' : addItemInsertIndex2);
}

function loadFromStorage() {
  try {
    const savedLists = localStorage.getItem('checklist-lists');
    const savedActive = localStorage.getItem('checklist-active');
    if (savedLists) {
      lists = JSON.parse(savedLists);
    } else {
      lists = [{ id: generateId(), name: 'Today', items: [] }];
    }
    if (!lists.length) {
      lists = [{ id: generateId(), name: 'Today', items: [] }];
    }
    activeListId = (savedActive && lists.find(l => l.id === savedActive)) ? savedActive : lists[0].id;
    const savedAddRow1 = localStorage.getItem('checklist-add-row-1');
    addItemInsertIndex1 = savedAddRow1 === null ? 0 : (savedAddRow1 === 'end' ? null : Number(savedAddRow1));
    const savedAddRow2 = localStorage.getItem('checklist-add-row-2');
    addItemInsertIndex2 = savedAddRow2 === null ? null : (savedAddRow2 === 'end' ? null : Number(savedAddRow2));
    listOrderHistory = [snapshotListOrder()];
    listOrderHistoryIndex = 0;
    const activeList = getActiveList();
    items = activeList ? activeList.items.map(i => ({ ...i })) : [];
    history = [items.map(i => ({ ...i }))];
    historyActions = [null];
    historyIndex = 0;
    editingId = null;
    pendingId = null;
    renderListTabs();
    if (currentView === 'text') {
      const ta = document.getElementById('input');
      ta.value = serializeList();
      initTextareaHistory();
    } else {
      requestAnimationFrame(() => render());
    }
    updateUndoRedo();
  } catch (e) {
    console.error('Failed to load from storage:', e);
    showToast('Could not load saved data', 'warning');
    lists = [{ id: generateId(), name: 'Today', items: [] }];
    activeListId = lists[0].id;
    listOrderHistory = [snapshotListOrder()];
    listOrderHistoryIndex = 0;
    renderListTabs();
  }
}

function updateFooter() {
  const footer = document.getElementById('listFooter');
  if (!footer) return;
  const total = items.length;
  const checked = items.filter(i => i.checked).length;
  const unchecked = total - checked;
  const hiddenLabel = document.getElementById('list').classList.contains('hide-checked') ? ' (hidden)' : '';
  footer.textContent = total === 0 ? '' : `${checked} of ${total} checked${hiddenLabel}, ${unchecked} unchecked`;
}

function render() {
  const list = document.getElementById('list');
  const addRow1 = document.getElementById('addItemRow1');
  const addRow2 = document.getElementById('addItemRow2');
  Array.from(list.querySelectorAll('.item')).forEach(el => el.remove());
  const ordered = [...items].sort((a, b) => a.originalIndex - b.originalIndex);
  const n = ordered.length;
  const split1 = addItemInsertIndex1 !== null ? Math.min(addItemInsertIndex1, n) : n;
  const split2 = addItemInsertIndex2 !== null ? Math.min(addItemInsertIndex2, n) : n;
  const nodes = ordered.map(renderItem);
  const sequence = split1 <= split2
    ? [...nodes.slice(0, split1), addRow1, ...nodes.slice(split1, split2), addRow2, ...nodes.slice(split2)]
    : [...nodes.slice(0, split2), addRow2, ...nodes.slice(split2, split1), addRow1, ...nodes.slice(split1)];
  sequence.forEach(node => list.appendChild(node));
  updateFooter();
}

function renderItem(item) {
  const div = document.createElement('div');
  div.className = 'item' + (item.checked ? ' checked' : '');
  div.dataset.id = item.id;

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.title = 'Drag to reorder';
  handle.appendChild(parseSVG(GRIP_ICON));
  handle.draggable = true;
  handle.addEventListener('dragstart', (e) => onDragStart(e, item.id, div));
  handle.addEventListener('dragend', () => onDragEnd(div));
  handle.addEventListener('touchstart', (e) => onTouchStart(e, div), { passive: false });
  handle.addEventListener('touchmove', (e) => onTouchMove(e), { passive: false });
  handle.addEventListener('touchend', () => onTouchEnd(div));
  handle.addEventListener('touchcancel', () => onTouchEnd(div));
  div.appendChild(handle);

  div.addEventListener('dragover', (e) => onDragOver(e, div));
  div.addEventListener('dragenter', (e) => { if (draggingDiv) e.preventDefault(); });
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
      if (input && cursorPosition !== null) input.setSelectionRange(cursorPosition, cursorPosition);
    } else if (editingId) {
      switchEditTo(item.id);
    } else {
      editingId = item.id;
      startEditInDOM(item.id);
    }
  });
  wrap.appendChild(label);

  div.appendChild(wrap);

  const menuBtn = document.createElement('button');
  menuBtn.className = 'item-menu';
  menuBtn.title = 'Item menu';
  menuBtn.setAttribute('aria-label', 'Item menu');
  menuBtn.appendChild(parseSVG(DOTS_ICON));
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); openItemMenu(item.id, menuBtn); });
  div.appendChild(menuBtn);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'item-remove';
  removeBtn.title = 'Remove';
  removeBtn.setAttribute('aria-label', 'Remove item');
  removeBtn.appendChild(parseSVG(TRASH_ICON));
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
    stopEditInDOM(oldId);
    if (oldItem) {
      if (!trimmed) {
        items = items.filter(i => i.id !== oldId);
        getItemEl(oldId)?.remove();
        if (!wasPending) pushHistory();
      } else if (trimmed !== oldItem.text || wasPending) {
        if (items.some(i => i.id !== oldId && i.text === trimmed)) {
          showToast('Duplicate item not allowed', 'warning');
        } else {
          oldItem.text = trimmed;
          updateItemTextInDOM(oldId, trimmed);
          pushHistory();
        }
      }
    }
  }
  editingId = newId;
  saveToStorage();
  startEditInDOM(newId);
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

    const addRow1 = document.getElementById('addItemRow1');
    const addRow2 = document.getElementById('addItemRow2');
    const siblings = Array.from(list.children);
    const countBefore1 = siblings.slice(0, siblings.indexOf(addRow1)).filter(el => el.classList.contains('item')).length;
    const countBefore2 = siblings.slice(0, siblings.indexOf(addRow2)).filter(el => el.classList.contains('item')).length;
    addItemInsertIndex1 = countBefore1 < reordered.length ? countBefore1 : null;
    addItemInsertIndex2 = countBefore2 < reordered.length ? countBefore2 : null;

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

function wouldViolateAddRowOrder(div, clientY) {
  if (draggingDiv.id !== 'addItemRow1' && draggingDiv.id !== 'addItemRow2') return false;
  const list = document.getElementById('list');
  const addRow1 = document.getElementById('addItemRow1');
  const addRow2 = document.getElementById('addItemRow2');
  const rect = div.getBoundingClientRect();
  const above = (clientY - rect.top) < rect.height / 2;
  const children = Array.from(list.children).filter(el => el !== draggingDiv);
  const targetIndex = children.indexOf(div);
  const insertIndex = above ? targetIndex : targetIndex + 1;
  children.splice(insertIndex, 0, draggingDiv);
  return children.indexOf(addRow1) > children.indexOf(addRow2);
}

function moveDraggingOver(div, clientY) {
  if (wouldViolateAddRowOrder(div, clientY)) return;
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
    saveToStorage();
    getItemEl(id)?.remove();
    return;
  }

  const el = getItemEl(id);
  if (el) {
    el.querySelector('label')?.classList.remove('editing');
    el.querySelector('.edit-input')?.remove();
  }

  if (trimmed === item.text && !wasPending) return;

  if (items.some(i => i.id !== id && i.text === trimmed)) {
    if (wasPending) {
      items = items.filter(i => i.id !== id);
      saveToStorage();
      getItemEl(id)?.remove();
    }
    showToast('Duplicate item not allowed', 'warning');
    return;
  }

  item.text = trimmed;
  updateItemTextInDOM(id, trimmed);
  const textarea = getItemEl(id)?.querySelector('.item-text');
  if (textarea) resizeItemTextarea(textarea);
  pushHistory();
  saveToStorage();
}

function cancelEdit(id) {
  editingId = null;
  if (pendingId === id) {
    pendingId = null;
    items = items.filter(i => i.id !== id);
    saveToStorage();
    stopEditInDOM(id);
    getItemEl(id)?.remove();
  } else {
    stopEditInDOM(id);
  }
}

function addItemFromInput(text, row) {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const existing = items.find(i => i.text.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    if (existing.checked) {
      toggle(existing.id);
      return true;
    }
    showToast('Duplicate item not allowed', 'warning');
    return false;
  }

  const newItem = { id: 'item-' + Date.now(), text: trimmed, originalIndex: 0, checked: false };
  const insertIndex = row === 1 ? addItemInsertIndex1 : addItemInsertIndex2;
  const above = row === 1 ? addItemAbove1 : addItemAbove2;
  const currentIdx = insertIndex !== null ? Math.min(insertIndex, items.length) : items.length;
  items.splice(currentIdx, 0, newItem);
  const newIndex = above ? currentIdx + 1 : currentIdx;
  if (row === 1) {
    addItemInsertIndex1 = newIndex;
    if (addItemInsertIndex2 !== null && addItemInsertIndex2 >= currentIdx) addItemInsertIndex2++;
  } else {
    addItemInsertIndex2 = newIndex;
    if (addItemInsertIndex1 !== null && addItemInsertIndex1 > currentIdx) addItemInsertIndex1++;
  }
  reindex();
  pushHistory();
  saveToStorage();
  render();
  return true;
}

function submitAddItem(row) {
  const input = document.getElementById(row === 1 ? 'addItemInput1' : 'addItemInput2');
  if (addItemFromInput(input.value, row)) {
    input.value = '';
    input.focus();
  }
}

function updateAddDirectionBtn(row) {
  const btn = document.getElementById(row === 1 ? 'addDirectionBtn1' : 'addDirectionBtn2');
  if (!btn) return;
  const above = row === 1 ? addItemAbove1 : addItemAbove2;
  btn.replaceChildren(parseSVG(above ? ADD_DIR_UP_ICON : ADD_DIR_DOWN_ICON));
  btn.title = above ? 'Adding above' : 'Adding below';
  btn.setAttribute('aria-label', above ? 'Add above' : 'Add below');
}

function toggleAddDirection(row) {
  if (row === 1) {
    addItemAbove1 = !addItemAbove1;
    localStorage.setItem('addItemAbove1', addItemAbove1 ? '1' : '0');
  } else {
    addItemAbove2 = !addItemAbove2;
    localStorage.setItem('addItemAbove2', addItemAbove2 ? '1' : '0');
  }
  updateAddDirectionBtn(row);
}

function moveAddRowToTop() {
  addItemInsertIndex1 = 0;
  saveToStorage();
  render();
}

function moveAddRowToBottom() {
  addItemInsertIndex2 = null;
  saveToStorage();
  render();
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
  saveToStorage();
  document.querySelectorAll('#list .item.checked').forEach(el => el.remove());
  updateFooter();
  showToast(`${count} done item${count > 1 ? 's' : ''} removed`, 'warning', TRASH_ICON);
}

function checkAll() {
  if (currentView === 'text') {
    const ta = document.getElementById('input');
    const lines = ta.value.split('\n');
    const updated = lines.map(l => {
      if (/^\[ \]/.test(l)) return '[x]' + l.slice(3);
      if (/^\[x\]/i.test(l)) return l;
      return l;
    });
    if (updated.join('\n') === ta.value) return;
    ta.value = updated.join('\n');
    pushTextareaHistory(ta.value);
    return;
  }
  if (items.every(i => i.checked)) return;
  items.forEach(i => { i.checked = true; });
  pushHistory();
  saveToStorage();
  document.querySelectorAll('#list .item').forEach(el => {
    el.classList.add('checked');
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = true;
  });
  updateFooter();
}

function uncheckAll() {
  if (currentView === 'text') {
    const ta = document.getElementById('input');
    const lines = ta.value.split('\n');
    const updated = lines.map(l => {
      if (/^\[x\]/i.test(l)) return '[ ]' + l.slice(3);
      return l;
    });
    if (updated.join('\n') === ta.value) return;
    ta.value = updated.join('\n');
    pushTextareaHistory(ta.value);
    return;
  }
  if (items.every(i => !i.checked)) return;
  items.forEach(i => { i.checked = false; });
  pushHistory();
  saveToStorage();
  document.querySelectorAll('#list .item').forEach(el => {
    el.classList.remove('checked');
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = false;
  });
  updateFooter();
}

function positionFooterDropdown() {
  const dropdown = document.getElementById('footerDropdown');
  const btn = document.getElementById('footerMenuBtn');
  if (!dropdown || !btn) return;
  const rect = btn.getBoundingClientRect();
  const padding = 8;
  dropdown.style.bottom = (window.innerHeight - rect.top + padding) + 'px';
  dropdown.style.top = 'auto';
  dropdown.style.left = Math.max(padding, rect.left) + 'px';
  dropdown.style.right = 'auto';
}

function toggleFooterMenu() {
  const dropdown = document.getElementById('footerDropdown');
  dropdown.classList.toggle('open');
  if (dropdown.classList.contains('open')) {
    positionFooterDropdown();
    window.addEventListener('scroll', positionFooterDropdown);
  } else {
    window.removeEventListener('scroll', positionFooterDropdown);
  }
}

function closeFooterMenu() {
  const dropdown = document.getElementById('footerDropdown');
  dropdown.classList.remove('open');
  window.removeEventListener('scroll', positionFooterDropdown);
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
  closeFooterMenu();
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
  if (editingId) stopEditInDOM(editingId);
  editingId = null;
  pendingId = null;
  items = [];
  pushHistory();
  saveToStorage();
  document.querySelectorAll('#list .item').forEach(el => el.remove());
  showToast('List cleared', 'warning', TRASH_ICON);
}

function removeItem(id) {
  const item = items.find(i => i.id === id);
  if (item) {
    const rank = [...items].sort((a, b) => a.originalIndex - b.originalIndex).findIndex(i => i.id === id);
    if (addItemInsertIndex1 !== null && rank < addItemInsertIndex1) addItemInsertIndex1--;
    if (addItemInsertIndex2 !== null && rank < addItemInsertIndex2) addItemInsertIndex2--;
  }
  items = items.filter(i => i.id !== id);
  pushHistory();
  saveToStorage();
  getItemEl(id)?.remove();
  updateFooter();
  if (item) showToast('"' + item.text + '" removed', 'warning', TRASH_ICON, undoItems);
}

function positionFloatingMenu(el, btnEl) {
  const rect = btnEl.getBoundingClientRect();
  const pad = 8;
  el.style.right = Math.max(pad, window.innerWidth - rect.right) + 'px';
  const spaceBelow = window.innerHeight - rect.bottom - pad;
  const spaceAbove = rect.top - pad;
  if (spaceAbove > spaceBelow) {
    el.style.top = 'auto';
    el.style.bottom = (window.innerHeight - rect.top + pad) + 'px';
    el.style.maxHeight = spaceAbove + 'px';
  } else {
    el.style.bottom = 'auto';
    el.style.top = (rect.bottom + pad) + 'px';
    el.style.maxHeight = spaceBelow + 'px';
  }
}

let itemMenuEl = null;
let itemMenuItemId = null;

function openItemMenu(itemId, btnEl) {
  if (itemMenuEl && itemMenuItemId === itemId) {
    closeItemMenu();
    return;
  }
  closeItemMenu();
  closeMoveDropdown();

  itemMenuItemId = itemId;
  const el = document.createElement('div');
  el.className = 'move-dropdown item-menu-dropdown';

  const topBtn = document.createElement('button');
  topBtn.className = 'secondary';
  topBtn.appendChild(parseSVG(ALIGN_TOP_ICON));
  topBtn.appendChild(document.createTextNode('Move to top'));
  topBtn.addEventListener('click', () => { moveItemToPosition(itemId, 'top'); closeItemMenu(); });
  el.appendChild(topBtn);

  const bottomBtn = document.createElement('button');
  bottomBtn.className = 'secondary';
  bottomBtn.appendChild(parseSVG(ALIGN_BOTTOM_ICON));
  bottomBtn.appendChild(document.createTextNode('Move to bottom'));
  bottomBtn.addEventListener('click', () => { moveItemToPosition(itemId, 'bottom'); closeItemMenu(); });
  el.appendChild(bottomBtn);

  if (lists.length > 1) {
    const moveListBtn = document.createElement('button');
    moveListBtn.className = 'secondary';
    moveListBtn.appendChild(parseSVG(MOVE_ICON));
    moveListBtn.appendChild(document.createTextNode('Move to list'));
    moveListBtn.addEventListener('click', (e) => { e.stopPropagation(); closeItemMenu(); openMoveDropdown(itemId, btnEl, 'move'); });
    el.appendChild(moveListBtn);

    const copyListBtn = document.createElement('button');
    copyListBtn.className = 'secondary';
    copyListBtn.appendChild(parseSVG(COPY_ICON));
    copyListBtn.appendChild(document.createTextNode('Copy to list'));
    copyListBtn.addEventListener('click', (e) => { e.stopPropagation(); closeItemMenu(); openMoveDropdown(itemId, btnEl, 'copy'); });
    el.appendChild(copyListBtn);
  }

  document.body.appendChild(el);
  itemMenuEl = el;
  positionFloatingMenu(el, btnEl);
}

function closeItemMenu() {
  itemMenuEl?.remove();
  itemMenuEl = null;
  itemMenuItemId = null;
}

function moveItemToPosition(id, position) {
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return;
  const [item] = items.splice(idx, 1);
  if (position === 'top') items.unshift(item);
  else items.push(item);
  reindex();
  pushHistory();
  saveToStorage();
  render();
}

let moveDropdownEl = null;
let moveDropdownItemId = null;

function openMoveDropdown(itemId, btnEl, mode = 'move') {
  const otherLists = lists.filter(l => l.id !== activeListId);
  if (otherLists.length === 0) return;

  if (moveDropdownEl && moveDropdownItemId === itemId) {
    closeMoveDropdown();
    return;
  }
  closeMoveDropdown();

  moveDropdownItemId = itemId;
  const el = document.createElement('div');
  el.className = 'move-dropdown';
  const title = document.createElement('div');
  title.className = 'move-dropdown-title';
  title.textContent = mode === 'copy' ? 'Copy to list:' : 'Move to list:';
  el.appendChild(title);
  otherLists.forEach(list => {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.textContent = list.name;
    btn.addEventListener('click', () => {
      if (mode === 'copy') copyItemToList(itemId, list.id);
      else moveItemToList(itemId, list.id);
      closeMoveDropdown();
    });
    el.appendChild(btn);
  });
  document.body.appendChild(el);
  moveDropdownEl = el;
  positionFloatingMenu(el, btnEl);
}

function closeMoveDropdown() {
  moveDropdownEl?.remove();
  moveDropdownEl = null;
  moveDropdownItemId = null;
}

function moveItemToList(itemId, targetListId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  const targetList = lists.find(l => l.id === targetListId);
  if (!targetList) return;

  const sourceListId = activeListId;
  const savedItem = { ...item };
  const savedOriginalIndex = item.originalIndex;

  items = items.filter(i => i.id !== itemId);
  reindex();
  pushHistory();

  const movedItem = { ...item, originalIndex: targetList.items.length };
  targetList.items.push(movedItem);
  targetList.items.forEach((i, idx) => { i.originalIndex = idx; });

  saveToStorage();
  getItemEl(itemId)?.remove();
  updateFooter();

  showToast(`"${savedItem.text}" moved to "${targetList.name}"`, 'success', MOVE_ICON, () => {
    const tgt = lists.find(l => l.id === targetListId);
    if (tgt) {
      tgt.items = tgt.items.filter(i => i.id !== itemId);
      tgt.items.forEach((i, idx) => { i.originalIndex = idx; });
    }
    if (activeListId === sourceListId) {
      items.splice(savedOriginalIndex, 0, { ...savedItem });
      reindex();
      pushHistory();
      saveToStorage();
      render();
    } else {
      const src = lists.find(l => l.id === sourceListId);
      if (src) {
        src.items.splice(savedOriginalIndex, 0, { ...savedItem });
        src.items.forEach((i, idx) => { i.originalIndex = idx; });
      }
      saveToStorage();
    }
  });
}

function copyItemToList(itemId, targetListId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  const targetList = lists.find(l => l.id === targetListId);
  if (!targetList) return;

  const copiedItem = { ...item, id: 'item-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), originalIndex: targetList.items.length };
  targetList.items.push(copiedItem);
  targetList.items.forEach((i, idx) => { i.originalIndex = idx; });

  saveToStorage();

  showToast(`"${item.text}" copied to "${targetList.name}"`, 'success', COPY_ICON, () => {
    const tgt = lists.find(l => l.id === targetListId);
    if (tgt) {
      tgt.items = tgt.items.filter(i => i.id !== copiedItem.id);
      tgt.items.forEach((i, idx) => { i.originalIndex = idx; });
    }
    saveToStorage();
  });
}

function serializeList() {
  return [...items]
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map(i => i.checked ? `[x] ${i.text}` : showUncheckedBrackets ? `[ ] ${i.text}` : i.text)
    .join('\n');
}

async function copyToClipboard() {
  const list = getActiveList();
  const rows = [...items]
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map(i => (i.checked ? '- [x] ' : '- [ ] ') + i.text);
  const content = ['# ' + (list ? list.name : ''), ...rows].join('\n');
  try {
    await navigator.clipboard.writeText(content);
    showToast('List copied to clipboard');
  } catch {
    showToast('Could not copy to clipboard', 'warning');
  }
}

async function copyAllListsToClipboard() {
  saveCurrentListItems();
  const parts = lists.map(l => {
    const rows = l.items
      .slice()
      .sort((a, b) => a.originalIndex - b.originalIndex)
      .map(i => (i.checked ? '- [x] ' : '- [ ] ') + i.text);
    return ['# ' + l.name, ...rows].join('\n');
  });
  const content = parts.join('\n\n');
  try {
    await navigator.clipboard.writeText(content);
    showToast('All ' + lists.length + ' list' + (lists.length !== 1 ? 's' : '') + ' copied to clipboard');
  } catch {
    showToast('Could not copy to clipboard', 'warning');
  }
}

async function importListsFromClipboard() {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    showToast('Could not read clipboard', 'warning');
    return;
  }

  const parsed = [];
  let current = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      if (current) parsed.push(current);
      current = { name: trimmed.slice(2).trim(), items: [] };
    } else if (current && /^- \[[ xX]\] /.test(trimmed)) {
      current.items.push({ text: trimmed.slice(6), checked: trimmed[3].toLowerCase() === 'x' });
    }
  }
  if (current) parsed.push(current);

  if (parsed.length === 0) {
    showToast('Clipboard does not contain valid list data', 'warning');
    return;
  }

  const conflicts = parsed.map(l => l.name).filter(n => {
    const existing = lists.find(l => l.name.toLowerCase() === n.toLowerCase());
    return existing && existing.items.length > 0;
  });
  if (conflicts.length > 0) {
    showToast('Already exists: ' + conflicts.join(', '), 'warning');
    return;
  }

  let lastId = null;
  for (const importedList of parsed) {
    const newItems = importedList.items.map((item, idx) => ({
      id: 'item-' + idx + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      text: item.text,
      checked: item.checked,
      originalIndex: idx
    }));
    const existing = lists.find(l => l.name.toLowerCase() === importedList.name.toLowerCase());
    if (existing) {
      existing.items = newItems;
      lastId = existing.id;
    } else {
      const id = generateId();
      lists.unshift({ id, name: importedList.name, items: newItems });
      lastId = id;
    }
  }

  saveToStorage();
  renderListTabs();
  if (parsed.length === 1) switchList(lastId);
  showToast('Imported: ' + parsed.map(l => '"' + l.name + '"').join(', '));
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
    showToast('Pasted from clipboard');
  } catch {
    showToast('Could not read clipboard', 'warning');
  }
}

const SUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.77 19.77 0 0 1 4.22-5.38"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.77 19.77 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const QR_ICON = '<svg viewBox="0 0 23 23" fill="currentColor" shape-rendering="crispEdges"><path d="M1,1h1v1h-1zM2,1h1v1h-1zM3,1h1v1h-1zM4,1h1v1h-1zM5,1h1v1h-1zM6,1h1v1h-1zM7,1h1v1h-1zM9,1h1v1h-1zM12,1h1v1h-1zM15,1h1v1h-1zM16,1h1v1h-1zM17,1h1v1h-1zM18,1h1v1h-1zM19,1h1v1h-1zM20,1h1v1h-1zM21,1h1v1h-1zM1,2h1v1h-1zM7,2h1v1h-1zM11,2h1v1h-1zM13,2h1v1h-1zM15,2h1v1h-1zM21,2h1v1h-1zM1,3h1v1h-1zM3,3h1v1h-1zM4,3h1v1h-1zM5,3h1v1h-1zM7,3h1v1h-1zM10,3h1v1h-1zM13,3h1v1h-1zM15,3h1v1h-1zM17,3h1v1h-1zM18,3h1v1h-1zM19,3h1v1h-1zM21,3h1v1h-1zM1,4h1v1h-1zM3,4h1v1h-1zM4,4h1v1h-1zM5,4h1v1h-1zM7,4h1v1h-1zM9,4h1v1h-1zM10,4h1v1h-1zM11,4h1v1h-1zM13,4h1v1h-1zM15,4h1v1h-1zM17,4h1v1h-1zM18,4h1v1h-1zM19,4h1v1h-1zM21,4h1v1h-1zM1,5h1v1h-1zM3,5h1v1h-1zM4,5h1v1h-1zM5,5h1v1h-1zM7,5h1v1h-1zM10,5h1v1h-1zM11,5h1v1h-1zM12,5h1v1h-1zM15,5h1v1h-1zM17,5h1v1h-1zM18,5h1v1h-1zM19,5h1v1h-1zM21,5h1v1h-1zM1,6h1v1h-1zM7,6h1v1h-1zM11,6h1v1h-1zM13,6h1v1h-1zM15,6h1v1h-1zM21,6h1v1h-1zM1,7h1v1h-1zM2,7h1v1h-1zM3,7h1v1h-1zM4,7h1v1h-1zM5,7h1v1h-1zM6,7h1v1h-1zM7,7h1v1h-1zM9,7h1v1h-1zM11,7h1v1h-1zM13,7h1v1h-1zM15,7h1v1h-1zM16,7h1v1h-1zM17,7h1v1h-1zM18,7h1v1h-1zM19,7h1v1h-1zM20,7h1v1h-1zM21,7h1v1h-1zM3,9h1v1h-1zM5,9h1v1h-1zM6,9h1v1h-1zM7,9h1v1h-1zM9,9h1v1h-1zM12,9h1v1h-1zM14,9h1v1h-1zM18,9h1v1h-1zM21,9h1v1h-1zM1,10h1v1h-1zM2,10h1v1h-1zM3,10h1v1h-1zM4,10h1v1h-1zM8,10h1v1h-1zM9,10h1v1h-1zM12,10h1v1h-1zM13,10h1v1h-1zM14,10h1v1h-1zM15,10h1v1h-1zM19,10h1v1h-1zM20,10h1v1h-1zM1,11h1v1h-1zM2,11h1v1h-1zM3,11h1v1h-1zM5,11h1v1h-1zM6,11h1v1h-1zM7,11h1v1h-1zM9,11h1v1h-1zM10,11h1v1h-1zM13,11h1v1h-1zM15,11h1v1h-1zM17,11h1v1h-1zM21,11h1v1h-1zM3,12h1v1h-1zM5,12h1v1h-1zM10,12h1v1h-1zM11,12h1v1h-1zM12,12h1v1h-1zM14,12h1v1h-1zM15,12h1v1h-1zM19,12h1v1h-1zM20,12h1v1h-1zM1,13h1v1h-1zM3,13h1v1h-1zM4,13h1v1h-1zM6,13h1v1h-1zM7,13h1v1h-1zM8,13h1v1h-1zM9,13h1v1h-1zM11,13h1v1h-1zM17,13h1v1h-1zM19,13h1v1h-1zM20,13h1v1h-1zM21,13h1v1h-1zM9,14h1v1h-1zM10,14h1v1h-1zM12,14h1v1h-1zM13,14h1v1h-1zM14,14h1v1h-1zM15,14h1v1h-1zM16,14h1v1h-1zM18,14h1v1h-1zM20,14h1v1h-1zM1,15h1v1h-1zM2,15h1v1h-1zM3,15h1v1h-1zM4,15h1v1h-1zM5,15h1v1h-1zM6,15h1v1h-1zM7,15h1v1h-1zM15,15h1v1h-1zM16,15h1v1h-1zM18,15h1v1h-1zM19,15h1v1h-1zM20,15h1v1h-1zM21,15h1v1h-1zM1,16h1v1h-1zM7,16h1v1h-1zM9,16h1v1h-1zM12,16h1v1h-1zM16,16h1v1h-1zM17,16h1v1h-1zM18,16h1v1h-1zM20,16h1v1h-1zM1,17h1v1h-1zM3,17h1v1h-1zM4,17h1v1h-1zM5,17h1v1h-1zM7,17h1v1h-1zM9,17h1v1h-1zM10,17h1v1h-1zM11,17h1v1h-1zM12,17h1v1h-1zM15,17h1v1h-1zM16,17h1v1h-1zM18,17h1v1h-1zM19,17h1v1h-1zM21,17h1v1h-1zM1,18h1v1h-1zM3,18h1v1h-1zM4,18h1v1h-1zM5,18h1v1h-1zM7,18h1v1h-1zM10,18h1v1h-1zM11,18h1v1h-1zM12,18h1v1h-1zM13,18h1v1h-1zM15,18h1v1h-1zM19,18h1v1h-1zM20,18h1v1h-1zM1,19h1v1h-1zM3,19h1v1h-1zM4,19h1v1h-1zM5,19h1v1h-1zM7,19h1v1h-1zM9,19h1v1h-1zM12,19h1v1h-1zM13,19h1v1h-1zM15,19h1v1h-1zM17,19h1v1h-1zM21,19h1v1h-1zM1,20h1v1h-1zM7,20h1v1h-1zM12,20h1v1h-1zM13,20h1v1h-1zM15,20h1v1h-1zM19,20h1v1h-1zM1,21h1v1h-1zM2,21h1v1h-1zM3,21h1v1h-1zM4,21h1v1h-1zM5,21h1v1h-1zM6,21h1v1h-1zM7,21h1v1h-1zM10,21h1v1h-1zM11,21h1v1h-1zM13,21h1v1h-1zM14,21h1v1h-1zM15,21h1v1h-1zM17,21h1v1h-1zM19,21h1v1h-1zM21,21h1v1h-1z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
const GRIP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
const PENCIL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 7"/></svg>';
const WARN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ARROW_UP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
const ARROW_DOWN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';
const MOVE_ICON = '<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M806-440H320v-80h486l-62-62 56-58 160 160-160 160-56-58 62-62ZM600-600v-160H200v560h400v-160h80v160q0 33-23.5 56.5T600-120H200q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h400q33 0 56.5 23.5T680-760v160h-80Z"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const UNDO_ICON = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h13a5 5 0 110 10h-1"/></svg>';
const REDO_ICON = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15 15L21 9m0 0l-6-6M21 9h-13a5 5 0 1 0 0 10h1"/></svg>';
const ADD_DIR_UP_ICON = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12,5 21,18 3,18" fill="transparent"/></svg>';
const ADD_DIR_DOWN_ICON = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12,19 21,6 3,6" fill="transparent"/></svg>';
const LISTS_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>';
const ALIGN_TOP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 11h3v10h2V11h3l-4-4-4 4zM4 3v2h16V3H4z"/></svg>';
const ALIGN_MIDDLE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 19h3v4h2v-4h3l-4-4-4 4zm8-14h-3V1h-2v4H8l4 4 4-4zM4 11v2h16v-2H4z"/></svg>';
const ALIGN_BOTTOM_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 13h-3V3h-2v10H8l4 4 4-4zM4 19v2h16v-2H4z"/></svg>';
const DOTS_ICON = '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/></svg>';
const ARCHIVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';
const CHEVRON_LEFT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
const CHEVRON_RIGHT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  btn.replaceChildren(parseSVG(theme === 'dark' ? SUN_ICON : MOON_ICON));
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
  const sortSpan = document.createElement('span');
  sortSpan.textContent = asc ? 'Sort A-Z' : 'Sort Z-A';
  btn.replaceChildren(parseSVG(asc ? ARROW_UP_ICON : ARROW_DOWN_ICON), sortSpan);
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
    if (editingId) stopEditInDOM(editingId);
    editingId = null;
    items.sort((a, b) => asc
      ? a.text.localeCompare(b.text)
      : b.text.localeCompare(a.text));
    reindex();
    pushHistory();
    saveToStorage();
    render();
  }
  sortDirection = asc ? 'desc' : 'asc';
  updateSortButton();
}

function reverseItems() {
  if (currentView === 'text') {
    const ta = document.getElementById('input');
    const lines = ta.value.split('\n').filter(l => l.trim());
    ta.value = lines.reverse().join('\n');
    pushTextareaHistory(ta.value, 'reverse');
  } else {
    if (editingId) stopEditInDOM(editingId);
    editingId = null;
    items.reverse();
    reindex();
    pushHistory('reverse');
    saveToStorage();
    render();
  }
  showToast('Reversed item order');
}

function applyCheckedVisibility(hidden) {
  document.getElementById('list').classList.toggle('hide-checked', hidden);
  const btn = document.getElementById('checkedToggle');
  const visSpan = document.createElement('span');
  visSpan.textContent = hidden ? 'Show checked' : 'Hide checked';
  btn.replaceChildren(parseSVG(hidden ? EYE_ICON : EYE_OFF_ICON), visSpan);
  localStorage.setItem('checkedHidden', hidden ? '1' : '0');
  updateFooter();
}

function toggleCheckedVisibility() {
  const hidden = !document.getElementById('list').classList.contains('hide-checked');
  applyCheckedVisibility(hidden);
}

function createQrCode() {
  const list = getActiveList();
  const sourceItems = currentView === 'text'
    ? parseTextareaLines(document.getElementById('input').value).items
    : [...items].sort((a, b) => a.originalIndex - b.originalIndex);
  if (!sourceItems.length) { showToast('List is empty', 'warning'); return; }
  const rows = sourceItems.map(i => (i.checked ? '- [x] ' : '- [ ] ') + i.text);
  const content = ['# ' + (list ? list.name : ''), ...rows].join('\n');
  const container = document.getElementById('qrCode');
  container.replaceChildren();
  let qr;
  try {
    const bytes = new TextEncoder().encode(content);
    const segs = [
      qrcodegen.QrSegment.makeEci(26),
      qrcodegen.QrSegment.makeBytes(bytes),
    ];
    qr = qrcodegen.QrCode.encodeSegments(segs, qrcodegen.QrCode.Ecc.MEDIUM);
  } catch (e) {
    console.error('QR encoding failed:', e);
    showToast('QR code failed — content may be too large', 'warning');
    return;
  }
  const vb = qr.size + 8;
  const parts = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y))
        parts.push(`M${x + 4},${y + 4}h1v1h-1z`);
    }
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${vb} ${vb}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('stroke', 'none');
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', vb);
  bg.setAttribute('height', vb);
  bg.setAttribute('fill', '#fff');
  svg.appendChild(bg);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', '#000');
  path.setAttribute('d', parts.join(''));
  svg.appendChild(path);
  container.appendChild(svg);
  document.getElementById('qrText').textContent = content;
  document.getElementById('qrModal').classList.add('open');
}

async function copyQrText() {
  const content = document.getElementById('qrText').textContent;
  if (!content) return;
  try {
    await navigator.clipboard.writeText(content);
    showToast('Text copied to clipboard');
  } catch {
    showToast('Could not copy to clipboard', 'warning');
  }
}

async function copyQrCode() {
  const svgEl = document.querySelector('#qrCode svg');
  if (!svgEl) return;

  const pngBlobPromise = new Promise((resolve, reject) => {
    const rect = svgEl.getBoundingClientRect();
    const scale = window.devicePixelRatio || 2;
    const w = Math.round(rect.width * scale);
    const h = Math.round(rect.height * scale);
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) resolve(pngBlob);
        else reject(new Error('toBlob returned null'));
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = url;
  });

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': pngBlobPromise })
    ]);
    showToast('QR code copied to clipboard');
  } catch (err) {
    console.error('Could not copy QR image:', err);
    showToast('Could not copy QR code', 'warning');
  }
}

function showToast(message, type = 'success', iconOverride = null, onUndo = null) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.className = 'toast ' + (type === 'warning' ? 'warning' : '');
  const iconStr = iconOverride || (type === 'warning' ? WARN_ICON : CHECK_ICON);
  const toastSpan = document.createElement('span');
  toastSpan.textContent = message;
  toast.replaceChildren(parseSVG(iconStr), toastSpan);
  if (onUndo) {
    const undoBtn = document.createElement('button');
    undoBtn.className = 'toast-undo';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', () => {
      toast.classList.remove('show');
      clearTimeout(toast._hideTimer);
      onUndo();
    });
    toast.appendChild(undoBtn);
  }
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    toast.classList.remove('show');
    clearTimeout(toast._hideTimer);
  });
  toast.appendChild(closeBtn);
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), onUndo ? TOAST_UNDO_DURATION : TOAST_DURATION);
}

function closeQrCode() {
  document.getElementById('qrModal').classList.remove('open');
  document.getElementById('qrCode').replaceChildren();
  document.getElementById('qrText').textContent = '';
}

document.addEventListener('click', (e) => {
  const container = document.getElementById('menuContainer');
  if (container && !container.contains(e.target)) closeMenu();
  const footerContainer = document.getElementById('footerMenuContainer');
  if (footerContainer && !footerContainer.contains(e.target)) closeFooterMenu();
  if (moveDropdownEl && !moveDropdownEl.contains(e.target) && !e.target.closest('.item-menu')) closeMoveDropdown();
  if (itemMenuEl && !itemMenuEl.contains(e.target) && !e.target.closest('.item-menu')) closeItemMenu();
});

window.addEventListener('resize', () => {
  if (document.getElementById('dropdown')?.classList.contains('open')) positionDropdown();
  if (document.getElementById('footerDropdown')?.classList.contains('open')) positionFooterDropdown();
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoItems(); }
  else if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redoItems(); }
  else if (e.key === 'Escape') { closeQrCode(); closeMoveDropdown(); closeItemMenu(); closeFooterMenu(); }
});

function initEventListeners() {
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('tabText').addEventListener('click', () => switchView('text'));
  document.getElementById('tabChecklist').addEventListener('click', () => switchView('checklist'));
  document.getElementById('undoBtn').addEventListener('click', undoItems);
  document.getElementById('redoBtn').addEventListener('click', redoItems);
  document.getElementById('listUndoBtn').addEventListener('click', undoLists);
  document.getElementById('listRedoBtn').addEventListener('click', redoLists);
  document.getElementById('menuBtn').addEventListener('click', toggleMenu);
  document.getElementById('footerMenuBtn').addEventListener('click', toggleFooterMenu);
  document.getElementById('pasteBtn').addEventListener('click', () => { pasteFromClipboard(); closeFooterMenu(); });
  document.getElementById('toggleCheckboxBtn').addEventListener('click', () => { toggleCheckboxFormat(); closeFooterMenu(); });
  document.getElementById('sortBtn').addEventListener('click', () => { toggleSort(); closeFooterMenu(); });
  document.getElementById('reverseBtn').addEventListener('click', () => { reverseItems(); closeFooterMenu(); });
  document.getElementById('copyListBtn').addEventListener('click', () => { copyToClipboard(); closeFooterMenu(); });
  document.getElementById('copyAllListsBtn').addEventListener('click', () => { copyAllListsToClipboard(); closeMenu(); });
  document.getElementById('importListsBtn').addEventListener('click', () => { importListsFromClipboard(); closeMenu(); });
  document.getElementById('checkedToggle').addEventListener('click', () => { toggleCheckedVisibility(); });
  document.getElementById('qrCodeBtn').addEventListener('click', () => { createQrCode(); });
  document.getElementById('checkAllBtn').addEventListener('click', () => { checkAll(); closeFooterMenu(); });
  document.getElementById('uncheckAllBtn').addEventListener('click', () => { uncheckAll(); closeFooterMenu(); });
  document.getElementById('clearDoneBtn').addEventListener('click', () => { clearDone(); closeFooterMenu(); });
  document.getElementById('archiveListBtn').addEventListener('click', () => { toggleArchiveActiveList(); closeFooterMenu(); });
  document.getElementById('clearBtn').addEventListener('click', clearAction);
  document.getElementById('addDirectionBtn1').addEventListener('click', () => toggleAddDirection(1));
  document.getElementById('addDirectionBtn2').addEventListener('click', () => toggleAddDirection(2));
  document.getElementById('addItemBtn1').addEventListener('mousedown', e => e.preventDefault());
  document.getElementById('addItemBtn1').addEventListener('click', () => submitAddItem(1));
  document.getElementById('addItemBtn2').addEventListener('mousedown', e => e.preventDefault());
  document.getElementById('addItemBtn2').addEventListener('click', () => submitAddItem(2));
  document.getElementById('addRowTopBtn').addEventListener('click', moveAddRowToTop);
  document.getElementById('addRowBottomBtn').addEventListener('click', moveAddRowToBottom);
  document.getElementById('qrModal').addEventListener('click', closeQrCode);
  document.getElementById('qrModalContent').addEventListener('click', e => e.stopPropagation());
  document.getElementById('copyQrCodeBtn').addEventListener('click', copyQrCode);
  document.getElementById('copyQrTextBtn').addEventListener('click', copyQrText);
  document.getElementById('closeQrBtn').addEventListener('click', closeQrCode);
}

function init() {
  initEventListeners();
  applyCheckedVisibility(localStorage.getItem('checkedHidden') === '1');
  const footerMenuBtn = document.getElementById('footerMenuBtn');
  if (footerMenuBtn) {
    const menuSpan = document.createElement('span');
    menuSpan.textContent = 'More';
    footerMenuBtn.replaceChildren(parseSVG('<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/></svg>'), menuSpan);
  }
  const undoBtn = document.getElementById('undoBtn');
  if (undoBtn) {
    const s = document.createElement('span');
    s.textContent = 'Undo';
    undoBtn.replaceChildren(parseSVG(UNDO_ICON), s);
  }
  const redoBtn = document.getElementById('redoBtn');
  if (redoBtn) {
    const s = document.createElement('span');
    s.textContent = 'Redo';
    redoBtn.replaceChildren(parseSVG(REDO_ICON), s);
  }
  const qrBtn = document.getElementById('qrCodeBtn');
  if (qrBtn) {
    const qrSpan = document.createElement('span');
    qrSpan.textContent = 'QR code';
    qrBtn.replaceChildren(parseSVG(QR_ICON), qrSpan);
  }
  updateSortButton();
  updateAddDirectionBtn(1);
  updateAddDirectionBtn(2);
  [1, 2].forEach(row => {
    const addItemBtn = document.getElementById(row === 1 ? 'addItemBtn1' : 'addItemBtn2');
    if (addItemBtn) {
      addItemBtn.replaceChildren(parseSVG(PLUS_ICON));
      addItemBtn.setAttribute('aria-label', 'Add item');
    }
  });
  const addRowTopBtn = document.getElementById('addRowTopBtn');
  if (addRowTopBtn) {
    addRowTopBtn.replaceChildren(parseSVG(ALIGN_TOP_ICON));
    addRowTopBtn.setAttribute('aria-label', 'Move row to top');
  }
  const addRowBottomBtn = document.getElementById('addRowBottomBtn');
  if (addRowBottomBtn) {
    addRowBottomBtn.replaceChildren(parseSVG(ALIGN_BOTTOM_ICON));
    addRowBottomBtn.setAttribute('aria-label', 'Move row to bottom');
  }
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
      ta.addEventListener('input', onTextareaInput);
      ta.addEventListener('blur', () => pushTextareaHistory(ta.value));
      ta.addEventListener('keyup', onTextareaCursorMove);
      ta.addEventListener('mouseup', onTextareaCursorMove);
    }
  })();
  (function initAddItemInputs() {
    [1, 2].forEach(row => {
      const input = document.getElementById(row === 1 ? 'addItemInput1' : 'addItemInput2');
      if (!input) return;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (addItemFromInput(input.value, row)) {
            input.value = '';
            input.focus();
          }
        }
      });
      input.addEventListener('blur', () => {
        if (input.value.trim()) {
          if (addItemFromInput(input.value, row)) {
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
        addRow.addEventListener('dragenter', (e) => { if (draggingDiv) e.preventDefault(); });
        addRow.addEventListener('drop', (e) => e.preventDefault());
      }
    });
  })();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./serviceworker.js').catch(err => {
      console.error('Service worker registration failed:', err);
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
