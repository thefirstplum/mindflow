// 캘린더 (타임블록 + 감정일기)
// 타임블록은 기존 모달(openTbModal/editTbBlock/saveTbBlock)을 재활용한다.
// 감정일기는 `#일기` 태그가 붙은 일반 메모로 저장한다. 아래 감정일기 섹션 참고.

let calViewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calSelectedKey = dateKey(new Date());
let calWeekStart = _calStartOfWeek(new Date());  // 현재 주 일요일

// 타임블록 색상별 이벤트 카드 컬러 클래스
const TB_COLOR_HEX = {
  yellow:'#b58900', orange:'#cb4b16', red:'#dc322f', rose:'#e11d48',
  magenta:'#d33682', purple:'#7c3aed', violet:'#6c71c4', sky:'#0284c7',
  blue:'#268bd2', cyan:'#2aa198', teal:'#0d9488', green:'#859900',
  brown:'#92400e', slate:'#475569'
};
const tbHex = c => TB_COLOR_HEX[c] || TB_COLOR_HEX.yellow;
const TB_COLOR_CLASS = {
  yellow:'c-yellow', orange:'c-apricot', red:'c-coral', rose:'c-coral',
  magenta:'c-magenta', purple:'c-lavender', violet:'c-lavender', sky:'c-blue',
  blue:'c-blue', cyan:'c-blue', teal:'c-green', green:'c-green',
  brown:'c-apricot', slate:'c-lavender'
};
const tbColorClass = c => TB_COLOR_CLASS[c] || 'c-yellow';

// 주 시작일(일요일)
function _calStartOfWeek(d) {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay());
  r.setHours(0, 0, 0, 0);
  return r;
}
function _calAddDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

// 'HH:MM' -> 분 (06:00 = 360)
function _timeToMin(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function renderCalendar() {
  _noteDayCache = null;   // 렌더 시작 시 한 번만 다시 만든다
  _renderMiniCal();
  _renderWeekGrid();
  _renderSummary();
  _renderMobileCal();
}

// 날짜별 노트 흔적
// 일정이 없는 날에도 그날 남긴 메모를 보여주기 위한 인덱스.
// 기준은 수정일(updatedAt). 오래된 메모를 오늘 고치면 오늘로 잡힌다.
let _noteDayCache = null;
function _notesByDay() {
  // renderCalendar가 하위 렌더 4개를 연달아 부르므로 그 사이엔 재사용한다.
  if (_noteDayCache) return _noteDayCache;
  const map = new Map();
  if (typeof getAllNotes === 'function') {
    for (const n of getAllNotes()) {
      const iso = n.updatedAt || n.createdAt;
      if (!iso) continue;
      const d = new Date(iso);
      if (isNaN(d)) continue;
      const k = dateKey(d);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(n);
    }
  }
  _noteDayCache = map;
  return map;
}
function _notesOnDay(key) { return _notesByDay().get(key) || []; }

// 그날 남긴 노트 목록. 데스크톱 사이드 패널과 모바일 1일 뷰가 같이 쓴다.
function _dayNotesCard(key) {
  const list = _notesOnDay(key);
  if (!list.length) return '';
  const rows = list.slice()
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .map(n => {
      const t = new Date(n.updatedAt || n.createdAt);
      const hh = isNaN(t) ? '' : `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`;
      // 일기는 아이콘과 감정으로 다른 메모와 구분한다
      const diary = _isDiaryNote(n);
      const mood = diary ? _noteMood(n) : '';
      const icon = diary ? 'menu_book' : (n.type === 'mindmap' ? 'account_tree' : 'edit_note');
      return `<div class="day-note-row${diary ? ' is-diary' : ''}" onclick="openNote('${n.type}', ${n.id})">
        <span class="mi mi-sm day-note-icon">${icon}</span>
        <span class="day-note-title">${_escapeHtml(n.title) || '제목 없음'}</span>
        ${mood ? `<span class="day-note-mood">${mood}</span>` : ''}
        <span class="day-note-time">${hh}</span>
      </div>`;
    }).join('');
  return `<div class="day-notes-card">
    <div class="day-notes-head">이날 남긴 흔적 ${list.length}</div>
    ${rows}
  </div>`;
}

// 미니 월간
function _renderMiniCal() {
  const grid = document.getElementById('mini-cal-grid');
  if (!grid) return;
  const title = document.getElementById('mini-cal-title');
  if (title) title.textContent = `${calViewMonth.getFullYear()}년 ${calViewMonth.getMonth()+1}월`;

  const year = calViewMonth.getFullYear();
  const month = calViewMonth.getMonth();
  const startDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const todayKey = dateKey(new Date());

  const weekStartKey = dateKey(calWeekStart);
  const weekEndKey = dateKey(_calAddDays(calWeekStart, 6));
  const inWeek = k => k >= weekStartKey && k <= weekEndKey;

  let html = '';
  // 이전 달
  for (let i = startDow - 1; i >= 0; i--) {
    html += `<div class="mini-cal-cell other">${prevMonthDays - i}</div>`;
  }
  // 이번 달
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const key = dateKey(date);
    const hasTb = (timeBlocks[key] || []).length > 0;
    const hasGCal = _gcalHasEventsOnDay(date);
    const dayNotes = _notesOnDay(key);
    const hasNote = dayNotes.length > 0;
    // 일기는 수정된 날에 뜬다. 다른 메모 흔적과 같은 규칙이고 표식만 따로 준다.
    const diary = dayNotes.find(_isDiaryNote);
    const has = hasTb || hasGCal;
    const cls = [
      'mini-cal-cell',
      key === todayKey ? 'today' : '',
      inWeek(key) ? 'in-week' : '',
      date.getDay() === 0 && inWeek(key) ? 'week-start' : '',
      date.getDay() === 6 && inWeek(key) ? 'week-end' : '',
      has ? 'has-event' : '',
      // 일정 점과 구분되는 메모 표식
      hasNote ? 'has-note' : '',
      diary ? 'has-diary' : '',
    ].filter(Boolean).join(' ');
    // 감정이 있으면 이모지, 없으면 일기 표식만 (CSS ::after 점)
    const mood = diary ? _noteMood(diary) : '';
    const moodTag = mood ? `<span class="mini-cal-mood">${mood}</span>` : '';
    html += `<div class="${cls}" onclick="calSelectDayMini('${key}')">${d}${moodTag}</div>`;
  }
  // 다음 달
  const total = startDow + daysInMonth;
  const trail = (7 - (total % 7)) % 7;
  for (let i = 1; i <= trail; i++) {
    html += `<div class="mini-cal-cell other">${i}</div>`;
  }
  grid.innerHTML = html;
}

