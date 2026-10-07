// 홈 화면
// 1. 이어서 하기: `프로젝트/*` 태그 노트를 프로젝트별 카드 1장으로
// 2. 최근 메모: 프로젝트 태그 없는 노트 최신 6개 (프로젝트 기록에 묻히지 않게 분리)
// 3. 묶음: 최상위 태그별 개수, 누르면 해당 태그로 필터
// 데이터는 getAllNotes()(memo.js)를 그대로 씀. 홈 전용 저장소 없음.

const PROJECT_TAG_PREFIX = '프로젝트/';

// '프로젝트/블로그' -> '블로그', 없으면 null
function noteProject(note) {
  for (const t of (note.tags || [])) {
    if (t.startsWith(PROJECT_TAG_PREFIX)) {
      const name = t.slice(PROJECT_TAG_PREFIX.length).split('/')[0];
      if (name) return name;
    }
  }
  return null;
}

// 상대 날짜 표기 (목록의 dateStr과 맞춤)
function homeRelDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}`;
}

// 본문 첫 줄 미리보기. 프로젝트 기록은 첫 줄이 요약이라
// 헤더/이미지/빈 줄만 건너뛰면 요약이 잡힌다.
function homeSnippet(note, max = 60) {
  const src = note.content || '';
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;        // 마크다운 헤더
    if (line.startsWith('![')) continue;       // 이미지
    if (line.startsWith('---')) continue;      // 구분선
    if (line.startsWith('<!--')) continue;     // HTML 주석
    const clean = line.replace(/^[-*+]\s*(\[[ x]\]\s*)?/, '').replace(/[*_`>]/g, '');
    if (clean) return clean.length > max ? clean.slice(0, max) + '…' : clean;
  }
  return note.type === 'mindmap' ? '마인드맵' : '내용 없음';
}

function renderHome() {
  const root = document.getElementById('home-body');
  if (!root || typeof getAllNotes !== 'function') return;
  const notes = getAllNotes();

  // 1. 이어서 하기: 프로젝트별 카드 1장, 최근 작업 순
  const byProject = new Map();
  for (const n of notes) {
    const proj = noteProject(n);
    if (!proj) continue;
    if (!byProject.has(proj)) byProject.set(proj, []);
    byProject.get(proj).push(n);
  }
  const projects = [...byProject.entries()].map(([name, list]) => {
    list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    const latest = list[0];
    const stats = projectStats(list);
    return { name, latest, list, stats, t: new Date(latest.updatedAt || 0).getTime() };
  }).sort((a, b) => b.t - a.t);

  // 가로 스크롤 + 고정폭 카드라 프로젝트 수와 상관없이 높이 일정
  const projectHtml = projects.length
    ? `<div class="home-proj-scroll">` + projects.map(p => {
        const s = p.stats;
        // 체크박스가 없으면 진행률 대신 노트 수
        const bar = s.todoTotal > 0 ? `
          <div class="home-progress">
            <span class="home-progress-label">할 일 ${s.todoDone}/${s.todoTotal}</span>
            <div class="home-progress-track"><div class="home-progress-fill" style="width:${s.pct}%"></div></div>
            <span class="home-progress-pct">${s.pct}%</span>
          </div>` : `
          <div class="home-progress">
            <span class="home-progress-label">노트 ${p.list.length}개</span>
            <div class="home-progress-track"></div>
          </div>`;
        const tile = (icon, label, n) =>
          `<div class="home-tile${n ? '' : ' is-zero'}"><span class="mi mi-sm">${icon}</span><b>${n}</b><span class="home-tile-label">${label}</span></div>`;
        return `
        <div class="home-card home-card-proj" onclick="openProject('${escapeHtml(p.name).replace(/'/g, "\\'")}', '${p.latest.type}', ${p.latest.id})">
          <div class="home-card-head">
            <div class="home-card-title">${escapeHtml(p.name)}</div>
            <span class="home-card-all">${p.list.length}건</span>
            <div class="home-card-time">${homeRelDate(p.latest.updatedAt)}</div>
          </div>
          <div class="home-card-sub">${escapeHtml(homeSnippet(p.latest, 80))}</div>
          ${bar}
          <div class="home-tiles">
            ${tile('edit_note', '메모', s.memo)}
            ${tile('account_tree', '마인드맵', s.mindmap)}
            ${tile('check_box', '할 일', s.todoTotal)}
            ${tile('image', '이미지', s.image)}
          </div>
        </div>`;
      }).join('') + `</div>`
    : `<div class="home-card home-empty">
         아직 프로젝트 기록이 없어요.<br>
         메모에 <code>프로젝트/이름</code> 태그를 붙이면 여기 모입니다.
       </div>`;

  // 오늘의 할 일: 프로젝트 노트의 미완료 체크박스(`- [ ]`) 최대 6개.
  // 별도 저장소 없이 노트 본문에서 뽑는다.
  const todos = [];
  for (const p of projects) {
    for (const n of p.list) {
      for (const m of (n.content || '').matchAll(/^[-*+]\s*\[ \]\s*(.+)$/gm)) {
        todos.push({ proj: p.name, text: m[1].trim(), note: n });
        if (todos.length >= 6) break;
      }
      if (todos.length >= 6) break;
    }
    if (todos.length >= 6) break;
  }
  const todoHtml = todos.length
    ? `<div class="home-card">${todos.map(t => `
        <div class="home-todo" onclick="openNote('${t.note.type}', ${t.note.id})">
          <span class="home-todo-box"></span>
          <span class="home-todo-text">${escapeHtml(t.text)}</span>
          <span class="home-todo-tag">${escapeHtml(t.proj)}</span>
        </div>`).join('')}</div>`
    : '';

  // 2. 최근 메모 (프로젝트 제외)
  const general = notes
    .filter(n => !noteProject(n))
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 6);

  const generalHtml = general.length
    ? `<div class="home-card">${general.map(n => `
        <div class="home-row" onclick="openNote('${n.type}', ${n.id})">
          <span class="mi mi-sm home-row-icon">${n.type === 'mindmap' ? 'account_tree' : 'edit_note'}</span>
          <div class="home-row-body">
            <div class="home-row-title">${escapeHtml(n.title) || '제목 없음'}</div>
            <div class="home-row-sub">${escapeHtml(homeSnippet(n))}</div>
          </div>
          <span class="home-row-date">${homeRelDate(n.updatedAt)}</span>
        </div>`).join('')}</div>`
    : `<div class="home-card home-empty">메모가 없어요.</div>`;

  // 3. 묶음: '프로젝트/블로그'는 '프로젝트'로 세기
  const groups = new Map();
  for (const n of notes) {
    for (const t of (n.tags || [])) {
      const top = t.split('/')[0];
      if (!top) continue;
      groups.set(top, (groups.get(top) || 0) + 1);
    }
  }
  const groupHtml = [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `
      <button class="home-group-chip" onclick="goToTag('${escapeHtml(name).replace(/'/g, "\\'")}')">
        ${escapeHtml(name)}<span>${count}</span>
      </button>`).join('');

  root.innerHTML = `
    <section class="home-sec">
      <div class="home-sec-head"><span>이어서 하기</span></div>
      ${projectHtml}
    </section>
    ${todoHtml ? `
    <section class="home-sec">
      <div class="home-sec-head"><span>오늘의 할 일</span></div>
      ${todoHtml}
    </section>` : ''}
    <section class="home-sec">
      <div class="home-sec-head">
        <span>최근 메모</span>
        <button class="home-sec-more" onclick="goToTag(null)">전체 보기</button>
      </div>
      ${generalHtml}
    </section>
    ${groupHtml ? `
    <section class="home-sec">
      <div class="home-sec-head"><span>묶음</span></div>
      <div class="home-groups">${groupHtml}</div>
    </section>` : ''}`;
}

