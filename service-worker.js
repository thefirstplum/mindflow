// MindFlow 서비스 워커. 같은 출처의 앱 코드는 네트워크 우선이라 배포가 바로 반영되고,
// 캐시는 오프라인일 때만 쓴다.
// 설치된 PWA에서 옛 SW가 캐시를 붙잡고 있던 적이 있어서 install/activate 때 캐시를
// 전부 지우고 클라이언트에 reload 메시지를 보낸다.

const CACHE_NAME = 'mindflow-cache-v53';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // CACHE_NAME이 같아도 전부 비운다
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    );
    await self.clients.claim();
    // 옛 코드로 떠 있는 PWA/탭을 바로 새로고침시킨다
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      try { c.postMessage({ type: 'SW_RELOAD', reason: 'new-version' }); } catch {}
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET만 처리하고 나머지는 그대로 네트워크로 보낸다
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 구글 폰트는 캐시 우선. 교차 출처를 그냥 넘기면 캐시가 안 돼서 네트워크가
  // 불안할 때 한글이 시스템 폰트로 떨어졌다. 고운바탕은 서브셋 파일이 많아 CDN을 쓰고
  // 여기서 캐시한다. 폰트 URL엔 버전이 들어 있어 캐시 우선이어도 안전하다.
  if (url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(req);
      if (hit) return hit;
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    })());
    return;
  }

  // 나머지 교차 출처(Drive, GSI 등)는 그대로 통과
  if (url.origin !== self.location.origin) return;

  // manifest는 캐시하지 않는다
  if (url.pathname.endsWith('/manifest.json')) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: 'no-cache' });
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (e) {
      // 오프라인이면 마지막으로 캐시한 사본
      const cached = await caches.match(req);
      if (cached) return cached;
      throw e;
    }
  })());
});

// 집중 타이머 알림을 누르면 열린 창으로 포커스, 없으면 새로 연다
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      if ('focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});

// main.js가 대기 중인 새 SW에 SKIP_WAITING을 보내면 바로 활성화한다
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
