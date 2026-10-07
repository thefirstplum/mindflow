// 마인드맵이 하나도 없으면 시작용 맵을 만든다
if (mindmaps.length === 0) {
  const starter = {
    id: Date.now(),
    name: '내 첫 마인드맵',
    nodes: [],
    edges: [],
    idCounter: 1,
    pan: { x: 0, y: 0 },
    zoom: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const cx = 400, cy = 300;
  starter.nodes.push({ id: starter.idCounter++, text: '중심 주제', x: cx, y: cy, color: '#b58900' });
  starter.nodes.push({ id: starter.idCounter++, text: '아이디어 1', x: cx - 200, y: cy - 110, color: '#268bd2' });
  starter.nodes.push({ id: starter.idCounter++, text: '아이디어 2', x: cx + 200, y: cy - 110, color: '#dc322f' });
  starter.nodes.push({ id: starter.idCounter++, text: '아이디어 3', x: cx - 200, y: cy + 110, color: '#859900' });
  starter.nodes.push({ id: starter.idCounter++, text: '아이디어 4', x: cx + 200, y: cy + 110, color: '#d33682' });
  starter.edges.push({ from: 1, to: 2 }, { from: 1, to: 3 }, { from: 1, to: 4 }, { from: 1, to: 5 });
  mindmaps = [starter];
  activeMindmapId = starter.id;
  bindActiveMap();
  save('mindmaps', mindmaps);
  save('mm_active', activeMindmapId);
}
renderMindmapList();
drawMindMap();

applySettings();

// 1회 마이그레이션: 기존 메모 본문의 #해시태그를 태그 칩으로 추출
if (typeof migrateHashtagsFromContent === 'function') {
  try { migrateHashtagsFromContent(); } catch (e) { console.warn('hashtag migration failed:', e); }
}

// 1회 마이그레이션: journal_entries를 #일기 메모로 이전. 해시태그 마이그레이션 뒤에 실행
if (typeof migrateJournalToMemos === 'function') {
  try { migrateJournalToMemos(); } catch (e) { console.warn('journal migration failed:', e); }
}

// 집중 타이머 복원. 시작 시각만 저장하므로 앱 재시작/새로고침 후에도 경과가 정확함
if (typeof restorePomodoro === 'function') {
  try { restorePomodoro(); } catch (e) { console.warn('pomodoro restore failed:', e); }
}

// 일일 백업 (유휴 시간에, 24시간에 한 번까지)
if (typeof BackupService !== 'undefined') {
  BackupService.maybeDaily().catch(() => {});
}

// persistent storage가 없으면 iOS Safari가 7일 동안 안 쓴 사이트의 localStorage를 지울 수 있다.
if (typeof requestPersistentStorage === 'function') {
  requestPersistentStorage().catch(() => {});
}

// manifest.json의 PWA 바로가기와 공유 대상 처리
// (?action=new-memo, ?page=calendar, ?share_title=...&share_text=...)
(function handleLaunchParams() {
  try {
    const u = new URL(location.href);
    const action = u.searchParams.get('action');
    const page = u.searchParams.get('page');
    const shareTitle = u.searchParams.get('share_title');
    const shareText = u.searchParams.get('share_text');
    const shareUrl = u.searchParams.get('share_url');
    let handled = false;
    if (action === 'new-memo' || shareText || shareTitle || shareUrl) {
      // memo.js 초기화가 끝난 뒤에 실행
      setTimeout(() => {
        if (typeof navigateTo === 'function') navigateTo('memo', { updateHash: false });
        if (typeof createMemo === 'function') {
          createMemo();
          if (shareText || shareTitle || shareUrl) {
            const m = memos.find(x => x.id === activeMemoId);
            if (m) {
              if (shareTitle) m.title = shareTitle;
              const bodyParts = [];
              if (shareText) bodyParts.push(shareText);
              if (shareUrl) bodyParts.push(shareUrl);
              if (bodyParts.length) m.content = bodyParts.join('\n\n');
              saveMemos();
              renderMemoEditor();
              renderMemoList();
            }
          }
        }
      }, 30);
      handled = true;
    } else if (action === 'new-mindmap') {
      setTimeout(() => {
        if (typeof navigateTo === 'function') navigateTo('memo', { updateHash: false });
        if (typeof createMindmap === 'function') createMindmap();
      }, 30);
      handled = true;
    } else if (page) {
      setTimeout(() => {
        if (typeof navigateTo === 'function') navigateTo(page, { updateHash: false });
      }, 30);
      handled = true;
    }
    if (handled) {
      // 새로고침해도 같은 동작이 다시 실행되지 않게
      const clean = location.pathname + location.hash;
      history.replaceState(null, '', clean);
    }
  } catch (e) { console.warn('launch param handler:', e); }
})();

// Service worker: network-first + auto skipWaiting + reload로 새 배포 즉시 적용
if ('serviceWorker' in navigator) {
  // GitHub Pages 하위 경로에서도 되도록 상대 경로
  navigator.serviceWorker.register('./service-worker.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) {
      reg.waiting.postMessage('SKIP_WAITING');
    }

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          sw.postMessage('SKIP_WAITING');
        }
      });
    });

    // 새 SW가 페이지를 잡으면 1회 reload
    let _reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_reloaded) return;
      _reloaded = true;
      // 입력 중이면 커서를 잃지 않게 blur까지 미룸 (본문은 즉시 저장되므로 손실 없음)
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) {
        if (typeof toast === 'function') toast('새 버전 대기 중 — 입력 끝나면 자동 적용', 'success');
        const reload = () => location.reload();
        el.addEventListener('blur', reload, { once: true });
        setTimeout(reload, 30000); // 30초 후엔 무조건 reload
      } else {
        location.reload();
      }
    });

    // 브라우저 기본 업데이트 체크는 24h 주기라 standalone PWA에선 너무 늦음.
    // 탭이 보이거나 포커스될 때마다 확인
    const checkUpdate = () => { try { reg.update(); } catch {} };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkUpdate();
    });
    window.addEventListener('focus', checkUpdate);
    checkUpdate();
  }).catch((e) => console.warn('SW register failed:', e));

  // controllerchange를 못 잡는 경우 대비해 SW가 보내는 reload 신호도 받음
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SW_RELOAD') {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (!typing) {
        setTimeout(() => location.reload(), 100);
      }
    }
  });
}

