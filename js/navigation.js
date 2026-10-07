// Page navigation / router
// The mood journal has no page of its own; it lives in a calendar panel
const pages = { home: '홈', memo: '노트', mindmap: '마인드맵', calendar: '캘린더' };

// Header primary pill (new note / node / event ...)
const headerActions = {
  home:     { label: '새 메모',     fn: () => {
    // From home, switch to the notes page and open the editor there
    if (typeof navigateTo === 'function') navigateTo('memo');
    if (typeof createMemo === 'function') createMemo();
  } },
  memo:     { label: '새 메모',     fn: () => (typeof createMemo === 'function' && createMemo()) },
  mindmap:  { label: '새 마인드맵', fn: () => (typeof createMindmap === 'function' && createMindmap()) },
  calendar: { label: '일정',        fn: () => {
    // Calendar header + button: depends on the calendar mode
    const m = (typeof window.gcal !== 'undefined') ? window.gcal.mode : 'all';
    const gE = (typeof window.gcal !== 'undefined') && window.gcal.enabled;
    if (m === 'google' && gE) {
      // Selected day, next full hour
      const k = (typeof calSelectedKey !== 'undefined') ? calSelectedKey : null;
      const now = new Date();
      const h = Math.min(22, Math.max(7, now.getHours() + 1));
      if (k && typeof openGCalNewEvent === 'function') { openGCalNewEvent(k, h, 0); return; }
    }
    if (m === 'all' && gE) {
      // A header click has no grid position, so the popup goes in the middle
      const x = window.innerWidth / 2;
      const y = window.innerHeight / 3;
      const now = new Date();
      const h = Math.min(22, Math.max(7, now.getHours() + 1));
      const totalMin = h * 60;
      if (typeof _openCalQuickPicker === 'function') { _openCalQuickPicker(x, y, h, 0, totalMin); return; }
    }
    if (typeof openTbModal === 'function') openTbModal('add');
  } },
};

// Header search-pill placeholder per page
const headerSearchPlaceholder = {
  home:     '메모, 태그, 액션 검색…',
  memo:     '메모, 태그, 액션 검색…',
  mindmap:  '마인드맵 검색…',
  calendar: '일정 검색…',
};

function applyHeaderForPage(page) {
  const pill = document.getElementById('header-action-pill');
  const label = document.getElementById('header-action-label');
  const ph = document.getElementById('header-search-placeholder');
  const a = headerActions[page];
  if (pill && label) {
    if (a) { pill.style.display = ''; label.textContent = a.label; }
    else { pill.style.display = 'none'; }
  }
  if (ph) ph.textContent = headerSearchPlaceholder[page] || '검색…';
}
window.headerPrimaryAction = function() {
  const a = headerActions[currentPage];
  if (a && typeof a.fn === 'function') a.fn();
};
// Tag drawer (hamburger on the right of the notes and mindmap pages)
window.toggleTagDrawer = function() {
  const drawer = document.getElementById('tag-drawer');
  const overlay = document.getElementById('tag-drawer-overlay');
  if (!drawer) return;
  const open = drawer.classList.contains('show');
  if (open) { closeTagDrawer(); return; }
  // Clone the sidebar tag tree (#memo-tag-bar) into the drawer
  const src = document.getElementById('memo-tag-bar');
  const body = document.getElementById('tag-drawer-body');
  if (src && body) {
    body.innerHTML = '';
    const clone = src.cloneNode(true);
    clone.removeAttribute('id'); // avoid a duplicate id
    body.appendChild(clone);
    // Real tag count (leaves out the all-notes and untagged rows)
    const tagCount = clone.querySelectorAll('.tag-row .tag-hash').length;
    const cntEl = document.getElementById('tag-drawer-count');
    if (cntEl) cntEl.textContent = tagCount > 0 ? tagCount : '';
  }
  overlay?.classList.add('show');
  drawer.classList.add('show');
  document.body.classList.add('tag-drawer-open');
  const search = document.getElementById('tag-drawer-search-input');
  if (search) { search.value = ''; }
  // Close on click (handler attached once)
  if (!body.__tagDrawerHandlerAttached) {
    body.addEventListener('click', (e) => {
      if (e.target.closest('.tag-row, .tag-tree-header')) {
        setTimeout(closeTagDrawer, 120);
      }
    });
    body.__tagDrawerHandlerAttached = true;
  }
};
window.closeTagDrawer = function() {
  document.getElementById('tag-drawer')?.classList.remove('show');
  document.getElementById('tag-drawer-overlay')?.classList.remove('show');
  document.body.classList.remove('tag-drawer-open');
};