// 카드 수치. 저장값 없이 노트 내용에서 매번 계산
function projectStats(list) {
  let memo = 0, mindmap = 0, image = 0, todoTotal = 0, todoDone = 0;
  for (const n of list) {
    if (n.type === 'mindmap') mindmap++; else memo++;
    const c = n.content || '';
    image += (c.match(/!\[[^\]]*\]\(/g) || []).length;
    const open = (c.match(/^[-*+]\s*\[ \]/gm) || []).length;
    const done = (c.match(/^[-*+]\s*\[x\]/gmi) || []).length;
    todoTotal += open + done;
    todoDone += done;
  }
  const pct = todoTotal ? Math.round((todoDone / todoTotal) * 100) : 0;
  return { memo, mindmap, image, todoTotal, todoDone, pct };
}

// '[블로그] 댓글 기능' -> '댓글 기능' (홈에선 칩이 프로젝트를 이미 보여줌)
function stripProjectPrefix(title) {
  return (title || '').replace(/^\s*\[[^\]]+\]\s*/, '') || (title || '');
}

// selectNote()는 페이지 전환을 안 하므로 홈에서는 navigateTo를 먼저 불러야 함
function openNote(type, id) {
  if (typeof navigateTo === 'function') navigateTo(type === 'mindmap' ? 'mindmap' : 'memo');
  if (typeof selectNote === 'function') selectNote(type, id);
}

// 프로젝트 카드: 목록을 해당 프로젝트로 필터하고 최신 노트를 연다.
// 필터는 목록 상단 칩(renderMemoList)에서 해제 가능.
function openProject(name, latestType, latestId) {
  if (typeof setTagFilter === 'function') setTagFilter(PROJECT_TAG_PREFIX + name);
  // setTagFilter는 항상 'memo'로 보내므로 마인드맵이면 다시 전환
  if (latestType === 'mindmap' && typeof navigateTo === 'function') navigateTo('mindmap');
  if (typeof selectNote === 'function') selectNote(latestType, latestId);
}

// setTagFilter가 내부에서 navigateTo('memo')를 부름
function goToTag(tag) {
  if (typeof setTagFilter === 'function') setTagFilter(tag);
  else if (typeof navigateTo === 'function') navigateTo('memo');
}
