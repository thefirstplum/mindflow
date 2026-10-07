// 필기 (Apple Pencil, 스타일러스, 손가락, 마우스)
// Bamboo Paper 스타일 필기 도구
//
// 펜 종류 (도구마다 stroke 렌더링이 다름):
//   fine         일정 굵기, 압력 무시 (라이너)
//   ink          압력에 비례해 굵기 변화 (기본 펜)
//   pencil       얇고 약간 거칠게, 회색 톤
//   fountain     압력 + 다른 굵기 곡선 (만년필)
//   marker       두꺼운 일정 굵기, 반투명
//   highlighter  아주 두껍고 투명, 강조용
//   brush        압력 따라 굵기 변화가 크고 살짝 번짐
let drawStrokes = [];
let drawRedoStack = [];
let drawCurrentStroke = null;
let drawTool = 'ink';         // 'ink' | 'fine' | 'pencil' | 'fountain' | 'marker' | 'highlighter' | 'brush' | 'eraser'
let drawEraserMode = 'pixel'; // 'pixel'(부분 지우개) | 'stroke'(스트로크 단위 삭제)
let drawColor = '#1f1a14';
let drawWidthBase = 2;
let drawCanvas = null;
let drawCtx = null;
// 오프스크린 baked 캔버스. 끝난 스트로크를 전부 그려 둔다.
let drawBaked = null;
let drawBakedCtx = null;
// 모바일은 기본 'pen-only' (손바닥/손가락 오인 방지). 저장된 값이 있으면 그걸 쓴다
const _isMobileEnv = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
let drawPalmMode = load('draw_palm_mode', _isMobileEnv ? 'pen-only' : 'auto');

// 펜별 굵기 기억 (펜을 바꿔도 각자 설정한 굵기 유지)
const _defaultToolWidths = { ink: 2.5, fine: 1.5, pencil: 1.5, fountain: 2.5, marker: 5, highlighter: 12, brush: 4, eraser: 8 };
let toolWidths = { ..._defaultToolWidths, ...load('draw_tool_widths', {}) };

// 종이 배경: 'blank' | 'lined' | 'grid' | 'dot' | 'cream' | 'sepia'
let drawPaper = load('draw_paper', 'blank');

// 줌/팬 (캔버스 wrap에 CSS transform)
let drawScale = 1;
let drawPanX = 0;
let drawPanY = 0;

// 멀티 페이지
let drawPages = [[]];  // 페이지별 strokes 배열
let drawPageIdx = 0;

// 최근 사용 색상 (팔레트 popup용)
let drawRecentColors = load('draw_recent_colors', ['#1d1a14']);
const DRAW_PALETTE_COLORS = [
  // 기본 팔레트 9색 (3x3)
  '#1d1a14', '#475569', '#7c5c3a',  // 검정, 슬레이트, 갈색
  '#dc322f', '#cb4b16', '#b58900',  // 레드, 오렌지, 옐로우
  '#859900', '#268bd2', '#7c3aed',  // 그린, 블루, 퍼플
];

// 도구별 굵기, 투명도, 압력 곡선
const DRAW_TOOLS = {
  ink:         { widthMul: 1.5, alpha: 1.00, pMin: 0.35, pMax: 1.10, jitter: 0,    composite: 'source-over' },
  fine:        { widthMul: 1.0, alpha: 1.00, pMin: 1.00, pMax: 1.00, jitter: 0,    composite: 'source-over' },
  pencil:      { widthMul: 0.9, alpha: 0.78, pMin: 0.50, pMax: 0.95, jitter: 0.6,  composite: 'source-over' },
  fountain:    { widthMul: 2.0, alpha: 1.00, pMin: 0.20, pMax: 1.45, jitter: 0,    composite: 'source-over' },
  marker:      { widthMul: 3.0, alpha: 0.55, pMin: 0.90, pMax: 1.05, jitter: 0,    composite: 'source-over' },
  highlighter: { widthMul: 7.0, alpha: 0.32, pMin: 1.00, pMax: 1.00, jitter: 0,    composite: 'multiply'    },
  brush:       { widthMul: 2.2, alpha: 0.92, pMin: 0.30, pMax: 1.50, jitter: 0,    composite: 'source-over' },
};

function openDrawingModal() {
  if (!activeMemoId) { toast('먼저 메모를 선택하세요'); return; }
  drawStrokes = [];
  drawRedoStack = [];
  drawCurrentStroke = null;
  drawTool = 'ink';
  drawColor = '#1f1a14';
  drawWidthBase = 2.5;
  setTimeout(_updateWidthDot, 50);
  // 줌 reset
  drawScale = 1;
  drawPanX = 0;
  drawPanY = 0;
  // 페이지 reset (1페이지로 시작)
  drawPages = [[]];
  drawPageIdx = 0;
  setTimeout(() => { _renderPageIndicator(); updateQuickDockState(); updatePalmModeButton(); }, 50);
  document.querySelectorAll('.draw-color').forEach(c => c.classList.toggle('active', c.dataset.color === drawColor));
  document.querySelectorAll('.draw-tool').forEach(b => b.classList.remove('active'));
  document.getElementById('tool-ink')?.classList.add('active');
  const slider = document.getElementById('draw-width');
  if (slider) slider.value = '2.5';
  const disp = document.getElementById('draw-width-display');
  if (disp) disp.textContent = '2';

  document.getElementById('drawing-modal-overlay').classList.add('show');
  setTimeout(() => {
    drawCanvas = document.getElementById('drawing-canvas');
    if (!drawCanvas) return;
    drawCtx = drawCanvas.getContext('2d');
    drawBaked = document.createElement('canvas');
    drawBakedCtx = drawBaked.getContext('2d');
    resizeDrawingCanvas();
    setupDrawingPointer(drawCanvas);
    updateDrawEmptyHint();
    updatePalmModeButton();
  }, 30);
}

function closeDrawingModal() {
  document.getElementById('drawing-modal-overlay').classList.remove('show');
}