// Hide drawer tag rows whose label doesn't match
window.filterTagDrawer = function(q) {
  const body = document.getElementById('tag-drawer-body');
  if (!body) return;
  const query = (q || '').trim().toLowerCase();
  const rows = body.querySelectorAll('.tag-row');
  rows.forEach(row => {
    if (!query) { row.classList.remove('tag-row-hidden'); return; }
    const label = (row.querySelector('.tag-row-label')?.textContent || row.textContent || '').toLowerCase();
    if (label.includes(query)) row.classList.remove('tag-row-hidden');
    else row.classList.add('tag-row-hidden');
  });
};

window.openCommandPalette = window.openCommandPalette || (function() {
  // Fallback, since the ⌘K palette entry point may be defined in another file
  return function() {
    if (typeof openCmdK === 'function') openCmdK();
    else if (typeof toggleCommandPalette === 'function') toggleCommandPalette();
    else document.getElementById('memo-search')?.focus();
  };
})();

// Current route. Single source of truth for which page is showing.
let currentPage = 'memo';

// Central router. All page switching (sidebar clicks, programmatic jumps,
// hash restoration) goes through here.
function navigateTo(page, opts) {
  opts = opts || {};
  if (!pages[page]) page = 'memo';
  // Honour settings that hide a tab
  const navBtn = document.querySelector(`.sidebar .nav-btn[data-page="${page}"]`);
  if (navBtn && navBtn.style.display === 'none') page = 'memo';

  document.querySelectorAll('.sidebar .nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.m-tab-btn[data-page]').forEach(b =>
    b.classList.toggle('active', b.dataset.page === page));
  // memo and mindmap share the same DOM (#page-memo); only the filter and header differ
  const domPage = (page === 'mindmap') ? 'memo' : page;
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === 'page-' + domPage));

  // Changing pages closes the mobile memo detail (show-editor)
  if (currentPage !== page) {
    const memoPage = document.getElementById('memo-page');
    if (memoPage) memoPage.classList.remove('show-editor');
  }
  document.getElementById('page-title').textContent = pages[page];
  currentPage = page;
  applyHeaderForPage(page);
  // Per-page body class (e.g. whether the header hamburger shows)
  Object.keys(pages).forEach(p => document.body.classList.remove('page-' + p));
  document.body.classList.add('page-' + page);

  // memo/mindmap: force the note-type filter on entry
  if (page === 'home') {
    // Home re-renders on every visit (memos may have changed elsewhere)
    if (typeof renderHome === 'function') renderHome();
  }

  if (page === 'mindmap') {
    if (typeof noteTypeFilter !== 'undefined' && noteTypeFilter !== 'mindmap') {
      noteTypeFilter = 'mindmap';
      try { localStorage.setItem('mindflow_note_type_filter', JSON.stringify('mindmap')); } catch {}
    }
  } else if (page === 'memo') {
    if (typeof noteTypeFilter !== 'undefined' && noteTypeFilter === 'mindmap') {
      noteTypeFilter = 'memo';
      try { localStorage.setItem('mindflow_note_type_filter', JSON.stringify('memo')); } catch {}
    }
  }

  if (page === 'calendar') {
    // Reset a stale selectedKey to today (mobile used to open on a date months back)
    if (typeof calSelectedKey !== 'undefined' && typeof dateKey === 'function') {
      const todayK = dateKey(new Date());
      if (calSelectedKey !== todayK && typeof calGoToday === 'function') {
        // If the selected day isn't in this week (another week was open), go to today
        const sel = new Date(calSelectedKey);
        const ws = (typeof calWeekStart !== 'undefined') ? calWeekStart : sel;
        const we = (typeof _calAddDays === 'function') ? _calAddDays(ws, 6) : new Date(ws.getTime() + 6*86400000);
        if (sel < ws || sel > we) calGoToday();
      }
    }
    renderCalendar();
    renderCalDetail();
    // In 'google'/'all' mode, fetch events for the visible range.
    // gcal_enabled is per device, so it starts off on a new device and events seemed to load
    // only after tapping the mode tab. Turn it on here too, unless the user switched it off in settings.
    if (typeof window.gcal !== 'undefined'
        && (window.gcal.mode === 'google' || window.gcal.mode === 'all')) {
      const on = (typeof maybeAutoEnableGCal === 'function')
        ? maybeAutoEnableGCal() : window.gcal.enabled;
      if (on && typeof refreshGCalEventsForVisibleWeek === 'function') {
        refreshGCalEventsForVisibleWeek();
      }
    }
    // Restore the active state of the mode toggle
    if (typeof window.gcal !== 'undefined') {
      const mode = window.gcal.mode;
      document.querySelectorAll('.cal-mode-seg button').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
    }
  }
  if (page === 'memo' || page === 'mindmap') {
    // The notes page hosts the mindmap canvas. If a mindmap note is open,
    // its canvas needs a resize once this page becomes visible.
    if (typeof resizeCanvas === 'function') requestAnimationFrame(resizeCanvas);
  }
  // Refresh the sidebar tag tree so its active-row highlight matches the
  // page we just switched to (highlight only shows on the notes view).
  if (typeof renderMemoList === 'function') renderMemoList();

  // Keep the URL hash in sync so a reload restores the same page.
  // replaceState, not pushState: tab switches shouldn't pile up in history.
  if (opts.updateHash !== false) {
    const h = '#' + page;
    if (location.hash !== h) {
      try { history.replaceState(null, '', h); } catch {}
    }
  }
}