// 미니월간 셀 클릭 시 그 주를 메인 뷰로
function calSelectDayMini(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  calSelectedKey = key;
  calWeekStart = _calStartOfWeek(date);
  renderCalendar();
}

// 메인 주간 그리드
function _renderWeekGrid() {
  const grid = document.getElementById('week-grid');
  if (!grid) return;
  const range = document.getElementById('week-range');
  const end = _calAddDays(calWeekStart, 6);
  if (range) {
    const fmt = d => `${(d.getMonth()+1).toString().padStart(2,'0')}월 ${d.getDate().toString().padStart(2,'0')}일`;
    range.textContent = `${fmt(calWeekStart)} — ${end.getDate().toString().padStart(2,'0')}일`;
  }

  const todayKey = dateKey(new Date());
  const dows = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

  // 헤더
  let header = '<div class="wdh-cell wdh-time-spacer"></div>';
  for (let i = 0; i < 7; i++) {
    const d = _calAddDays(calWeekStart, i);
    const k = dateKey(d);
    const cls = [
      'wdh-cell',
      k === todayKey ? 'today' : '',
      i === 0 ? 'sun' : '',
      i === 6 ? 'sat' : '',
    ].filter(Boolean).join(' ');
    header += `<div class="${cls}">
      <div class="wdh-day-num">${d.getDate().toString().padStart(2,'0')}</div>
      <div class="wdh-day-name">${dows[i]}</div>
    </div>`;
  }

  // 시간 컬럼 (06:00 - 22:00, 17 슬롯, 60px/h)
  const START_H = 6, END_H = 22;
  let timeCol = '<div class="time-col">';
  for (let h = START_H; h <= END_H; h++) {
    timeCol += `<div class="time-slot">${h.toString().padStart(2,'0')}:00</div>`;
  }
  timeCol += '</div>';

  // 7개 day 컬럼
  let dayCols = '';
  for (let i = 0; i < 7; i++) {
    const date = _calAddDays(calWeekStart, i);
    const k = dateKey(date);
    const isToday = k === todayKey;
    const cls = [
      'day-col',
      isToday ? 'today' : '',
      (i === 0 || i === 6) ? 'weekend' : '',
    ].filter(Boolean).join(' ');
    let inner = '';
    for (let h = START_H; h <= END_H; h++) inner += '<div class="hour-line"></div>';

    // 캘린더 모드: 'all'(둘 다) | 'mine'(timeBlock만) | 'google'(gcal만)
    // 영역을 나누지 않고 한 컬럼에 합쳐서 아이콘으로 구분한다
    const calMode = (typeof window.gcal !== 'undefined') ? window.gcal.mode : 'all';
    const showMine = (calMode === 'all' || calMode === 'mine');
    const showGoogle = (calMode === 'all' || calMode === 'google');

    // 타임블록 (event_note 아이콘)
    if (showMine) {
      const blocks = timeBlocks[k] || [];
      for (const b of blocks) {
        const startMin = _timeToMin(b.start);
        const endMin = _timeToMin(b.end);
        const top = (startMin - START_H * 60) + 4;  // padding 보정
        const height = Math.max(28, endMin - startMin - 4);
        if (top < 0 || top > (END_H - START_H + 1) * 60) continue;
        const colorClass = tbColorClass(b.color);
        inner += `<div class="event-card ${colorClass}" style="top:${top}px;height:${height}px;" onclick="event.stopPropagation();calEditBlockKey('${k}', ${blocks.indexOf(b)})">
          <div class="ev-title"><span class="mi mi-sm ev-icon ev-icon-mine">event_note</span>${_escapeHtml(b.title || '제목 없음')}</div>
          <div class="ev-time">${b.start} — ${b.end}</div>
        </div>`;
      }
    }

    // Google 일정 (event 아이콘)
    if (showGoogle && typeof window.gcal !== 'undefined') {
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
      const dayEnd   = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
      const evList = _gcalEventsInRange(dayStart, dayEnd);
      let alldayTop = 0;
      for (const ev of evList) {
        if (window.gcal.eventIsAllDay(ev)) {
          inner += `<div class="event-card gcal-allday" style="top:${alldayTop}px;height:20px;background:${window.gcal.eventColor(ev)}26;border-left:3px solid ${window.gcal.eventColor(ev)};" onclick="event.stopPropagation();openGCalEditor('${ev._calendarId}','${ev.id}')">
            <div class="ev-title"><span class="mi mi-sm ev-icon ev-icon-gcal">event</span>${_escapeHtml(ev.summary || '제목 없음')}</div>
          </div>`;
          alldayTop += 22;
          continue;
        }
        const evStart = window.gcal.eventStart(ev);
        const evEnd = window.gcal.eventEnd(ev);
        const startMin = evStart.getHours() * 60 + evStart.getMinutes();
        const endMin = evEnd.getHours() * 60 + evEnd.getMinutes();
        const top = (startMin - START_H * 60) + 4;
        const height = Math.max(28, endMin - startMin - 4);
        if (top < -30 || top > (END_H - START_H + 1) * 60) continue;
        const bg = window.gcal.eventColor(ev);
        const startLabel = `${String(evStart.getHours()).padStart(2,'0')}:${String(evStart.getMinutes()).padStart(2,'0')}`;
        const endLabel   = `${String(evEnd.getHours()).padStart(2,'0')}:${String(evEnd.getMinutes()).padStart(2,'0')}`;
        inner += `<div class="event-card gcal-event" style="top:${top}px;height:${height}px;background:${bg}26;border-left:3px solid ${bg};color:var(--text);" onclick="event.stopPropagation();openGCalEditor('${ev._calendarId}','${ev.id}')">
          <div class="ev-title"><span class="mi mi-sm ev-icon ev-icon-gcal">event</span>${_escapeHtml(ev.summary || '제목 없음')}</div>
          <div class="ev-time">${startLabel} — ${endLabel}</div>
        </div>`;
      }
    }

    // 현재 시각 marker (오늘만)
    if (isToday) {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if (nowMin >= START_H * 60 && nowMin <= END_H * 60) {
        const top = nowMin - START_H * 60;
        inner += `<div class="now-pill" style="top:${top}px;">${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}</div>`;
        inner += `<div class="now-line" style="top:${top}px;"></div>`;
      }
    }
    dayCols += `<div class="${cls}" data-day-key="${k}" data-start-h="${START_H}" onclick="calGridEmptyClick(event)">${inner}</div>`;
  }

  grid.innerHTML = `
    <div class="week-day-header">${header}</div>
    <div class="week-body">${timeCol}${dayCols}</div>
  `;
}