// 동기화 이벤트를 화면에 반영. 동기화 엔진은 렌더러를 모른다.
if (window.SyncEvents) {
  SyncEvents.on('itemsMerged', ({ types, editingMemoId, focusedEl, focusSel }) => {
    if (types.includes('mindmap')) {
      if (typeof renderMindmapList === 'function') renderMindmapList();
      if (typeof drawMindMap === 'function') drawMindMap();
      // 머지로 태그가 바뀌었을 수 있다. 태그 입력 중이면 건너뜀
      const ae = document.activeElement;
      if (typeof renderMindmapTags === 'function' && !(ae && ae.id === 'mm-tag-input')) {
        renderMindmapTags();
      }
    }
    if (types.includes('memo')) {
      if (typeof renderMemoList === 'function') renderMemoList();
      // 편집 중엔 에디터를 다시 그리지 않는다. 커서가 날아간다
      if (editingMemoId == null && typeof renderMemoEditor === 'function') renderMemoEditor();
    }
    // 홈/캘린더에 머무는 중 동기화가 오면 navigateTo가 안 불리므로 여기서 다시 그림
    const notesChanged = types.includes('memo') || types.includes('mindmap');
    if (currentPage === 'home' && typeof renderHome === 'function' && notesChanged) {
      renderHome();
    }
    if (currentPage === 'calendar' && typeof renderCalendar === 'function' && notesChanged) {
      renderCalendar();
    }
    // 다시 그리면서 잃은 포커스와 선택 영역 복원
    if (focusedEl && focusedEl.isConnected) {
      try {
        focusedEl.focus();
        if (focusSel && focusedEl.setSelectionRange) {
          focusedEl.setSelectionRange(focusSel.start, focusSel.end);
        }
      } catch {}
    }
  });
}

// 모바일 소프트 키보드
// iOS는 키보드가 떠도 레이아웃 뷰포트(100dvh)를 안 줄이고, html/body가
// overflow:hidden이라 메모 아래쪽 입력 지점이 키보드에 가려짐.
// visualViewport로 가려진 높이를 --kb에 넣고 CSS가 .app을 줄이면
// CodeMirror가 알아서 캐럿을 스크롤해 보여준다.
(function initKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;

  // 주소창/툴바(보통 50~110px)와 키보드(수백 px)를 구분하는 기준
  const MIN_KB = 120;
  let raf = 0;

  // 편집 요소에 포커스가 없으면 뷰포트 변화는 키보드가 아니라 주소창/툴바.
  // 이 체크가 없으면 안드로이드에서 스크롤만 해도 하단 탭바가 사라진다.
  function editableFocused() {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    return el.isContentEditable
      || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
  }

  function apply() {
    raf = 0;
    // 레이아웃 높이 - (보이는 높이 + 위로 밀린 양) = 아래쪽이 가려진 양
    const occluded = window.innerHeight - vv.height - vv.offsetTop;
    const kb = (editableFocused() && occluded >= MIN_KB) ? Math.round(occluded) : 0;
    document.documentElement.style.setProperty('--kb', kb + 'px');
    document.body.classList.toggle('kb-open', kb > 0);
  }

  // 키보드 애니메이션 중 resize/scroll이 연속으로 오므로 프레임당 1회
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };

  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  // blur 직후엔 뷰포트가 아직 안 돌아왔을 수 있어서 300ms 뒤 한 번 더 확인
  document.addEventListener('focusin', schedule, true);
  document.addEventListener('focusout', () => { schedule(); setTimeout(apply, 300); }, true);
  apply();
})();

// Drive 동기화 (전에 연결했으면 조용히 재인증하고 pull)
initDrive();
updateHeaderSyncPill();

// URL 해시로 페이지 복원. 모든 페이지 렌더러가 정의된 뒤여야 해서
// navigation.js 대신 여기서 부른다.
if (typeof initRoute === 'function') initRoute();