// Mobile bottom tab bar switches pages
document.querySelectorAll('.m-tab-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    navigateTo(btn.dataset.page);
  });
});

document.querySelectorAll('.sidebar .nav-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    navigateTo(btn.dataset.page);
    closeMobileSidebar();
  });
});

// React to manual hash edits / external links. replaceState above does NOT
// fire hashchange, so this only runs for genuine user-driven changes.
window.addEventListener('hashchange', () => {
  const page = location.hash.slice(1);
  if (pages[page] && page !== currentPage) navigateTo(page, { updateHash: false });
});

// Restore the route from the URL hash on first load. Called from main.js
// after every module has loaded.
function initRoute() {
  const page = location.hash.slice(1);
  // Call navigateTo even without a hash. index.html still marks #page-memo as
  // .page.active, so skipping this opens the notes page instead of home.
  if (pages[page]) {
    if (page !== 'memo') navigateTo(page, { updateHash: false });
  } else {
    navigateTo('home', { updateHash: false });
  }
}

// Arrow wrapper so the reference resolves at click time. sync.js loads after
// navigation.js, so a bare openSyncModal reference would throw and abort this file.

// Mobile sidebar drawer
// On mobile the sidebar is a slide-in drawer driven by the `drawer-open` class
// on <body>. CSS handles the rest.
function openMobileSidebar() { document.body.classList.add('drawer-open'); }
function closeMobileSidebar() { document.body.classList.remove('drawer-open'); }
function toggleMobileSidebar() { document.body.classList.toggle('drawer-open'); }
// Esc closes the drawer
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMobileSidebar();
});