// 빈 시간 셀 클릭 시 그 위치의 시간으로 새 타임블록 / Google 일정 추가
function calGridEmptyClick(ev) {
  if (ev.target.closest('.event-card')) return; // 카드 자체 클릭은 무시
  if (ev.target.closest('.cal-quick-picker')) return; // popup 자체 클릭 무시
  const col = ev.currentTarget;
  const rect = col.getBoundingClientRect();
  const startH = parseInt(col.dataset.startH || '6', 10);
  const y = ev.clientY - rect.top;
  const min = Math.max(0, Math.round(y / 30) * 30);
  const totalMin = startH * 60 + min;
  const h = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  calSelectedKey = col.dataset.dayKey;
  _calSyncCurrentDate();

  const calMode = (typeof window.gcal !== 'undefined') ? window.gcal.mode : 'all';
  const gEnabled = (typeof window.gcal !== 'undefined') && window.gcal.enabled;

  // 'all' 모드 + Google 연동 시 popup으로 선택
  if (calMode === 'all' && gEnabled) {
    _openCalQuickPicker(ev.clientX, ev.clientY, h, mm, totalMin);
    return;
  }

  // 'google' 모드: 바로 Google 일정
  if (calMode === 'google' && gEnabled) {
    if (typeof openGCalNewEvent === 'function') openGCalNewEvent(calSelectedKey, h, mm);
    return;
  }

  // 'mine' 또는 Google 미연동: 바로 timeBlock
  _openTbModalAt(h, mm, totalMin);
}

// 'all' 모드용 빠른 선택 popup (클릭 위치에 카드 두 개)
function _openCalQuickPicker(clientX, clientY, h, mm, totalMin) {
  document.getElementById('cal-quick-picker')?.remove();
  const writeCal = (typeof window.gcal !== 'undefined') && window.gcal.writeId
    ? (window.gcal.calendars.find(c => c.id === window.gcal.writeId) || {}).summary
    : '';
  const pop = document.createElement('div');
  pop.id = 'cal-quick-picker';
  pop.className = 'cal-quick-picker';
  const timeLabel = `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  pop.innerHTML = `
    <div class="cqp-head">
      <span class="mi mi-sm">schedule</span>
      <span>${timeLabel} 부터 추가</span>
      <button class="cqp-close" onclick="_closeCalQuickPicker()" aria-label="닫기"><span class="mi mi-sm">close</span></button>
    </div>
    <button class="cqp-card cqp-mine" onclick="_calQuickPick('mine', ${h}, ${mm}, ${totalMin})">
      <span class="mi">event_note</span>
      <span class="cqp-text">
        <span class="cqp-title">타임블록</span>
        <span class="cqp-sub">투두·색상 지정 가능</span>
      </span>
    </button>
    <button class="cqp-card cqp-gcal" onclick="_calQuickPick('google', ${h}, ${mm}, ${totalMin})">
      <span class="mi">event</span>
      <span class="cqp-text">
        <span class="cqp-title">Google 일정</span>
        <span class="cqp-sub">${writeCal ? _escapeHtml(writeCal) : 'Google Calendar'}</span>
      </span>
    </button>
  `;
  document.body.appendChild(pop);
  // 클릭 좌표 근처에 띄우고, 화면 밖으로 넘으면 보정
  const rect = pop.getBoundingClientRect();
  let left = clientX + 10;
  let top = clientY - rect.height / 2;
  if (left + rect.width > window.innerWidth - 8) left = clientX - rect.width - 10;
  if (top < 10) top = 10;
  if (top + rect.height > window.innerHeight - 10) top = window.innerHeight - rect.height - 10;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  pop.classList.add('show');
  // 외부 클릭 시 닫기
  setTimeout(() => {
    document.addEventListener('click', _calQuickPickerOutsideClick, true);
  }, 0);
}
function _calQuickPickerOutsideClick(e) {
  const pop = document.getElementById('cal-quick-picker');
  if (!pop) { document.removeEventListener('click', _calQuickPickerOutsideClick, true); return; }
  if (!pop.contains(e.target)) _closeCalQuickPicker();
}
function _closeCalQuickPicker() {
  document.getElementById('cal-quick-picker')?.remove();
  document.removeEventListener('click', _calQuickPickerOutsideClick, true);
}
window._closeCalQuickPicker = _closeCalQuickPicker;
window._calQuickPick = function(type, h, mm, totalMin) {
  _closeCalQuickPicker();
  if (type === 'google') {
    if (typeof openGCalNewEvent === 'function') openGCalNewEvent(calSelectedKey, h, mm);
  } else {
    _openTbModalAt(h, mm, totalMin);
  }
};

function _openTbModalAt(h, mm, totalMin) {
  if (typeof openTbModal === 'function') openTbModal(h);
  setTimeout(() => {
    const s = document.getElementById('tb-start');
    const e = document.getElementById('tb-end');
    if (s) s.value = `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    if (e) {
      const endTotal = totalMin + 60;
      const eh = Math.min(23, Math.floor(endTotal / 60));
      const em = endTotal % 60;
      e.value = `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`;
    }
    document.getElementById('tb-title')?.focus();
  }, 30);
}

// 특정 날짜에 Google 일정이 있는지 (mini cal, slider 점 표시용)
function _gcalHasEventsOnDay(date) {
  if (typeof window.gcal === 'undefined' || !window.gcal.enabled) return false;
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const dayEnd   = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
  return _gcalEventsInRange(dayStart, dayEnd).length > 0;
}

