// 의존성 없는 로컬 정적 서버: node scripts/serve.mjs [port]
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
      res.writeHead(403).end();
      return;
    }
    // DNS 리바인딩 막기: 로컬 주소로 들어온 요청만 받는다 (SERVE_HOST 로 바꾸면 검사하지 않는다)
    if (!process.env.SERVE_HOST && !allowedHosts.has(req.headers.host ?? '')) {
      res.writeHead(421).end();
      return;
    }
    if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html');
    // 저장소 안의 심볼릭 링크가 루트 밖을 가리키면 막는다
    const real = await realpath(path);
    const realRel = relative(realRoot, real);
    if (realRel.startsWith('..') || isAbsolute(realRel)) {
      res.writeHead(403).end();
      return;
    }
    path = real;
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, host, () => {
  console.log(`슈퍼도장: http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`);
});