function resizeDrawingCanvas() {
  if (!drawCanvas || !drawCtx) return;
  const wrap = drawCanvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  drawCanvas.width = rect.width * dpr;
  drawCanvas.height = rect.height * dpr;
  drawCanvas.style.width = rect.width + 'px';
  drawCanvas.style.height = rect.height + 'px';
  drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (drawBaked) {
    drawBaked.width = drawCanvas.width;
    drawBaked.height = drawCanvas.height;
    drawBakedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  applyPaperBg();
  rebakeAll();
  // resize 후엔 backing이 scale 1 기준이라 현재 zoom 비율로 다시 oversample
  _bakedZoomFactor = 1;
  if (drawScale !== 1) resizeBakedForZoom();
}

// 종이 배경 패턴 (data URL svg)
function _paperPatternUrl(type) {
  // 32px grid 기준 패턴
  const patterns = {
    lined: `<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='32'><line x1='0' y1='31.5' x2='100%' y2='31.5' stroke='%23D9C9B4' stroke-width='1'/></svg>`,
    grid:  `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><path d='M 32 0 L 0 0 0 32' fill='none' stroke='%23DCC9B3' stroke-width='0.6'/></svg>`,
    dot:   `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='12' cy='12' r='1' fill='%23C4B095'/></svg>`,
  };
  return patterns[type] ? `url("data:image/svg+xml;utf8,${patterns[type]}")` : 'none';
}
function applyPaperBg() {
  if (!drawCanvas) return;
  const wrap = drawCanvas.parentElement;
  if (!wrap) return;
  const bgColors = {
    blank:  '#FFFFFF',
    lined:  '#FFFCF2',
    grid:   '#FFFDF5',
    dot:    '#FAF6EB',
    cream:  '#F7EFD8',
    sepia:  '#F4E7C7',
  };
  wrap.style.background = bgColors[drawPaper] || '#FFFFFF';
  const url = _paperPatternUrl(drawPaper);
  wrap.style.backgroundImage = url;
  wrap.style.backgroundSize = drawPaper === 'lined' ? '100% 32px' : 'auto';
  wrap.style.backgroundRepeat = 'repeat';
}
function setPaper(type) {
  drawPaper = type;
  save('draw_paper', type);
  applyPaperBg();
  document.querySelectorAll('.paper-pick').forEach(b =>
    b.classList.toggle('active', b.dataset.paper === type));
  closePaperPicker();
}
function togglePaperPicker(e) {
  e?.stopPropagation();
  const pop = document.getElementById('draw-paper-picker');
  if (!pop) return;
  pop.classList.toggle('show');
  if (pop.classList.contains('show')) {
    setTimeout(() => document.addEventListener('click', _paperOutside, { once: true }), 0);
  }
}
function _paperOutside(e) {
  const pop = document.getElementById('draw-paper-picker');
  if (pop && !pop.contains(e.target)) closePaperPicker();
}
function closePaperPicker() {
  document.getElementById('draw-paper-picker')?.classList.remove('show');
  document.removeEventListener('click', _paperOutside);
}
window.setPaper = setPaper;
window.togglePaperPicker = togglePaperPicker;
window.closePaperPicker = closePaperPicker;
window.addEventListener('resize', () => {
  if (document.getElementById('drawing-modal-overlay')?.classList.contains('show')) {
    resizeDrawingCanvas();
  }
});

function clearVisibleCanvas() {
  if (!drawCtx) return;
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  drawCtx.clearRect(0, 0, w, h);
}

function clearBakedCanvas() {
  if (!drawBakedCtx) return;
  const w = drawBaked.width / (window.devicePixelRatio || 1);
  const h = drawBaked.height / (window.devicePixelRatio || 1);
  drawBakedCtx.clearRect(0, 0, w, h);
}

// 도구별 stroke 세그먼트 렌더
function _renderSegment(ctx, p1, p2, stroke, spec) {
  const pAvg = ((p1.p || 0.5) + (p2.p || 0.5)) / 2;
  const pNorm = spec.pMin + (spec.pMax - spec.pMin) * Math.max(0, Math.min(1, pAvg));
  const w = Math.max(0.4, stroke.width * spec.widthMul * pNorm);
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  // 연필: 옆에 작은 노이즈 점으로 질감
  if (spec.jitter && Math.random() < spec.jitter) {
    const dx = (Math.random() - 0.5) * w * 0.8;
    const dy = (Math.random() - 0.5) * w * 0.8;
    ctx.fillRect((p1.x + p2.x) / 2 + dx, (p1.y + p2.y) / 2 + dy, 0.6, 0.6);
  }
}

function _setupStrokeCtx(ctx, stroke) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
    return DRAW_TOOLS.fine;  // 지우개도 fine 톤 width
  }
  const spec = DRAW_TOOLS[stroke.tool] || DRAW_TOOLS.ink;
  ctx.globalCompositeOperation = spec.composite || 'source-over';
  ctx.globalAlpha = spec.alpha;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  return spec;
}

function renderStrokeOn(ctx, stroke) {
  if (!stroke || !ctx || stroke.points.length < 1) return;
  ctx.save();
  const spec = _setupStrokeCtx(ctx, stroke);
  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    const r = Math.max(1, stroke.width * spec.widthMul * spec.pMax * (p.p || 0.5));
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      _renderSegment(ctx, stroke.points[i-1], stroke.points[i], stroke, spec);
    }
  }
  ctx.restore();
}

// 그리는 중인 스트로크의 마지막 구간만 화면 캔버스에 덧그린다
function paintLatestSegment(stroke, fromIdx) {
  if (!drawCtx || !stroke || stroke.points.length <= fromIdx) return;
  drawCtx.save();
  const spec = _setupStrokeCtx(drawCtx, stroke);
  for (let i = Math.max(1, fromIdx); i < stroke.points.length; i++) {
    _renderSegment(drawCtx, stroke.points[i-1], stroke.points[i], stroke, spec);
  }
  drawCtx.restore();
}