// Keyboard shortcuts (Cmd on macOS, Ctrl elsewhere).
// Input-context guards keep shortcuts from breaking text input.
document.addEventListener('keydown', (e) => {
  const meta = e.metaKey || e.ctrlKey;
  const ae = document.activeElement;
  const inInput = ae && (
    ae.tagName === 'INPUT' ||
    ae.tagName === 'TEXTAREA' ||
    ae.isContentEditable ||
    (ae.closest && ae.closest('.cm-editor'))
  );

  // ⌘K: command palette (anywhere)
  if (meta && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if (typeof openCmdPalette === 'function') openCmdPalette();
    return;
  }
  // ⌘N: new memo (anywhere)
  if (meta && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
    e.preventDefault();
    if (typeof navigateTo === 'function') navigateTo('memo', { updateHash: false });
    if (typeof createMemo === 'function') createMemo();
    return;
  }
  // ⌘F: focus memo search
  if (meta && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
    const search = document.getElementById('memo-search');
    if (search) {
      e.preventDefault();
      if (typeof navigateTo === 'function') navigateTo('memo', { updateHash: false });
      search.focus();
      search.select();
      return;
    }
  }
  // The rest only when not typing
  if (inInput) return;

  // ↑/↓: move through the memo list (memo page only)
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && currentPage === 'memo') {
    if (typeof navigateMemoList === 'function') {
      e.preventDefault();
      navigateMemoList(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
  }
  // ⌘P: pin or unpin the current memo
  if (meta && (e.key === 'p' || e.key === 'P')) {
    if (typeof activeMemoId !== 'undefined' && activeMemoId != null && currentPage === 'memo') {
      e.preventDefault();
      togglePinNote('memo', activeMemoId);
      return;
    }
  }
  // ⌘⌫: delete the current memo
  if (meta && (e.key === 'Backspace' || e.key === 'Delete')) {
    if (typeof activeMemoId !== 'undefined' && activeMemoId != null && currentPage === 'memo') {
      e.preventDefault();
      deleteMemo(activeMemoId);
      return;
    }
  }
});

// The sidebar is always the expanded panel (calendar link + tag tree);
// the `expanded` class is hardcoded in the HTML.

// History-based back button
// On Android PWA and iOS standalone (no edge swipe) the back button would just
// close the app. Keep one sentinel history entry: the first back pops it, we close
// the topmost UI layer (action sheet, modal, theme picker, drawer, memo editor),
// then re-push the sentinel so later backs can close more layers.
function _historyHasSentinel() {
  try { return history.state?.mf === 'sentinel'; } catch { return false; }
}
function _pushSentinel() {
  if (!_historyHasSentinel()) {
    try { history.pushState({ mf: 'sentinel' }, ''); } catch {}
  }
}
_pushSentinel();

function _closeTopLayer() {
  // Order = visual stacking (topmost first)
  const sheet = document.querySelector('.action-sheet.show');
  if (sheet) {
    sheet.classList.remove('show');
    document.querySelectorAll('.action-sheet-overlay.show').forEach(o => o.classList.remove('show'));
    return true;
  }
  const modal = document.querySelector('.modal-overlay.show');
  if (modal) {
    modal.classList.remove('show');
    return true;
  }
  const tp = document.getElementById('theme-picker-popup');
  if (tp && tp.classList.contains('show')) {
    if (typeof closeThemePicker === 'function') closeThemePicker();
    else tp.classList.remove('show');
    return true;
  }
  if (document.body.classList.contains('drawer-open')) {
    closeMobileSidebar();
    return true;
  }
  // Mobile: if a memo editor or mindmap canvas is open, go back to the list
  const memoPage = document.getElementById('memo-page');
  if (memoPage && memoPage.classList.contains('show-editor') && window.innerWidth <= 768) {
    if (typeof backToList === 'function') backToList();
    return true;
  }
  return false;
}

window.addEventListener('popstate', () => {
  if (_closeTopLayer()) {
    // Re-push sentinel so user can keep pressing back to close more layers
    _pushSentinel();
  }
  // else nothing to close, let the back propagate (PWA closes / browser back)
});

// Mobile modal drag-to-dismiss
// Bottom-sheet modals show a grabber (.modal::before) and people swipe down on it,
// so wire up the actual gesture.
(function attachModalDragDismiss() {
  let dragging = false, modal = null, startY = 0, startTime = 0;
  function onStart(e) {
    if (window.innerWidth > 768) return; // bottom-sheet behaviour only on mobile
    const t = e.touches && e.touches[0];
    if (!t) return;
    const m = e.target.closest('.modal-overlay.show .modal');
    if (!m) return;
    // Don't intercept if touch starts inside an interactive input
    if (e.target.closest('input, textarea, select, button, [contenteditable="true"], .cm-editor')) return;
    // Only grab if the modal's own scroll is at the top, otherwise let it scroll
    if (m.scrollTop > 4) return;
    dragging = true; modal = m;
    startY = t.clientY; startTime = Date.now();
    modal.style.transition = 'none';
  }
  function onMove(e) {
    if (!dragging || !modal) return;
    const t = e.touches[0];
    const dy = t.clientY - startY;
    if (dy < 0) return; // upward = no-op
    modal.style.transform = `translateY(${dy}px)`;
    if (e.cancelable) e.preventDefault();
  }
  function onEnd(e) {
    if (!dragging || !modal) return;
    const t = (e.changedTouches && e.changedTouches[0]) || e;
    const dy = Math.max(0, (t.clientY || 0) - startY);
    const dt = Math.max(1, Date.now() - startTime);
    const vel = dy / dt; // px/ms
    const shouldClose = dy > 80 || vel > 0.4;
    modal.style.transition = 'transform 0.24s cubic-bezier(0.32,0.72,0.16,1)';
    if (shouldClose) {
      const overlay = modal.closest('.modal-overlay');
      modal.style.transform = 'translateY(100%)';
      setTimeout(() => {
        if (modal) modal.style.transform = '';
        if (overlay) overlay.classList.remove('show');
      }, 240);
    } else {
      modal.style.transform = '';
    }
    dragging = false; modal = null;
  }
  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
  document.addEventListener('touchcancel', onEnd);
})();
