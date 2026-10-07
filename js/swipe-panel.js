// Panel collapse / swipe-to-delete
function togglePanel(pageId) {
  const el = document.getElementById(pageId);
  if (!el) return;
  el.classList.toggle('list-collapsed');
  // Canvas size is set in JS, so it has to be redrawn when the wrapper width
  // changes or it looks clipped. The canvas lives in #memo-page.
  if (pageId === 'memo-page' && typeof resizeCanvas === 'function') {
    // Wait for layout so getBoundingClientRect returns the collapsed width
    requestAnimationFrame(() => requestAnimationFrame(resizeCanvas));
  }
}

// Swipe-to-delete for any container with .swipe-row children.
// Transform is always set inline from JS to avoid class/inline conflicts.
// onLongPress(id, rowEl) fires after a 500ms hold with <8px movement. iOS Safari
// never fires contextmenu on touch, so this is how mobile opens context menus.
function attachSwipeToDelete(rootEl, options) {
  const { resolveId, onDelete, onLongPress, max = 88 } = options;
  const threshold = max * 0.4;
  let row = null, content = null;
  let startX = 0, startY = 0, startTime = 0;
  let dragLocked = false, isHorizontal = false, startedOpen = false;
  let lpTimer = null;
  let lpFired = false;
  const LP_DELAY = 500;     // ms
  const LP_MOVE_MAX = 8;    // px, more than this means scroll/swipe
  function cancelLongPress() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
  }

  function setState(r, isOpen) {
    const c = r.querySelector('.swipe-content');
    if (!c) return;
    c.style.transition = 'transform 0.24s cubic-bezier(0.32,0.72,0.16,1)';
    c.style.transform = isOpen ? 'translateX(-' + max + 'px)' : 'translateX(0)';
    r.classList.toggle('swiped', isOpen);
  }

  function closeAll() {
    rootEl.querySelectorAll('.swipe-row.swiped').forEach(r => setState(r, false));
  }

  function onStart(e) {
    const t = e.touches ? e.touches[0] : e;
    const r = e.target.closest('.swipe-row');
    if (!r) return;
    // Action button taps are handled by the click handler
    if (e.target.closest('.swipe-action')) return;
    rootEl.querySelectorAll('.swipe-row.swiped').forEach(o => { if (o !== r) setState(o, false); });
    row = r;
    content = r.querySelector('.swipe-content');
    if (!content) { row = null; return; }
    content.style.transition = 'none';
    startedOpen = r.classList.contains('swiped');
    startX = t.clientX;
    startY = t.clientY;
    startTime = Date.now();
    dragLocked = false;
    isHorizontal = false;
    // Long-press only on touch; desktop uses contextmenu
    cancelLongPress();
    lpFired = false;
    if (onLongPress && e.touches && !startedOpen) {
      const lpRow = r;
      lpTimer = setTimeout(() => {
        lpTimer = null;
        lpFired = true;
        // Cancel any in-flight swipe so the menu opens cleanly
        if (content) content.style.transform = 'translateX(0)';
        row = null; content = null;
        const id = resolveId(lpRow);
        if (typeof haptic === 'function') haptic('medium');
        if (id != null) onLongPress(id, lpRow);
      }, LP_DELAY);
    }
  }

  function onMove(e) {
    if (!row || !content) return;
    const t = e.touches ? e.touches[0] : e;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > LP_MOVE_MAX || Math.abs(dy) > LP_MOVE_MAX) cancelLongPress();
    if (!dragLocked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      dragLocked = true;
      isHorizontal = Math.abs(dx) > Math.abs(dy) + 2; // bias toward vertical for ambiguous gestures
      if (!isHorizontal) {
        // Yield to vertical scroll
        content.style.transition = '';
        row = null;
        content = null;
        return;
      }
    }
    if (!isHorizontal) return;

    const baseX = startedOpen ? -max : 0;
    let offset = baseX + dx;
    // Rubber-band beyond bounds
    if (offset > 0) offset = offset * 0.25;
    else if (offset < -max) offset = -max + (offset + max) * 0.25;

    content.style.transform = 'translateX(' + offset + 'px)';
    if (e.cancelable) e.preventDefault();
  }

  function onEnd(e) {
    cancelLongPress();
    // Menu already opened by long-press; don't let the click fire too
    if (lpFired) { lpFired = false; return; }
    if (!row || !content) { row = null; content = null; return; }
    if (!isHorizontal) {
      content.style.transition = '';
      row = null; content = null;
      return;
    }
    const t = (e.changedTouches && e.changedTouches[0]) || e;
    const dx = t.clientX - startX;
    const dt = Math.max(1, Date.now() - startTime);
    const velocity = dx / dt; // px/ms (negative = leftward)
    const flickLeft = velocity < -0.5 && dx < -20;
    const flickRight = velocity > 0.5 && dx > 20;

    let shouldOpen;
    if (startedOpen) {
      shouldOpen = !(dx >= threshold || flickRight);
    } else {
      shouldOpen = dx <= -threshold || flickLeft;
    }
    setState(row, shouldOpen);
    row = null; content = null;
    dragLocked = false; isHorizontal = false;
  }

  rootEl.addEventListener('touchstart', onStart, { passive: true });
  rootEl.addEventListener('touchmove', onMove, { passive: false });
  rootEl.addEventListener('touchend', onEnd);
  rootEl.addEventListener('touchcancel', onEnd);

  rootEl.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.swipe-row')) return;
    onStart(e);
    const move = (ev) => onMove(ev);
    const up = (ev) => {
      onEnd(ev);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // Capture-phase click: delete on action tap, close on tap of swiped content
  rootEl.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('.swipe-action');
    if (actionBtn) {
      e.stopPropagation();
      e.preventDefault();
      const r = actionBtn.closest('.swipe-row');
      if (!r) return;
      const id = resolveId(r);
      if (id != null) onDelete(id, r);
      setState(r, false);
      return;
    }
    const r = e.target.closest('.swipe-row');
    if (r && r.classList.contains('swiped')) {
      e.stopPropagation();
      e.preventDefault();
      setState(r, false);
    }
  }, true);

  // Outside tap closes any open swipe in this list
  document.addEventListener('click', (e) => {
    if (rootEl.contains(e.target)) return;
    closeAll();
  });
}

