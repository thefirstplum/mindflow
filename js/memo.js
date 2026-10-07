// Notes (memo + mindmap)
let memos = load('memos', []);
let activeMemoId = null;
let memoIdCounter = load('memo_idcounter', 1);

// Counter ids (1, 2, 3...) collided when two devices created memos, which made conflict copies.
// ms * 10000 + random doesn't collide even for simultaneous creates, and it sits far above
// STABLE_ID_FLOOR (1e9), so it can't hit import ids either. memoIdCounter is kept only for
// old data and is never incremented.
function newMemoId() {
  return Date.now() * 10000 + Math.floor(Math.random() * 10000);
}
let activeTagFilter = null;
let memoSortMode = load('memo_sort', 'updated');  // 'updated' | 'created' | 'title'
// Detail pane: 'memo' or 'mindmap'
let activeNoteType = 'memo';

// memos[] and mindmaps[] are stored separately; this merges them for the list view.
function getAllNotes() {
  const out = [];
  for (const m of memos) {
    out.push({
      type: 'memo', id: m.id,
      title: m.title || '',
      pinned: !!m.pinned,
      tags: m.tags || [],
      updatedAt: m.updatedAt || m.date,
      createdAt: m.date,
      searchText: _nfc(((m.title || '') + ' ' + (m.content || ''))).toLowerCase(),
      content: m.content || '',
      ref: m
    });
  }
  if (typeof mindmaps !== 'undefined' && Array.isArray(mindmaps)) {
    for (const mm of mindmaps) {
      const nodeText = (mm.nodes || []).map(n => n.text || '').join(' ');
      out.push({
        type: 'mindmap', id: mm.id,
        title: mm.name || '',
        pinned: !!mm.pinned,
        tags: mm.tags || [],
        updatedAt: mm.updatedAt || mm.createdAt,
        createdAt: mm.createdAt,
        searchText: _nfc(((mm.name || '') + ' ' + nodeText)).toLowerCase(),
        nodeCount: (mm.nodes || []).length,
        edgeCount: (mm.edges || []).length,
        ref: mm
      });
    }
  }
  return out;
}

// Tag-tree highlight only on the notes view, otherwise other pages look filtered
function notesViewActive() {
  return typeof currentPage === 'undefined' || currentPage === 'memo';
}

function isActiveNote(type, id) {
  if (type === 'mindmap') return activeNoteType === 'mindmap' && typeof activeMindmapId !== 'undefined' && id === activeMindmapId;
  return activeNoteType === 'memo' && id === activeMemoId;
}

function selectNote(type, id) {
  const page = document.getElementById('memo-page');
  if (type === 'mindmap') {
    activeNoteType = 'mindmap';
    activeMemoId = null;
    if (page) page.classList.add('note-mindmap', 'show-editor');
    if (typeof switchMindmap === 'function') switchMindmap(id);
    if (typeof renderMindmapTags === 'function') renderMindmapTags();
    renderMemoList();
    if (typeof resizeCanvas === 'function') setTimeout(resizeCanvas, 40);
    else if (typeof drawMindMap === 'function') drawMindMap();
  } else {
    activeNoteType = 'memo';
    activeMemoId = id;
    if (page) { page.classList.remove('note-mindmap'); page.classList.add('show-editor'); }
    renderMemoList();
    renderMemoEditor();
  }
}

function deleteNote(type, id) {
  if (type === 'mindmap') {
    if (typeof deleteMindmapById === 'function') deleteMindmapById(id);
    return;
  }
  deleteMemo(id);
}


// Tag tree
// "/" separates levels (#work/proja). Selecting a node filters to it and its children.
let tagCollapsed = new Set(load('tag_collapsed', []));

function toggleTagNode(ev, path) {
  if (ev) ev.stopPropagation();
  if (tagCollapsed.has(path)) tagCollapsed.delete(path);
  else tagCollapsed.add(path);
  save('tag_collapsed', [...tagCollapsed]);
  renderMemoList();
}

function buildTagTree(allNotes) {
  const fullTags = new Set();
  for (const n of allNotes) for (const t of (n.tags || [])) fullTags.add(t);
  const root = { children: new Map() };
  for (const full of fullTags) {
    const parts = full.split('/').filter(Boolean);
    let node = root, path = '';
    for (const part of parts) {
      path = path ? path + '/' + part : part;
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path, children: new Map(), count: 0 });
      }
      node = node.children.get(part);
    }
  }
  // Count notes matching the tag or any descendant
  const matches = (tags, path) => (tags || []).some(t => t === path || t.startsWith(path + '/'));
  (function fill(node) {
    for (const child of node.children.values()) {
      let c = 0;
      for (const n of allNotes) if (matches(n.tags, child.path)) c++;
      child.count = c;
      fill(child);
    }
  })(root);
  return root;
}

const _TAG_CHEVRON = '<span class="mi mi-sm">expand_more</span>';