function rebakeAll() {
  if (!drawBakedCtx) return;
  clearBakedCanvas();
  for (const stroke of drawStrokes) renderStrokeOn(drawBakedCtx, stroke);
  drawCompositeFromBaked();
}

function drawCompositeFromBaked() {
  if (!drawCtx || !drawBaked) return;
  clearVisibleCanvas();
  drawCtx.save();
  drawCtx.setTransform(1, 0, 0, 1, 0, 0); // drawImage는 실제 픽셀 기준
  drawCtx.drawImage(drawBaked, 0, 0);
  drawCtx.restore();
  if (drawCurrentStroke) renderStrokeOn(drawCtx, drawCurrentStroke);
}

// undo, 모두 지우기, 리사이즈에서 부르는 다시 그리기 진입점
function redrawAllStrokes() {
  rebakeAll();
}

function setDrawTool(tool) {
  drawTool = tool;
  // 메인 펜 4개 + 지우개 active 토글
  document.querySelectorAll('.bamboo-pen').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === tool));
  // 펜 picker 안 active 표시 (더보기 popup의 추가 펜)
  document.querySelectorAll('.pen-pick').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === tool));
  // 호환용 (옛 selector)
  document.getElementById('tool-eraser')?.classList.toggle('active', tool === 'eraser');
  if (drawCanvas) drawCanvas.classList.toggle('eraser-mode', tool === 'eraser');
  // 그 펜에 마지막으로 설정한 굵기 복원
  const savedWidth = toolWidths[tool] ?? _defaultToolWidths[tool];
  if (savedWidth != null) {
    drawWidthBase = savedWidth;
    const slider = document.getElementById('draw-width');
    if (slider) slider.value = savedWidth;
    const disp = document.getElementById('draw-width-display');
    if (disp) disp.textContent = String(Math.round(savedWidth));
    _updateWidthDot();
    _updateMoreWidthVal();
  }
}
function _updateMoreWidthVal() {
  const el = document.getElementById('more-width-val');
  if (el) el.textContent = Math.round(drawWidthBase) + 'px';
}

function togglePenPicker(e) {
  e?.stopPropagation();
  const pop = document.getElementById('draw-pen-picker');
  if (!pop) return;
  pop.classList.toggle('show');
  if (pop.classList.contains('show')) {
    setTimeout(() => document.addEventListener('click', _penOutside, { once: true }), 0);
  }
}
function _penOutside(e) {
  const pop = document.getElementById('draw-pen-picker');
  if (pop && !pop.contains(e.target)) closePenPicker();
}
function closePenPicker() {
  document.getElementById('draw-pen-picker')?.classList.remove('show');
}
function pickTool(tool, el) {
  // 이미 active인 펜을 다시 탭하면 굵기 슬라이더 popup을 그 펜 아래에 띄운다
  if (tool === drawTool && el && el.classList?.contains('bamboo-pen')) {
    _showWidthPopupNear(el);
    closePenPicker();
    closeMorePicker();
    return;
  }
  setDrawTool(tool);
  closePenPicker();
  closeMorePicker();
  // 펜을 바꾸면 떠 있던 굵기 popup은 닫는다
  document.getElementById('draw-width-inline')?.classList.remove('show');
}
window.togglePenPicker = togglePenPicker;
window.closePenPicker = closePenPicker;
window.pickTool = pickTool;

// 굵기 inline popup을 펜 버튼 아래에 띄움 (active 재탭용)
function _showWidthPopupNear(el) {
  const pop = document.getElementById('draw-width-inline');
  if (!pop) return;
  const toolbar = el.closest('.drawing-toolbar');
  if (!toolbar) return;
  const r = el.getBoundingClientRect();
  const tr = toolbar.getBoundingClientRect();
  const popWidth = 220;
  const margin = 8;
  // 펜 중앙 기준 + clamp (toolbar 좌우 끝과 8px 간격)
  let left = (r.left + r.width / 2 - tr.left) - popWidth / 2;
  left = Math.max(margin, Math.min(left, tr.width - popWidth - margin));
  pop.style.right = 'auto';
  pop.style.left = `${left}px`;
  pop.classList.add('show');
  const slider = document.getElementById('draw-width');
  if (slider) slider.value = String(drawWidthBase);
  const disp = document.getElementById('draw-width-display');
  if (disp) disp.textContent = String(Math.round(drawWidthBase));
  // 바깥 클릭 시 닫기
  setTimeout(() => document.addEventListener('click', _widthInlineOutside, { once: true }), 0);
}
function _widthInlineOutside(e) {
  const pop = document.getElementById('draw-width-inline');
  if (!pop) return;
  // popup 내부나 펜 버튼 클릭이면 유지
  if (pop.contains(e.target) || e.target.closest?.('.bamboo-pen')) {
    setTimeout(() => document.addEventListener('click', _widthInlineOutside, { once: true }), 0);
    return;
  }
  pop.classList.remove('show');
}

function toggleWidthPicker(e) {
  e?.stopPropagation();
  const pop = document.getElementById('draw-width-picker');
  if (!pop) return;
  pop.classList.toggle('show');
  if (pop.classList.contains('show')) {
    setTimeout(() => document.addEventListener('click', _widthOutside, { once: true }), 0);
  }
}
function _widthOutside(e) {
  const pop = document.getElementById('draw-width-picker');
  if (pop && !pop.contains(e.target)) closeWidthPicker();
}
function closeWidthPicker() {
  document.getElementById('draw-width-picker')?.classList.remove('show');
}
function pickWidth(w) {
  drawWidthBase = parseFloat(w);
  const slider = document.getElementById('draw-width');
  if (slider) slider.value = drawWidthBase;
  const disp = document.getElementById('draw-width-display');
  if (disp) disp.textContent = String(Math.round(drawWidthBase));
  _updateWidthDot();
  _updateMoreWidthVal();
  if (drawTool) {
    toolWidths[drawTool] = drawWidthBase;
    save('draw_tool_widths', toolWidths);
  }
  closeWidthPicker();
}
function _updateWidthDot() {
  const dot = document.getElementById('width-trigger-dot');
  if (!dot) return;
  const size = Math.max(3, Math.min(16, drawWidthBase));
  dot.style.width = size + 'px';
  dot.style.height = size + 'px';
}
window.toggleWidthPicker = toggleWidthPicker;
window.pickWidth = pickWidth;