// 한 날짜에 걸친 Google 이벤트만 필터
// 종일 이벤트의 end.date는 exclusive(다음 날)라서 Date로 비교하면 다음 날에도 표시된다.
// 그래서 종일은 dayKey 문자열로 따로 비교한다.
function _gcalEventsInRange(dayStart, dayEnd) {
  if (typeof window.gcal === 'undefined') return [];
  const events = window.gcal.events || {};
  const out = [];
  // dayStart에서 YYYY-MM-DD 추출 (로컬 타임존 기준)
  const _pad2 = n => String(n).padStart(2, '0');
  const dayKey = `${dayStart.getFullYear()}-${_pad2(dayStart.getMonth()+1)}-${_pad2(dayStart.getDate())}`;
  for (const key in events) {
    const ev = events[key];
    if (window.gcal.eventIsAllDay(ev)) {
      // 종일: start.date <= dayKey < end.date (end는 exclusive)
      const sk = ev.start.date;
      const ek = ev.end.date;
      if (sk && ek && sk <= dayKey && dayKey < ek) out.push(ev);
    } else {
      // 시간 이벤트: 일반 시간 겹침 검사
      const s = window.gcal.eventStart(ev);
      const e = window.gcal.eventEnd(ev);
      if (e >= dayStart && s <= dayEnd) out.push(ev);
    }
  }
  return out;
}

