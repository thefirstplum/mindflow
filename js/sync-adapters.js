// Item adapters: per-type serialize/parse, Drive folder, conflict detection.
// SyncEngine stays type-agnostic and delegates to these.
//
// Adapter contract:
//   type            string id (also the snapshot key)
//   isSingleton     true for journal/prefix/app (one file, no per-id collection)
//   folderId(ctx)   Drive folder for its files
//   getLocalItems() local data (collections)
//   getLocalValue() local value (singletons)
//   getId(item), getMtime(item)
//   serialize(item) -> { name, content, mime, appProperties }
//   parse(file, content) -> item
//   recoverId(file, parsedItem) -> id (fallback chain for collections)
//   filterFiles(files) -> files this adapter owns
//   merge(local, remote) -> winner
//   detectConflict(snap, remote, local) -> 'noop' | 'push-only' | 'pull-only' | 'conflict'
//   createConflictCopy(remote) -> copy with name suffix and new id (collections only)

const _CONFLICT_TAG = 'conflict';

// Shared helpers
const _mtime = m => new Date((m && (m.updatedAt || m.date)) || 0).getTime();
function _conflictSuffix() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `(충돌 ${mm}-${dd} ${hh}:${mi})`;
}

// 3-way conflict check. snap = mtime of what we last pushed.
function detectConflictByMtime(snapMtime, remoteMtime, localMtime) {
  const remoteChanged = !!remoteMtime && remoteMtime !== snapMtime;
  const localChanged = !!localMtime && localMtime !== snapMtime;
  if (!remoteChanged && !localChanged) return 'noop';
  if (!remoteChanged && localChanged) return 'push-only';
  if (remoteChanged && !localChanged) return 'pull-only';
  return 'conflict';
}

// Memo
const MemoAdapter = {
  type: 'memo',
  isSingleton: false,

  folderId(ctx) { return ctx.memosFolderId || ctx.rootFolderId; },

  getLocalItems() { return (typeof memos !== 'undefined') ? memos : []; },

  getId(item) { return item.id; },
  getMtime(item) { return item.updatedAt || item.date || ''; },

  filterFiles(files) {
    return files.filter(f => f.name && f.name.toLowerCase().endsWith('.md'));
  },

  serialize(memo) {
    const updated = memo.updatedAt || memo.date || new Date().toISOString();
    const title = (memo.title || '').replace(/\n/g, ' ');
    const tagsLine = memo.tags && memo.tags.length ? `\ntags: [${memo.tags.map(t => JSON.stringify(t)).join(', ')}]` : '';
    const content = `---\nid: ${memo.id}\ntitle: ${title}\ndate: ${memo.date}\nupdated: ${updated}${tagsLine}\n---\n\n${memo.content || ''}`;
    // Filename dedup happens in the engine (it sees all sibling memos)
    return { name: null, content, mime: 'text/markdown', appProperties: { memoId: String(memo.id) } };
  },

  parse(file, content) {
    if (typeof parseFrontmatter !== 'function') return null;
    const memo = parseFrontmatter(content, file.name, Date.now());
    return memo;
  },

  // Id fallback: frontmatter id, then appProperties.memoId, then "{id}-..." filename
  recoverId(file, parsedMemo) {
    if (parsedMemo && parsedMemo.id) return parsedMemo.id;
    const propId = file.appProperties?.memoId ? parseInt(file.appProperties.memoId) : null;
    if (propId && !isNaN(propId)) return propId;
    const m = (file.name || '').match(/^(\d+)-/);
    return m ? parseInt(m[1]) : null;
  },

  merge(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    return _mtime(local) > _mtime(remote) ? local : remote;
  },

  detectConflict(snap, remote, local) {
    return detectConflictByMtime(
      snap?.mtime || '',
      remote ? this.getMtime(remote) : '',
      local ? this.getMtime(local) : ''
    );
  },

  // Conflict copy of remote, so local stays canonical and both are visible.
  createConflictCopy(remote, ctx) {
    const newId = (ctx.nextMemoId && ctx.nextMemoId()) || (Date.now());
    const suffix = _conflictSuffix();
    const baseTitle = (remote.title || '').replace(/\s*\(충돌 [\d-]+ [\d:]+\)\s*$/, '');
    const tags = Array.from(new Set([...(remote.tags || []), _CONFLICT_TAG]));
    return {
      ...remote,
      id: newId,
      title: `${baseTitle} ${suffix}`.trim(),
      tags,
      updatedAt: new Date().toISOString(),
      date: remote.date || new Date().toISOString(),
    };
  },
};