function renderTagTree(node, depth) {
  const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  let html = '';
  for (const child of kids) {
    const hasKids = child.children.size > 0;
    const collapsed = tagCollapsed.has(child.path);
    const isActive = activeTagFilter === child.path && notesViewActive();
    const safe = JSON.stringify(child.path).replace(/"/g, '&quot;');
    const expander = hasKids
      ? `<button class="tag-expand${collapsed ? ' collapsed' : ''}" onclick="toggleTagNode(event, ${safe})" aria-label="펼치기/접기">${_TAG_CHEVRON}</button>`
      : '<span class="tag-expand-spacer"></span>';
    html += `<div class="tag-row${isActive ? ' active' : ''}" style="--tag-depth:${depth}" onclick="setTagFilter(${safe})">
      ${expander}
      <span class="tag-hash">#</span>
      <span class="tag-row-label">${escapeHtml(child.name)}</span>
      <span class="tag-row-count">${child.count}</span>
    </div>`;
    if (hasKids && !collapsed) html += renderTagTree(child, depth + 1);
  }
  return html;
}
const MEMO_SORT_LABELS = { updated: '수정일순', created: '생성일순', title: '제목순' };

// Note-type filter: 'all' | 'memo' | 'mindmap'
let noteTypeFilter = load('note_type_filter', 'all');

function cycleMemoSort() {
  const order = ['updated', 'created', 'title'];
  memoSortMode = order[(order.indexOf(memoSortMode) + 1) % order.length];
  save('memo_sort', memoSortMode);
  renderMemoList();
}

function setNoteTypeFilter(t) {
  noteTypeFilter = t;
  save('note_type_filter', t);
  if (typeof navigateTo === 'function') {
    if (t === 'mindmap' && currentPage !== 'mindmap') { navigateTo('mindmap'); return; }
    if ((t === 'memo' || t === 'all') && currentPage === 'mindmap') { navigateTo('memo'); return; }
  }
  renderMemoList();
}

function togglePinNote(type, id, ev) {
  if (ev) ev.stopPropagation();
  // Pinning leaves updatedAt alone so the sort order doesn't shift
  if (type === 'mindmap') {
    const mm = (typeof mindmaps !== 'undefined' ? mindmaps : []).find(x => x.id === id);
    if (!mm) return;
    mm.pinned = !mm.pinned;
    save('mindmaps', mindmaps);
  } else {
    const m = memos.find(x => x.id === id);
    if (!m) return;
    m.pinned = !m.pinned;
    saveMemos();
  }
  if (typeof haptic === 'function') haptic('light');
  renderMemoList();
}
// Back-compat alias for text memos
function togglePinMemo(id, ev) { togglePinNote('memo', id, ev); }

// Reopen the list: show-editor on mobile, list-collapsed on desktop
window._reopenMemoList = function() {
  const page = document.getElementById('memo-page');
  if (!page) return;
  if (page.classList.contains('show-editor')) {
    if (typeof backToList === 'function') { backToList(); return; }
    page.classList.remove('show-editor');
  } else if (page.classList.contains('list-collapsed')) {
    if (typeof togglePanel === 'function') togglePanel('memo-page');
    else page.classList.remove('list-collapsed');
  }
};

// "+ 새 노트": create a note of the current page's type right away
function showNoteCreateMenu(anchor) {
  if (typeof currentPage !== 'undefined' && currentPage === 'mindmap') {
    if (typeof createMindmap === 'function') createMindmap();
    return;
  }
  if (typeof createMemo === 'function') createMemo();
}
window.showNoteCreateMenu = showNoteCreateMenu;

function _closeNoteCreateSheet() {
  const el = document.getElementById('note-create-sheet');
  if (!el) return;
  el.classList.remove('show');
  setTimeout(() => el.remove(), 180);
}
window._closeNoteCreateSheet = _closeNoteCreateSheet;

function _chooseNoteCreate(type) {
  _closeNoteCreateSheet();
  if (type === 'memo' && typeof createMemo === 'function') createMemo();
  else if (type === 'mindmap' && typeof createMindmap === 'function') createMindmap();
}
window._chooseNoteCreate = _chooseNoteCreate;

// Note context menu (right click / long press)
// Mindmaps reuse showMindmapMenu, memos get their own sheet
let memoMenuTargetId = null;

function showNoteMenu(type, id, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  if (memoSelectMode) return;
  if (type === 'mindmap') {
    if (typeof showMindmapMenu === 'function') showMindmapMenu(id);
    return;
  }
  const m = memos.find(x => x.id === id);
  if (!m) return;
  memoMenuTargetId = id;
  document.getElementById('memo-action-title').textContent = m.title || '제목 없음';
  const pinBtn = document.getElementById('memo-action-pin');
  if (pinBtn) {
    const pinIcon = '<span class="mi mi-sm' + (m.pinned ? ' mi-fill' : '') + '">push_pin</span>';
    pinBtn.innerHTML = pinIcon + ' ' + (m.pinned ? '고정 해제' : '고정');
  }
  document.getElementById('memo-action-overlay').classList.add('show');
  document.getElementById('memo-action-sheet').classList.add('show');
}

function closeMemoMenu() {
  document.getElementById('memo-action-overlay').classList.remove('show');
  document.getElementById('memo-action-sheet').classList.remove('show');
  memoMenuTargetId = null;
}

function togglePinMemoActive() {
  const id = memoMenuTargetId;
  closeMemoMenu();
  togglePinNote('memo', id);
}

async function renameMemoActive() {
  const id = memoMenuTargetId;
  closeMemoMenu();
  const m = memos.find(x => x.id === id);
  if (!m) return;
  const name = await promptDialog('새 이름', m.title || '', { placeholder: '메모 제목' });
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  m.title = trimmed;
  m.updatedAt = new Date().toISOString();
  saveMemos();
  renderMemoList();
  if (activeMemoId === id) renderMemoEditor();
}

function duplicateMemoActive() {
  const id = memoMenuTargetId;
  closeMemoMenu();
  const m = memos.find(x => x.id === id);
  if (!m) return;
  const copy = JSON.parse(JSON.stringify(m));
  copy.id = newMemoId();
  copy.title = (m.title || '제목 없음') + ' (복사)';
  const now = new Date().toISOString();
  copy.createdAt = now;
  copy.updatedAt = now;
  copy.date = now;
  copy.pinned = false;
  const insertIdx = memos.findIndex(x => x.id === id);
  memos.splice(insertIdx + 1, 0, copy);
  saveMemos();
  renderMemoList();
  toast(`"${copy.title}" 복제됨`, 'success');
}

function deleteMemoActive() {
  const id = memoMenuTargetId;
  closeMemoMenu();
  deleteMemo(id);
}

// Add the memo to the active mindmap as a linked node
function addMemoToActiveMindmap() {
  const id = memoMenuTargetId;
  closeMemoMenu();
  const m = memos.find(x => x.id === id);
  if (!m) return;
  if (typeof mindmaps === 'undefined' || mindmaps.length === 0) {
    toast('먼저 마인드맵을 만드세요'); return;
  }
  const map = mindmaps.find(x => x.id === activeMindmapId) || mindmaps[0];
  if (!map) { toast('마인드맵을 찾을 수 없어요'); return; }
  const cx = 400 + Math.floor((Math.random() - 0.5) * 200);
  const cy = 300 + Math.floor((Math.random() - 0.5) * 200);
  const newNode = {
    id: (map.idCounter || 1),
    text: (m.title || '제목 없음').slice(0, 30),
    x: cx, y: cy,
    color: '#268bd2',
    noteId: m.id
  };
  map.nodes = map.nodes || [];
  map.nodes.push(newNode);
  map.idCounter = (map.idCounter || 1) + 1;
  map.updatedAt = new Date().toISOString();
  save('mindmaps', mindmaps);
  activeMindmapId = map.id;
  save('mm_active', activeMindmapId);
  if (typeof bindActiveMap === 'function') bindActiveMap();
  if (typeof drawMindMap === 'function') drawMindMap();
  if (typeof navigateTo === 'function' && currentPage !== 'memo') navigateTo('memo', { updateHash: false });
  if (typeof selectNote === 'function') selectNote('mindmap', map.id);
  toast(`"${m.title || '제목'}" 마인드맵 "${map.name}"에 추가됨`, 'success');
}

function saveMemos() {
  save('memos', memos);
  save('memo_idcounter', memoIdCounter);
}

// Multi-select
let memoSelectMode = false;
let memoSelectedIds = new Set();

function toggleMemoSelectMode() {
  memoSelectMode = !memoSelectMode;
  memoSelectedIds.clear();
  document.getElementById('memo-select-toggle-btn')?.classList.toggle('active', memoSelectMode);
  renderMemoList();
}

function exitMemoSelectMode() {
  memoSelectMode = false;
  memoSelectedIds.clear();
  document.getElementById('memo-select-toggle-btn')?.classList.remove('active');
  renderMemoList();
}

function toggleMemoSelected(id, ev) {
  if (ev) { ev.stopPropagation(); }
  if (memoSelectedIds.has(id)) memoSelectedIds.delete(id);
  else memoSelectedIds.add(id);
  renderMemoList();
}

function selectAllMemosInView() {
  const search = (document.getElementById('memo-search')?.value || '').toLowerCase();
  const visible = memos.filter(m =>
    (m.title.toLowerCase().includes(search) || m.content.toLowerCase().includes(search)) &&
    (!activeTagFilter || (m.tags || []).includes(activeTagFilter))
  );
  visible.forEach(m => memoSelectedIds.add(m.id));
  renderMemoList();
}

async function bulkDeleteSelectedMemos() {
  if (memoSelectedIds.size === 0) { toast('선택된 메모가 없어요'); return; }
  const n = memoSelectedIds.size;
  if (!(await confirmDialog(`선택한 ${n}개 메모를 삭제할까요?\n(백업이 자동 생성됩니다)`, { danger: true, okText: '삭제' }))) return;
  if (typeof BackupService !== 'undefined') {
    BackupService.safeSnapshot('pre-bulk-delete').catch(() => {});
  }
  const tombs = load('memo_tombstones', {});
  const now = new Date().toISOString();
  for (const id of memoSelectedIds) tombs[id] = now;
  save('memo_tombstones', tombs);
  memos = memos.filter(m => !memoSelectedIds.has(m.id));
  if (memoSelectedIds.has(activeMemoId)) activeMemoId = null;
  saveMemos();
  exitMemoSelectMode();
  renderMemoEditor();
  backToList();
  toast(`${n}개 메모 삭제됨`, 'success');
}

async function bulkAddTagToSelectedMemos() {
  if (memoSelectedIds.size === 0) { toast('선택된 메모가 없어요'); return; }
  const tag = await promptDialog('추가할 태그 (쉼표로 여러 개 가능)', '', { placeholder: '예: work, idea' });
  if (!tag) return;
  const tags = tag.split(',').map(t => t.trim()).filter(Boolean);
  if (tags.length === 0) return;
  let count = 0;
  for (const m of memos) {
    if (!memoSelectedIds.has(m.id)) continue;
    if (!m.tags) m.tags = [];
    let added = false;
    for (const t of tags) {
      if (!m.tags.includes(t)) { m.tags.push(t); added = true; }
    }
    if (added) { touchMemo(m); count++; }
  }
  saveMemos();
  renderMemoList();
  toast(`${count}개 메모에 태그 추가됨`, 'success');
}

async function bulkRemoveTagFromSelectedMemos() {
  if (memoSelectedIds.size === 0) { toast('선택된 메모가 없어요'); return; }
  const sel = memos.filter(m => memoSelectedIds.has(m.id));
  const allTags = [...new Set(sel.flatMap(m => m.tags || []))].sort();
  if (allTags.length === 0) { toast('선택된 메모에 태그가 없어요'); return; }
  const tag = await promptDialog(`삭제할 태그`, '', { placeholder: `예: ${allTags.slice(0, 3).join(', ')}` });
  if (!tag) return;
  const t = tag.trim();
  let count = 0;
  for (const m of memos) {
    if (!memoSelectedIds.has(m.id)) continue;
    if (m.tags && m.tags.includes(t)) {
      m.tags = m.tags.filter(x => x !== t);
      touchMemo(m);
      count++;
    }
  }
  saveMemos();
  renderMemoList();
  toast(`${count}개 메모에서 "${t}" 태그 제거됨`, 'success');
}

// Sync merge compares updatedAt. date is kept equal for old memos and the list UI.
function touchMemo(memo) {
  const now = new Date().toISOString();
  memo.updatedAt = now;
  memo.date = now;
}

// Inline hashtags
// memo.content is the source of truth; memo.tags is always re-extracted from it.
// Adding/removing a tag chip edits "#tag" in the content.
const HASHTAG_RE = /(?:^|[\s,.;:!?(){}\[\]"'`])#([가-힣a-zA-Z][가-힣\w-]*(?:\/[가-힣\w-]+)*)/g;
const _BOUNDARY_SET = `[\\s,.;:!?(){}\\[\\]"'\`]`;

function extractHashtags(content) {
  if (!content) return [];
  const found = new Set();
  for (const m of content.matchAll(HASHTAG_RE)) {
    found.add(m[1]);
  }
  return [...found];
}

function _escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function _hasInlineTag(content, tag) {
  if (!content || !tag) return false;
  const re = new RegExp(`(?:^|${_BOUNDARY_SET})#${_escapeRe(tag)}(?=$|${_BOUNDARY_SET})`);
  return re.test(content);
}

function _addInlineTag(content, tag) {
  if (_hasInlineTag(content, tag)) return content;
  const c = content || '';
  const sep = c.length === 0 ? '' : (c.endsWith('\n') ? '' : '\n');
  return c + sep + '#' + tag;
}

function _removeInlineTag(content, tag) {
  if (!content) return '';
  // Keep the leading boundary char
  const re = new RegExp(`(^|${_BOUNDARY_SET})#${_escapeRe(tag)}(?=$|${_BOUNDARY_SET})`, 'g');
  let out = content.replace(re, '$1');
  // Trim trailing spaces left on the line
  out = out.replace(/[ \t]+\n/g, '\n');
  return out;
}

// Returns true if tags changed
function syncMemoHashtags(memo) {
  const inline = extractHashtags(memo.content || '');
  const old = memo.tags || [];
  const oldSet = new Set(old);
  const newSet = new Set(inline);
  const same = oldSet.size === newSet.size && [...newSet].every(t => oldSet.has(t));
  if (same) return false;
  memo.tags = inline;
  return true;
}

// One-time: write existing tags into content as #tag, then re-derive from content
function migrateHashtagsFromContent() {
  const KEY = 'mindflow_hashtag_migration_v2';
  try { if (localStorage.getItem(KEY)) return; } catch { return; }
  if (typeof memos === 'undefined' || !Array.isArray(memos)) return;
  let touchedCount = 0;
  for (const m of memos) {
    const oldContent = m.content || '';
    let content = oldContent;
    for (const t of (m.tags || [])) {
      if (!_hasInlineTag(content, t)) content = _addInlineTag(content, t);
    }
    const contentChanged = content !== oldContent;
    if (contentChanged) m.content = content;
    const tagsChanged = syncMemoHashtags(m);
    if (contentChanged || tagsChanged) {
      touchMemo(m);
      touchedCount++;
    }
  }
  if (touchedCount > 0) {
    saveMemos();
    if (typeof renderMemoList === 'function') renderMemoList();
    if (typeof renderMemoEditor === 'function') renderMemoEditor();
    if (typeof toast === 'function') {
      toast(`${touchedCount}개 메모의 태그를 본문에 동기화했어요`, 'success');
    }
    console.log(`[Migration] Synced ${touchedCount} memos: tags ↔ content`);
  }
  try { localStorage.setItem(KEY, '1'); } catch {}
}

function createMemo() {
  const now = new Date().toISOString();
  const memo = { id: newMemoId(), title: '새 메모', content: '', date: now, updatedAt: now, tags: [] };
  memos.unshift(memo);
  activeNoteType = 'memo';
  activeMemoId = memo.id;
  memoMode = 'live';
  save('memo_mode', 'live');
  saveMemos();
  renderMemoList();
  renderMemoEditor();
  const page = document.getElementById('memo-page');
  page.classList.remove('note-mindmap');
  page.classList.add('show-editor');
  setTimeout(() => {
    const inp = document.querySelector('.memo-editor-header input');
    if (inp) { inp.focus(); inp.select(); }
  }, 100);
}

function selectMemo(id) {
  selectNote('memo', id);
}

function backToList() {
  document.getElementById('memo-page').classList.remove('show-editor');
}

async function deleteMemo(id) {
  if (!(await confirmDialog('이 메모를 삭제하시겠습니까?', { danger: true, okText: '삭제' }))) return false;
  // Tombstone so a Drive pull can't resurrect it
  const tombs = load('memo_tombstones', {});
  tombs[id] = new Date().toISOString();
  save('memo_tombstones', tombs);
  memos = memos.filter(m => m.id !== id);
  if (activeMemoId === id) activeMemoId = null;
  saveMemos();
  renderMemoList();
  renderMemoEditor();
  backToList();
  toast('삭제되었습니다');
  return true;
}

// Search query
//   tag:work           has tag or a child tag
//   type:memo|mindmap
//   is:pinned|untagged|conflict
//   "exact phrase"
//   -foo               must not contain
//   bare word          substring
// Some old memo titles that came through macOS were stored as NFD (decomposed jamo),
// so includes() missed them (19 of 49). Normalize to NFC before comparing.
function _nfc(s) { return typeof s === 'string' ? s.normalize('NFC') : s; }

function parseSearchQuery(raw) {
  const tokens = [];
  if (!raw) return tokens;
  const re = /(-?)((?:tag|type|is):)?(?:"([^"]*)"|(\S+))/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const neg = m[1] === '-';
    const key = m[2] ? m[2].slice(0, -1).toLowerCase() : null; // strip ':'
    const val = _nfc(m[3] !== undefined ? m[3] : m[4] || '').toLowerCase();
    if (!val && !key) continue;
    tokens.push({ neg, key, val });
  }
  return tokens;
}

function evalSearchQuery(note, tokens) {
  if (!tokens.length) return true;
  const text = (note.searchText || _nfc(((note.title || '') + ' ' + (note.content || ''))).toLowerCase());
  for (const t of tokens) {
    let pass;
    if (t.key === 'tag') {
      const tag = t.val.replace(/^#/, '');
      pass = (note.tags || []).some(x => {
        const lx = _nfc(x || '').toLowerCase();
        return lx === tag || lx.startsWith(tag + '/');
      });
    } else if (t.key === 'type') {
      pass = note.type === t.val;
    } else if (t.key === 'is') {
      if (t.val === 'pinned') pass = !!note.pinned;
      else if (t.val === 'untagged') pass = (note.tags || []).length === 0;
      else if (t.val === 'conflict') {
        pass = (note.tags || []).includes('conflict') ||
               ((note.title || note.name || '').includes('(충돌'));
      } else pass = false;
    } else {
      pass = text.includes(t.val);
    }
    if (t.neg) pass = !pass;
    if (!pass) return false;
  }
  return true;
}

function _escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Snippet around the first matched bare word
function previewSnippetWithMatch(content, tokens) {
  const text = _nfc(content).replace(/^#+\s+.*$/gm, '').replace(/[*_`>#]/g, '').replace(/\n+/g, ' ');
  const word = tokens.find(t => !t.key && !t.neg && t.val)?.val;
  if (!word) return text.trim().slice(0, 90);
  const idx = text.toLowerCase().indexOf(word);
  if (idx < 0) return text.trim().slice(0, 90);
  const start = Math.max(0, idx - 25);
  const end = Math.min(text.length, idx + word.length + 65);
  return (start > 0 ? '… ' : '') + text.slice(start, end).trim() + (end < text.length ? ' …' : '');
}

function highlightSearchMatch(html, tokens) {
  if (!tokens.length) return html;
  // Display only, so NFC gives the same result
  let out = _nfc(html);
  for (const t of tokens) {
    if (t.key || t.neg || !t.val) continue;
    out = out.replace(new RegExp(`(${_escapeRegex(t.val)})`, 'gi'), '<mark>$1</mark>');
  }
  return out;
}

function renderMemoList() {
  const searchRaw = document.getElementById('memo-search').value;
  const search = searchRaw.toLowerCase();
  const searchTokens = parseSearchQuery(searchRaw);
  const allNotes = getAllNotes();

  let untaggedCount = 0;
  for (const n of allNotes) {
    if ((n.tags || []).length === 0) untaggedCount++;
  }
  const tagTree = buildTagTree(allNotes);

  // Sort + note-type filter
  const sortBar = document.getElementById('memo-sort-bar');
  if (sortBar) {
    const typeSeg = `<div class="note-type-seg">
      <button class="${noteTypeFilter === 'all' ? 'active' : ''}" onclick="setNoteTypeFilter('all')">전체</button>
      <button class="${noteTypeFilter === 'memo' ? 'active' : ''}" onclick="setNoteTypeFilter('memo')">메모</button>
      <button class="${noteTypeFilter === 'mindmap' ? 'active' : ''}" onclick="setNoteTypeFilter('mindmap')">마인드맵</button>
    </div>`;
    // On mobile the tag tree is inside the drawer, so an active filter was invisible.
    // Show it as a chip above the list that clears in one tap.
    const filterChip = activeTagFilter
      ? `<div class="memo-filter-chip">
           <span class="mi mi-sm">label</span>
           <span class="memo-filter-name">${activeTagFilter === '__untagged__' ? '태그 없음' : escapeHtml(activeTagFilter)}</span>
           <button onclick="setTagFilter(null)" aria-label="필터 해제" title="필터 해제">
             <span class="mi mi-sm">close</span>
           </button>
         </div>`
      : '';
    sortBar.innerHTML = `<div class="memo-sort-row">${typeSeg}<button class="memo-sort-btn" onclick="cycleMemoSort()" title="정렬 기준 변경">
      <span class="mi mi-sm">swap_vert</span>
      <span>${MEMO_SORT_LABELS[memoSortMode]}</span></button></div>${filterChip}`;
  }

  // Sidebar tag tree: all notes / #tags / untagged
  const tagBar = document.getElementById('memo-tag-bar');
  if (tagBar) {
    const allRow = `<div class="tag-row tag-row-special${(!activeTagFilter && notesViewActive()) ? ' active' : ''}" onclick="setTagFilter(null)">
      <span class="tag-expand-spacer"></span>
      <span class="tag-row-label">전체 노트</span>
      <span class="tag-row-count">${allNotes.length}</span>
    </div>`;
    const untaggedRow = untaggedCount > 0
      ? `<div class="tag-row tag-row-special${(activeTagFilter === '__untagged__' && notesViewActive()) ? ' active' : ''}" onclick="setTagFilter('__untagged__')">
          <span class="tag-expand-spacer"></span>
          <span class="tag-row-label">태그 없음</span>
          <span class="tag-row-count">${untaggedCount}</span>
        </div>`
      : '';
    const tagsLabel = tagTree.children.size > 0 ? `<div class="tag-tree-label">태그</div>` : '';
    tagBar.innerHTML = `${allRow}${untaggedRow}${tagsLabel}<div class="tag-tree">${renderTagTree(tagTree, 0)}</div>`;
  }

  const filtered = allNotes.filter(n => {
    if (noteTypeFilter !== 'all' && n.type !== noteTypeFilter) return false;
    if (searchTokens.length && !evalSearchQuery(n, searchTokens)) return false;
    if (!activeTagFilter) return true;
    if (activeTagFilter === '__untagged__') return (n.tags || []).length === 0;
    // Parent tag also matches child tags
    return (n.tags || []).some(t => t === activeTagFilter || t.startsWith(activeTagFilter + '/'));
  }).sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (memoSortMode === 'title') {
      return (a.title || '').localeCompare(b.title || '', 'ko');
    }
    if (memoSortMode === 'created') {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    }
    // 'updated' (default)
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });
  const container = document.getElementById('memo-items');
  const countEl = document.getElementById('memo-count');
  if (countEl) countEl.textContent = allNotes.length;
  // Count in the page header
  const chipEl = document.getElementById('page-meta-chip');
  if (chipEl && currentPage === 'memo') chipEl.textContent = allNotes.length;

  // Multi-select only applies to text memos
  const toolbar = document.getElementById('memo-select-toolbar');
  if (toolbar) {
    if (memoSelectMode) {
      const n = memoSelectedIds.size;
      toolbar.style.display = '';
      toolbar.innerHTML = `
        <div class="memo-select-bar">
          <span class="memo-select-count">${n}개 선택</span>
          <button class="memo-select-btn" onclick="selectAllMemosInView()">전체</button>
          <button class="memo-select-btn" onclick="bulkAddTagToSelectedMemos()" ${n===0?'disabled':''}><span class="mi mi-sm">label</span> 태그추가</button>
          <button class="memo-select-btn" onclick="bulkRemoveTagFromSelectedMemos()" ${n===0?'disabled':''}><span class="mi mi-sm">label_off</span> 태그제거</button>
          <button class="memo-select-btn danger" onclick="bulkDeleteSelectedMemos()" ${n===0?'disabled':''}><span class="mi mi-sm">delete</span> 삭제</button>
          <button class="memo-select-btn" onclick="exitMemoSelectMode()">완료</button>
        </div>`;
    } else {
      toolbar.style.display = 'none';
      toolbar.innerHTML = '';
    }
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="memo-empty">
      <span class="mi big-icon">edit_note</span>
      ${allNotes.length === 0 ? '아직 노트가 없습니다<br>+ 버튼을 눌러 시작하세요' : '검색 결과가 없습니다'}
    </div>`;
    return;
  }
  const now = new Date();
  container.innerHTML = filtered.map(n => {
    const date = new Date(n.updatedAt || n.createdAt);
    let dateStr;
    if (isSameDay(date, now)) {
      dateStr = `오늘 ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    } else {
      const dayDiff = Math.floor((now - date) / (1000*60*60*24));
      if (dayDiff < 7) dateStr = `${dayDiff}일 전`;
      else dateStr = `${date.getMonth()+1}월 ${date.getDate()}일`;
    }
    let preview, metaRight;
    if (n.type === 'mindmap') {
      preview = `노드 ${n.nodeCount}개 · 연결 ${n.edgeCount}개`;
      metaRight = '마인드맵';
    } else {
      preview = previewSnippetWithMatch(n.content, searchTokens) || '내용 없음';
      metaRight = `${n.content.length}자`;
    }
    // Escape first, then wrap matches in <mark>
    const titleHtml = highlightSearchMatch(escapeHtml(n.title) || '제목 없음', searchTokens);
    const previewHtml = highlightSearchMatch(escapeHtml(preview), searchTokens);
    const isActive = isActiveNote(n.type, n.id) && !memoSelectMode;
    const selectable = n.type === 'memo';
    const isSelected = selectable && memoSelectedIds.has(n.id);
    const checkbox = (memoSelectMode && selectable)
      ? `<span class="memo-select-check ${isSelected ? 'checked' : ''}" onclick="toggleMemoSelected(${n.id}, event)">${isSelected ? '✓' : ''}</span>`
      : '';
    const onClick = (memoSelectMode && selectable)
      ? `toggleMemoSelected(${n.id}, event)`
      : `selectNote('${n.type}', ${n.id})`;
    const pinBtn = memoSelectMode ? '' :
      `<button class="memo-pin-btn ${n.pinned ? 'pinned' : ''}" onclick="togglePinNote('${n.type}', ${n.id}, event)" title="${n.pinned ? '고정 해제' : '고정'}" aria-label="고정">
        <span class="mi mi-sm${n.pinned ? ' mi-fill' : ''}">push_pin</span>
      </button>`;
    const typeIcon = n.type === 'mindmap' ? 'account_tree' : 'edit_note';
    return `<div class="swipe-row" data-id="${n.id}" data-note-type="${n.type}">
      <div class="memo-item swipe-content ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${n.pinned ? 'is-pinned' : ''}" onclick="${onClick}" oncontextmenu="showNoteMenu('${n.type}', ${n.id}, event); return false;">
        ${checkbox}
        <span class="note-type-badge mi mi-sm" aria-hidden="true">${typeIcon}</span>
        <div class="memo-item-body">
          <div class="memo-item-title">${titleHtml}</div>
          <div class="memo-item-preview">${previewHtml}</div>
          <div class="memo-item-meta">
            <span>${dateStr}</span>
            <span class="dot"></span>
            <span>${metaRight}</span>
          </div>
        </div>
        ${pinBtn}
      </div>
      <button class="swipe-action" aria-label="삭제"><span class="mi mi-sm">delete</span> 삭제</button>
    </div>`;
  }).join('');
  // Swipe-to-delete + long-press context menu (disabled in select mode)
  if (!container.dataset.swipeReady) {
    attachSwipeToDelete(container, {
      resolveId: (row) => parseInt(row.dataset.id),
      onDelete: (id, row) => {
        if (memoSelectMode) return;
        deleteNote(row.dataset.noteType, id);
      },
      onLongPress: (id, row) => {
        if (memoSelectMode) return;
        showNoteMenu(row.dataset.noteType, id, null);
      }
    });
    container.dataset.swipeReady = '1';
  }
}

