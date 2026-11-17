// 오프라인 지원. 앱 파일은 네트워크 우선(새 버전을 바로 받음), 실패하면 캐시를 쓴다.
// 글꼴은 한 번 받은 뒤 캐시에서 바로 쓴다.
const VERSION = 'v2';
const APP_CACHE = `super-dojang-app-${VERSION}`;
const FONT_CACHE = 'super-dojang-fonts';

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
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('super-dojang-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
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
        if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) caches.open(APP_CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true })),
    );
  }
});
