// Image URLs
// Rewrite Drive thumbnail URLs to the lh3.googleusercontent CDN form (edge-cached,
// much faster). Only works for public files; driveMakePublic runs after upload.
function optimizeImageUrl(url) {
  if (!url) return url;
  // drive.google.com/thumbnail?id=ID&sz=... -> lh3.googleusercontent.com/d/ID=w2560
  // 2560 because uploads are already resized to at most 2560px.
  let m = url.match(/^https?:\/\/(?:www\.)?drive\.google\.com\/thumbnail\?(?:.*&)?id=([^&]+)/);
  if (m) {
    return `https://lh3.googleusercontent.com/d/${m[1]}=w2560`;
  }
  // drive.google.com/uc?export=view&id=ID
  m = url.match(/^https?:\/\/(?:www\.)?drive\.google\.com\/uc\?(?:.*&)?id=([^&]+)/);
  if (m) {
    return `https://lh3.googleusercontent.com/d/${m[1]}=w2560`;
  }
  return url;
}

// Markdown
// ![[Title]] embed: find the memo by title and render its body recursively (up to depth 2)
function _renderEmbed(title, depth) {
  if (depth >= 2) {
    return `<div class="embed-block embed-block-skip">↻ 임베드 깊이 제한 (${title})</div>`;
  }
  if (typeof memos === 'undefined') {
    return `<div class="embed-block embed-block-miss">↻ [[${title}]]</div>`;
  }
  const m = memos.find(x => (x.title || '').trim() === title);
  if (!m) {
    return `<div class="embed-block embed-block-miss">↻ <a href="#" class="wikilink" onclick="event.preventDefault();openMemoByTitle('${title.replace(/'/g, "\\'")}')">${title}</a> (없음 — 클릭해 만들기)</div>`;
  }
  window._mdEmbedDepth = (window._mdEmbedDepth || 0) + 1;
  let inner;
  try { inner = md2html(m.content || '*(빈 메모)*'); }
  finally { window._mdEmbedDepth = Math.max(0, (window._mdEmbedDepth || 0) - 1); }
  return `<div class="embed-block">
    <div class="embed-block-head" onclick="openMemoByTitle('${title.replace(/'/g, "\\'")}')">
      <span class="mi mi-sm">north_east</span>
      <span>${title}</span>
    </div>
    <div class="embed-block-body">${inner}</div>
  </div>`;
}