// ↑/↓ shortcuts. Reads the list from the DOM, no cache
function navigateMemoList(delta) {
  const items = document.querySelectorAll('#memo-items .swipe-row');
  if (!items.length) return;
  const arr = Array.from(items).map(r => ({
    el: r,
    id: parseInt(r.dataset.id),
    type: r.dataset.noteType
  }));
  const curIdx = arr.findIndex(x => isActiveNote(x.type, x.id));
  let next = curIdx + delta;
  if (curIdx === -1) next = delta > 0 ? 0 : arr.length - 1;
  if (next < 0) next = 0;
  if (next >= arr.length) next = arr.length - 1;
  const t = arr[next];
  if (!t) return;
  selectNote(t.type, t.id);
  t.el.scrollIntoView({ block: 'nearest' });
}

function computeMemoMeta(memo) {
  const content = memo.content || '';
  const charCount = content.length;
  // Assumes a Korean reading speed of about 250 chars/min
  const readMin = Math.max(1, Math.round(charCount / 250));
  const imageCount = (content.match(/!\[[^\]]*\]\(/g) || []).length;
  const lineCount = content ? content.split('\n').length : 0;
  return {
    charCount, readMin, imageCount, lineCount,
    createdRel: relativeTime(memo.date || memo.createdAt || memo.updatedAt),
    updatedRel: relativeTime(memo.updatedAt || memo.date),
  };
}

function relativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = now - d;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return '방금';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (isSameDay(d, now)) return `오늘 ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  if (diffH < 24 * 7) return `${Math.floor(diffH / 24)}일 전`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth()+1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}`;
}

function renderMemoEditor() {
  const editor = document.getElementById('memo-editor');
  // Keep decoded images to put back after re-render (iOS re-decode flicker)
  const _imgCache = new Map();
  editor.querySelectorAll('.markdown-body img').forEach(img => {
    if (img.complete && img.naturalWidth > 0) _imgCache.set(img.src, img);
  });
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) {
    const mod = (navigator.platform || '').toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
    editor.innerHTML = `<div class="memo-editor-empty">
      <span class="mi big">edit_note</span>
      <div style="font-size:16px;font-weight:600;color:var(--text-dim);">메모를 선택하거나 새로 만드세요</div>
      <div class="hint">목록에서 메모를 선택하거나 + 버튼을 눌러 새 메모를 만드세요</div>
      <div class="shortcuts">
        <div style="font-weight:600;color:var(--text);margin-bottom:6px;">단축키</div>
        <code>${mod}+K</code> 명령 팔레트 ·  <code>${mod}+N</code> 새 메모 ·  <code>${mod}+F</code> 검색<br>
        <code>↑/↓</code> 메모 이동 ·  <code>${mod}+P</code> 핀 ·  <code>${mod}+⌫</code> 삭제<br>
        <div style="font-weight:600;color:var(--text);margin:10px 0 6px;">마크다운 단축 문법</div>
        <code># </code> 큰 제목 ·  <code>## </code> 중제목<br>
        <code>**굵게**</code> ·  <code>*기울임*</code> ·  <code>~~취소~~</code><br>
        <code>- </code> 목록 ·  <code>- [ ] </code> 체크박스<br>
        <code>\`코드\`</code> ·  <code>&gt; </code> 인용문 ·  <code>---</code> 구분선
      </div>
    </div>`;
    return;
  }
  const meta = computeMemoMeta(memo);

  // Only the live editor is used now
  const bodyHtml = `<div class="memo-body-wrap edit-only"><div class="bear-editor" id="memo-live-editor"></div></div>`;

  // Don't replace the DOM while the user is typing in it
  if (document.activeElement && editor.contains(document.activeElement)) return;

  editor.innerHTML = `
    <div class="memo-editor-toolbar">
      <button class="panel-reopen-btn" onclick="togglePanel('memo-page')" title="목록 열기">
        <span class="mi mi-sm">chevron_right</span>
      </button>
      <button class="memo-back" onclick="backToList()" aria-label="뒤로">‹</button>
      <div class="memo-toolbar-spacer"></div>
      <!-- 드로잉 버튼 숨김 (2026-07-29). 필기는 아이패드 전용 앱에서 하고
           이 앱은 결과물을 보관하는 쪽으로 역할을 나눴다. drawing.js와 모달
           마크업은 그대로 두었으므로, 되살리려면 아래 3줄만 복구하면 된다.
        <button class="memo-icon-btn" onclick="openDrawingModal()" title="드로잉 (Apple Pencil)">
          <span class="mi mi-sm">brush</span>
        </button>
      -->
      <button class="memo-icon-btn" onclick="startPomodoroForActiveMemo()" title="이 노트에 집중 (타이머 시작)">
        <span class="mi mi-sm">timer</span>
      </button>
      <button class="memo-icon-btn" onclick="triggerImageUpload()" title="이미지 업로드 (또는 메모에 붙여넣기/드래그)">
        <span class="mi mi-sm">image</span>
      </button>
      <button class="memo-icon-btn" onclick="triggerFileUpload()" title="파일 첨부 (Google Drive에 업로드)">
        <span class="mi mi-sm">attach_file</span>
      </button>
      <button class="memo-icon-btn" onclick="openVersionHistory()" title="버전 히스토리">
        <span class="mi mi-sm">history</span>
      </button>
      <button class="memo-icon-btn danger" onclick="deleteMemo(${memo.id})" title="메모 삭제">
        <span class="mi mi-sm">delete</span>
      </button>
    </div>
    <div class="memo-editor-header">
      <input type="text" value="${escapeHtml(memo.title)}" oninput="updateMemoTitle(this.value)" placeholder="제목 없음">
    </div>
    <div class="memo-tags-row">
      <div id="memo-tag-chips">
        ${(memo.tags || []).map(t => `<span class="memo-tag-chip">${escapeHtml(t)}<button onclick="removeMemoTag(${JSON.stringify(t).replace(/"/g, '&quot;')})" class="memo-tag-del">✕</button></span>`).join('')}
      </div>
      <button class="memo-tag-add-btn" onclick="focusMemoTagInput()">+ 태그</button>
      <input type="text" id="memo-tag-input" class="memo-tag-input" placeholder="태그명..."
        oninput="renderTagSuggest()"
        onkeydown="if(event.key==='Enter'&&!event.isComposing){addMemoTagFromInput();} if(event.key==='Escape'){hideMemoTagInput();}"
        onblur="setTimeout(hideMemoTagInput,150)">
      <div class="tag-suggest" id="memo-tag-suggest"></div>
    </div>
    <!-- 메타는 수정 시각 한 줄만. 예전엔 수정·작성·글자수·읽기시간·이미지·태그
         6개가 가운뎃점으로 이어져 제목 바로 밑에서 시선을 뺏었다.
         나머지는 hover 툴팁으로 옮겨 필요할 때만 보이게 한다. -->
    <div class="memo-meta" title="작성 ${meta.createdRel} · ${meta.charCount}자 · 읽기 ${meta.readMin}분${meta.imageCount > 0 ? ` · 이미지 ${meta.imageCount}` : ''}">
      ${meta.updatedRel}
    </div>
    ${bodyHtml}
    ${_renderBacklinkPanel(memo)}
  `;

  _patchImagesAfterRender(editor, _imgCache);

  const bearEl = document.getElementById('memo-live-editor');
  if (bearEl && window.CM6) {
    if (window._cm6View) { try { window._cm6View.destroy(); } catch {} window._cm6View = null; }
    window._cm6View = window.CM6.createEditor(bearEl, memo.content, (text) => updateMemoContent(text));
    setTimeout(() => { try { window._cm6View.focus(); } catch {} }, 30);
  }

  // Cached images never fire load, so clear the shimmer manually
  setTimeout(markLoadedImages, 0);
}

// view/edit modes were removed; memoMode is always 'live' and kept for old callers
let memoMode = 'live';
function setMemoMode(_mode) {
  memoMode = 'live';
  renderMemoEditor();
}

function updateMemoTitle(val) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (memo) {
    memo.title = val;
    touchMemo(memo);
    saveMemos();
    renderMemoList();
  }
}

function updateMemoContent(val) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) return;
  memo.content = val;
  syncMemoHashtags(memo);
  _refreshMemoTagChips();
  touchMemo(memo);
  saveMemos();
  // Update meta without re-rendering the editor
  const meta = document.querySelector('.memo-meta');
  if (meta) {
    const date = new Date(memo.date);
    const dateStr = `${date.getFullYear()}년 ${date.getMonth()+1}월 ${date.getDate()}일 ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    const wc = val.trim().split(/\s+/).filter(Boolean).length;
    const spans = meta.querySelectorAll('span');
    if (spans[0]) spans[0].textContent = dateStr;
    if (spans[2]) spans[2].textContent = `${val.length}자 · ${wc}단어`;
  }
  // Split-mode preview, keeping decoded images
  const preview = document.querySelector('.memo-body-wrap.split #memo-preview');
  if (preview) {
    const _previewCache = new Map();
    preview.querySelectorAll('img').forEach(img => {
      if (img.complete && img.naturalWidth > 0) _previewCache.set(img.src, img);
    });
    preview.innerHTML = val.trim() ? md2html(val) : '<div class="markdown-empty">미리볼 내용이 없습니다</div>';
    _patchImagesAfterRender(preview, _previewCache);
    setTimeout(markLoadedImages, 0);
  }
  clearTimeout(window._memoListTimer);
  window._memoListTimer = setTimeout(renderMemoList, 500);
}