function toggleMorePicker(e) {
  e?.stopPropagation();
  const pop = document.getElementById('draw-more-picker');
  if (!pop) return;
  pop.classList.toggle('show');
  if (pop.classList.contains('show')) {
    setTimeout(() => document.addEventListener('click', _moreOutside, { once: true }), 0);
  }
}
function _moreOutside(e) {
  const pop = document.getElementById('draw-more-picker');
  if (pop && !pop.contains(e.target)) closeMorePicker();
}
function closeMorePicker() {
  document.getElementById('draw-more-picker')?.classList.remove('show');
}
window.toggleMorePicker = toggleMorePicker;

function setDrawColor(color, el) {
  drawColor = color;
  document.querySelectorAll('.draw-color').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  const trigger = document.getElementById('color-picker-trigger');
  if (trigger) trigger.style.background = color;
  // active 펜 dot 색은 CSS 변수 하나로 갱신 (dot은 active 펜만 보임)
  document.documentElement.style.setProperty('--bp-color', color);
  // 최근 사용 색 (앞에 추가, 중복 제거, 최대 6개)
  drawRecentColors = [color, ...drawRecentColors.filter(c => c !== color)].slice(0, 6);
  save('draw_recent_colors', drawRecentColors);
  // 지우개 상태에서 색을 고르면 그리려는 의도라 ink로 전환
  if (drawTool === 'eraser') setDrawTool('ink');
  closeColorPicker();
}

// 굵기 inline popup (더보기 > 굵기). 우측 끝 고정 위치
window.toggleWidthInline = function(e) {
  e?.stopPropagation();
  const el = document.getElementById('draw-width-inline');
  if (!el) return;
  // 펜 재탭 때 left를 바꿨을 수 있어서 원래 위치로 복원
  el.style.left = 'auto';
  el.style.right = '14px';
  el.classList.toggle('show');
  closeMorePicker();
};

// 색상 팔레트 popup
function toggleColorPicker(e) {
  e?.stopPropagation();
  const pop = document.getElementById('draw-color-picker');
  if (!pop) return;
  _renderColorPicker();
  pop.classList.toggle('show');
  if (pop.classList.contains('show')) {
    setTimeout(() => document.addEventListener('click', _colorOutside, { once: true }), 0);
  }
}
function _colorOutside(e) {
  const pop = document.getElementById('draw-color-picker');
  if (pop && !pop.contains(e.target)) closeColorPicker();
}
function closeColorPicker() {
  document.getElementById('draw-color-picker')?.classList.remove('show');
  document.removeEventListener('click', _colorOutside);
}
function _renderColorPicker() {
  const pop = document.getElementById('draw-color-picker');
  if (!pop) return;
  const recent = drawRecentColors.length > 0
    ? `<div class="cp-section-title">최근</div>
       <div class="cp-grid recent">${drawRecentColors.map(c =>
         `<div class="draw-color${c === drawColor ? ' active' : ''}" data-color="${c}" style="background:${c}" onclick="setDrawColor('${c}', this)"></div>`
       ).join('')}</div>`
    : '';
  const palette = `<div class="cp-section-title">팔레트</div>
    <div class="cp-grid">${DRAW_PALETTE_COLORS.map(c =>
      `<div class="draw-color${c === drawColor ? ' active' : ''}" data-color="${c}" style="background:${c}" onclick="setDrawColor('${c}', this)"></div>`
    ).join('')}</div>
    <div class="cp-custom-row">
      <input type="color" id="draw-custom-color" value="${drawColor}" onchange="setDrawColor(this.value, this)" title="사용자 정의 색">
      <span style="font-size:11px;color:var(--text-mute);">사용자 정의</span>
    </div>`;
  pop.innerHTML = recent + palette;
}
window.toggleColorPicker = toggleColorPicker;
window.closeColorPicker = closeColorPicker;

function updateDrawWidth(v) {
  drawWidthBase = parseFloat(v) || 2;
  document.getElementById('draw-width-display').textContent = String(Math.round(drawWidthBase));
  _updateWidthDot();
  _updateMoreWidthVal();
  // 현재 펜 굵기로 저장
  if (drawTool) {
    toolWidths[drawTool] = drawWidthBase;
    save('draw_tool_widths', toolWidths);
  }
}

