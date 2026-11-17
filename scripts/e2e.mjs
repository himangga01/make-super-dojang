// 브라우저 확인: node scripts/e2e.mjs [스크린샷 폴더]
// 로컬 서버를 띄우고 세 탭에서 생성·다운로드가 되는지, 투명 PNG 모서리가 투명한지 확인한다.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// 전역 설치된 playwright 도 찾도록 require 를 쓴다
const { chromium } = createRequire(import.meta.url)('playwright');

const outDir = process.argv[2] ?? 'e2e-output';
mkdirSync(outDir, { recursive: true });
const port = 8765;
const server = spawn(process.execPath, ['scripts/serve.mjs', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
// 로케일이 UTF-8 이 아니면 Chromium 이 한글 파일 이름을 'download' 로 바꿔 버린다
const browser = await chromium.launch({ proxy, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const context = await browser.newContext({ viewport: { width: 400, height: 860 }, acceptDownloads: true, ignoreHTTPSErrors: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failed = 0;
function check(cond, msg) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
}

/** PNG 파일의 크기와 네 모서리 알파값 */
async function inspectPng(path) {
  const b64 = readFileSync(path).toString('base64');
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const a = (x, y) => ctx.getImageData(x, y, 1, 1).data;
    return { w: img.width, h: img.height, corner: Array.from(a(0, 0)), corner2: Array.from(a(img.width - 1, img.height - 1)) };
  }, b64);
}

async function saveDownload(trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const path = join(outDir, dl.suggestedFilename());
  await dl.saveAs(path);
  return { path, name: dl.suggestedFilename() };
}

try {
  await page.goto(`http://localhost:${port}/`);

  // 1) 직접 서명
  const pad = await page.locator('#pad').boundingBox();
  await page.mouse.move(pad.x + 40, pad.y + pad.height * 0.7);
  await page.mouse.down();
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    await page.mouse.move(pad.x + 40 + t * (pad.width - 80), pad.y + pad.height * (0.5 + 0.25 * Math.sin(t * 9)), { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('#download').disabled, null, { timeout: 5000 }).catch(() => {});
  check(await page.locator('#download').isEnabled(), '직접 서명 후 다운로드 버튼 활성화');
  await page.screenshot({ path: join(outDir, '1-draw.png'), fullPage: true });
  let file = await saveDownload(() => page.click('#download'));
  let png = await inspectPng(file.path);
  check(/^서명_\d{8}\.png$/.test(file.name), `직접 서명 파일 이름: ${file.name}`);
  check(png.corner[3] === 0 && png.corner2[3] === 0, `투명 배경 모서리 알파 0 (${png.w}×${png.h})`);

  // 2) 서명 생성 (한글)
  await page.click('#tab-sign');
  await page.fill('#sign-name', '홍길동');
  await page.click('#panel-sign button[type="submit"]');
  await page.waitForSelector('#sign-results .card');
  check((await page.locator('#sign-results .card').count()) === 8, '한글 서명 후보 8개');
  check((await page.locator('#sign-results .card-warn').count()) === 0, '한글 서명 글꼴 모두 로드');
  await page.locator('#sign-results .card-select').nth(1).click();
  await page.click('[data-bg="#ffffff"]');
  file = await saveDownload(() => page.click('#download'));
  png = await inspectPng(file.path);
  check(file.name.startsWith('서명_홍길동_'), `서명 파일 이름: ${file.name}`);
  check(png.corner[3] === 255 && png.corner[0] === 255, '흰 배경 PNG 모서리 불투명 흰색');
  await page.screenshot({ path: join(outDir, '2-sign-ko.png'), fullPage: true });

  // 영문 서명 + 카드 바로 다운로드
  await page.click('[data-bg="transparent"]');
  await page.fill('#sign-name', 'Jane Doe');
  await page.waitForFunction(() => document.querySelectorAll('#sign-results .card').length === 8 && document.querySelector('#sign-results .card-label').textContent === 'Great Vibes');
  await page.check('#sign-flourish');
  check((await page.locator('#sign-results .card-warn').count()) === 0, '영문 서명 글꼴 모두 로드');
  file = await saveDownload(() => page.locator('#sign-results .card-dl').first().click());
  png = await inspectPng(file.path);
  check(file.name.startsWith('서명_Jane_Doe_') && png.corner[3] === 0, `카드 바로 다운로드: ${file.name}`);
  await page.screenshot({ path: join(outDir, '3-sign-en.png'), fullPage: true });

  // 영문 모드에 한글 입력 → 안내
  await page.click('#panel-sign .seg label:nth-child(3)');
  await page.fill('#sign-name', '홍길동');
  await page.waitForSelector('#sign-results .error');
  check(true, '영문 모드 한글 입력 안내');

  // 3) 도장 생성 (한글)
  await page.click('#tab-stamp');
  await page.fill('#stamp-name', '홍길동');
  await page.click('#panel-stamp button[type="submit"]');
  await page.waitForSelector('#stamp-results .card');
  check((await page.locator('#stamp-results .card').count()) === 12, '한글 도장 후보 12개');
  check((await page.locator('#stamp-results .card-warn').count()) === 0, '한글 도장 글꼴 모두 로드');
  await page.screenshot({ path: join(outDir, '4-stamp-ko.png'), fullPage: true });
  await page.locator('#stamp-results .card-select').nth(4).click();
  await page.check('input[name="res"][value="2.5"]');
  file = await saveDownload(() => page.click('#download'));
  png = await inspectPng(file.path);
  check(file.name.startsWith('도장_홍길동_') && png.corner[3] === 0 && png.w > 900, `도장 고해상도 투명 PNG (${png.w}×${png.h})`);

  await page.check('#stamp-texture');
  await page.selectOption('#stamp-order', 'vertical');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, '5-stamp-ko-texture.png'), fullPage: true });

  // 영문 도장
  await page.fill('#stamp-name', 'Jane Doe');
  await page.waitForFunction(() => document.querySelectorAll('#stamp-results .card').length === 8);
  check(await page.locator('#stamp-order').isHidden(), '영문 도장에서 한글 전용 옵션 숨김');
  await page.uncheck('#stamp-texture');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, '6-stamp-en.png'), fullPage: true });

  check(errors.length === 0, `콘솔 오류 없음 ${errors.length ? JSON.stringify(errors) : ''}`);
} catch (err) {
  console.error(err);
  failed++;
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