function filterMemos() { renderMemoList(); }

function setTagFilter(tag) {
  activeTagFilter = tag;
  // navigateTo() re-renders the list and tag tree
  if (typeof navigateTo === 'function') navigateTo('memo');
  else renderMemoList();
  if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
}

function _refreshMemoTagChips() {
  const memo = memos.find(m => m.id === activeMemoId);
  const chipsEl = document.getElementById('memo-tag-chips');
  if (!chipsEl || !memo) return;
  chipsEl.innerHTML = (memo.tags || []).map(t =>
    `<span class="memo-tag-chip">${escapeHtml(t)}<button onclick="removeMemoTag(${JSON.stringify(t).replace(/"/g, '&quot;')})" class="memo-tag-del">✕</button></span>`
  ).join('');
}

function addMemoTag(tag) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) return;
  tag = tag.trim().replace(/^#/, '');
  if (!tag) return;
  // Content is the source of truth, so write #tag into the body
  if (!_hasInlineTag(memo.content, tag)) {
    memo.content = _addInlineTag(memo.content || '', tag);
  }
  syncMemoHashtags(memo);
  touchMemo(memo);
  saveMemos();
  _refreshMemoTagChips();
  renderMemoList();
  // Re-render so CodeMirror shows the appended #tag
  if (typeof renderMemoEditor === 'function') renderMemoEditor();
}

function removeMemoTag(tag) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) return;
  memo.content = _removeInlineTag(memo.content || '', tag);
  syncMemoHashtags(memo);
  touchMemo(memo);
  saveMemos();
  _refreshMemoTagChips();
  renderMemoList();
  if (typeof renderMemoEditor === 'function') renderMemoEditor();
}

function focusMemoTagInput() {
  const input = document.getElementById('memo-tag-input');
  if (!input) return;
  input.classList.add('visible');
  input.focus();
  renderTagSuggest();
}

function addMemoTagFromInput() {
  const input = document.getElementById('memo-tag-input');
  if (!input) return;
  addMemoTag(input.value);
  input.value = '';
  hideMemoTagInput();
}

function hideMemoTagInput() {
  const input = document.getElementById('memo-tag-input');
  if (!input || document.activeElement === input) return;
  input.classList.remove('visible');
  input.value = '';
  const box = document.getElementById('memo-tag-suggest');
  if (box) box.innerHTML = '';
}

// Tag autocomplete
// Typing tags by hand produced near-duplicates like '프로젝트/블로그' and '프로젝트/블로그앱',
// so existing tags are suggested. Enter still creates a new tag as typed.
function allExistingTags() {
  const set = new Set();
  for (const n of getAllNotes()) for (const t of (n.tags || [])) if (t) set.add(t);
  return [...set];
}

function renderTagSuggest() {
  const input = document.getElementById('memo-tag-input');
  const box = document.getElementById('memo-tag-suggest');
  if (!input || !box) return;
  const q = input.value.trim().toLowerCase();
  const memo = memos.find(m => m.id === activeMemoId);
  const own = new Set((memo && memo.tags) || []);

  const hits = allExistingTags()
    .filter(t => !own.has(t))
    .filter(t => !q || t.toLowerCase().includes(q))
    .sort((a, b) => {
      // Prefix matches first, then alphabetical
      const as = q && a.toLowerCase().startsWith(q) ? 0 : 1;
      const bs = q && b.toLowerCase().startsWith(q) ? 0 : 1;
      return as !== bs ? as - bs : a.localeCompare(b, 'ko');
    })
    .slice(0, 8);

  box.innerHTML = hits.map(t =>
    `<button class="tag-suggest-item" onmousedown="event.preventDefault()" onclick="pickTagSuggest(${JSON.stringify(t).replace(/"/g, '&quot;')})">${escapeHtml(t)}</button>`
  ).join('');
}

// onmousedown preventDefault on items stops the input blur from hiding the list before the click lands
function pickTagSuggest(tag) {
  addMemoTag(tag);
  const input = document.getElementById('memo-tag-input');
  if (input) { input.value = ''; input.blur(); }
  hideMemoTagInput();
}

renderMemoList();
renderMemoEditor();


