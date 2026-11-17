// 오프라인 지원. 앱 파일은 네트워크 우선(새 버전을 바로 받음), 느리거나 실패하면 캐시를 쓴다.
// 글꼴은 한 번 받은 뒤 캐시에서 바로 쓴다. 실패한 응답은 캐시하지 않는다.
const VERSION = 'v4';
const APP_CACHE = `super-dojang-app-${VERSION}`;
const FONT_CACHE = `super-dojang-fonts-${VERSION}`;
const NETWORK_TIMEOUT_MS = 4000;

const APP_FILES = [
  './',
  'index.html',
  'css/style.css',
  'manifest.webmanifest',
  'assets/favicon.svg',
  'assets/icon-192.png',
  'js/app.js',
  'js/fonts.js',
  'js/signature-styles.js',
  'js/signature-gen.js',
  'js/signature-pad.js',
  'js/stamp-gen.js',
  'js/exporter.js',
  'js/photo-import.js',
  'js/doc-composer.js',
  'js/library.js',
  'js/core/text.js',
  'js/core/geometry.js',
  'js/core/random.js',
  'js/core/image.js',
  'js/core/zip.js',
];

self.addEventListener('install', (event) => {
  // 브라우저 HTTP 캐시의 예전 파일을 피해 서버에서 새로 받는다
  const requests = APP_FILES.map((u) => new Request(u, { cache: 'reload' }));
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  const keep = new Set([APP_CACHE, FONT_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('super-dojang-') && !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        // 503 이나 차단 페이지가 한 번 캐시되면 글꼴이 영영 안 나오므로 성공한 응답만 저장한다
        if (res.ok) event.waitUntil(cache.put(request, res.clone()));
        return res;
      }),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(event, request));
  }
});

/** 정상 응답만 저장한다: 같은 출처, 리디렉트 아님, 200 (공용 와이파이 로그인 페이지 등이 앱으로 저장되지 않게) */
function cacheable(res) {
  return res.ok && res.type === 'basic' && !res.redirected;
}

/** 쿼리 문자열마다 따로 쌓이지 않게 주소만으로 저장한다 */
function cacheKey(request) {
  const url = new URL(request.url);
  url.search = '';
  return url.href;
}

async function networkFirst(event, request) {
  const key = cacheKey(request);
  const cached = caches.match(key);
  const network = fetch(request).then((res) => {
    if (cacheable(res)) {
      // 본문을 읽기 전에 복제한다. 응답이 끝난 뒤일 수 있어 waitUntil 대신 그냥 저장한다
      const copy = res.clone();
      caches.open(APP_CACHE).then((c) => c.put(key, copy)).catch(() => {});
    }
    return res;
  });
  network.catch(() => {});
  // 네트워크가 느리면 캐시로 먼저 띄운다
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    // 서버 오류(5xx 등)는 저장된 정상 사본이 있으면 그것을 보여 준다
    if (first && first.ok) return first;
    return (await cached) ?? first ?? (await network);
  } catch {
    const hit = await cached;
    if (hit) return hit;
    throw new Error('offline');
  }
}