// 캘린더 모드 토글 핸들러
function setCalendarModeAndRefresh(mode) {
  if (typeof window.gcal === 'undefined') return;
  // 토글 활성 표시 (데스크탑, 모바일)
  document.querySelectorAll('.cal-mode-seg button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  window.gcal.setMode(mode);
  // 'google'/'all'인데 연동이 꺼져 있으면 켠다 (사용자가 직접 누른 것이므로)
  if ((mode === 'google' || mode === 'all') && !window.gcal.enabled) {
    window.gcal.setEnabled(true);
  }
  if ((mode === 'google' || mode === 'all') && window.gcal.enabled) {
    // 인증 없으면 자동 토큰 요청까지 시도
    if (typeof driveClient !== 'undefined' && !driveClient.hasValidToken()) {
      toast('Google 인증 중...', 'info');
      driveClient.ensureToken().then(() => {
        refreshGCalEventsForVisibleWeek();
      }).catch(() => {
        toast('Google 동기화 버튼을 한번 눌러 연결해주세요', 'error');
        renderCalendar();
      });
      return;
    }
    refreshGCalEventsForVisibleWeek();
  } else {
    renderCalendar();
  }
}

// 지금 화면에 필요한 기간. 월 단위(+앞뒤 1주)로 받아야 미니 월간 점이 정확하고
// 주 이동은 대부분 이미 받은 범위 안에서 끝난다.
function _gcalDesiredRange() {
  const m = (typeof calViewMonth !== 'undefined') ? calViewMonth : new Date();
  const mStart = new Date(m.getFullYear(), m.getMonth(), 1);
  const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
  // 미니 월간 그리드는 앞뒤 달 일부를 함께 그리므로 1주씩 여유
  let from = _calAddDays(mStart, -7);
  let to = _calAddDays(mEnd, 7);
  // 월은 그대로 두고 주만 넘긴 경우 주간 뷰가 범위 밖일 수 있다
  const wStart = new Date(calWeekStart);
  const wEnd = _calAddDays(calWeekStart, 7);
  if (wStart < from) from = _calAddDays(wStart, -7);
  if (wEnd > to) to = _calAddDays(wEnd, 7);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

// 이미 받아둔 기간. 이 안이면 다시 부르지 않는다.
let _gcalFetchedRange = null;
function invalidateGCalRange() { _gcalFetchedRange = null; }

// 화면에 필요한 기간의 Google 이벤트 fetch + 다시 렌더
async function refreshGCalEventsForVisibleWeek(opts) {
  if (typeof window.gcal === 'undefined' || !window.gcal.enabled) {
    renderCalendar();
    return;
  }
  const force = !!(opts && opts.force);
  const { from, to } = _gcalDesiredRange();
  // 이미 가진 범위 안이면 네트워크를 타지 않고 그리기만 한다
  if (!force && _gcalFetchedRange
      && from >= _gcalFetchedRange.from && to <= _gcalFetchedRange.to) {
    renderCalendar();
    return;
  }
  try {
    // 캘린더 목록/선택 ids가 없으면 먼저 fetch.
    // 모바일 첫 진입 시엔 localStorage가 데스크탑과 별도라 비어 있다.
    if (window.gcal.selectedIds.length === 0) {
      await window.gcal.fetchCalendarList();
    }
    await window.gcal.fetchEvents(from, to);
    _gcalFetchedRange = { from, to };
  } catch (e) {
    console.warn('[GCal] week fetch failed:', e);
    if (e.status === 401 || e.status === 403) {
      toast('Google 인증이 만료됐어요. 동기화 버튼을 눌러주세요', 'error');
    } else if (e.status === 404) {
      toast('Calendar API가 활성화 안 됐어요 (Cloud Console 확인)', 'error');
    } else {
      toast('Google 일정 가져오기 실패: ' + (e.message || ''), 'error');
    }
  }
  renderCalendar();
}
window.refreshGCalEventsForVisibleWeek = refreshGCalEventsForVisibleWeek;
window.setCalendarModeAndRefresh = setCalendarModeAndRefresh;

function _escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function calEditBlockKey(key, idx) {
  calSelectedKey = key;
  currentDate = new Date(key);
  editTbBlock(key, idx);
}

// 주 네비게이션 (Google 모드 또는 '전체' 모드면 새 주 이벤트 자동 fetch)
function _shouldFetchGCal() {
  return typeof window.gcal !== 'undefined' && window.gcal.enabled
    && (window.gcal.mode === 'google' || window.gcal.mode === 'all');
}
function calPrevWeek() {
  calWeekStart = _calAddDays(calWeekStart, -7);
  renderCalendar();
  if (_shouldFetchGCal()) refreshGCalEventsForVisibleWeek();
}
function calNextWeek() {
  calWeekStart = _calAddDays(calWeekStart, 7);
  renderCalendar();
  if (_shouldFetchGCal()) refreshGCalEventsForVisibleWeek();
}

// 요약 카드 + 선택일 감정일기
function _renderSummary() {
  const el = document.getElementById('cal-summary-card');
  if (!el) return;
  let totalBlocks = 0, totalMin = 0, doneCount = 0;
  for (let i = 0; i < 7; i++) {
    const k = dateKey(_calAddDays(calWeekStart, i));
    const blocks = timeBlocks[k] || [];
    totalBlocks += blocks.length;
    for (const b of blocks) {
      const d = _timeToMin(b.end) - _timeToMin(b.start);
      if (d > 0) totalMin += d;
      if (b.done) doneCount++;
    }
  }
  const hh = Math.floor(totalMin / 60), mm = totalMin % 60;
  el.innerHTML = `
    <div class="summary-row"><span class="lbl">이번 주 블록</span><span class="val">${totalBlocks}</span></div>
    <div class="summary-row"><span class="lbl">완료</span><span class="val accent">${doneCount} / ${totalBlocks}</span></div>
    <div class="summary-row"><span class="lbl">계획 시간</span><span class="val">${hh}h ${mm}m</span></div>
  `;
  // 선택일에 남긴 노트 (데스크톱 사이드 패널)
  const notesHost = document.getElementById('cal-day-notes');
  if (notesHost) notesHost.innerHTML = _dayNotesCard(calSelectedKey);

  _renderDayJournal();  // cal-side 하단 감정일기 패널
}

// 무드 버튼 한 줄 (데스크탑/모바일 공용).
// onmousedown preventDefault가 없으면 누르는 순간 textarea가 blur되고, calJournalBlur가
// 다시 그리면서 버튼이 사라져 click이 안 온다.
function _calMoodRowHtml() {
  const cur = _diaryMood(calSelectedKey);
  const moodList = (typeof MOODS !== 'undefined') ? MOODS
    : [{e:'😊',l:'좋음'},{e:'🙂',l:'괜찮음'},{e:'😐',l:'보통'},{e:'😟',l:'별로'},{e:'😢',l:'안좋음'}];
  return moodList.map(mo =>
    `<button class="cal-mood-btn${cur===mo.e?' active':''}" onmousedown="event.preventDefault()" onclick="calSetMood('${mo.e}')" title="${mo.l}">${mo.e}</button>`
  ).join('');
}

// 선택일 감정일기 패널 (데스크탑 cal-side)
function _renderDayJournal() {
  const host = document.getElementById('cal-day-journal');
  if (!host) return;
  const key = calSelectedKey;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m-1, d);
  const dows = ['일','월','화','수','목','금','토'];
  const journal = _diaryParse(_diaryMemo(key));
  const moodHtml = _calMoodRowHtml();
  // 입력 중이면 textarea를 다시 만들지 않는다. innerHTML을 교체하면 포커스/커서가 날아간다.
  // (동기화, gcal 응답, 자동저장이 모두 renderCalendar를 부름)
  if (_calJournalTyping()) {
    const row = host.querySelector('.cal-mood-row');
    if (row) row.innerHTML = moodHtml;   // 무드 버튼만 갱신
    return;
  }
  host.innerHTML = `
    <div class="cal-side-sec-title cal-side-sec-title-with-date">
      <span>📔 감정일기</span>
      <span class="cal-side-day">${m}/${d} ${dows[date.getDay()]}</span>
    </div>
    <div class="cal-mood-row">${moodHtml}</div>
    <textarea class="cal-journal-ta" id="cal-journal-ta" placeholder="오늘 하루를 기록해보세요..." oninput="calJournalInput()" onblur="calJournalBlur()">${_escapeHtml(journal.body || '')}</textarea>
  `;
}

// 모바일 1일 뷰
function _renderMobileCal() {
  const el = document.getElementById('cal-mobile');
  if (!el) return;
  // 모바일은 일기 textarea가 이 el 안에 있어서 입력 중 다시 그리면 포커스가 날아간다.
  // 입력 중엔 갱신을 미루고 blur(calJournalBlur) 때 반영한다.
  if (_calJournalTyping()) return;
  const todayKey = dateKey(new Date());
  const dows = ['일','월','화','수','목','금','토'];

  // 7일 슬라이더: timeBlock이나 Google 일정이 있으면 has-event
  let slider = '<div class="mob-week-slider">';
  for (let i = 0; i < 7; i++) {
    const d = _calAddDays(calWeekStart, i);
    const k = dateKey(d);
    const hasTb = (timeBlocks[k] || []).length > 0;
    const hasGCal = _gcalHasEventsOnDay(d);
    const has = hasTb || hasGCal;
    const dayNotes = _notesOnDay(k);
    const diary = dayNotes.find(_isDiaryNote);
    const mood = diary ? _noteMood(diary) : '';
    const cls = [
      'mob-day',
      k === calSelectedKey ? 'active' : '',
      i === 0 ? 'sun' : '',
      i === 6 ? 'sat' : '',
      has ? 'has-event' : '',
      hasGCal ? 'has-gcal' : '',
      dayNotes.length > 0 ? 'has-note' : '',
      diary ? 'has-diary' : '',
    ].filter(Boolean).join(' ');
    slider += `<button class="${cls}" onclick="calSelectDay('${k}')">
      <span class="dow">${dows[i]}</span>
      <span class="num">${d.getDate()}</span>
      ${mood ? `<span class="mob-day-mood">${mood}</span>` : ''}
    </button>`;
  }
  slider += '</div>';

  // 선택일 정보
  const [y, m, dd] = calSelectedKey.split('-').map(Number);
  const date = new Date(y, m-1, dd);
  const dowName = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'][date.getDay()];
  const blocks = timeBlocks[calSelectedKey] || [];
  let total = 0, done = 0;
  for (const b of blocks) {
    const d = _timeToMin(b.end) - _timeToMin(b.start);
    if (d > 0) total += d;
    if (b.done) done++;
  }
  const dayNotes = _notesOnDay(calSelectedKey);
  const head = `
    <div class="mob-day-head">
      <div class="mob-day-big">${m}월 ${dd}일 ${dowName}</div>
      <div class="mob-day-stat">
        <span class="pill accent">${blocks.length} 블록</span>
        ${blocks.length > 0 ? `<span class="pill">${done}/${blocks.length} 완료</span>` : ''}
        ${total > 0 ? `<span class="pill">${Math.floor(total/60)}h ${total%60}m</span>` : ''}
        ${dayNotes.length > 0 ? `<span class="pill">메모 ${dayNotes.length}</span>` : ''}
      </div>
    </div>
  `;

  // 그날 남긴 노트 (일정과 별개)
  const notesSection = _dayNotesCard(calSelectedKey);

  // 1일 시간표
  const START_H = 7, END_H = 22;
  let timeCol = '<div class="time-col">';
  for (let h = START_H; h <= END_H; h++) {
    timeCol += `<div class="time-slot">${h.toString().padStart(2,'0')}</div>`;
  }
  timeCol += '</div>';
  let dayCol = `<div class="day-col" data-day-key="${calSelectedKey}" data-start-h="${START_H}" onclick="calGridEmptyClick(event)">`;
  for (let h = START_H; h <= END_H; h++) dayCol += '<div class="hour-line"></div>';

  // 캘린더 모드 분기: 'all'/'mine'은 timeBlock, 'all'/'google'은 gcal
  const _mobMode = (typeof window.gcal !== 'undefined') ? window.gcal.mode : 'all';
  const _showMine = (_mobMode === 'all' || _mobMode === 'mine');
  const _showGcal = (_mobMode === 'all' || _mobMode === 'google');

  if (_showMine) {
    for (const b of blocks) {
      const startMin = _timeToMin(b.start);
      const endMin = _timeToMin(b.end);
      const top = (startMin - START_H * 60) + 4;
      const height = Math.max(28, endMin - startMin - 4);
      if (top < 0) continue;
      dayCol += `<div class="event-card ${tbColorClass(b.color)}" style="top:${top}px;height:${height}px;" onclick="event.stopPropagation();calEditBlockKey('${calSelectedKey}', ${blocks.indexOf(b)})">
        <div class="ev-title"><span class="mi mi-sm ev-icon ev-icon-mine">event_note</span>${_escapeHtml(b.title || '제목 없음')}</div>
        <div class="ev-time">${b.start} — ${b.end}</div>
      </div>`;
    }
  }

  if (_showGcal && typeof window.gcal !== 'undefined') {
    const dayStart = new Date(y, m-1, dd, 0, 0, 0);
    const dayEnd   = new Date(y, m-1, dd, 23, 59, 59);
    const evList = _gcalEventsInRange(dayStart, dayEnd);
    let alldayTop = 0;
    for (const ev of evList) {
      if (window.gcal.eventIsAllDay(ev)) {
        dayCol += `<div class="event-card gcal-allday" style="top:${alldayTop}px;height:20px;background:${window.gcal.eventColor(ev)}26;border-left:3px solid ${window.gcal.eventColor(ev)};" onclick="event.stopPropagation();openGCalEditor('${ev._calendarId}','${ev.id}')">
          <div class="ev-title"><span class="mi mi-sm ev-icon ev-icon-gcal">event</span>${_escapeHtml(ev.summary || '제목 없음')}</div>
        </div>`;
        alldayTop += 22;
        continue;
      }
      const evStart = window.gcal.eventStart(ev);
      const evEnd = window.gcal.eventEnd(ev);
      const startMin = evStart.getHours() * 60 + evStart.getMinutes();
      const endMin = evEnd.getHours() * 60 + evEnd.getMinutes();
      const top = (startMin - START_H * 60) + 4;
      const height = Math.max(28, endMin - startMin - 4);
      if (top < 0) continue;
      const bg = window.gcal.eventColor(ev);
      const startLabel = `${String(evStart.getHours()).padStart(2,'0')}:${String(evStart.getMinutes()).padStart(2,'0')}`;
      const endLabel   = `${String(evEnd.getHours()).padStart(2,'0')}:${String(evEnd.getMinutes()).padStart(2,'0')}`;
      dayCol += `<div class="event-card gcal-event" style="top:${top}px;height:${height}px;background:${bg}26;border-left:3px solid ${bg};color:var(--text);" onclick="event.stopPropagation();openGCalEditor('${ev._calendarId}','${ev.id}')">
        <div class="ev-title"><span class="mi mi-sm ev-icon ev-icon-gcal">event</span>${_escapeHtml(ev.summary || '제목 없음')}</div>
        <div class="ev-time">${startLabel} — ${endLabel}</div>
      </div>`;
    }
  }
  // 현재시각 (오늘만)
  if (calSelectedKey === todayKey) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin >= START_H * 60 && nowMin <= END_H * 60) {
      const top = nowMin - START_H * 60;
      dayCol += `<div class="now-pill" style="top:${top}px;">${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}</div>`;
      dayCol += `<div class="now-line" style="top:${top}px;"></div>`;
    }
  }
  dayCol += '</div>';

  // 선택일 감정일기
  const journal = _diaryParse(_diaryMemo(calSelectedKey));
  const moodHtml = _calMoodRowHtml();
  const journalSection = `
    <div class="mob-journal-sec">
      <div class="mob-journal-head">📔 감정일기</div>
      <div class="cal-mood-row">${moodHtml}</div>
      <textarea class="cal-journal-ta" id="cal-journal-ta" placeholder="오늘 하루를 기록해보세요..." oninput="calJournalInput()" onblur="calJournalBlur()">${_escapeHtml(journal.body || '')}</textarea>
    </div>
  `;

  // 모드 토글은 정적 HTML(.cal-mobile-mode-static)에 있고 여기선 active 상태만 맞춘다
  const _curMode = (typeof window.gcal !== 'undefined') ? window.gcal.mode : 'all';
  document.querySelectorAll('#cal-mode-seg-mobile button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === _curMode);
  });

  // 헤더는 한 줄로 (날짜가 줄바꿈되며 깨지던 문제)
  el.innerHTML = `
    <div class="mob-cal-month-row">
      <button class="mob-week-nav" onclick="calPrevWeek()" aria-label="이전 주">
        <span class="mi mi-sm">chevron_left</span>
      </button>
      <div class="mob-cal-month">${y}년 ${m}월</div>
      <button class="mob-week-nav" onclick="calNextWeek()" aria-label="다음 주">
        <span class="mi mi-sm">chevron_right</span>
      </button>
      <button class="mob-cal-today" onclick="calGoToday()" aria-label="오늘로 이동">
        <span class="mi mi-sm">today</span>
      </button>
    </div>
    ${slider}
    ${head}
    <div class="mob-timeline">${timeCol}${dayCol}</div>
    ${notesSection}
    ${journalSection}
  `;
}