function md2html(md) {
  if (!md) return '';
  let s = md;
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Code blocks ```
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `\n<pre><code>${code.replace(/\n$/, '')}</code></pre>\n`);

  // Headers
  s = s.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  s = s.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rule
  s = s.replace(/^---+$/gm, '<hr>');

  // Blockquote
  s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  s = s.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

  // Task lists: '- [ ]' and '- []'
  s = s.replace(/^[-*+] \[\s?\] (.+)$/gm, '<li class="task"><input type="checkbox" disabled> $1</li>');
  s = s.replace(/^[-*+] \[x\] (.+)$/gmi, '<li class="task done"><input type="checkbox" checked disabled> <del>$1</del></li>');

  // Unordered list
  s = s.replace(/^[-*+] (.+)$/gm, '<li>$1</li>');
  // Ordered list
  s = s.replace(/^\d+\. (.+)$/gm, '<li class="ord">$1</li>');

  // Wrap consecutive <li>
  s = s.replace(/(<li(?:\s+class="(?:task(?:\s+done)?|ord)")?>[\s\S]*?<\/li>(?:\n|$))+/g, m => {
    if (m.includes('class="ord"')) return '<ol>' + m.replace(/ class="ord"/g, '') + '</ol>';
    return '<ul>' + m + '</ul>';
  });

  // Bold (use sentinels to avoid conflict with italic)
  s = s.replace(/\*\*([^\*\n]+)\*\*/g, 'B$1b');
  s = s.replace(/__([^_\n]+)__/g, 'B$1b');

  // Italic
  s = s.replace(/\*([^\*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, '$1<em>$2</em>');

  // Convert bold sentinels
  s = s.replace(/B/g, '<strong>').replace(/b/g, '</strong>');

  // Strikethrough
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // Highlight (Obsidian-style ==text==)
  s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Block embed ![[Title]]. Must run before wikilinks, otherwise the [[...]]
  // inside ![[...]] matches first.
  s = s.replace(/!\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_m, target) => {
    return _renderEmbed(target.trim(), (window._mdEmbedDepth || 0));
  });

  // Wikilinks [[Title]] / [[Title|Display]], resolved on click.
  // Before markdown links so [[x]] isn't parsed as [x](y).
  s = s.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_m, target, display) => {
    const safeTarget = (target || '').trim().replace(/"/g, '&quot;');
    const safeDisp = ((display || target) || '').trim();
    return `<a href="#" class="wikilink" data-wikilink="${safeTarget}" onclick="event.preventDefault();openMemoByTitle('${safeTarget.replace(/'/g, "\\'")}')">${safeDisp}</a>`;
  });

  // Links and images (Drive URLs rewritten to the CDN form)
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
    const optimized = optimizeImageUrl(url);
    return `<img src="${optimized}" alt="${alt}" loading="lazy" decoding="async">`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Paragraphs (split by blank lines)
  s = s.split(/\n\n+/).map(block => {
    block = block.trim();
    if (!block) return '';
    if (/^<(h\d|ul|ol|pre|blockquote|hr|table|img)/.test(block)) return block;
    return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');

  return s;
}

// Theme
// 'light' (default) has no data-theme attribute; the rest use body[data-theme="xxx"]
const THEMES_META = [
  { section: '코어' },
  { key: 'light',      label: 'Solarized Light', dots: ['#FDF6E3', '#B85E94', '#D2832E'] },
  { key: 'dark',       label: 'Solarized Dark',  dots: ['#1B2027', '#E093BD', '#F0B264'] },
  { key: 'charcoal',   label: 'Charcoal',        dots: ['#1B1E22', '#B89866', '#8FA68E'] },
  { section: '라이트' },
  { key: 'sepia',      label: 'Sepia',           dots: ['#F2E7CD', '#A66B23', '#B0512E'] },
  { key: 'sakura',     label: 'Sakura',          dots: ['#FCEFF3', '#D86A8A', '#C7869E'] },
  { key: 'toothpaste', label: 'Toothpaste',      dots: ['#EAF4F1', '#2E96A0', '#E29C8E'] },
  { key: 'leather',    label: 'Leather',         dots: ['#F4E9D0', '#A35817', '#C99244'] },
  { key: 'botanical',  label: 'Botanical',       dots: ['#F2EFE0', '#6B8C5A', '#B8A06B'] },
  { key: 'diary',      label: 'Diary',           dots: ['#F8E8D8', '#C76E55', '#7B9A8A'] },
  { key: 'book',       label: '책 (Book)',         dots: ['#F4ECD8', '#7C5C3A', '#A8784C'] },
  { key: 'handwritten',label: '손글씨 (꾸꾸꾹)',     dots: ['#FDF8EE', '#B36B5A', '#D89A6B'] },
  { section: '다크' },
  { key: 'midnight',   label: 'Midnight',        dots: ['#0E0E10', '#5B8DEF', '#A78BFA'] },
  { key: 'dracula',    label: 'Dracula',         dots: ['#282A36', '#FF79C6', '#BD93F9'] },
  { key: 'gotham',     label: 'Gotham',          dots: ['#0A1019', '#4A8FD4', '#95C8E8'] },
  { key: 'forest',     label: 'Forest',          dots: ['#1A2620', '#79B36F', '#C9A85C'] },
  { key: 'ocean',      label: 'Ocean',           dots: ['#0E1E2F', '#4FB3D9', '#E08B6E'] },
  { key: 'sunset',     label: 'Sunset',          dots: ['#2A1A28', '#E85E8A', '#F5BC4A'] },
];
const THEMES = THEMES_META.filter(t => t.key).map(t => t.key);
const THEME_LABELS = Object.fromEntries(THEMES_META.filter(t => t.key).map(t => [t.key, t.label]));
const THEME_META_COLOR = Object.fromEntries(THEMES_META.filter(t => t.key).map(t => [t.key, t.dots[0]]));

// Map old theme names to current ones
function migrateThemeName(t) {
  if (t == null || t === 'paper' || t === 'solarized' || t === 'duotone-snow' || t === 'ayu') return 'light';
  if (t === 'solarized-dark') return 'dark';
  if (t === 'cobalt') return 'ocean';
  if (t === 'panic') return 'sunset';
  if (t === 'duotone-light') return 'sakura';
  if (t === 'dieci') return 'charcoal';
  if (t === 'leather') return 'charcoal';  // old leather was a dark charcoal
  return THEMES.includes(t) ? t : 'light';
}

let currentTheme = (function () {
  try { return migrateThemeName(JSON.parse(localStorage.getItem('mindflow_theme'))); }
  catch { return 'light'; }
})();

function applyTheme(theme) {
  theme = migrateThemeName(theme);
  if (theme === 'light') document.body.removeAttribute('data-theme');
  else document.body.setAttribute('data-theme', theme);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_META_COLOR[theme] || '#FDF6E3';

  currentTheme = theme;
  try { localStorage.setItem('mindflow_theme', JSON.stringify(theme)); } catch {}

  document.querySelectorAll('.theme-dd-item').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === theme);
  });
}

