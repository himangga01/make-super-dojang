// 의존성 없는 로컬 정적 서버: node scripts/serve.mjs [port]
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const realRoot = await realpath(root);
const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
// 일부 셸이 HOST 를 자동으로 내보내므로 전용 변수만 본다
const host = process.env.SERVE_HOST ?? '127.0.0.1';
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
// 캐시 헤더가 없으면 Cloudflare가 JS·CSS를 4시간 캐시해서, 고친 HTML과 옛 모듈이 섞여 화면이 깨질 수 있다.
// 그래서 매번 확인(no-cache)하게 하고, 내용이 같으면 ETag로 304를 돌려줘 다시 받지 않게 한다.
const NO_STORE = { 'Cache-Control': 'no-store' };
const etagOf = (body) => `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`;
// If-None-Match 는 약한 비교: Cloudflare가 압축하면서 W/ 를 붙여도 같은 것으로 본다
const sameTag = (header, etag) => header.split(',').some((t) => t.trim() === '*' || t.trim().replace(/^W\//, '') === etag);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(join(root, decodeURIComponent(url.pathname)));
    const rel = relative(root, path);
    // 루트 밖(이름이 비슷한 이웃 폴더 포함)과 .git 같은 점 파일은 막는다
    if (rel.startsWith('..') || isAbsolute(rel) || rel.split(/[\\/]/).some((seg) => seg.startsWith('.'))) {
      res.writeHead(403, NO_STORE).end();
      return;
    }
    // DNS 리바인딩 막기: 로컬 주소로 들어온 요청만 받는다 (SERVE_HOST 로 바꾸면 검사하지 않는다)
    if (!process.env.SERVE_HOST && !allowedHosts.has(req.headers.host ?? '')) {
      res.writeHead(421, NO_STORE).end();
      return;
    }
    if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html');
    // 저장소 안의 심볼릭 링크가 루트 밖을 가리키면 막는다
    const real = await realpath(path);
    const realRel = relative(realRoot, real);
    if (realRel.startsWith('..') || isAbsolute(realRel)) {
      res.writeHead(403, NO_STORE).end();
      return;
    }
    path = real;
    const body = await readFile(path);
    const etag = etagOf(body);
    if (sameTag(req.headers['if-none-match'] ?? '', etag)) {
      res.writeHead(304, { 'Cache-Control': 'no-cache', ETag: etag }).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
      ETag: etag,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE }).end('Not found');
  }
}).listen(port, host, () => {
  console.log(`슈퍼도장: http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`);
});