// Image upload to Drive (paste / drag / button)
async function uploadImageToDrive(blob) {
  if (!driveAssetsFolderId) {
    toast('이미지 업로드는 Drive 연결이 필요합니다', 'error');
    return null;
  }
  try {
    toast('이미지 업로드 중...');
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const name = `img-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const file = await driveUploadFile(name, blob, blob.type, driveAssetsFolderId);
    await driveMakePublic(file.id);
    // lh3 CDN is much faster than drive.google.com/thumbnail
    const url = `https://lh3.googleusercontent.com/d/${file.id}=w2560`;
    toast('이미지 업로드 완료', 'success');
    return { url, id: file.id, name };
  } catch (e) {
    toast('업로드 실패: ' + e.message, 'error');
    return null;
  }
}

// Insert markdown at the cursor
function insertIntoActiveMemo(insertText) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) return false;

  const ta = document.getElementById('memo-textarea');
  if (ta && memoMode === 'edit') {
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + insertText + ta.value.slice(end);
    const caret = start + insertText.length;
    try { ta.setSelectionRange(caret, caret); } catch {}
    ta.focus();
    updateMemoContent(ta.value);
    return true;
  }

  if (window._cm6View && memoMode === 'live') {
    const view = window._cm6View;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + insertText.length },
    });
    view.focus();
    return true;
  }

  // No editor mounted: append and switch to live
  memo.content = (memo.content || '') + insertText;
  touchMemo(memo);
  saveMemos();
  setMemoMode('live');
  return true;
}

// iPhone photos are 4032px and 2-5MB. 2560px at q=0.92 comes out around
// 600KB-1.2MB and still looks sharp on retina at full memo width.
async function resizeImage(blob, maxDim = 2560, quality = 0.92) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > maxDim || h > maxDim) {
        const scale = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => {
        URL.revokeObjectURL(url);
        if (b) resolve(b);
        else reject(new Error('이미지 변환 실패'));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 로드 실패 (지원하지 않는 형식일 수 있음)'));
    };
    img.src = url;
  });
}

async function handleImageInsert(blob) {
  if (!activeMemoId) { toast('먼저 메모를 선택하세요'); return; }

  let workingBlob = blob;
  try {
    // HEIC/HEIF always (Safari can't render them inline). Otherwise only > 1.5MB
    // so small PNG screenshots stay sharp.
    if (blob.size > 1_500_000 || /image\/(heic|heif)/i.test(blob.type)) {
      toast('이미지 처리 중...');
      workingBlob = await resizeImage(blob, 2560, 0.92);
    }
  } catch (e) {
    console.warn('Resize failed, using original:', e);
  }

  let insertText;
  if (driveAssetsFolderId) {
    const result = await uploadImageToDrive(workingBlob);
    if (!result) return;
    insertText = `\n![${result.name}](${result.url})\n`;
  } else {
    // No Drive: inline base64
    if (workingBlob.size > 1_500_000) {
      toast('이미지가 너무 큽니다. Drive를 연결하면 자동 업로드돼요', 'error');
      return;
    }
    const dataUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(workingBlob);
    });
    insertText = `\n![image](${dataUrl})\n`;
    toast('인라인 이미지로 삽입됨 (Drive 연결하면 자동 업로드)', 'success');
  }
  insertIntoActiveMemo(insertText);
}

document.addEventListener('paste', (e) => {
  const ae = document.activeElement;
  const inEditor = ae && ae.tagName === 'TEXTAREA' && ae.closest('.memo-editor');
  if (!inEditor) return;
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (blob) handleImageInsert(blob);
      return;
    }
  }
});

document.addEventListener('dragover', (e) => {
  if (e.target.closest && e.target.closest('.memo-editor')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  const target = e.target.closest && e.target.closest('.memo-editor');
  if (!target) return;
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const img = [...files].find(f => f.type.startsWith('image/'));
  if (img) {
    e.preventDefault();
    handleImageInsert(img);
  }
});

// File upload to Drive (any file type)
// Uploaded the same way as images, but inserted as a markdown link instead of an image.
// Sharing works the same too (anyone with the URL).
async function uploadFileToDrive(file) {
  if (!driveAssetsFolderId) {
    toast('파일 업로드는 Drive 연결이 필요합니다 (동기화 모달에서 연결)', 'error');
    return null;
  }
  // Ask again above 50MB (mobile data)
  if (file.size > 50 * 1024 * 1024) {
    const ok = await confirmDialog(
      `"${file.name}"\n파일 크기: ${_fmtFileSize(file.size)}\n\n업로드에 시간이 걸려요. 계속할까요?`,
      { okText: '업로드' }
    );
    if (!ok) return null;
  }
  try {
    toast(`파일 업로드 중... (${_fmtFileSize(file.size)})`);
    // Prefix to avoid name clashes
    const safeName = (file.name || 'file').replace(/[/\\?%*:|"<>]/g, '_');
    const driveName = `file-${Date.now()}-${safeName}`;
    const uploaded = await driveUploadFile(
      driveName, file, file.type || 'application/octet-stream', driveAssetsFolderId
    );
    await driveMakePublic(uploaded.id);
    // Share link the browser can preview or download
    const url = `https://drive.google.com/file/d/${uploaded.id}/view`;
    toast('파일 업로드 완료', 'success');
    return { url, id: uploaded.id, name: file.name, size: file.size };
  } catch (e) {
    toast('업로드 실패: ' + e.message, 'error');
    return null;
  }
}

function _fmtFileSize(n) {
  if (!Number.isFinite(n)) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function triggerFileUpload() {
  if (!activeMemoId) { toast('먼저 메모를 선택하세요', 'error'); return; }
  const input = document.createElement('input');
  input.type = 'file';
  // Any file type (images have their own button)
  input.multiple = true;
  input.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
  input.onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    // One at a time because of the Drive API rate limit
    for (const f of files) {
      const result = await uploadFileToDrive(f);
      if (!result) continue;
      const size = _fmtFileSize(result.size);
      // Icon fonts don't work in markdown, so every file type gets the same clip character
      const link = `[📎 ${result.name} (${size})](${result.url})\n`;
      insertIntoActiveMemo(link);
    }
    setTimeout(() => { try { input.remove(); } catch {} }, 200);
  };
  document.body.appendChild(input);
  input.click();
}

function triggerImageUpload() {
  // iOS doesn't reliably open the picker for a detached input, so append it to
  // the DOM. Explicit MIME types make iPadOS show the photo library option.
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,image/jpeg,image/png,image/heic,image/heif,image/webp,image/gif';
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.style.top = '-9999px';
  input.style.opacity = '0';
  input.onchange = (e) => {
    const f = e.target.files?.[0];
    if (f) handleImageInsert(f);
    setTimeout(() => { try { input.remove(); } catch {} }, 200);
  };
  document.body.appendChild(input);
  input.click();
}

// Put already-decoded <img> nodes back after an innerHTML re-render.
// iOS Safari otherwise re-decodes on every render and images flicker.
// imgCache: Map<src, img> captured before the innerHTML replace.
function _patchImagesAfterRender(container, imgCache) {
  if (!imgCache || imgCache.size === 0) return;
  container.querySelectorAll('img').forEach(newImg => {
    const old = imgCache.get(newImg.src);
    if (old && !old.isConnected) {
      old.className = newImg.className;
      newImg.parentNode.replaceChild(old, newImg);
    }
  });
}

// Image lightbox
function openImageLightbox(src, alt) {
  let lb = document.getElementById('image-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'image-lightbox';
    lb.className = 'image-lightbox';
    lb.innerHTML = `
      <button class="lightbox-close" aria-label="닫기">×</button>
      <img class="lightbox-img" alt="">
    `;
    document.body.appendChild(lb);
    lb.addEventListener('click', (e) => {
      if (e.target === lb || e.target.classList.contains('lightbox-close')) {
        closeImageLightbox();
      }
    });
  }
  const img = lb.querySelector('.lightbox-img');
  img.src = src;
  img.alt = alt || '';
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeImageLightbox() {
  const lb = document.getElementById('image-lightbox');
  if (!lb) return;
  lb.classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeImageLightbox();
});
// stopPropagation so parent click handlers don't also fire.
// For lh3 URLs, =w0 requests the original size.
document.addEventListener('click', (e) => {
  const img = e.target.closest('.markdown-body img');
  if (!img) return;
  e.stopPropagation();
  e.preventDefault();
  let fullSrc = img.src;
  const m = fullSrc.match(/^(https:\/\/lh3\.googleusercontent\.com\/d\/[^=]+)=w\d+/);
  if (m) fullSrc = m[1] + '=w0';
  openImageLightbox(fullSrc, img.alt);
});

// .loaded removes the shimmer. load doesn't bubble, so listen in capture phase.
document.addEventListener('load', (e) => {
  if (e.target?.tagName === 'IMG' && e.target.closest('.markdown-body')) {
    e.target.classList.add('loaded');
  }
}, true);
// Images already complete from cache never fire load
function markLoadedImages() {
  document.querySelectorAll('.markdown-body img').forEach(img => {
    if (img.complete && img.naturalWidth > 0) img.classList.add('loaded');
  });
}

// Per-memo version history (IndexedDB)
// BackupService covers the whole state; this is for rolling back a single memo.
// Throttled to one entry per 5 min, plus one when switching to another memo.
const MH_DB = 'mindflow-memo-history';
const MH_STORE = 'versions';
const MH_VERSIONS_PER_MEMO = 10;
const MH_THROTTLE_MS = 5 * 60_000;
const _mhLastPushAt = {};

function _mhOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MH_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MH_STORE)) {
        const s = db.createObjectStore(MH_STORE, { keyPath: 'key' });
        s.createIndex('memoId', 'memoId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function mhGetVersionsForMemo(memoId) {
  try {
    const db = await _mhOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MH_STORE, 'readonly');
      const idx = tx.objectStore(MH_STORE).index('memoId');
      const req = idx.getAll(memoId);
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.ts - a.ts));
      req.onerror = () => reject(req.error);
    });
  } catch (e) { console.warn('mh get:', e); return []; }
}