// 네비게이션
function calSelectDay(key) {
  calSelectedKey = key;
  // 선택일이 현재 주에 없으면 주도 이동
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const ws = _calStartOfWeek(date);
  if (dateKey(ws) !== dateKey(calWeekStart)) calWeekStart = ws;
  renderCalendar();
}
// 달을 넘기면 그 달 일정을 받아야 미니 월간 점이 채워진다.
function calPrevMonth() {
  calViewMonth.setMonth(calViewMonth.getMonth() - 1);
  _renderMiniCal();
  if (_shouldFetchGCal()) refreshGCalEventsForVisibleWeek();
}
function calNextMonth() {
  calViewMonth.setMonth(calViewMonth.getMonth() + 1);
  _renderMiniCal();
  if (_shouldFetchGCal()) refreshGCalEventsForVisibleWeek();
}
function calGoToday() {
  const t = new Date();
  calViewMonth = new Date(t.getFullYear(), t.getMonth(), 1);
  calSelectedKey = dateKey(t);
  calWeekStart = _calStartOfWeek(t);
  renderCalendar();
  if (_shouldFetchGCal()) refreshGCalEventsForVisibleWeek();
}
function calBackToGrid() {
  // 주간 뷰에선 별도 동작 없음 (호환용 stub)
}
function renderCalDetail() { /* 주간 뷰로 통합됨, 호환용 stub */ }