function toggleTheme() { openThemePicker(); }

function openThemePicker() {
  const dd = document.getElementById('theme-dd');
  if (!dd) return;
  // Build the menu once, on first open
  const menu = document.getElementById('theme-dd-menu');
  if (menu && !menu.children.length) {
    for (const t of THEMES_META) {
      if (t.section) {
        const h = document.createElement('div');
        h.className = 'theme-dd-section';
        h.textContent = t.section;
        menu.appendChild(h);
        continue;
      }
      const btn = document.createElement('button');
      btn.className = 'theme-dd-item' + (t.key === currentTheme ? ' active' : '');
      btn.dataset.theme = t.key;
      btn.innerHTML = `<span class="theme-dd-dots">
        <span class="theme-dd-dot" style="background:${t.dots[0]}"></span>
        <span class="theme-dd-dot" style="background:${t.dots[1]}"></span>
        <span class="theme-dd-dot" style="background:${t.dots[2]}"></span>
      </span><span>${t.label}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyTheme(t.key);
        if (typeof drawMindMap === 'function') drawMindMap();
        if (typeof toast === 'function') toast(t.label);
        closeThemePicker();
      });
      menu.appendChild(btn);
    }
  }
  dd.classList.toggle('open');
}

function closeThemePicker() {
  document.getElementById('theme-dd')?.classList.remove('open');
}

// Close on outside click
if (typeof window !== 'undefined' && !window._themeDdInited) {
  window._themeDdInited = true;
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('theme-dd');
    if (dd && !dd.contains(e.target)) dd.classList.remove('open');
  });
}

applyTheme(currentTheme);

// Toast
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.remove('show'); }, 2500);
}

// Storage
// load/save are synchronous, so the in-memory cache (_kvCache) is the source of truth.
// IDB (mindflow-kv) is the persistent store; localStorage seeds the cache at boot and
// keeps a backup mirror (allowed to fail).
// Boot: seed the cache from LS synchronously, overwrite with IDB values, copy LS-only keys to IDB.
// save: update the cache, IDB write-behind (80ms debounce), LS mirror, schedule a Drive sync.

const _kvCache = new Map();
let _kvDb = null;
let _kvReadyResolve;
const kvReady = new Promise(r => { _kvReadyResolve = r; });

// Synchronous because it must finish before other modules' IIFEs call load()
(function _seedFromLocalStorage() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('mindflow_')) continue;
      const raw = localStorage.getItem(k);
      if (raw == null) continue;
      try { _kvCache.set(k.slice('mindflow_'.length), JSON.parse(raw)); }
      catch { _kvCache.set(k.slice('mindflow_'.length), raw); }
    }
  } catch (e) { console.warn('[kv] LS seed failed:', e); }
})();

function _kvOpen() {
  if (_kvDb) return Promise.resolve(_kvDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mindflow-kv', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => { _kvDb = req.result; resolve(_kvDb); };
    req.onerror = () => reject(req.error);
  });
}

// Merge IDB values into the cache and migrate LS keys (in the background)
(async function _kvBoot() {
  try {
    const db = await _kvOpen();
    // IDB is newer than LS, so it wins
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const store = tx.objectStore('kv');
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        _kvCache.set(cursor.key, cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    // Copy LS keys into IDB (idempotent)
    const toMigrate = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('mindflow_')) continue;
        const subKey = k.slice('mindflow_'.length);
        if (!_kvCache.has(subKey)) continue; // missing from the seed: treat as corrupt and skip
        toMigrate.push(subKey);
      }
    } catch {}
    if (toMigrate.length) {
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      for (const k of toMigrate) store.put(_kvCache.get(k), k);
    }
  } catch (e) {
    console.warn('[kv] IDB boot failed — localStorage mode 유지:', e);
  } finally {
    _kvReadyResolve();
  }
})();

// Write-behind queue that batches consecutive saves into one transaction
const _kvPendingWrites = new Map();
let _kvFlushTimer = null;
function _kvFlush() {
  if (!_kvDb || _kvPendingWrites.size === 0) return;
  const pending = new Map(_kvPendingWrites);
  _kvPendingWrites.clear();
  try {
    const tx = _kvDb.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    for (const [k, v] of pending) {
      if (v === undefined) store.delete(k);
      else store.put(v, k);
    }
  } catch (e) { console.warn('[kv] flush failed:', e); }
}

function save(key, data) {
  _kvCache.set(key, data);
  _kvPendingWrites.set(key, data);
  clearTimeout(_kvFlushTimer);
  _kvFlushTimer = setTimeout(_kvFlush, 80);
  // The LS mirror may fail; IDB has the data, so just warn
  try {
    localStorage.setItem('mindflow_' + key, JSON.stringify(data));
  } catch (e) {
    console.warn('[save] LS mirror failed (IDB OK):', key);
  }
  scheduleDriveSave();
  _maybeCheckQuota();
}

function load(key, def) {
  if (_kvCache.has(key)) return _kvCache.get(key);
  // On a cache miss, try LS once more
  try {
    const v = localStorage.getItem('mindflow_' + key);
    if (v != null) {
      try { return JSON.parse(v); } catch { return v; }
    }
  } catch {}
  return def;
}

// For callers that need the IDB write to finish
async function saveAsync(key, data) {
  save(key, data);
  // Wait past the 80ms flush
  await new Promise(r => setTimeout(r, 100));
}
async function loadAsync(key, def) {
  await kvReady;
  return load(key, def);
}

function kvDelete(key) {
  _kvCache.delete(key);
  _kvPendingWrites.set(key, undefined);
  clearTimeout(_kvFlushTimer);
  _kvFlushTimer = setTimeout(_kvFlush, 80);
  try { localStorage.removeItem('mindflow_' + key); } catch {}
}

// Mobile may never fire beforeunload, so listen to pagehide too
window.addEventListener('pagehide', _kvFlush);
window.addEventListener('beforeunload', _kvFlush);

// A lot of code calls localStorage.setItem/removeItem directly, so Storage.prototype is
// patched to mirror mindflow_ keys into the cache and IDB as well.
(function _patchStorageForKv() {
  const origSet = Storage.prototype.setItem;
  const origRm = Storage.prototype.removeItem;
  Storage.prototype.setItem = function(key, value) {
    if (this === localStorage && typeof key === 'string' && key.startsWith('mindflow_')) {
      const subKey = key.slice('mindflow_'.length);
      let parsed = value;
      try { parsed = JSON.parse(value); } catch {}
      _kvCache.set(subKey, parsed);
      _kvPendingWrites.set(subKey, parsed);
      clearTimeout(_kvFlushTimer);
      _kvFlushTimer = setTimeout(_kvFlush, 80);
    }
    return origSet.call(this, key, value);
  };
  Storage.prototype.removeItem = function(key) {
    if (this === localStorage && typeof key === 'string' && key.startsWith('mindflow_')) {
      const subKey = key.slice('mindflow_'.length);
      _kvCache.delete(subKey);
      _kvPendingWrites.set(subKey, undefined);
      clearTimeout(_kvFlushTimer);
      _kvFlushTimer = setTimeout(_kvFlush, 80);
    }
    return origRm.call(this, key);
  };
})();

// Storage quota
// The IDB quota is about 60% of the disk, so only warn above 95%
let _quotaLastCheckAt = 0;
let _quotaLastWarnAt = 0;
async function _maybeCheckQuota() {
  // At most once per 60s
  const now = Date.now();
  if (now - _quotaLastCheckAt < 60_000) return;
  _quotaLastCheckAt = now;
  if (!navigator.storage?.estimate) return;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (!usage || !quota) return;
    const pct = usage / quota;
    if (pct > 0.95 && now - _quotaLastWarnAt > 60 * 60_000) {
      _quotaLastWarnAt = now;
      const mb = (n) => (n / 1024 / 1024).toFixed(1);
      toast(`⚠️ 저장공간 ${Math.round(pct * 100)}% (${mb(usage)}MB / ${mb(quota)}MB) — 정리 권장`, 'error');
    }
  } catch {}
}
// iOS Safari may evict data after 7 idle days without persistent storage
async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return null;
  try {
    const already = await navigator.storage.persisted?.();
    if (already) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}
// For diagnostics in the sync modal
async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}

// In-app dialogs
// In an iOS standalone PWA, native confirm()/prompt() show a domain header and handle
// IME and shortcuts poorly, so in-app modals replace them.
function confirmDialog(message, opts) {
  opts = opts || {};
  const okText = opts.okText || '확인';
  const cancelText = opts.cancelText || '취소';
  const danger = !!opts.danger;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show app-dialog-overlay';
    overlay.innerHTML = `<div class="modal app-dialog">
      <div class="app-dialog-body"></div>
      <div class="app-dialog-actions">
        <button class="app-dialog-btn cancel" type="button"></button>
        <button class="app-dialog-btn ${danger ? 'danger' : 'primary'}" type="button"></button>
      </div>
    </div>`;
    overlay.querySelector('.app-dialog-body').textContent = message;
    overlay.querySelector('.app-dialog-btn.cancel').textContent = cancelText;
    overlay.querySelector('.app-dialog-btn.primary,.app-dialog-btn.danger').textContent = okText;
    document.body.appendChild(overlay);
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    function close(v) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(v);
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    overlay.querySelector('.app-dialog-btn.cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.app-dialog-btn.primary,.app-dialog-btn.danger').addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKey);
  });
}

function promptDialog(label, defaultValue, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show app-dialog-overlay';
    overlay.innerHTML = `<div class="modal app-dialog">
      <div class="app-dialog-label"></div>
      <input type="text" class="app-dialog-input">
      <div class="app-dialog-actions">
        <button class="app-dialog-btn cancel" type="button">취소</button>
        <button class="app-dialog-btn primary" type="button">${opts.okText || '확인'}</button>
      </div>
    </div>`;
    overlay.querySelector('.app-dialog-label').textContent = label;
    const input = overlay.querySelector('.app-dialog-input');
    input.value = defaultValue || '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    document.body.appendChild(overlay);
    // Delay so iOS actually opens the keyboard
    setTimeout(() => { input.focus(); input.select(); }, 30);
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter') close(input.value);
    };
    function close(v) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(v);
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector('.app-dialog-btn.cancel').addEventListener('click', () => close(null));
    overlay.querySelector('.app-dialog-btn.primary').addEventListener('click', () => close(input.value));
    input.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey);
  });
}

// Haptics (Vibration API: Android only, no-op on iOS Safari)
// kind: 'light' (selection), 'medium' (action confirm), 'heavy' (warning/delete)
function haptic(kind) {
  if (!navigator.vibrate) return;
  const patterns = { light: 8, medium: 15, heavy: [10, 30, 10] };
  try { navigator.vibrate(patterns[kind] || patterns.light); } catch {}
}

// IndexedDB (folder handle store)
const IDB_NAME = 'mindflow-fs';
const IDB_STORE = 'handles';
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}


// Date helpers
// Local-timezone YYYY-MM-DD. Don't slice(0,10) an ISO string: it's UTC, so a
// Korean morning entry lands on the previous day.
function localDateKey(d) {
  const date = (d instanceof Date) ? d : new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function localMonthKey(d) {
  const date = (d instanceof Date) ? d : new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}
function localTimeHHMM(d) {
  const date = (d instanceof Date) ? d : new Date(d);
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}

// App settings (leftover ledger* keys are ignored)
let appSettings = load('settings', {});

function applySettings() {
  // Ruled lines are on by default; .no-ruled only when explicitly false
  document.body.classList.toggle('no-ruled', appSettings.ruledLines === false);
  const ruledToggle = document.getElementById('setting-ruled-lines');
  if (ruledToggle) ruledToggle.checked = appSettings.ruledLines !== false;
}

// Called from the ⌘K action and the settings toggle
function toggleRuledLines() {
  appSettings.ruledLines = appSettings.ruledLines === false;
  save('settings', appSettings);
  applySettings();
  if (typeof toast === 'function') {
    toast(appSettings.ruledLines === false ? '메모 밑줄 끔' : '메모 밑줄 켬', 'success');
  }
}

function saveSettings() {
  save('settings', appSettings);
  applySettings();
}

function setSetting(key, value) {
  appSettings = { ...appSettings, [key]: value };
  saveSettings();
}

function openSettingsModal() {
  applySettings();
  document.getElementById('settings-modal')?.classList.add('show');
}
function closeSettingsModal() {
  document.getElementById('settings-modal')?.classList.remove('show');
}