// 지우개 모드 토글: 픽셀 vs 스트로크
function setEraserMode(mode) {
  drawEraserMode = (mode === 'stroke') ? 'stroke' : 'pixel';
  document.querySelectorAll('.eraser-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === drawEraserMode));
  if (typeof toast === 'function') {
    toast(drawEraserMode === 'stroke' ? '지우개: 스트로크 단위' : '지우개: 부분 (픽셀)');
  }
}
window.setEraserMode = setEraserMode;

// 스트로크 지우개: 클릭 위치에 닿은 stroke 전체 삭제
function _strokeHitTest(x, y, radius) {
  // 끝에서부터 검사 (위에 그려진 게 먼저 지워지게)
  for (let i = drawStrokes.length - 1; i >= 0; i--) {
    const s = drawStrokes[i];
    if (s.tool === 'eraser') continue;
    for (const p of s.points) {
      const dx = p.x - x, dy = p.y - y;
      if (dx * dx + dy * dy < radius * radius) return i;
    }
  }
  return -1;
}

function undoDraw() {
  if (drawStrokes.length === 0) return;
  const last = drawStrokes.pop();
  drawRedoStack.push(last);
  redrawAllStrokes();
  updateDrawEmptyHint();
  updateQuickDockState();
}

// 다시 실행 (redo)
function redoDraw() {
  if (drawRedoStack.length === 0) return;
  const s = drawRedoStack.pop();
  drawStrokes.push(s);
  redrawAllStrokes();
  updateDrawEmptyHint();
  updateQuickDockState();
}
window.redoDraw = redoDraw;

// quick FAB의 undo/redo disabled 상태 갱신
function updateQuickDockState() {
  const undoBtn = document.getElementById('quick-undo');
  const redoBtn = document.getElementById('quick-redo');
  if (undoBtn) undoBtn.disabled = drawStrokes.length === 0;
  if (redoBtn) redoBtn.disabled = drawRedoStack.length === 0;
}
window.updateQuickDockState = updateQuickDockState;

// 최초 1회 제스처 안내 toast
function _maybeShowGestureHint() {
  try {
    if (localStorage.getItem('mindflow_draw_gesture_hint_shown')) return;
    if (typeof toast === 'function') toast('💡 두 손가락 탭 = 되돌리기, 세 손가락 탭 = 다시 실행');
    localStorage.setItem('mindflow_draw_gesture_hint_shown', '1');
  } catch {}
}

function clearDraw() {
  if (drawStrokes.length === 0) return;
  if (!confirm('모두 지우시겠습니까?')) return;
  drawStrokes = [];
  drawRedoStack = [];
  redrawAllStrokes();
  updateDrawEmptyHint();
}

// 멀티 페이지
// 현재 페이지를 drawStrokes에 동기화 + 다른 페이지로 전환
function _flushCurrentPage() {
  drawPages[drawPageIdx] = drawStrokes.slice();
}
function _loadPage(idx) {
  drawStrokes = drawPages[idx] ? drawPages[idx].slice() : [];
  drawRedoStack = [];
  drawCurrentStroke = null;
  drawPageIdx = idx;
  redrawAllStrokes();
  updateDrawEmptyHint();
  _renderPageIndicator();
  resetCanvasTransform();
}
function gotoPage(idx) {
  if (idx < 0 || idx >= drawPages.length) return;
  _flushCurrentPage();
  _loadPage(idx);
}
function addPage() {
  _flushCurrentPage();
  drawPages.push([]);
  _loadPage(drawPages.length - 1);
  if (typeof toast === 'function') toast(`페이지 ${drawPageIdx + 1} 추가됨`, 'success');
}
function deletePage() {
  if (drawPages.length === 1) {
    if (typeof toast === 'function') toast('마지막 페이지는 삭제할 수 없어요');
    return;
  }
  if (!confirm(`페이지 ${drawPageIdx + 1} 삭제할까요?`)) return;
  drawPages.splice(drawPageIdx, 1);
  if (drawPageIdx >= drawPages.length) drawPageIdx = drawPages.length - 1;
  _loadPage(drawPageIdx);
}
window.gotoPage = gotoPage;
window.addPage = addPage;
window.deletePage = deletePage;

function _renderPageIndicator() {
  const host = document.getElementById('draw-page-indicator');
  if (!host) return;
  const dots = drawPages.map((_, i) =>
    `<button class="page-dot${i === drawPageIdx ? ' active' : ''}" onclick="gotoPage(${i})" aria-label="페이지 ${i + 1}"></button>`
  ).join('');
  // compact chip 1개(탭 시 expand) + expanded 영역
  host.innerHTML = `
    <button class="page-compact" onclick="togglePageExpand(event)" aria-label="페이지 ${drawPageIdx + 1} / ${drawPages.length}">
      ${drawPageIdx + 1}/${drawPages.length}
      <span class="mi">expand_less</span>
    </button>
    <div class="page-expanded">
      <button class="page-nav-btn" onclick="gotoPage(${drawPageIdx - 1})" ${drawPageIdx === 0 ? 'disabled' : ''} aria-label="이전 페이지">
        <span class="mi mi-sm">chevron_left</span>
      </button>
      <span class="page-count">${drawPageIdx + 1} / ${drawPages.length}</span>
      <div class="page-dots">${dots}</div>
      <button class="page-nav-btn" onclick="gotoPage(${drawPageIdx + 1})" ${drawPageIdx === drawPages.length - 1 ? 'disabled' : ''} aria-label="다음 페이지">
        <span class="mi mi-sm">chevron_right</span>
      </button>
      <button class="page-nav-btn add" onclick="addPage()" title="새 페이지 추가" aria-label="새 페이지">
        <span class="mi mi-sm">add</span>
      </button>
      <button class="page-nav-btn del" onclick="deletePage()" title="페이지 삭제" aria-label="페이지 삭제" ${drawPages.length === 1 ? 'disabled' : ''}>
        <span class="mi mi-sm">delete</span>
      </button>
      <button class="page-nav-btn" onclick="togglePageExpand(event)" title="닫기" aria-label="닫기">
        <span class="mi mi-sm">close</span>
      </button>
    </div>
  `;
}

// 페이지 chip 탭 시 compact/expanded 토글
window.togglePageExpand = function(e) {
  e?.stopPropagation();
  const host = document.getElementById('draw-page-indicator');
  if (!host) return;
  host.classList.toggle('expanded');
};
// 캔버스를 탭하면 expanded 닫기
document.addEventListener('click', (e) => {
  const host = document.getElementById('draw-page-indicator');
  if (!host || !host.classList.contains('expanded')) return;
  if (!host.contains(e.target)) host.classList.remove('expanded');
});

function updateDrawEmptyHint() {
  const hint = document.getElementById('draw-empty-hint');
  if (hint) hint.classList.toggle('hidden', drawStrokes.length > 0 || !!drawCurrentStroke);
}

// 줌/팬 transform 적용
function applyCanvasTransform() {
  if (!drawCanvas) return;
  drawCanvas.style.transformOrigin = '0 0';
  drawCanvas.style.transform = `translate(${drawPanX}px, ${drawPanY}px) scale(${drawScale})`;
  const ind = document.getElementById('draw-zoom-indicator');
  if (ind) ind.textContent = `${Math.round(drawScale * 100)}%`;
}

// 핀치 줌이 끝나면 backing canvas를 zoom 비율로 다시 만든다.
// CSS scale만 쓰면 래스터가 흐려져서 backing 픽셀로 보상한다.
let _bakedZoomFactor = 1;
function resizeBakedForZoom() {
  if (!drawCanvas || !drawCtx) return;
  // 변화가 미미하면 skip (rebake 비용)
  if (Math.abs(drawScale - _bakedZoomFactor) < 0.05) return;
  const wrap = drawCanvas.parentElement;
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  // backing 픽셀 = wrap css * dpr * drawScale
  const eff = dpr * drawScale;
  drawCanvas.width = rect.width * eff;
  drawCanvas.height = rect.height * eff;
  drawCanvas.style.width = rect.width + 'px';
  drawCanvas.style.height = rect.height + 'px';
  drawCtx.setTransform(eff, 0, 0, eff, 0, 0);
  if (drawBaked) {
    drawBaked.width = drawCanvas.width;
    drawBaked.height = drawCanvas.height;
    drawBakedCtx.setTransform(eff, 0, 0, eff, 0, 0);
  }
  _bakedZoomFactor = drawScale;
  applyPaperBg();
  rebakeAll();
}

function resetCanvasTransform() {
  drawScale = 1;
  drawPanX = 0;
  drawPanY = 0;
  applyCanvasTransform();
  resizeBakedForZoom();  // 100%로 돌아온 backing 사이즈 복원
}
window.resetCanvasTransform = resetCanvasTransform;

// 클릭 좌표 -> 캔버스 내부(unscaled) 좌표
function _clientToCanvas(clientX, clientY) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / drawScale,
    y: (clientY - rect.top) / drawScale,
  };
}