// 타임블록 (기존 모달 재활용)
// 모달 저장 함수들은 전역 currentDate를 쓰므로 선택일로 동기화한다.
function _calSyncCurrentDate() {
  const [y, m, d] = calSelectedKey.split('-').map(Number);
  currentDate = new Date(y, m-1, d);
}
function calAddBlock() {
  _calSyncCurrentDate();
  const h = Math.min(22, Math.max(6, new Date().getHours()));
  openTbModal(h);
}
function calEditBlock(idx) {
  _calSyncCurrentDate();
  editTbBlock(calSelectedKey, idx);
}
function calToggleBlock(idx) {
  toggleTbDone(calSelectedKey, idx);
}

// 블록 안의 투두 항목 체크 토글
function calToggleTodo(blockIdx, todoIdx) {
  const blocks = timeBlocks[calSelectedKey];
  const todo = blocks && blocks[blockIdx] && (blocks[blockIdx].todos || [])[todoIdx];
  if (!todo) return;
  todo.done = !todo.done;
  save('tb_blocks', timeBlocks);
  updateTbMeta(calSelectedKey);
  renderCalDetail();
}

// 빠른 추가: 제목만으로 블록 생성 (시작 시각은 자동 배치)
function calQuickAddBlock() {
  const input = document.getElementById('cal-quick-input');
  if (!input) return;
  const title = input.value.trim();
  if (!title) { toast('제목을 입력하세요'); return; }
  const key = calSelectedKey;
  if (!timeBlocks[key]) timeBlocks[key] = [];
  // 시작 시각: 마지막 블록의 끝, 없으면 현재 시각(06~22시로 클램프)
  let startMin;
  if (timeBlocks[key].length) {
    startMin = Math.min(23 * 60, Math.max(...timeBlocks[key].map(b => minutesFromTime(b.end))));
  } else {
    startMin = Math.min(22, Math.max(6, new Date().getHours())) * 60;
  }
  const endMin = Math.min(23 * 60 + 59, startMin + 60);
  const prefix = extractTbPrefix(title);
  const color = prefix ? getColorForPrefix(prefix) : 'yellow';
  timeBlocks[key].push({
    title, start: minsToTime(startMin), end: minsToTime(endMin),
    desc: '', color, done: false, todos: []
  });
  timeBlocks[key].sort((a, b) => a.start.localeCompare(b.start));
  save('tb_blocks', timeBlocks);
  updateTbMeta(key);
  input.value = '';
  renderCalendar();
  renderCalDetail();
  // 연속 추가가 편하도록 입력칸 다시 포커스
  setTimeout(() => { const i = document.getElementById('cal-quick-input'); if (i) i.focus(); }, 30);
}

// 상세 화면의 노트 항목 클릭 시 노트 페이지에서 해당 노트 열기
function calOpenNote(type, id) {
  if (typeof navigateTo === 'function') navigateTo('memo');
  if (typeof selectNote === 'function') selectNote(type, id);
}

// 감정일기 = #일기 태그가 붙은 일반 메모
// 일반 메모라서 드라이브 동기화, 검색, 태그, 흔적 표시에 그대로 엮인다.
//
// 규약: 제목 `YYYY-MM-DD 일기`, 태그 `일기`, 본문 첫 줄이 무드 이모지 1개.
//   <무드 이모지>
//
//   오늘 본문...
//
//   #일기
const DIARY_TAG = '일기';
const DIARY_TAIL = '#' + DIARY_TAG;

function _diaryTitle(key) { return `${key} 일기`; }

// 그 날짜의 일기 메모. 제목 앞 10자(YYYY-MM-DD)가 키.
function _diaryMemo(key) {
  if (typeof memos === 'undefined' || !Array.isArray(memos)) return null;
  return memos.find(m =>
    (m.tags || []).includes(DIARY_TAG) && (m.title || '').slice(0, 10) === key
  ) || null;
}