async function mhPushVersion(memo, opts) {
  if (!memo) return;
  opts = opts || {};
  const now = Date.now();
  if (!opts.force && _mhLastPushAt[memo.id] && now - _mhLastPushAt[memo.id] < MH_THROTTLE_MS) return;
  try {
    const existing = await mhGetVersionsForMemo(memo.id);
    // Skip if the content is unchanged
    if (existing.length && existing[0].content === (memo.content || '') && existing[0].title === (memo.title || '')) return;
    _mhLastPushAt[memo.id] = now;
    const db = await _mhOpen();
    const tx = db.transaction(MH_STORE, 'readwrite');
    const store = tx.objectStore(MH_STORE);
    store.put({
      key: `${memo.id}:${now}`,
      memoId: memo.id,
      ts: now,
      title: memo.title || '',
      content: memo.content || '',
      tags: memo.tags || []
    });
    if (existing.length >= MH_VERSIONS_PER_MEMO) {
      for (const v of existing.slice(MH_VERSIONS_PER_MEMO - 1)) store.delete(v.key);
    }
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (e) { console.warn('mh push:', e); }
}

async function mhDeleteAllForMemo(memoId) {
  try {
    const versions = await mhGetVersionsForMemo(memoId);
    if (versions.length === 0) return;
    const db = await _mhOpen();
    const tx = db.transaction(MH_STORE, 'readwrite');
    const store = tx.objectStore(MH_STORE);
    for (const v of versions) store.delete(v.key);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch {}
}

// Version history modal
async function openVersionHistory() {
  if (!activeMemoId) { toast('메모를 먼저 선택하세요'); return; }
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) return;
  // Force a save so the current state is in the list too
  await mhPushVersion(memo, { force: true });
  const versions = await mhGetVersionsForMemo(memo.id);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show app-dialog-overlay version-history-overlay';
  const body = document.createElement('div');
  body.className = 'modal version-history-modal';
  body.innerHTML = `
    <div class="vh-header">
      <span class="mi mi-sm">history</span>
      <span>버전 히스토리 — ${escapeHtml(memo.title || '제목 없음')}</span>
      <button class="vh-close" onclick="this.closest('.modal-overlay').remove()" aria-label="닫기">
        <span class="mi mi-sm">close</span>
      </button>
    </div>
    <div class="vh-body">
      ${versions.length === 0
        ? '<div class="vh-empty">아직 저장된 버전이 없어요. 5분 이상 텀을 두고 편집하면 자동 기록됩니다.</div>'
        : `<div class="vh-list">${versions.map((v, i) => `
            <div class="vh-item ${i === 0 ? 'active' : ''}" data-vk="${v.key}">
              <div class="vh-item-time">${_vhRelTime(v.ts)} ${i === 0 ? '<span class="vh-current">현재</span>' : ''}</div>
              <div class="vh-item-title">${escapeHtml(v.title || '제목 없음')}</div>
              <div class="vh-item-sub">${v.content.length}자</div>
            </div>`).join('')}</div>
          <div class="vh-preview" id="vh-preview"></div>`}
    </div>
    <div class="vh-actions">
      <button class="app-dialog-btn cancel" onclick="this.closest('.modal-overlay').remove()">닫기</button>
      ${versions.length > 0 ? '<button class="app-dialog-btn primary" id="vh-restore-btn">선택한 버전으로 복원</button>' : ''}
    </div>`;
  overlay.appendChild(body);
  document.body.appendChild(overlay);
  if (versions.length === 0) return;

  let selectedVk = versions[0].key;
  const setPreview = (key) => {
    const v = versions.find(x => x.key === key);
    if (!v) return;
    selectedVk = key;
    document.querySelectorAll('.vh-item').forEach(el => el.classList.toggle('selected', el.dataset.vk === key));
    document.getElementById('vh-preview').innerHTML = `
      <div class="vh-preview-title">${escapeHtml(v.title || '제목 없음')}</div>
      <div class="vh-preview-meta">${_vhFullTime(v.ts)} · ${v.content.length}자 · 태그 ${(v.tags || []).length}개</div>
      <div class="vh-preview-body markdown-body">${md2html(v.content || '')}</div>`;
  };
  setPreview(versions[0].key);
  overlay.querySelectorAll('.vh-item').forEach(el => {
    el.addEventListener('click', () => setPreview(el.dataset.vk));
  });
  const restoreBtn = overlay.querySelector('#vh-restore-btn');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', async () => {
      const v = versions.find(x => x.key === selectedVk);
      if (!v) return;
      const ok = await confirmDialog(`이 버전으로 복원하시겠어요?\n(현재 버전은 히스토리에 백업됩니다)`, { okText: '복원' });
      if (!ok) return;
      // Back up the current version before restoring
      await mhPushVersion(memo, { force: true });
      memo.title = v.title;
      memo.content = v.content;
      memo.tags = v.tags || [];
      memo.updatedAt = new Date().toISOString();
      saveMemos();
      renderMemoEditor();
      renderMemoList();
      overlay.remove();
      toast('버전 복원됨', 'success');
    });
  }
}

function _vhRelTime(ts) {
  const d = new Date(ts);
  return (typeof relativeTime === 'function') ? relativeTime(d.toISOString()) : d.toLocaleString();
}
function _vhFullTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// Snapshot the previous memo when switching to another one
const _origSelectNote = typeof selectNote === 'function' ? selectNote : null;
if (_origSelectNote) {
  window.selectNote = function(type, id) {
    if (activeMemoId && activeMemoId !== id) {
      const prev = memos.find(m => m.id === activeMemoId);
      if (prev) mhPushVersion(prev); // throttled
    }
    return _origSelectNote(type, id);
  };
}
const _origDeleteMemo = typeof deleteMemo === 'function' ? deleteMemo : null;
if (_origDeleteMemo) {
  window.deleteMemo = async function(id) {
    const res = await _origDeleteMemo(id);
    // History is dropped only if the delete went through (cancelling the confirm keeps it)
    if (res) mhDeleteAllForMemo(id).catch(() => {});
    return res;
  };
}

// Wikilinks + backlinks
// Open the memo with this title, or create it
function openMemoByTitle(title) {
  if (!title) return;
  const t = String(title).trim();
  let m = memos.find(x => (x.title || '').trim() === t);
  if (!m) {
    const now = new Date().toISOString();
    m = { id: newMemoId(), title: t, content: '', date: now, updatedAt: now, tags: [] };
    memos.unshift(m);
    saveMemos();
    toast(`새 메모 "${t}" 생성됨`, 'success');
  }
  if (typeof navigateTo === 'function' && currentPage !== 'memo') {
    navigateTo('memo', { updateHash: false });
  }
  selectNote('memo', m.id);
}

// Memos whose body links here with [[title]]
function findBacklinks(memo) {
  if (!memo || !memo.title) return [];
  const t = memo.title.trim();
  if (!t) return [];
  // Case-insensitive, includes the [[title|label]] form
  const re = new RegExp('\\[\\[\\s*' + _escapeRegex(t) + '(?:\\|[^\\]\\n]+)?\\s*\\]\\]', 'i');
  return memos.filter(other => other.id !== memo.id && re.test(other.content || ''));
}

function findMindmapNodesLinkingTo(memoId) {
  if (typeof mindmaps === 'undefined') return [];
  const out = [];
  for (const mm of mindmaps) {
    for (const n of (mm.nodes || [])) {
      if (n.noteId === memoId) out.push({ mindmapId: mm.id, mindmapName: mm.name, nodeId: n.id, nodeText: n.text });
    }
  }
  return out;
}

// Unlink a mindmap node from the backlinks panel
function unlinkMindmapNodeFromHere(mmId, nodeId) {
  if (typeof mindmaps === 'undefined') return;
  const mm = mindmaps.find(x => x.id === mmId);
  if (!mm) return;
  const node = (mm.nodes || []).find(n => n.id === nodeId);
  if (!node) return;
  delete node.noteId;
  node.updatedAt = new Date().toISOString();  // node-level mtime for merge
  mm.updatedAt = new Date().toISOString();
  save('mindmaps', mindmaps);
  // Redraw right away if the canvas is open
  if (typeof activeMindmapId !== 'undefined' && activeMindmapId === mmId && typeof drawMindMap === 'function') {
    if (typeof bindActiveMap === 'function') bindActiveMap();
    drawMindMap();
    if (typeof updateNodeActionBar === 'function') updateNodeActionBar();
  }
  renderMemoEditor();
  toast('연결 해제됨', 'success');
}