function setupDrawingPointer(canvas) {
  if (canvas.dataset.drawReady) return;
  canvas.dataset.drawReady = '1';

  // 팜 리젝션 상태 (모달을 열 때마다 새로 시작)
  let stylusActive = false;
  let lastPenAt = 0;
  let everSawPen = false;
  const PALM_BUFFER_MS = 1500;

  // 멀티터치 추적 (두 손가락: 핀치 줌 + 팬)
  const activePointers = new Map();  // id -> {x, y, type}
  let pinchMode = false;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let pinchStartCenter = { x: 0, y: 0 };
  let pinchStartPan = { x: 0, y: 0 };

  // 멀티터치 tap 제스처 (2-finger = undo, 3-finger = redo)
  let tapGesture = { active: false, fingers: 0, startTime: 0, startCenter: { x: 0, y: 0 }, moved: false, maxFingers: 0 };
  const GESTURE_MAX_TIME = 280;
  const GESTURE_MAX_MOVE = 16;
  // 핀치가 한 번이라도 있었는지. 손가락을 모두 떼면 backing 재구성에 씀
  let _pinchEverActive = false;

  function shouldRejectTouch() {
    if (drawPalmMode === 'allow-touch') return false;
    if (drawPalmMode === 'pen-only') return true;          // 손가락 입력은 항상 무시
    // 'auto' 모드:
    if (stylusActive) return true;
    if (!everSawPen) return false;
    return (Date.now() - lastPenAt) < PALM_BUFFER_MS;
  }

  // 캔버스 밖(툴바 등)에 손바닥이 닿아도 잡히도록 document에서 듣는다.
  // iPad에선 손바닥이 닿기 전에 pointerType=pen인 pointerover가 먼저 오는 경우가 많아서
  // pointerdown 전에 손바닥 스트로크를 걸러낼 수 있다.
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'pen') {
      everSawPen = true;
      lastPenAt = Date.now();
      // 방금 시작된 손바닥 스트로크를 거슬러 취소
      if (drawCurrentStroke && drawCurrentStroke.pointerType === 'touch') {
        drawCurrentStroke = null;
        drawCompositeFromBaked();
        updateDrawEmptyHint();
      }
    }
  });

  const start = (e) => {
    // 멀티터치 추적
    if (e.pointerType === 'touch') {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // tap 제스처 트래커 (손가락 2개 이상)
      if (activePointers.size >= 2) {
        const ps = [...activePointers.values()];
        const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length;
        const cy = ps.reduce((s, p) => s + p.y, 0) / ps.length;
        if (!tapGesture.active) {
          tapGesture.active = true;
          tapGesture.startTime = Date.now();
          tapGesture.startCenter = { x: cx, y: cy };
          tapGesture.moved = false;
        }
        tapGesture.fingers = activePointers.size;
        if (activePointers.size > tapGesture.maxFingers) tapGesture.maxFingers = activePointers.size;
      }

      // 두 번째 손가락이 오면 pinch 모드로 전환
      if (activePointers.size === 2) {
        const ps = [...activePointers.values()];
        pinchMode = true;
        _pinchEverActive = true;
        pinchStartDist = Math.hypot(ps[1].x - ps[0].x, ps[1].y - ps[0].y);
        pinchStartScale = drawScale;
        pinchStartCenter = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
        pinchStartPan = { x: drawPanX, y: drawPanY };
        // 진행 중이던 stroke 취소
        if (drawCurrentStroke) {
          drawCurrentStroke = null;
          drawCompositeFromBaked();
          updateDrawEmptyHint();
        }
        return;
      }
    }

    if (e.pointerType === 'touch' && shouldRejectTouch()) return;
    if (e.pointerType === 'pen') {
      everSawPen = true;
      stylusActive = true;
      lastPenAt = Date.now();
      // 동시에 그려지던 손바닥 스트로크 취소
      if (drawCurrentStroke && drawCurrentStroke.pointerType === 'touch') {
        drawCurrentStroke = null;
        drawCompositeFromBaked();
      }
    }
    e.preventDefault();
    if (e.pointerId != null) {
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    }
    // transform 적용된 좌표로 변환
    const { x, y } = _clientToCanvas(e.clientX, e.clientY);

    // stroke 지우개: 클릭 위치의 stroke 삭제
    if (drawTool === 'eraser' && drawEraserMode === 'stroke') {
      const hitIdx = _strokeHitTest(x, y, Math.max(8, drawWidthBase * 2));
      if (hitIdx >= 0) {
        drawStrokes.splice(hitIdx, 1);
        drawRedoStack = [];  // 새 액션이면 redo 초기화
        redrawAllStrokes();
        updateDrawEmptyHint();
      }
      return;
    }

    drawRedoStack = [];
    drawCurrentStroke = {
      tool: drawTool,
      color: drawColor,
      width: drawWidthBase,
      points: [{ x, y, p: e.pressure > 0 ? e.pressure : 0.5 }],
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      paintedUpTo: 1 // index of next point to paint
    };
    drawCompositeFromBaked();
    updateDrawEmptyHint();
    // 그리는 중엔 dock을 흐리게
    document.getElementById('draw-quick-dock')?.classList.add('drawing');
  };

  const move = (e) => {
    // pinch 모드: 핀치 줌 + 팬
    if (e.pointerType === 'touch' && activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // 이동 거리가 임계를 넘으면 tap이 아니라 핀치/팬
      if (tapGesture.active) {
        const ps = [...activePointers.values()];
        const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length;
        const cy = ps.reduce((s, p) => s + p.y, 0) / ps.length;
        const dist = Math.hypot(cx - tapGesture.startCenter.x, cy - tapGesture.startCenter.y);
        if (dist > GESTURE_MAX_MOVE) tapGesture.moved = true;
      }

      if (pinchMode && activePointers.size === 2) {
        e.preventDefault();
        const ps = [...activePointers.values()];
        const newDist = Math.hypot(ps[1].x - ps[0].x, ps[1].y - ps[0].y);
        const newCenter = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
        const ratio = newDist / Math.max(1, pinchStartDist);
        drawScale = Math.max(0.4, Math.min(4, pinchStartScale * ratio));
        drawPanX = pinchStartPan.x + (newCenter.x - pinchStartCenter.x);
        drawPanY = pinchStartPan.y + (newCenter.y - pinchStartCenter.y);
        applyCanvasTransform();
        return;
      }
    }

    // stroke 지우개: 드래그하며 닿은 stroke 제거
    if (drawTool === 'eraser' && drawEraserMode === 'stroke' && !drawCurrentStroke) {
      if (e.pointerType === 'touch' && shouldRejectTouch()) return;
      const { x, y } = _clientToCanvas(e.clientX, e.clientY);
      const hitIdx = _strokeHitTest(x, y, Math.max(8, drawWidthBase * 2));
      if (hitIdx >= 0) {
        drawStrokes.splice(hitIdx, 1);
        redrawAllStrokes();
        updateDrawEmptyHint();
      }
      return;
    }

    if (!drawCurrentStroke) return;
    if (e.pointerId !== drawCurrentStroke.pointerId) return;
    if (e.pointerType === 'pen') { lastPenAt = Date.now(); }
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const { x, y } = _clientToCanvas(ev.clientX, ev.clientY);
      drawCurrentStroke.points.push({ x, y, p: ev.pressure > 0 ? ev.pressure : 0.5 });
    }
    // 새 구간만 화면 캔버스에 덧그린다. baked 캔버스는 다시 만들지 않음
    paintLatestSegment(drawCurrentStroke, drawCurrentStroke.paintedUpTo);
    drawCurrentStroke.paintedUpTo = drawCurrentStroke.points.length;
  };

  const end = (e) => {
    // pointer 추적 제거
    if (e.pointerType === 'touch') {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) pinchMode = false;

      // 손가락을 모두 떼고 핀치가 있었으면 backing 재구성
      if (activePointers.size === 0 && _pinchEverActive && tapGesture.moved) {
        resizeBakedForZoom();
        _pinchEverActive = false;
      } else if (activePointers.size === 0) {
        _pinchEverActive = false;  // 핀치 안 했어도 reset
      }

      // 모든 손가락이 떨어졌을 때 tap 여부 판정
      if (activePointers.size === 0 && tapGesture.active) {
        const elapsed = Date.now() - tapGesture.startTime;
        if (!tapGesture.moved && elapsed < GESTURE_MAX_TIME) {
          if (tapGesture.maxFingers === 2) {
            undoDraw();
            _maybeShowGestureHint();
          } else if (tapGesture.maxFingers === 3) {
            redoDraw();
          }
        }
        tapGesture = { active: false, fingers: 0, startTime: 0, startCenter: { x: 0, y: 0 }, moved: false, maxFingers: 0 };
      }
    }
    if (drawCurrentStroke && e.pointerId !== drawCurrentStroke.pointerId) return;
    if (e.pointerType === 'pen') {
      stylusActive = false;
      lastPenAt = Date.now();
    }
    if (!drawCurrentStroke) return;
    if (drawCurrentStroke.points.length > 0) {
      drawStrokes.push(drawCurrentStroke);
      renderStrokeOn(drawBakedCtx, drawCurrentStroke);
    }
    drawCurrentStroke = null;
    drawCompositeFromBaked();
    updateDrawEmptyHint();
    updateQuickDockState();
    document.getElementById('draw-quick-dock')?.classList.remove('drawing');
  };

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);

  // 휠 줌은 뺐다. macOS 트랙패드 핀치는 ctrlKey가 자동 true라 일반 스크롤이 줌으로 잡혔다.
  // 데스크탑 줌은 우상단 인디케이터 +/- 버튼, 모바일은 핀치.
}