// Mindmap
const MindmapAdapter = {
  type: 'mindmap',
  isSingleton: false,

  folderId(ctx) { return ctx.mindmapsFolderId || ctx.rootFolderId; },

  getLocalItems() { return (typeof mindmaps !== 'undefined') ? mindmaps : []; },

  getId(item) { return item.id; },
  getMtime(item) { return item.updatedAt || ''; },

  filterFiles(files) {
    return files.filter(f => {
      const n = (f.name || '').toLowerCase();
      return n.startsWith('mindmap-') && n.endsWith('.json');
    });
  },

  serialize(mm) {
    const fname = `mindmap-${mm.id}.json`;
    const content = JSON.stringify(mm, null, 2);
    return { name: fname, content, mime: 'application/json', appProperties: null };
  },

  parse(file, content) {
    try { return JSON.parse(content); } catch { return null; }
  },

  recoverId(file, parsed) {
    if (parsed && parsed.id) return parsed.id;
    const m = (file.name || '').match(/^mindmap-(\d+)\.json$/i);
    return m ? parseInt(m[1]) : null;
  },

  merge(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    return _mtime(local) > _mtime(remote) ? local : remote;
  },

  detectConflict(snap, remote, local) {
    return detectConflictByMtime(
      snap?.mtime || '',
      remote ? this.getMtime(remote) : '',
      local ? this.getMtime(local) : ''
    );
  },

  createConflictCopy(remote, ctx) {
    const newId = Date.now() + Math.floor(Math.random() * 1000);
    const suffix = _conflictSuffix();
    return {
      ...remote,
      id: newId,
      name: `${remote.name || '마인드맵'} ${suffix}`,
      updatedAt: new Date().toISOString(),
    };
  },
};

// Timeblock (one file per day)
const TimeblockAdapter = {
  type: 'timeblock',
  isSingleton: false,

  folderId(ctx) { return ctx.timeblocksFolderId || ctx.rootFolderId; },

  // Local items: { dayKey, blocks, updatedAt } per day
  getLocalItems() {
    const blocks = (typeof load === 'function') ? load('tb_blocks', {}) : {};
    const meta = (typeof load === 'function') ? load('tb_meta', {}) : {};
    return Object.keys(blocks).map(day => ({
      id: day,
      dayKey: day,
      blocks: blocks[day],
      updatedAt: meta[day] || ''
    }));
  },

  getId(item) { return item.dayKey || item.id; },
  getMtime(item) { return item.updatedAt || ''; },

  filterFiles(files) {
    return files.filter(f => {
      const n = (f.name || '').toLowerCase();
      return n.startsWith('timeblock-') && n.endsWith('.json');
    });
  },

  serialize(item) {
    const fname = `timeblock-${item.dayKey}.json`;
    const payload = JSON.stringify({
      blocks: item.blocks,
      updatedAt: item.updatedAt || new Date().toISOString()
    }, null, 2);
    return { name: fname, content: payload, mime: 'application/json', appProperties: null };
  },

  parse(file, content) {
    const m = (file.name || '').match(/^timeblock-(.+)\.json$/i);
    if (!m) return null;
    try {
      const data = JSON.parse(content);
      return { id: m[1], dayKey: m[1], blocks: data.blocks || [], updatedAt: data.updatedAt || '' };
    } catch { return null; }
  },

  recoverId(file, parsed) {
    if (parsed && parsed.dayKey) return parsed.dayKey;
    const m = (file.name || '').match(/^timeblock-(.+)\.json$/i);
    return m ? m[1] : null;
  },

  // LWW per day
  merge(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    return _mtime(local) > _mtime(remote) ? local : remote;
  },

  detectConflict(snap, remote, local) {
    return detectConflictByMtime(
      snap?.mtime || '',
      remote ? this.getMtime(remote) : '',
      local ? this.getMtime(local) : ''
    );
  },

  createConflictCopy(remote) {
    // Conflict copy goes to a separate dayKey: "{day}__conflict__YYYYMMDD-HHMM"
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
    const newKey = `${remote.dayKey}__conflict__${stamp}`;
    return { id: newKey, dayKey: newKey, blocks: remote.blocks, updatedAt: new Date().toISOString() };
  },
};

