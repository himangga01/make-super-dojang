// 브라우저 확인: node scripts/e2e.mjs [결과 폴더]
// 로컬 서버를 띄우고 모든 탭의 생성·저장 흐름을 실제 브라우저에서 확인한다.
import { spawn, execFileSync } from 'node:child_process';
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

/** 이미지 파일의 크기와 지정한 점들의 RGBA (음수 좌표는 오른쪽·아래 끝에서) */
async function inspectImage(path, points = [[0, 0]]) {
  const b64 = readFileSync(path).toString('base64');
  const type = path.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  return page.evaluate(async ({ src, type, points }) => {
    const img = new Image();
    img.src = `data:${type};base64,${src}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = points.map(([x, y]) => Array.from(ctx.getImageData(x < 0 ? img.width + x : x, y < 0 ? img.height + y : y, 1, 1).data));
    return { w: img.width, h: img.height, px };
  }, { src: b64, type, points });
}

async function saveDownload(trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const path = join(outDir, dl.suggestedFilename());
  await dl.saveAs(path);
  return { path, name: dl.suggestedFilename() };
}

/** 브라우저 안에서 테스트용 이미지를 만들어 파일 버퍼로 돌려준다 */
async function makeImage(kind) {
  const b64 = await page.evaluate((kind) => {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (kind === 'photo') {
      // 그늘진 종이에 쓴 서명 사진 흉내
      c.width = 900;
      c.height = 500;
      const g = ctx.createLinearGradient(0, 0, 900, 500);
      g.addColorStop(0, '#9a958c');
      g.addColorStop(1, '#f4f1ea');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 900, 500);
      ctx.strokeStyle = '#1a2a6c';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(150, 320);
      ctx.bezierCurveTo(250, 80, 330, 420, 430, 220);
      ctx.bezierCurveTo(520, 60, 600, 380, 760, 260);
      ctx.stroke();
      for (let i = 0; i < 300; i++) { // 종이 잡티
        ctx.fillStyle = 'rgba(80,70,60,0.5)';
        ctx.fillRect(Math.random() * 900, Math.random() * 500, 1, 1);
      }
    } else {
      c.width = 1240;
      c.height = 1754;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#222';
      ctx.font = 'bold 60px sans-serif';
      ctx.fillText('계약서', 520, 200);
      ctx.font = '28px sans-serif';
      for (let i = 0; i < 20; i++) ctx.fillRect(140, 320 + i * 50, 960, 6);
      ctx.fillText('서명:', 700, 1500);
    }
    return c.toDataURL(kind === 'photo' ? 'image/jpeg' : 'image/png').split(',')[1];
  }, kind);
  return Buffer.from(b64, 'base64');
}

try {
  await page.goto(`http://localhost:${port}/`);

  // ── 1) 직접 서명: 그리기
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
  let file = await saveDownload(() => page.click('#download'));
  let img = await inspectImage(file.path, [[0, 0], [-1, -1]]);
  check(/^서명_\d{8}\.png$/.test(file.name), `직접 서명 파일 이름: ${file.name}`);
  check(img.px.every((p) => p[3] === 0), `투명 배경 모서리 알파 0 (${img.w}×${img.h})`);
  await page.click('#save-library');
  await page.waitForSelector('#library-grid .lib-item');
  check((await page.locator('#library-grid .lib-item').count()) === 1, '보관함 저장');
  await page.screenshot({ path: join(outDir, '1-draw.png'), fullPage: true });

  // ── 2) 직접 서명: 사진에서 가져오기
  await page.click('#panel-draw .seg label:nth-child(2)');
  await page.setInputFiles('#photo-file', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: await makeImage('photo') });
  await page.waitForFunction(() => document.querySelector('#preview canvas'), null, { timeout: 10000 });
  file = await saveDownload(() => page.click('#download'));
  img = await inspectImage(file.path, [[0, 0], [-1, -1], [2, -3]]);
  check(img.px.every((p) => p[3] === 0), `사진 서명 배경 제거 (${img.w}×${img.h})`);
  check(img.w > 400 && img.w < 900 && img.h < 450, '사진 서명 영역만 잘라냄');
  await page.screenshot({ path: join(outDir, '2-photo.png'), fullPage: true });

  // ── 3) 서명 생성
  await page.click('#tab-sign');
  await page.fill('#sign-name', '홍길동');
  await page.click('#panel-sign button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('#sign-results .card').length === 24);
  check(true, '한글 서명 형태 24가지');
  check((await page.locator('#sign-results .card-warn').count()) === 0, '한글 서명 글꼴 모두 로드');
  await page.locator('#sign-results .card-select').nth(4).click();
  await page.click('[data-bg="#ffffff"]');
  file = await saveDownload(() => page.click('#download'));
  img = await inspectImage(file.path);
  check(file.name.startsWith('서명_홍길동_') && img.px[0][0] === 255 && img.px[0][3] === 255, `흰 배경 서명: ${file.name}`);
  await page.click('[data-bg="transparent"]');
  file = await saveDownload(() => page.click('#sign-zip'));
  const zipList = execFileSync('unzip', ['-Z1', file.path]).toString().trim().split('\n');
  execFileSync('unzip', ['-tq', file.path]);
  check(zipList.length === 24 && zipList[0].endsWith('.png'), `서명 전체 ZIP: ${file.name} (${zipList.length}개)`);
  await page.screenshot({ path: join(outDir, '3-sign-ko.png'), fullPage: true });

  await page.fill('#sign-name', 'Jane Doe');
  await page.waitForFunction(() => document.querySelector('#sign-results .card-label')?.textContent.startsWith('Classic'));
  check((await page.locator('#sign-results .card').count()) === 24, '영문 서명 형태 24가지');
  check((await page.locator('#sign-results .card-warn').count()) === 0, '영문 서명 글꼴 모두 로드');
  file = await saveDownload(() => page.locator('#sign-results .card-dl').nth(21).click());
  check(file.name.startsWith('서명_Jane_Doe_'), `카드 바로 다운로드: ${file.name}`);

  // ── 4) 도장 생성
  await page.click('#tab-stamp');
  await page.fill('#stamp-name', '홍길동');
  await page.click('#panel-stamp button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('#stamp-results .card').length === 97);
  check(true, '한글 도장 97가지');
  check((await page.locator('#stamp-results .card-warn').count()) === 0, '한글 도장 글꼴 모두 로드');
  await page.screenshot({ path: join(outDir, '4-stamp-ko.png'), fullPage: true });
  await page.click('#stamp-cats [data-cat="office"]');
  await page.waitForFunction(() => document.querySelectorAll('#stamp-results .card').length === 4);
  check(true, '분류 필터 (날짜·결재 4가지)');
  await page.locator('#stamp-results .card-select').nth(0).click();
  await page.check('input[name="res"][value="2.5"]');
  file = await saveDownload(() => page.click('#download'));
  img = await inspectImage(file.path);
  check(file.name.startsWith('도장_홍길동_') && img.px[0][3] === 0 && img.w > 900, `날짜 도장 고해상도 투명 PNG (${img.w}×${img.h})`);
  await page.click('#save-library');
  await page.waitForFunction(() => document.querySelectorAll('#library-grid .lib-item').length === 2);
  check(true, '도장 보관함 저장');
  await page.click('#stamp-cats [data-cat="ring"]');
  await page.waitForFunction(() => document.querySelectorAll('#stamp-results .card').length === 23);
  check(true, '분류 필터 (둘레글자 23가지)');
  await page.click('#stamp-cats [data-cat="seal"]');
  await page.waitForFunction(() => document.querySelectorAll('#stamp-results .card').length === 25);
  check(true, '분류 필터 (인장체 25가지)');
  const sealSubs = await page.locator('#stamp-results .card-label .sub').allTextContents();
  check(sealSubs.length === 25 && sealSubs.every((t) => t === '인장체' || t === '인감체'), `인장체 카드 이름표 (${sealSubs.join(', ')})`);

  await page.click('#stamp-cats [data-cat="all"]');
  await page.check('#stamp-texture');
  await page.check('#stamp-bleed');
  await page.click('details.more summary');
  await page.locator('#stamp-rotation').fill('-8');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, '5-stamp-effects.png'), fullPage: true });

  await page.fill('#stamp-name', 'Jane Doe');
  await page.waitForFunction(() => document.querySelectorAll('#stamp-results .card').length === 97 && document.querySelector('#stamp-font').dataset.lang === 'en');
  check(await page.locator('#stamp-order').isHidden(), '영문 도장에서 한글 전용 옵션 숨김');
  check((await page.locator('#stamp-results .card-warn').count()) === 0, '영문 도장 글꼴 모두 로드');

  // ── 5) 문서에 넣기
  await page.click('#tab-doc');
  check(await page.locator('#export-panel').isHidden(), '문서 탭에서는 저장 패널 숨김');
  await page.setInputFiles('#doc-file', { name: 'contract.png', mimeType: 'image/png', buffer: await makeImage('doc') });
  await page.waitForSelector('#doc-stage.has-doc');
  await page.click('#doc-add [data-add="stamp"]');
  await page.click('#doc-add [data-add="draw"]');
  check((await page.locator('#doc-stage .overlay').count()) === 2, '문서에 도장·서명 올리기');
  await page.locator('#library-grid [data-act="doc"]').first().click();
  const libAdded = await page.waitForFunction(() => document.querySelectorAll('#doc-stage .overlay').length === 3, null, { timeout: 5000 }).then(() => true, () => false);
  check(libAdded, '보관함 항목 문서에 올리기');
  // 끌어서 옮기기 (넣을 때 화면이 부드럽게 스크롤되므로 멈출 때까지 기다린다)
  await page.waitForTimeout(900);
  const ov = await page.locator('#doc-stage .overlay').first().boundingBox();
  await page.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2);
  await page.mouse.down();
  await page.mouse.move(ov.x + ov.width / 2 - 60, ov.y + ov.height / 2 - 120, { steps: 5 });
  await page.mouse.up();
  const ov2 = await page.locator('#doc-stage .overlay').last().boundingBox(); // 선택하면 맨 위(마지막)로 간다
  check(Math.abs(ov2.x - (ov.x - 60)) < 3 && Math.abs(ov2.y - (ov.y - 120)) < 3, '올린 항목 끌어서 옮기기');
  await page.screenshot({ path: join(outDir, '6-doc.png'), fullPage: true });
  file = await saveDownload(() => page.click('#doc-download'));
  img = await inspectImage(file.path, [[5, 5]]);
  check(file.name.startsWith('contract_서명완료_') && img.w === 1240 && img.h === 1754 && img.px[0][0] === 255, `완성 문서 원본 해상도 (${file.name})`);

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