function setPalmMode(mode) {
  drawPalmMode = mode;
  save('draw_palm_mode', drawPalmMode);
  updatePalmModeButton();
}
function updatePalmModeButton() {
  const btn = document.getElementById('tool-palm');
  const labels = { 'auto': '🤖 자동', 'pen-only': '🖋 펜만', 'allow-touch': '✋ 손가락 OK' };
  if (btn) {
    btn.title = `팜 리젝션: ${labels[drawPalmMode] || drawPalmMode}`;
    btn.dataset.mode = drawPalmMode;
  }
  // 더보기 popup의 현재 모드 라벨 갱신
  const lbl = document.getElementById('more-palm-mode');
  if (lbl) {
    const short = { 'auto': '자동', 'pen-only': '펜만', 'allow-touch': '손가락 OK' };
    lbl.textContent = short[drawPalmMode] || drawPalmMode;
  }
}
function cyclePalmMode() {
  const order = ['auto', 'pen-only', 'allow-touch'];
  const idx = order.indexOf(drawPalmMode);
  setPalmMode(order[(idx + 1) % order.length]);
  toast({ 'auto': '팜 리젝션: 자동', 'pen-only': '팜 리젝션: 펜만 받기', 'allow-touch': '팜 리젝션: 손가락도 받기' }[drawPalmMode]);
}

