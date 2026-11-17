// 오프라인 지원. 앱 파일은 네트워크 우선(새 버전을 바로 받음), 느리거나 실패하면 캐시를 쓴다.
// 글꼴은 한 번 받은 뒤 캐시에서 바로 쓴다. 실패한 응답은 캐시하지 않는다.
const VERSION = 'v3';
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
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
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

async function networkFirst(event, request) {
  const cached = caches.match(request, { ignoreSearch: true });
  const network = fetch(request).then((res) => {
    if (res.ok) {
      // 본문을 읽기 전에 복제해야 한다 (응답을 돌려준 뒤에는 복제할 수 없다)
      const copy = res.clone();
      event.waitUntil(caches.open(APP_CACHE).then((c) => c.put(request, copy)));
    }
    return res;
  });
  network.catch(() => {}); // 캐시로 응답한 뒤 네트워크가 실패해도 처리되지 않은 거부로 남지 않게
  // 네트워크가 느리면 캐시로 먼저 띄운다
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    return (await cached) ?? (await network);
  } catch {
    const hit = await cached;
    if (hit) return hit;
    throw new Error('offline');
  }
}