// 본문 -> { mood, body }. 사용자에게는 무드 줄과 꼬리 해시태그를 감춘다.
function _diaryParse(memo) {
  if (!memo) return { mood: '', body: '' };
  const text = String(memo.content || '').replace(/\n*#일기[ \t]*$/, '');
  const lines = text.split('\n');
  let mood = '';
  const first = (lines[0] || '').trim();
  if (first && typeof MOODS !== 'undefined' && MOODS.some(mo => mo.e === first)) {
    mood = first;
    lines.shift();
    while (lines.length && !lines[0].trim()) lines.shift();
  }
  return { mood, body: lines.join('\n').replace(/\s+$/, '') };
}

// { mood, body } -> 메모에 반영. 둘 다 비면 빈 껍데기를 남기지 않고 지운다.
// (deleteMemo는 확인창을 띄우고 화면을 이동시키므로 여기선 조용히 처리)
function _diaryWrite(key, mood, body) {
  const existing = _diaryMemo(key);
  const clean = String(body || '').replace(/\s+$/, '');
  const now = new Date().toISOString();

  if (!mood && !clean.trim()) {
    if (existing) {
      const tombs = load('memo_tombstones', {});
      tombs[existing.id] = now;
      save('memo_tombstones', tombs);
      memos = memos.filter(m => m.id !== existing.id);
      if (typeof activeMemoId !== 'undefined' && activeMemoId === existing.id) activeMemoId = null;
      saveMemos();
      if (typeof renderMemoList === 'function') renderMemoList();
    }
    return;
  }

  const content = (mood ? mood + '\n\n' : '') + clean + '\n\n' + DIARY_TAIL;
  let target = existing;
  if (target) {
    if (target.content === content) return;   // 실제 변화 없으면 updated를 흔들지 않는다
    target.content = content;
    target.updatedAt = now;
  } else {
    // createdAt은 그 날짜로 둔다 (그날에 대한 기록이므로)
    const created = new Date(`${key}T09:00:00`);
    target = {
      id: newMemoId(),
      title: _diaryTitle(key),
      content,
      date: (isNaN(created) ? new Date() : created).toISOString(),
      updatedAt: now,
      tags: []
    };
    memos.unshift(target);
  }
  if (typeof syncMemoHashtags === 'function') syncMemoHashtags(target);
  saveMemos();
  if (typeof renderMemoList === 'function') renderMemoList();
}

// 그 날짜 일기의 무드(없으면 ''). 캘린더 표시용.
function _diaryMood(key) { return _diaryParse(_diaryMemo(key)).mood; }

// 1회 마이그레이션: 옛 journal_entries를 #일기 메모로 옮긴다. 원본 localStorage는 남겨둔다.
// 같은 날짜 일기가 있으면 건너뛰므로 여러 기기에서 돌려도 중복이 안 생긴다.
function migrateJournalToMemos() {
  const KEY = 'mindflow_journal_to_memo_v1';
  try { if (localStorage.getItem(KEY)) return; } catch { return; }
  if (typeof memos === 'undefined' || !Array.isArray(memos)) return;
  const src = (typeof journalEntries !== 'undefined' && journalEntries) || {};
  let made = 0;
  for (const key of Object.keys(src).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const e = src[key] || {};
    const mood = e.mood || '';
    const body = String(e.content || '').replace(/\s+$/, '');
    if (!mood && !body.trim()) continue;
    if (_diaryMemo(key)) continue;                    // 이미 옮겨짐
    const created = new Date(`${key}T09:00:00`);
    // 수정일을 원래 날짜로 둔다 (전부 오늘로 몰리지 않게)
    let upd = e.updatedAt && !isNaN(new Date(e.updatedAt)) ? new Date(e.updatedAt) : null;
    if (!upd || dateKey(upd) !== key) upd = new Date(`${key}T21:00:00`);
    memos.unshift({
      id: newMemoId(),
      title: _diaryTitle(key),
      content: (mood ? mood + '\n\n' : '') + body + '\n\n' + DIARY_TAIL,
      date: (isNaN(created) ? upd : created).toISOString(),
      updatedAt: upd.toISOString(),
      tags: [DIARY_TAG]
    });
    made++;
  }
  if (made) {
    saveMemos();
    if (typeof renderMemoList === 'function') renderMemoList();
    if (typeof toast === 'function') toast(`감정일기 ${made}개를 메모로 옮겼어요`, 'success');
  }
  try { localStorage.setItem(KEY, new Date().toISOString()); } catch {}
}

// 캘린더 흔적 표시용 (getAllNotes() 서술자 기준)
function _isDiaryNote(n) { return !!n && (n.tags || []).includes(DIARY_TAG); }
function _noteMood(n) {
  if (!_isDiaryNote(n)) return '';
  return _diaryParse({ content: n.content }).mood;
}

let _calJournalTimer = null;
function calSetMood(emoji) {
  const key = calSelectedKey;
  const cur = _diaryParse(_diaryMemo(key));
  // 입력 중이면 저장 안 된 글자가 있을 수 있으니 화면의 textarea 값을 쓴다
  const ta = document.getElementById('cal-journal-ta');
  const body = ta ? ta.value : cur.body;
  _diaryWrite(key, cur.mood === emoji ? '' : emoji, body);
  renderCalendar();
  renderCalDetail();
  // 입력 중이면 위 렌더러들이 일기 패널을 건너뛰므로 무드 버튼 상태만 직접 반영한다.
  if (_calJournalTyping()) {
    document.querySelectorAll('.cal-mood-row').forEach(r => { r.innerHTML = _calMoodRowHtml(); });
  }
}
// 감정일기 textarea에 포커스가 있는지. 렌더러들이 이걸 보고 다시 그릴지 정한다.
function _calJournalTyping() {
  const ae = document.activeElement;
  return !!(ae && ae.id === 'cal-journal-ta');
}

// 저장만 하고 렌더는 안 한다 (입력 중 화면을 건드리지 않게)
function _calJournalSave() {
  const ta = document.getElementById('cal-journal-ta');
  if (!ta) return;
  const key = calSelectedKey;
  _diaryWrite(key, _diaryParse(_diaryMemo(key)).mood, ta.value);
}

function calJournalInput() {
  clearTimeout(_calJournalTimer);
  _calJournalTimer = setTimeout(_calJournalSave, 600);
}

// 입력을 마치면 그때 한 번 저장 + 전체 갱신 (달력 셀의 일기 표시 등)
function calJournalBlur() {
  clearTimeout(_calJournalTimer);
  _calJournalSave();
  renderCalendar();
}

// timeblock.js가 블록을 저장/삭제하면 이 훅으로 캘린더를 갱신한다.
function _calRefreshHook() {
  const page = document.getElementById('page-calendar');
  if (!page || !page.classList.contains('active')) return;
  // 일기 입력 중이면 textarea를 다시 그리지 않도록 detail 갱신은 조건부
  const typingJournal = document.activeElement
    && document.activeElement.id === 'cal-journal-ta';
  renderCalendar();
  if (!typingJournal) renderCalDetail();
}

renderCalendar();
renderCalDetail();