// Journal (single file, per-entry mtime)
const JournalAdapter = {
  type: 'journal',
  isSingleton: true,

  folderId(ctx) { return ctx.rootFolderId; },

  getFilename() { return 'journal.json'; },

  // Singleton value is the whole object; mtime is the newest entry updatedAt.
  getLocalValue() {
    return (typeof load === 'function') ? load('journal_entries', {}) : {};
  },

  getMtimeFromValue(entries) {
    return Object.values(entries || {}).reduce((acc, e) => {
      const u = (e && e.updatedAt) || '';
      return u > acc ? u : acc;
    }, '');
  },

  filterFiles(files) {
    return files.filter(f => f.name === 'journal.json');
  },

  serialize(entries) {
    const content = JSON.stringify({ entries, exportedAt: new Date().toISOString() }, null, 2);
    return { name: 'journal.json', content, mime: 'application/json', appProperties: null };
  },

  parse(file, content) {
    try { return JSON.parse(content)?.entries || {}; } catch { return null; }
  },

  // Per-entry merge by updatedAt
  merge(local, remote) {
    const out = { ...(remote || {}) };
    Object.entries(local || {}).forEach(([k, e]) => {
      const r = out[k];
      if (!r || _mtime(e) >= _mtime(r)) out[k] = e;
    });
    return out;
  },

  detectConflict(snap, remoteValue, localValue) {
    const remoteMtime = this.getMtimeFromValue(remoteValue);
    const localMtime = this.getMtimeFromValue(localValue);
    return detectConflictByMtime(snap?.mtime || '', remoteMtime, localMtime);
  },

  // No conflict copy for journal: the per-entry merge already keeps both sides.
  createConflictCopy() { return null; },
};

// Prefix colors (small singleton)
const PrefixAdapter = {
  type: 'prefix',
  isSingleton: true,

  folderId(ctx) { return ctx.rootFolderId; },
  getFilename() { return 'tb-prefix-colors.json'; },

  getLocalValue() {
    return (typeof load === 'function') ? load('tb_prefix_colors', {}) : {};
  },

  // No timestamps here, so the JSON string doubles as a hash
  getMtimeFromValue(value) { return JSON.stringify(value); },

  filterFiles(files) { return files.filter(f => f.name === 'tb-prefix-colors.json'); },

  serialize(value) {
    return { name: 'tb-prefix-colors.json', content: JSON.stringify(value), mime: 'application/json', appProperties: null };
  },

  parse(file, content) {
    try { return JSON.parse(content); } catch { return null; }
  },

  // Union merge, local wins on the same key
  merge(local, remote) {
    return { ...(remote || {}), ...(local || {}) };
  },

  detectConflict(snap, remoteValue, localValue) {
    const remoteHash = this.getMtimeFromValue(remoteValue);
    const localHash = this.getMtimeFromValue(localValue);
    return detectConflictByMtime(snap?.hash || '', remoteHash, localHash);
  },

  createConflictCopy() { return null; },
};

// App meta (singleton)
const AppMetaAdapter = {
  type: 'app',
  isSingleton: true,

  folderId(ctx) { return ctx.rootFolderId; },
  getFilename() { return '_mindflow-app.json'; },

  getLocalValue() {
    return {
      activeMindmapId: (typeof load === 'function') ? load('mm_active', null) : null,
      settings: (typeof load === 'function') ? load('settings', {}) : {}
    };
  },

  getMtimeFromValue(value) { return JSON.stringify(value); },

  filterFiles(files) { return files.filter(f => f.name === '_mindflow-app.json'); },

  serialize(value) {
    const data = { version: 3, app: 'mindflow', exportedAt: new Date().toISOString(), ...value };
    return { name: '_mindflow-app.json', content: JSON.stringify(data, null, 2), mime: 'application/json', appProperties: null };
  },

  parse(file, content) {
    try {
      const parsed = JSON.parse(content);
      if (parsed?.app !== 'mindflow') return null;
      return { activeMindmapId: parsed.activeMindmapId ?? null, settings: parsed.settings || {} };
    } catch { return null; }
  },

  // Remote wins (low stakes)
  merge(local, remote) { return remote || local; },

  detectConflict(snap, remoteValue, localValue) {
    const remoteHash = this.getMtimeFromValue(remoteValue);
    const localHash = this.getMtimeFromValue(localValue);
    return detectConflictByMtime(snap?.hash || '', remoteHash, localHash);
  },

  createConflictCopy() { return null; },
};

window.SyncAdapters = {
  Memo: MemoAdapter,
  Mindmap: MindmapAdapter,
  Timeblock: TimeblockAdapter,
  Journal: JournalAdapter,
  Prefix: PrefixAdapter,
  AppMeta: AppMetaAdapter,
  // Helpers used by the engine
  detectConflictByMtime,
  conflictSuffix: _conflictSuffix,
  CONFLICT_TAG: _CONFLICT_TAG,
};