// Backlinks panel under the editor. Empty string when there are none
function _renderBacklinkPanel(memo) {
  if (!memo) return '';
  const links = findBacklinks(memo);
  const mmLinks = findMindmapNodesLinkingTo(memo.id);
  if (links.length === 0 && mmLinks.length === 0) return '';
  const items = links.map(l => {
    const re = new RegExp('\\[\\[\\s*' + _escapeRegex(memo.title.trim()) + '(?:\\|[^\\]\\n]+)?\\s*\\]\\]', 'i');
    const idx = (l.content || '').search(re);
    let snip = '';
    if (idx >= 0) {
      const start = Math.max(0, idx - 30);
      const end = Math.min((l.content || '').length, idx + 60);
      snip = ((start > 0 ? '… ' : '') + l.content.slice(start, end).replace(/\n+/g, ' ') + (end < l.content.length ? ' …' : ''));
    }
    return `<div class="backlink-item" onclick="selectNote('memo', ${l.id})">
      <div class="backlink-title">${escapeHtml(l.title) || '제목 없음'}</div>
      ${snip ? `<div class="backlink-snippet">${escapeHtml(snip)}</div>` : ''}
    </div>`;
  }).join('');
  // Linked mindmap nodes (with an unlink button)
  const mmItems = mmLinks.map(x => `<div class="backlink-item backlink-item-mm" onclick="selectNote('mindmap', ${x.mindmapId})">
    <div class="backlink-item-main">
      <div class="backlink-title"><span class="mi mi-sm" style="vertical-align:-3px;">account_tree</span> ${escapeHtml(x.mindmapName)}</div>
      <div class="backlink-snippet">노드 "${escapeHtml(x.nodeText)}"</div>
    </div>
    <button class="backlink-unlink" onclick="event.stopPropagation();unlinkMindmapNodeFromHere(${x.mindmapId}, ${x.nodeId})" title="연결 해제" aria-label="연결 해제">
      <span class="mi mi-sm">link_off</span>
    </button>
  </div>`).join('');
  return `<div class="backlink-panel">
    ${links.length > 0 ? `<div class="backlink-header">
      <span class="mi mi-sm">north_east</span>
      <span>이 메모를 참조하는 노트 ${links.length}개</span>
    </div>
    <div class="backlink-list">${items}</div>` : ''}
    ${mmLinks.length > 0 ? `<div class="backlink-header" style="${links.length > 0 ? 'margin-top:14px;' : ''}">
      <span class="mi mi-sm">account_tree</span>
      <span>이 메모와 연결된 마인드맵 노드 ${mmLinks.length}개</span>
    </div>
    <div class="backlink-list">${mmItems}</div>` : ''}
  </div>`;
}

// Command palette (⌘K): notes, tags, actions
let _cmdActiveIdx = 0;
let _cmdResults = [];

function openCmdPalette() {
  const o = document.getElementById('cmd-palette-overlay');
  if (!o) return;
  o.classList.add('show');
  const inp = document.getElementById('cmd-palette-input');
  inp.value = '';
  _cmdActiveIdx = 0;
  renderCmdPaletteResults('');
  setTimeout(() => inp.focus(), 30);
}
function closeCmdPalette() {
  const o = document.getElementById('cmd-palette-overlay');
  if (o) o.classList.remove('show');
}
function _cmdActions() {
  return [
    { key: 'new-memo',     label: '새 메모',        icon: 'edit_note',    fn: () => { closeCmdPalette(); createMemo(); } },
    { key: 'new-mindmap',  label: '새 마인드맵',    icon: 'account_tree', fn: () => { closeCmdPalette(); createMindmap(); } },
    { key: 'go-calendar',  label: '캘린더로 이동',  icon: 'calendar_month', fn: () => { closeCmdPalette(); navigateTo('calendar'); } },
    { key: 'sync-now',     label: '지금 동기화',    icon: 'sync',         fn: () => { closeCmdPalette(); if (typeof openSyncModal === 'function') openSyncModal(); } },
    { key: 'theme',        label: '테마 선택',      icon: 'palette',      fn: () => { closeCmdPalette(); if (typeof openThemePicker === 'function') openThemePicker(); } },
    { key: 'ruled',        label: '메모 밑줄 켜기/끄기', icon: 'horizontal_rule', fn: () => { closeCmdPalette(); if (typeof toggleRuledLines === 'function') toggleRuledLines(); } },
    { key: 'cleanup-conflicts', label: '충돌 사본 정리', icon: 'cleaning_services', fn: () => { closeCmdPalette(); if (typeof cleanupSyncConflicts === 'function') cleanupSyncConflicts(); } },
  ];
}
function renderCmdPaletteResults(q) {
  const cont = document.getElementById('cmd-palette-results');
  if (!cont) return;
  const ql = (q || '').toLowerCase().trim();
  const tokens = parseSearchQuery(q);
  const notes = getAllNotes()
    .filter(n => !tokens.length || evalSearchQuery(n, tokens))
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 15);
  const allTags = new Set();
  for (const n of memos) for (const t of (n.tags || [])) allTags.add(t);
  const tags = [...allTags]
    .filter(t => !ql || t.toLowerCase().includes(ql.replace(/^#/, '')) || ('#' + t).toLowerCase().includes(ql))
    .slice(0, 8);
  const acts = _cmdActions().filter(a => !ql || a.label.toLowerCase().includes(ql));

  _cmdResults = [];
  let html = '';
  if (notes.length) {
    html += `<div class="cmd-palette-section">노트 (${notes.length})</div>`;
    for (const n of notes) {
      _cmdResults.push({ kind: 'note', noteType: n.type, id: n.id });
      const titleHl = highlightSearchMatch(escapeHtml(n.title || '제목 없음'), tokens);
      const subText = n.type === 'mindmap'
        ? `마인드맵 · 노드 ${n.nodeCount}개`
        : (previewSnippetWithMatch(n.content || '', tokens) || '내용 없음');
      const subHl = highlightSearchMatch(escapeHtml(subText), tokens);
      const icon = n.type === 'mindmap' ? 'account_tree' : 'edit_note';
      html += `<div class="cmd-palette-item" data-cmd-idx="${_cmdResults.length - 1}">
        <span class="mi mi-sm">${icon}</span>
        <div class="cmd-palette-item-main">
          <div class="cmd-palette-item-title">${titleHl}</div>
          <div class="cmd-palette-item-sub">${subHl}</div>
        </div>
      </div>`;
    }
  }
  if (tags.length) {
    html += `<div class="cmd-palette-section">태그 (${tags.length})</div>`;
    for (const t of tags) {
      _cmdResults.push({ kind: 'tag', tag: t });
      html += `<div class="cmd-palette-item" data-cmd-idx="${_cmdResults.length - 1}">
        <span class="mi mi-sm">label</span>
        <div class="cmd-palette-item-main">
          <div class="cmd-palette-item-title">#${escapeHtml(t)}</div>
          <div class="cmd-palette-item-sub">이 태그로 필터링</div>
        </div>
      </div>`;
    }
  }
  if (acts.length) {
    html += `<div class="cmd-palette-section">액션 (${acts.length})</div>`;
    for (const a of acts) {
      _cmdResults.push({ kind: 'action', action: a });
      html += `<div class="cmd-palette-item" data-cmd-idx="${_cmdResults.length - 1}">
        <span class="mi mi-sm">${a.icon}</span>
        <div class="cmd-palette-item-main">
          <div class="cmd-palette-item-title">${escapeHtml(a.label)}</div>
        </div>
      </div>`;
    }
  }
  if (!_cmdResults.length) html = '<div class="cmd-palette-empty">검색 결과 없음</div>';
  cont.innerHTML = html;
  _cmdActiveIdx = 0;
  _highlightCmdActive();
  cont.querySelectorAll('.cmd-palette-item').forEach((el) => {
    el.addEventListener('click', () => {
      _cmdActiveIdx = parseInt(el.dataset.cmdIdx);
      _runActiveCmd();
    });
  });
}
function _highlightCmdActive() {
  const cont = document.getElementById('cmd-palette-results');
  if (!cont) return;
  cont.querySelectorAll('.cmd-palette-item').forEach((el, i) => {
    el.classList.toggle('active', i === _cmdActiveIdx);
  });
  const active = cont.querySelector('.cmd-palette-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}
function _runActiveCmd() {
  const r = _cmdResults[_cmdActiveIdx];
  if (!r) return;
  if (r.kind === 'note') {
    closeCmdPalette();
    if (currentPage !== 'memo' && typeof navigateTo === 'function') navigateTo('memo', { updateHash: false });
    selectNote(r.noteType, r.id);
  } else if (r.kind === 'tag') {
    closeCmdPalette();
    if (currentPage !== 'memo' && typeof navigateTo === 'function') navigateTo('memo', { updateHash: false });
    setTagFilter(r.tag);
  } else if (r.kind === 'action') {
    r.action.fn();
  }
}
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('cmd-palette-input');
  if (!inp) return;
  inp.addEventListener('input', (e) => renderCmdPaletteResults(e.target.value));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); _cmdActiveIdx = Math.min(_cmdResults.length - 1, _cmdActiveIdx + 1); _highlightCmdActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _cmdActiveIdx = Math.max(0, _cmdActiveIdx - 1); _highlightCmdActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); _runActiveCmd(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeCmdPalette(); }
  });
});

// Called from the CM6 checkbox widget. pos is where '[' starts
window._cmToggleCheckbox = function(pos, checked) {
  if (!window._cm6View) return;
  const view = window._cm6View;
  const newText = checked ? '[x]' : '[ ]';
  // Without keeping the selection, the cursor follows the replaced range and jumps to the next line
  const sel = view.state.selection;
  view.dispatch({
    changes: { from: pos, to: pos + 3, insert: newText },
    selection: sel
  });
  // updateListener takes care of saving
};

// Open raw URLs in the editor in a new tab on click.
// Only when the click lands inside the URL; the capture phase keeps CM6 from moving the cursor.
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
document.addEventListener('click', (e) => {
  // Links that already have their own handler
  if (e.target.closest('.markdown-body a, .wikilink, .cm-link-w, .cm-wikilink-w')) return;
  const liveEl = e.target.closest('#memo-live-editor');
  if (!liveEl) return;
  const view = window._cm6View;
  if (!view) return;
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
  if (pos == null) return;
  const line = view.state.doc.lineAt(pos);
  const lineText = line.text;
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(lineText))) {
    const startPos = line.from + m.index;
    const endPos = startPos + m[0].length;
    if (pos >= startPos && pos < endPos) {
      e.preventDefault();
      e.stopPropagation();
      window.open(m[0], '_blank', 'noopener,noreferrer');
      return;
    }
  }
}, true);  // before CM6 moves the cursor