// Generate compact SVG from stroke history (도구별 alpha/width 반영)
// pencil jitter, highlighter multiply 같은 건 SVG로 표현이 안 돼서 PNG로 fallback
function strokesToSVG() {
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  const hasEraser = drawStrokes.some(s => s.tool === 'eraser');
  const hasComplex = drawStrokes.some(s => {
    const t = s.tool;
    return t === 'pencil' || t === 'highlighter' || t === 'brush';
  });
  if (hasEraser || hasComplex) return null;  // PNG fallback (정확)

  const f = (n) => Math.round(n * 10) / 10;
  let paths = '';
  for (const stroke of drawStrokes) {
    if (stroke.points.length < 1) continue;
    const spec = DRAW_TOOLS[stroke.tool] || DRAW_TOOLS.ink;
    const op = spec.alpha < 1 ? ` stroke-opacity="${spec.alpha}" fill-opacity="${spec.alpha}"` : '';
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      const r = f(Math.max(1, stroke.width * spec.widthMul * spec.pMax * (p.p || 0.5)));
      paths += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${r}" fill="${stroke.color}"${op}/>`;
    } else {
      for (let i = 1; i < stroke.points.length; i++) {
        const p1 = stroke.points[i-1];
        const p2 = stroke.points[i];
        const pAvg = ((p1.p || 0.5) + (p2.p || 0.5)) / 2;
        const pNorm = spec.pMin + (spec.pMax - spec.pMin) * Math.max(0, Math.min(1, pAvg));
        const sw = f(Math.max(0.4, stroke.width * spec.widthMul * pNorm));
        paths += `<line x1="${f(p1.x)}" y1="${f(p1.y)}" x2="${f(p2.x)}" y2="${f(p2.y)}" stroke="${stroke.color}" stroke-width="${sw}" stroke-linecap="round"${op}/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}">${paths}</svg>`;
}

async function insertDrawing() {
  _flushCurrentPage();
  const nonEmpty = drawPages.filter(p => p && p.length > 0);
  if (nonEmpty.length === 0) {
    toast('그림이 비어있습니다');
    return;
  }

  let totalInsertText = '';
  const origIdx = drawPageIdx;
  toast(nonEmpty.length > 1 ? `${nonEmpty.length}개 페이지 처리 중...` : '드로잉 처리 중...');

  for (let pi = 0; pi < drawPages.length; pi++) {
    if (!drawPages[pi] || drawPages[pi].length === 0) continue;
    // 그 페이지 strokes로 캔버스를 다시 그려 PNG 생성
    drawStrokes = drawPages[pi].slice();
    drawPageIdx = pi;
    rebakeAll();
    drawCompositeFromBaked();

    let blob, mimeType, filename;
    const svg = strokesToSVG();
    if (svg) {
      blob = new Blob([svg], { type: 'image/svg+xml' });
      mimeType = 'image/svg+xml';
      filename = `drawing-${Date.now()}-p${pi+1}.svg`;
    } else {
      const pngBlob = await new Promise(resolve => drawCanvas.toBlob(resolve, 'image/png'));
      if (!pngBlob) { toast('이미지 생성 실패', 'error'); return; }
      blob = pngBlob;
      mimeType = 'image/png';
      filename = `drawing-${Date.now()}-p${pi+1}.png`;
    }

    let insertText;
    if (driveAssetsFolderId) {
      try {
        const file = await driveUploadFile(filename, blob, mimeType, driveAssetsFolderId);
        await driveMakePublic(file.id);
        const url = `https://drive.google.com/thumbnail?id=${file.id}&sz=w2000`;
        insertText = `\n![drawing](${url})\n`;
      } catch (e) {
        console.warn('Drive upload failed; falling back to inline:', e);
        const dataUrl = await blobToDataUrl(blob);
        insertText = `\n![drawing](${dataUrl})\n`;
      }
    } else {
      const dataUrl = await blobToDataUrl(blob);
      insertText = `\n![drawing](${dataUrl})\n`;
    }
    totalInsertText += insertText;
  }

  // 모든 페이지를 메모 끝에 붙인다
  const memo = memos.find(m => m.id === activeMemoId);
  if (memo) {
    memo.content = (memo.content || '') + totalInsertText;
    touchMemo(memo);
    saveMemos();
    renderMemoEditor();
    toast(nonEmpty.length > 1 ? `${nonEmpty.length}개 페이지 삽입됨` : '드로잉이 메모에 삽입됨', 'success');
  }

  // 원래 페이지로 복원
  drawPageIdx = origIdx;
  closeDrawingModal();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Cmd/Ctrl+Z: undo, Cmd/Ctrl+Shift+Z: redo (modal 열려 있을 때만)
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('drawing-modal-overlay')?.classList.contains('show')) return;
  if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) redoDraw(); else undoDraw();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redoDraw(); return; }
  if (e.key === 'Escape') { e.preventDefault(); closeDrawingModal(); }
  // 도구 단축키 (1-7)
  const toolKeys = { '1': 'ink', '2': 'fine', '3': 'pencil', '4': 'fountain', '5': 'marker', '6': 'highlighter', '7': 'brush', 'e': 'eraser', 'E': 'eraser' };
  if (toolKeys[e.key] && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    setDrawTool(toolKeys[e.key]);
  }
});

