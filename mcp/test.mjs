#!/usr/bin/env node
// 슈퍼도장 MCP 서버 종단 간 테스트.   실행: cd mcp && npm test   (또는 node mcp/test.mjs)
//   1) 로컬 stdio 모드: 모든 도구, 사진 입력, 문서에 넣기, 입력 오류
//   2) 원격 HTTP 모드(기본 7612번): 다운로드·업로드 링크, Host 검사, SSRF 막기, 호출 제한(마지막)
// 진짜 헤드리스 Chrome 과 진짜 서버 프로세스를 쓰므로 몇십 초 걸린다. 실패가 하나라도 있으면 종료 코드 1.
//
// 환경 변수
//   DOJANG_TEST_DIR   결과·픽스처를 둘 폴더(없으면 시스템 임시 폴더에 만들고 끝나면 지운다)
//   DOJANG_TEST_PORT  HTTP 테스트 포트(기본 7612). 운영 포트 7547~7550 은 거부한다
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, inflateSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium } from 'playwright-core';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const HTTP_PORT = Number(process.env.DOJANG_TEST_PORT ?? 7612);
if (!Number.isInteger(HTTP_PORT) || (HTTP_PORT >= 7547 && HTTP_PORT <= 7550)) {
  console.error(`포트 ${process.env.DOJANG_TEST_PORT ?? HTTP_PORT} 는 쓸 수 없어요 (7547~7550 은 운영 포트).`);
  process.exit(2);
}
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HANGUL = /[가-힣]/;

const EXPECTED_TOOLS = ['list_styles', 'preview_signatures', 'create_signature', 'preview_stamps', 'create_stamp', 'download_all', 'signature_from_photo', 'draw_signature', 'place_on_document'];

// ───────────── 결과 기록 ─────────────

let passed = 0;
let failed = 0;
let warned = 0;
const failures = [];
let currentSection = '';

function check(label, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push({ section: currentSection, label, detail });
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`);
  }
  return Boolean(cond);
}
function warn(label, detail = '') {
  warned++;
  console.log(`  WARN  ${label}${detail ? `  — ${detail}` : ''}`);
}
const info = (line) => console.log(`        ${line}`);

async function section(title, fn) {
  currentSection = title;
  console.log(`\n== ${title}`);
  try {
    await fn();
  } catch (err) {
    check('section ran to the end without an exception', false, err?.stack ?? String(err));
  }
}

// ───────────── 이미지 바이트 읽기 (외부 라이브러리 없이) ─────────────

const isPng = (b) => b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isJpeg = (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;

/** PNG → { width, height, data: RGBA 바이트 }. 8비트·비인터레이스만 */
function decodePng(buf) {
  if (!isPng(buf)) throw new Error('PNG 시그니처가 아니에요');
  let pos = 8;
  let ihdr = null;
  const idat = [];
  let sawIend = false;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], ctype: body[9], interlace: body[12] };
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') { sawIend = true; break; }
    pos += 12 + len;
  }
  if (!ihdr || !sawIend) throw new Error('IHDR 또는 IEND 가 없어요');
  if (ihdr.depth !== 8 || ihdr.interlace !== 0) throw new Error(`지원하지 않는 PNG (depth ${ihdr.depth}, interlace ${ihdr.interlace})`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.ctype];
  if (!channels) throw new Error(`지원하지 않는 색 형식 ${ihdr.ctype}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * channels;
  if (raw.length !== (stride + 1) * ihdr.height) throw new Error('픽셀 데이터 길이가 맞지 않아요');
  const px = Buffer.alloc(stride * ihdr.height);
  for (let y = 0; y < ihdr.height; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= channels ? px[y * stride + i - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= channels && y > 0 ? px[(y - 1) * stride + i - channels] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + i] = v & 255;
    }
  }
  const rgba = Buffer.alloc(ihdr.width * ihdr.height * 4);
  for (let i = 0, n = ihdr.width * ihdr.height; i < n; i++) {
    const s = i * channels;
    if (ihdr.ctype === 6) px.copy(rgba, i * 4, s, s + 4);
    else if (ihdr.ctype === 2) { rgba[i * 4] = px[s]; rgba[i * 4 + 1] = px[s + 1]; rgba[i * 4 + 2] = px[s + 2]; rgba[i * 4 + 3] = 255; }
    else if (ihdr.ctype === 0) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = px[s]; rgba[i * 4 + 3] = 255; }
    else { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = px[s]; rgba[i * 4 + 3] = px[s + 1]; }
  }
  return { width: ihdr.width, height: ihdr.height, data: rgba };
}

function jpegSize(buf) {
  let p = 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const m = buf[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
    p += 2 + buf.readUInt16BE(p + 2);
  }
  return null;
}

const rgbaAt = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]; };

function alphaStats(img) {
  let clear = 0;
  let solid = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const a = img.data[i * 4 + 3];
    if (a === 0) clear++;
    else if (a >= 200) solid++;
  }
  return { total: n, clear, solid, clearFrac: clear / n };
}

/** 불투명(alpha 255)인 픽셀들의 평균 색 */
function solidMeanColor(img) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    if (img.data[i * 4 + 3] === 255) { r += img.data[i * 4]; g += img.data[i * 4 + 1]; b += img.data[i * 4 + 2]; n++; }
  }
  return n ? [r / n, g / n, b / n].map(Math.round) : null;
}

const near = (a, b, tol) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const corners = (img) => [rgbaAt(img, 0, 0), rgbaAt(img, img.width - 1, 0), rgbaAt(img, 0, img.height - 1), rgbaAt(img, img.width - 1, img.height - 1)];

/** 저장 방식 ZIP(store) 읽기 */
function readZip(buf) {
  const out = { startsWithPK: buf.readUInt32LE(0) === 0x04034b50, entries: [], total: 0 };
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP 끝 기록(EOCD)을 찾지 못했어요');
  out.total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < out.total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 중앙 디렉터리가 깨졌어요');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = method === 0 ? buf.subarray(dataStart, dataStart + csize) : null;
    out.entries.push({ name, method, data, crcOk: data ? crc32(data) === crc : false });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ───────────── MCP 호출 도우미 ─────────────

const timings = []; // { mode, tool, ms, ok, cold }
const coldSeen = new Set();

function summarize(res) {
  const content = res.content ?? [];
  return {
    isError: Boolean(res.isError),
    text: content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'),
    images: content.filter((c) => c.type === 'image').map((c) => ({ mime: c.mimeType, buf: Buffer.from(c.data, 'base64') })),
    textBlocks: content.filter((c) => c.type === 'text').length,
    thrown: null,
  };
}

/** 도구를 부르고 시간을 잰다. 프로토콜 오류로 던져도 호출 쪽이 볼 수 있게 thrown 에 담는다 */
async function call(ctx, name, args, { timeout = 240_000, timed = true } = {}) {
  const t0 = performance.now();
  try {
    const res = summarize(await ctx.client.callTool({ name, arguments: args }, undefined, { timeout }));
    const cold = !coldSeen.has(ctx.mode) && name !== 'create_upload_link';
    if (cold) coldSeen.add(ctx.mode);
    if (timed) timings.push({ mode: ctx.mode, tool: name, ms: performance.now() - t0, ok: !res.isError, cold });
    return res;
  } catch (err) {
    return { isError: true, text: String(err?.message ?? err), images: [], textBlocks: 0, thrown: err };
  }
}

/** 응답 텍스트에서 저장 위치(경로 또는 다운로드 주소) */
const whereOf = (r) => /^(?:저장한 파일|다운로드 \(1시간 동안 유효\)): (.+)$/m.exec(r.text)?.[1]?.trim() ?? null;
const dimsOf = (r) => { const m = /(\d+)×(\d+)px/.exec(r.text); return m ? { width: +m[1], height: +m[2] } : null; };
const midOf = (r) => r.images[0]?.buf;
const fonts = (r) => (r.text.includes('주의: 글꼴') ? r.text.match(/주의: 글꼴\(([^)]*)\)/)?.[1] : null);

const fontWarnings = [];
function noteFonts(label, r) {
  const f = fonts(r);
  if (f) fontWarnings.push(`${label}: ${f}`);
}

/** 이미지 하나(PNG)가 올바른지: mimeType, 시그니처, 해독, 텍스트에 적힌 크기와 일치 */
function checkPng(label, r, { index = 0 } = {}) {
  const im = r.images[index];
  if (!check(`${label}: image content is present`, Boolean(im))) return null;
  let dec = null;
  let problem = '';
  if (im.mime !== 'image/png') problem = `mimeType ${im.mime}`;
  else if (!isPng(im.buf)) problem = 'no PNG magic bytes';
  else {
    try {
      dec = decodePng(im.buf);
    } catch (err) {
      problem = `does not decode: ${err.message}`;
    }
  }
  const d = dimsOf(r);
  if (dec && d && (d.width !== dec.width || d.height !== dec.height)) problem = `text says ${d.width}×${d.height}, png is ${dec.width}×${dec.height}`;
  check(`${label}: valid PNG (magic bytes, decodes${d ? ', size matches the text' : ''})${dec ? ` ${dec.width}×${dec.height}` : ''}`, !problem, problem);
  return problem ? null : dec;
}

// ───────────── 테스트 폴더 ─────────────

const userDir = process.env.DOJANG_TEST_DIR;
if (userDir) await mkdir(userDir, { recursive: true });
const WORK = await mkdtemp(join(userDir ?? tmpdir(), 'dojang-mcp-test-'));
const OUT_STDIO = join(WORK, 'out-stdio');
const OUT_HTTP = join(WORK, 'out-http');
await mkdir(OUT_STDIO, { recursive: true });
await mkdir(OUT_HTTP, { recursive: true });
console.log(`슈퍼도장 MCP 종단 간 테스트  (node ${process.version}, 작업 폴더 ${WORK})`);

// ───────────── 픽스처: 테스트용 Chrome 으로 사진·문서 이미지 만들기 ─────────────

let browser = null;
let pg = null; // about:blank 페이지 (이미지 만들기·픽셀 비교)
const fx = {}; // photo(서명 사진), doc(문서) 등

async function makeFixtures() {
  browser = await chromium.launch({ headless: true, ...(process.env.DOJANG_CHROME ? { executablePath: process.env.DOJANG_CHROME } : { channel: 'chrome' }) });
  pg = await browser.newPage();
  const gen = (fn, arg) => pg.evaluate(fn, arg);

  // 종이에 쓴 서명을 찍은 사진처럼: 살짝 어두운 그라데이션 + 잡음 + 어두운 획, JPEG
  fx.photo = Buffer.from(await gen(() => {
    const W = 900, H = 420;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#f7f4ee');
    grad.addColorStop(1, '#e9e4d8');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(60,50,40,${rnd() * 0.05})`; g.fillRect(rnd() * W, rnd() * H, 2, 2); }
    g.strokeStyle = '#1b1e26';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(90, 270); g.bezierCurveTo(140, 60, 230, 50, 260, 250); g.bezierCurveTo(285, 380, 340, 90, 410, 210);
    g.bezierCurveTo(450, 280, 480, 120, 540, 200); g.bezierCurveTo(600, 290, 650, 100, 790, 170);
    g.stroke();
    g.beginPath(); g.moveTo(120, 330); g.bezierCurveTo(300, 300, 560, 345, 800, 300); g.stroke();
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }), 'base64');

  // 내용이 없는 흰 사진 (서명이 없다는 오류를 보려는 것)
  fx.blank = Buffer.from(await gen(() => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 400, 200);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }), 'base64');

  // A4 비율 문서: 흰 바탕에 글줄
  const makeDoc = (w, h, type) => gen(({ w, h, type }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#222';
    g.textBaseline = 'top';
    const fs = Math.round(w / 44);
    g.font = `700 ${Math.round(fs * 1.6)}px "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    g.fillText('용역 계약서  Service Agreement', w * 0.1, h * 0.06);
    g.font = `400 ${fs}px "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    for (let i = 0; i < 18; i++) g.fillText(`제 ${i + 1} 조  갑과 을은 다음과 같이 계약을 체결하고 성실히 이행한다. The parties agree as follows (${i + 1}).`, w * 0.1, h * (0.14 + i * 0.026));
    g.fillText('갑 (서명 또는 인) : ______________________', w * 0.1, h * 0.8);
    g.fillText('을 (서명 또는 인) : ______________________', w * 0.1, h * 0.86);
    return c.toDataURL(type, 0.9).split(',')[1];
  }, { w, h, type });
  fx.doc = Buffer.from(await makeDoc(1240, 1754, 'image/jpeg'), 'base64');
  fx.docPng = Buffer.from(await makeDoc(600, 800, 'image/png'), 'base64');
  fx.docWebp = Buffer.from(await makeDoc(600, 800, 'image/webp'), 'base64');
  fx.docBig = Buffer.from(await gen(() => {
    const c = document.createElement('canvas');
    c.width = 4500; c.height = 3000;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 4500, 3000);
    g.fillStyle = '#333';
    g.font = '90px sans-serif';
    g.fillText('big document 4500x3000', 300, 400);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  }), 'base64');

  fx.photoPath = join(WORK, 'sign-photo.jpg');
  fx.docPath = join(WORK, '계약서.jpg');
  fx.docPngPath = join(WORK, '신청서.png');
  fx.blankPath = join(WORK, 'blank.jpg');
  fx.textPath = join(WORK, 'not-an-image.txt');
  await writeFile(fx.photoPath, fx.photo);
  await writeFile(fx.docPath, fx.doc);
  await writeFile(fx.docPngPath, fx.docPng);
  await writeFile(fx.blankPath, fx.blank);
  await writeFile(fx.textPath, '이것은 이미지가 아니라 글자 파일입니다.\nplain text, not an image\n');
}

/** 두 JPEG/PNG 의 같은 위치 직사각형에서 달라진 픽셀 비율 (한 채널이라도 threshold 넘게 다른 것) */
async function changedFraction(aBuf, bBuf, rect, threshold = 40) {
  return pg.evaluate(async ({ a, b, rect, threshold }) => {
    const load = async (s) => {
      const bin = atob(s);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return createImageBitmap(new Blob([u]));
    };
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const grab = (img) => {
      const c = new OffscreenCanvas(rect.w, rect.h);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
      return g.getImageData(0, 0, rect.w, rect.h).data;
    };
    const da = grab(ia);
    const db = grab(ib);
    let changed = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) > threshold || Math.abs(da[i + 1] - db[i + 1]) > threshold || Math.abs(da[i + 2] - db[i + 2]) > threshold) changed++;
    }
    return changed / (rect.w * rect.h);
  }, { a: aBuf.toString('base64'), b: bBuf.toString('base64'), rect, threshold });
}

// ───────────── 1. stdio ─────────────

const state = {}; // 단계 사이에 넘기는 값

async function runStdio() {
  const stderrLines = [];
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, DOJANG_OUT_DIR: OUT_STDIO }, stderr: 'pipe' });
  transport.stderr?.on('data', (d) => stderrLines.push(String(d)));
  const client = new Client({ name: 'dojang-e2e-stdio', version: '1.0.0' });
  const ctx = { client, mode: 'stdio' };
  const tConnect = performance.now();
  await client.connect(transport);
  const connectMs = performance.now() - tConnect;
  const savedFiles = []; // { tool, path }
  let styles = null;

  try {
    await section('stdio: tools/list', async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      check('exactly 9 tools', names.length === 9, `got ${names.length}: ${names.join(', ')}`);
      check('tool names match the expected 9', EXPECTED_TOOLS.every((n) => names.includes(n)) && names.every((n) => EXPECTED_TOOLS.includes(n)), names.join(', '));
      check('create_upload_link is absent in stdio mode', !names.includes('create_upload_link'));
      check('every tool has a description and an object input schema', tools.every((t) => t.description && t.inputSchema?.type === 'object'));
      const pfp = tools.find((t) => t.name === 'signature_from_photo')?.inputSchema.properties.image.properties ?? {};
      check('image input offers path (not upload_id) in stdio mode', 'path' in pfp && !('upload_id' in pfp), Object.keys(pfp).join(','));
      check('server identifies itself as super-dojang', client.getServerVersion()?.name === 'super-dojang');
      info(`initialize handshake ${Math.round(connectMs)}ms`);
    });

    await section('stdio: list_styles', async () => {
      const r = await call(ctx, 'list_styles', {});
      check('succeeds', !r.isError, r.text.slice(0, 200));
      try {
        styles = JSON.parse(r.text);
      } catch {
        check('returns JSON text', false, r.text.slice(0, 120));
        return;
      }
      const sig = styles.signatureStyles ?? {};
      check('signature styles for ko and en, non-empty', sig.ko?.length > 0 && sig.en?.length > 0, `ko=${sig.ko?.length} en=${sig.en?.length}`);
      check('signature style ids are unique per language', ['ko', 'en'].every((l) => new Set(sig[l].map((s) => s.id)).size === sig[l].length));
      const shapes = styles.stampShapes ?? [];
      check(`stamp shapes present (${shapes.length}), unique ids`, shapes.length > 0 && new Set(shapes.map((s) => s.id)).size === shapes.length);
      const catIds = new Set((styles.stampCategories ?? []).map((c) => c.id));
      check('every stamp shape belongs to a listed category', shapes.every((s) => catIds.has(s.category)), shapes.filter((s) => !catIds.has(s.category)).map((s) => s.id).join(','));
      check('stamp fonts for ko and en', styles.stampFonts?.ko?.length > 0 && styles.stampFonts?.en?.length > 0);
      check('dateLabels, inks, backgrounds, resolutions are listed', styles.dateLabels?.length > 0 && styles.inks && styles.backgrounds?.length > 0 && styles.resolutions);
      info(`signature styles ko=${sig.ko.length} en=${sig.en.length}, stamp shapes=${shapes.length}, categories=${[...catIds].join(',')}`);
      state.styles = styles;
      const sigOnly = JSON.parse((await call(ctx, 'list_styles', { kind: 'signature' })).text);
      check("kind='signature' omits stamp data", sigOnly.signatureStyles && !sigOnly.stampShapes);
      const stampOnly = JSON.parse((await call(ctx, 'list_styles', { kind: 'stamp' })).text);
      check("kind='stamp' omits signature data", stampOnly.stampShapes && !stampOnly.signatureStyles);
    });

    const S = state.styles;
    if (!S) throw new Error('list_styles 를 읽지 못해 나머지 단계를 진행할 수 없어요');
    const koIds = S.signatureStyles.ko.map((s) => s.id);
    const enIds = S.signatureStyles.en.map((s) => s.id);
    const shapeIds = S.stampShapes.map((s) => s.id);
    const koFont = S.stampFonts.ko[0].family;
    const dateShape = shapeIds.includes('date') ? 'date' : S.stampShapes.find((s) => s.category === 'special')?.id ?? shapeIds.at(-1);
    const squareShape = shapeIds.includes('square') ? 'square' : shapeIds[Math.min(12, shapeIds.length - 1)];

    const parseIds = (text) => [...text.matchAll(/^(\d+)\. .* — id: (\S+) \(/gm)].map((m) => ({ no: +m[1], id: m[2] }));

    const verifySaved = async (label, r, bytes) => {
      const p = whereOf(r);
      if (!check(`${label}: saved file path is reported`, Boolean(p), r.text.slice(-160))) return null;
      const st = await stat(p).catch(() => null);
      const problems = [];
      if (!p.startsWith(OUT_STDIO + '/')) problems.push('outside DOJANG_OUT_DIR');
      if (!st?.isFile() || !st.size) problems.push('missing or empty');
      else if (bytes && Buffer.compare(await readFile(p), bytes) !== 0) problems.push('bytes differ from the returned image');
      check(`${label}: saved in DOJANG_OUT_DIR${bytes ? ', same bytes as the returned image' : ''} (${basename(p)})`, !problems.length, `${problems.join(', ')} ${p}`);
      savedFiles.push(p);
      return p;
    };

    await section('stdio: preview_signatures', async () => {
      for (const [label, args, ids] of [
        ['ko 홍길동 (ink navy, slant 5, weight 1)', { name: '홍길동', ink: 'navy', slant: 5, weight: 1 }, koIds],
        ['en Jane Doe', { name: 'Jane Doe' }, enIds],
      ]) {
        const r = await call(ctx, 'preview_signatures', args);
        noteFonts(label, r);
        check(`${label}: succeeds`, !r.isError, r.text.slice(0, 200));
        check(`${label}: one image and one text block`, r.images.length === 1 && r.textBlocks === 1, `images=${r.images.length} texts=${r.textBlocks}`);
        const dec = checkPng(label, r);
        const listed = parseIds(r.text);
        check(`${label}: numbered id list length ${listed.length} equals list_styles (${ids.length})`, listed.length === ids.length);
        check(`${label}: ids are numbered 1..N in list_styles order`, listed.every((x, i) => x.no === i + 1 && x.id === ids[i]));
        check(`${label}: header says ${ids.length}가지`, r.text.includes(`${ids.length}가지`), r.text.split('\n')[0]);
        if (dec) {
          const cols = Math.min(4, ids.length);
          check(`${label}: sheet is ${cols * 300}×${Math.ceil(ids.length / cols) * 190}`, dec.width === cols * 300 && dec.height === Math.ceil(ids.length / cols) * 190, `${dec.width}×${dec.height}`);
          check(`${label}: sheet has ink (not blank)`, dec.data.some((v, i) => i % 4 === 0 && v < 200));
        }
      }
    });

    await section('stdio: create_signature', async () => {
      // 투명(기본), normal vs high 해상도
      const base = { name: '홍길동', style: koIds[0], ink: 'navy' };
      const a = await call(ctx, 'create_signature', base);
      noteFonts('create_signature', a);
      check('ko default (transparent, normal): succeeds', !a.isError, a.text.slice(0, 200));
      const da = checkPng('ko transparent', a);
      state.sigPath = await verifySaved('ko transparent', a, midOf(a));
      state.sigPng = midOf(a);
      if (da) {
        check('transparent background: all 4 corners have alpha 0', corners(da).every((p) => p[3] === 0), JSON.stringify(corners(da)));
        const st = alphaStats(da);
        check('transparent background: has solid ink pixels', st.solid > 50, `solid=${st.solid}`);
        const col = solidMeanColor(da);
        check("ink 'navy' paints #1d2b64", col && near(col, [29, 43, 100], 28), `mean solid colour ${col}`);
        check('text mentions style id and font', a.text.includes(koIds[0]));
      }
      const hi = await call(ctx, 'create_signature', { ...base, resolution: 'high' });
      const dh = checkPng('ko high', hi);
      await verifySaved('ko high', hi, midOf(hi));
      if (da && dh) {
        const ratio = dh.width / da.width;
        check("resolution 'high' is about 2.5× wider", ratio > 2.2 && ratio < 2.8, `${da.width} → ${dh.width} (×${ratio.toFixed(2)})`);
      }

      // 배경: white / cream / hex
      for (const [bg, rgb] of [['white', [255, 255, 255]], ['cream', [253, 246, 227]], ['#ffeedd', [255, 238, 221]], ['#abc', [170, 187, 204]]]) {
        const r = await call(ctx, 'create_signature', { name: 'Jane Doe', style: enIds[Math.min(1, enIds.length - 1)], ink: '#1f5fd1', background: bg });
        noteFonts(`en bg ${bg}`, r);
        check(`en Jane Doe, background ${bg}: succeeds`, !r.isError, r.text.slice(0, 200));
        const d = checkPng(`en bg ${bg}`, r);
        await verifySaved(`en bg ${bg}`, r, midOf(r));
        if (d) {
          check(`background ${bg}: corners are exactly ${rgb} and opaque`, corners(d).every((p) => near(p.slice(0, 3), rgb, 1) && p[3] === 255), JSON.stringify(corners(d)[0]));
          check(`background ${bg}: no transparent pixel`, alphaStats(d).clear === 0);
        }
      }

      // 같은 날 같은 이름을 또 저장해도 덮어쓰지 않는다
      const names = new Set(savedFiles.filter((p) => /서명_홍길동_/.test(p)));
      check('same-day same-name saves get unique file names', names.size >= 2, [...names].map((p) => basename(p)).join(' | '));

      // 슬랜트·굵기·다른 형태 (실제 인자 조합)
      const r2 = await call(ctx, 'create_signature', { name: '홍길동', style: koIds[koIds.length - 1], slant: 12, weight: 2, background: 'white', resolution: 'high', ink: 'blue' });
      check('last ko style with slant 12, weight 2, white, high: succeeds', !r2.isError, r2.text.slice(0, 200));
      checkPng('slant/weight', r2);
      const r3 = await call(ctx, 'create_signature', { name: 'Abcdefghijklmn' }); // 14자 경계
      check('14-character name (boundary) is accepted; style omitted → first style', !r3.isError, r3.text.slice(0, 200));
    });

    await section('stdio: preview_stamps', async () => {
      const opts = { add_in: true, order: 'vertical', texture: true, bleed: true, rotation: 6, date: '2026-11-22', date_label: '결재' };
      const r = await call(ctx, 'preview_stamps', { name: '홍길동', ink: 'red', ...opts });
      noteFonts('preview_stamps ko', r);
      check('ko 홍길동 with add_in/vertical/texture/bleed/rotation/date/date_label: succeeds', !r.isError, r.text.slice(0, 200));
      check('one image and one text block', r.images.length === 1 && r.textBlocks === 1, `images=${r.images.length} texts=${r.textBlocks}`);
      const dec = checkPng('stamp sheet', r);
      const listed = parseIds(r.text);
      check(`numbered id list length ${listed.length} equals list_styles stamp shapes (${shapeIds.length})`, listed.length === shapeIds.length);
      check('ids are numbered 1..N in list_styles order', listed.every((x, i) => x.no === i + 1 && x.id === shapeIds[i]));
      check(`header says ${shapeIds.length}가지`, r.text.includes(`${shapeIds.length}가지`), r.text.split('\n')[0]);
      if (dec) {
        const cols = Math.min(4, shapeIds.length);
        const rows = Math.ceil(shapeIds.length / cols);
        check(`sheet is ${cols * 300}×${rows * 250}`, dec.width === cols * 300 && dec.height === rows * 250, `${dec.width}×${dec.height}`);
      }

      const cat = S.stampCategories[0].id;
      const inCat = S.stampShapes.filter((s) => s.category === cat).length;
      const rc = await call(ctx, 'preview_stamps', { name: 'Jane Doe', lang: 'en', category: cat });
      check(`category '${cat}' preview: succeeds, one image`, !rc.isError && rc.images.length === 1, rc.text.slice(0, 200));
      check(`category '${cat}' preview lists ${inCat} shapes`, parseIds(rc.text).length === inCat, `got ${parseIds(rc.text).length}`);
      check("category 'all' is the same as no category", parseIds((await call(ctx, 'preview_stamps', { name: '홍길동', category: 'all' })).text).length === shapeIds.length);
    });

    await section('stdio: create_stamp', async () => {
      const full = await call(ctx, 'create_stamp', { name: '홍길동', shape: squareShape, add_in: true, order: 'vertical', texture: true, bleed: true, rotation: 6, background: 'cream', resolution: 'high', ink: 'red', font: koFont });
      noteFonts('create_stamp full', full);
      check(`홍길동 ${squareShape} + add_in/vertical/texture/bleed/rotation/cream/high/font: succeeds`, !full.isError, full.text.slice(0, 200));
      const df = checkPng('full-option stamp', full);
      await verifySaved('full-option stamp', full, midOf(full));
      if (df) check('cream background applied (corners)', corners(df).every((p) => near(p.slice(0, 3), [253, 246, 227], 1) && p[3] === 255), JSON.stringify(corners(df)[0]));

      const date = await call(ctx, 'create_stamp', { name: '홍길동', shape: dateShape, date: '2026-11-22', date_label: '결재', ink: '#c0392b', background: '#ffffff' });
      check(`date stamp (${dateShape}) with date + date_label + hex ink + white: succeeds`, !date.isError, date.text.slice(0, 200));
      const dd = checkPng('date stamp', date);
      await verifySaved('date stamp', date, midOf(date));
      const date2 = await call(ctx, 'create_stamp', { name: '홍길동', shape: dateShape, date: '2026-11-23', date_label: '승인', ink: '#c0392b', background: '#ffffff' });
      check('different date/date_label gives different pixels', date2.images[0] && date.images[0] && Buffer.compare(date.images[0].buf, date2.images[0].buf) !== 0);
      if (dd) check('date stamp: white background applied', corners(dd).every((p) => near(p.slice(0, 3), [255, 255, 255], 1)));

      const en = await call(ctx, 'create_stamp', { name: 'Jane Doe', shape: 'circle-double', lang: 'en', date_label: 'APPROVED', background: '#fdf6e3' });
      check('en Jane Doe circle-double: succeeds', !en.isError, en.text.slice(0, 200));
      checkPng('en stamp', en);
      await verifySaved('en stamp', en, midOf(en));

      const plain = await call(ctx, 'create_stamp', { name: '홍길동' });
      check('only name: defaults to circle + red + transparent', !plain.isError && plain.text.includes('(circle'), plain.text.split('\n')[0]);
      const dp = checkPng('default stamp', plain);
      state.stampPng = midOf(plain);
      if (dp) {
        check('default stamp: transparent corners', corners(dp).every((p) => p[3] === 0));
        const col = solidMeanColor(dp);
        check('default ink is red (#d0201f)', col && near(col, [208, 32, 31], 30), `mean solid colour ${col}`);
      }

      // 옵션이 실제 그림에 반영되는지: 같은 인자를 두 번 그려 같으면 결정적, 그때만 옵션별로 달라지는지 본다
      const baseArgs = { name: '홍길동', shape: squareShape, ink: 'red' };
      const b1 = await call(ctx, 'create_stamp', baseArgs);
      const b2 = await call(ctx, 'create_stamp', baseArgs);
      const same = b1.images[0] && b2.images[0] && Buffer.compare(b1.images[0].buf, b2.images[0].buf) === 0;
      if (same) {
        check('rendering is deterministic (same args → same bytes)', true);
        for (const [label, extra] of [['add_in', { add_in: true }], ['order vertical (with add_in)', { add_in: true, order: 'vertical' }], ['rotation 8', { rotation: 8 }], ['font', { font: S.stampFonts.ko[S.stampFonts.ko.length - 1].family }]]) {
          const v = await call(ctx, 'create_stamp', { ...baseArgs, ...extra });
          const ref = label.startsWith('order') ? await call(ctx, 'create_stamp', { ...baseArgs, add_in: true }) : b1;
          check(`option ${label} changes the image`, !v.isError && v.images[0] && ref.images[0] && Buffer.compare(v.images[0].buf, ref.images[0].buf) !== 0, v.text.slice(0, 160));
        }
        for (const [label, extra] of [['texture', { texture: true }], ['bleed', { bleed: true }]]) {
          const v = await call(ctx, 'create_stamp', { ...baseArgs, ...extra });
          check(`option ${label} is accepted`, !v.isError && v.images.length === 1, v.text.slice(0, 160));
        }
      } else {
        warn('rendering is not byte-deterministic; skipped the "option changes the image" checks');
      }
    });

    await section('stdio: download_all (ZIP)', async () => {
      const wanted = [
        ['signature ko', { kind: 'signature', name: '홍길동', ink: 'blue', background: 'white' }, S.signatureStyles.ko.length],
        ['signature en', { kind: 'signature', name: 'Jane Doe' }, S.signatureStyles.en.length],
        ['stamp ko all shapes', { kind: 'stamp', name: '홍길동', add_in: true, order: 'vertical', texture: true, bleed: true, rotation: 4, date: '2026-11-22', date_label: '확인', background: '#fdf6e3' }, S.stampShapes.length],
        ['stamp category', { kind: 'stamp', name: 'Jane Doe', lang: 'en', category: S.stampCategories[0].id }, S.stampShapes.filter((s) => s.category === S.stampCategories[0].id).length],
      ];
      for (const [label, args, count] of wanted) {
        const r = await call(ctx, 'download_all', args);
        noteFonts(label, r);
        check(`${label}: succeeds`, !r.isError, r.text.slice(0, 200));
        check(`${label}: text-only result (no inline image)`, r.images.length === 0);
        check(`${label}: text says ${count}장`, r.text.includes(`후보 ${count}장`), r.text.split('\n')[0]);
        const p = await verifySaved(label, r);
        if (!p) continue;
        check(`${label}: file name ends with .zip`, p.endsWith('.zip'), basename(p));
        let z = null;
        try {
          z = readZip(await readFile(p));
        } catch (err) {
          check(`${label}: ZIP structure parses`, false, err.message);
          continue;
        }
        check(`${label}: starts with PK header`, z.startsWithPK);
        check(`${label}: entry count ${z.entries.length} equals candidates (${count})`, z.entries.length === count && z.total === count);
        check(`${label}: all entries stored with valid CRC`, z.entries.every((e) => e.method === 0 && e.crcOk));
        check(`${label}: every entry is a PNG with a unique .png name`, z.entries.every((e) => e.name.endsWith('.png') && e.data && isPng(e.data)) && new Set(z.entries.map((e) => e.name)).size === count, z.entries.find((e) => !e.name.endsWith('.png') || !(e.data && isPng(e.data)))?.name ?? '');
        check(`${label}: entries are numbered 01_ ...`, z.entries[0]?.name.startsWith('01_'), z.entries[0]?.name);
      }
    });

    await section('stdio: signature_from_photo', async () => {
      const analyze = (label, r, expectColor) => {
        check(`${label}: succeeds`, !r.isError, r.text.slice(0, 200));
        const d = checkPng(label, r);
        if (!d) return;
        const st = alphaStats(d);
        check(`${label}: background removed (${(st.clearFrac * 100).toFixed(0)}% fully transparent)`, st.clearFrac > 0.4, `clear=${st.clear}/${st.total}`);
        check(`${label}: strokes kept (${st.solid} solid px)`, st.solid > 100, `solid=${st.solid}`);
        if (expectColor) {
          const col = solidMeanColor(d);
          check(`${label}: ink colour ≈ ${expectColor.name}`, col && near(col, expectColor.rgb, 40), `mean solid colour ${col}`);
        }
      };
      const byPath = await call(ctx, 'signature_from_photo', { image: { path: fx.photoPath } });
      analyze('photo via path', byPath, { name: 'black', rgb: [17, 17, 17] });
      await verifySaved('photo via path', byPath, midOf(byPath));
      state.photoPng = midOf(byPath);
      const b64 = fx.photo.toString('base64');
      const byData = await call(ctx, 'signature_from_photo', { image: { data: b64 }, ink: 'red' });
      analyze('photo via base64 data', byData, { name: 'red', rgb: [208, 32, 31] });
      const byUri = await call(ctx, 'signature_from_photo', { image: { data: `data:image/jpeg;base64,${b64}` }, ink: '#1f5fd1', background: 'white', resolution: 'high', strength: 10 });
      check('photo via data: URI + blue + white + high + strength 10: succeeds', !byUri.isError, byUri.text.slice(0, 200));
      const du = checkPng('photo data-URI', byUri);
      if (du) check('white background applied', corners(du).every((p) => near(p.slice(0, 3), [255, 255, 255], 1) && p[3] === 255));
      const wrapped = await call(ctx, 'signature_from_photo', { image: { data: b64.replace(/(.{76})/g, '$1\n') } });
      check('base64 data with line breaks every 76 chars is accepted', !wrapped.isError && wrapped.images.length === 1, wrapped.text.slice(0, 160));
      const kc = await call(ctx, 'signature_from_photo', { image: { path: fx.photoPath }, keep_color: true });
      check('keep_color: succeeds', !kc.isError, kc.text.slice(0, 200));
      const dk = checkPng('keep_color', kc);
      if (dk) check('keep_color: transparent output', alphaStats(dk).clear > 0);
      if (byPath.images[0] && byData.images[0]) check('same photo via path and data gives the same shape (equal size when ink differs)', sameSize(byPath.images[0].buf, byData.images[0].buf));
      const blank = await call(ctx, 'signature_from_photo', { image: { path: fx.blankPath } });
      check('blank photo → isError with Korean message (no signature found)', blank.isError && HANGUL.test(blank.text) && !blank.thrown, blank.text.slice(0, 160));
    });

    await section('stdio: draw_signature', async () => {
      const strokes = [
        [[0, 60], [10, 30], [25, 5], [40, 30], [50, 60], [60, 30], [75, 5], [90, 30], [100, 60]],
        [[20, 45], [60, 48], [110, 40], [140, 44]],
        [[120, 20, 1.4], [125, 35, 1.2], [130, 50, 0.9]],
      ];
      const n = await call(ctx, 'draw_signature', { strokes, ink: 'blue' });
      check('strokes (incl. pressure value): succeeds', !n.isError, n.text.slice(0, 200));
      const dn = checkPng('draw normal', n);
      await verifySaved('draw normal', n, midOf(n));
      state.drawPng = midOf(n);
      if (dn) {
        check('transparent corners', corners(dn).every((p) => p[3] === 0));
        const col = solidMeanColor(dn);
        check('ink blue (#1f5fd1)', col && near(col, [31, 95, 209], 30), `mean solid colour ${col}`);
      }
      const h = await call(ctx, 'draw_signature', { strokes, ink: '#222222', pen_width: 5, background: 'cream', resolution: 'high' });
      check('pen_width 5 + cream + high: succeeds', !h.isError, h.text.slice(0, 200));
      const dh = checkPng('draw high', h);
      if (dn && dh) {
        const ratio = dh.width / dn.width;
        check("resolution 'high' is about 2.5× wider", ratio > 2.2 && ratio < 2.8, `${dn.width} → ${dh.width}`);
        check('cream background applied', corners(dh).every((p) => near(p.slice(0, 3), [253, 246, 227], 1) && p[3] === 255));
      }
    });

    await section('stdio: place_on_document', async () => {
      const W = 1240, H = 1754;
      check('fixture document is 1240×1754 JPEG', jpegSize(fx.doc)?.width === W && jpegSize(fx.doc)?.height === H);
      const items = [
        { kind: 'signature', name: '홍길동', ink: 'navy', x: 0.30, y: 0.80, width: 0.35 },
        { kind: 'stamp', name: '홍길동', shape: 'circle', add_in: true, rotation: 4, x: 0.74, y: 0.785, width: 0.15 },
        { kind: 'image', image: { path: state.sigPath }, x: 0.50, y: 0.50, width: 0.22 },
      ];
      const r = await call(ctx, 'place_on_document', { document: { path: fx.docPath }, items });
      noteFonts('place_on_document', r);
      check('signature + stamp + image(path) on a 1240×1754 JPEG: succeeds', !r.isError, r.text.slice(0, 300));
      check('one inline image', r.images.length === 1);
      const prev = r.images[0];
      if (prev) {
        check('inline preview is JPEG (mimeType and magic bytes)', prev.mime === 'image/jpeg' && isJpeg(prev.buf), `mime=${prev.mime}`);
        const ps = jpegSize(prev.buf);
        check(`preview long side ≤ 1600 (${ps?.width}×${ps?.height})`, ps && Math.max(ps.width, ps.height) <= 1600);
        check('preview keeps the aspect ratio', ps && Math.abs(ps.width / ps.height - W / H) < 0.01);
      }
      const p = await verifySaved('placed document', r);
      let full = null;
      if (p) {
        full = await readFile(p);
        check('saved file is a .jpg and a valid JPEG', p.endsWith('.jpg') && isJpeg(full), basename(p));
        const fs = jpegSize(full);
        check(`saved file keeps the input size ${W}×${H}`, fs?.width === W && fs?.height === H, `${fs?.width}×${fs?.height}`);
        check('saved name starts with the input name (계약서_서명완료_)', basename(p).startsWith('계약서_서명완료_'), basename(p));
      }
      check('text header reports the input size', r.text.includes(`${W}×${H}px`), r.text.split('\n')[0]);
      const placed = [...r.text.matchAll(/^(\d+)\. (\w+) — 위치 \((-?\d+), (-?\d+)\) 크기 (\d+)×(\d+)px/gm)].map((m) => ({ kind: m[2], x: +m[3], y: +m[4], w: +m[5], h: +m[6] }));
      check('placement list has 3 entries in order (signature, stamp, image)', placed.map((q) => q.kind).join() === 'signature,stamp,image', placed.map((q) => q.kind).join());
      for (const [i, it] of items.entries()) {
        const q = placed[i];
        if (!q) continue;
        check(`item ${i + 1} (${it.kind}) width ≈ ${it.width} of the page (${Math.round(it.width * W)}px)`, Math.abs(q.w - it.width * W) <= 1.5, `got ${q.w}px`);
        check(`item ${i + 1} (${it.kind}) centred at x=${it.x}, y=${it.y}`, Math.abs(q.x + q.w / 2 - it.x * W) <= 2 && Math.abs(q.y + q.h / 2 - it.y * H) <= 2, `centre ${q.x + q.w / 2},${q.y + q.h / 2} wanted ${it.x * W},${it.y * H}`);
      }
      if (full && placed.length === 3) {
        for (const [i, q] of placed.entries()) {
          const frac = await changedFraction(fx.doc, full, { x: q.x, y: q.y, w: q.w, h: q.h });
          check(`item ${i + 1} (${q.kind}): pixels really changed inside its box (${(frac * 100).toFixed(1)}%)`, frac > 0.005, `changed ${(frac * 100).toFixed(2)}%`);
        }
        const untouched = await changedFraction(fx.doc, full, { x: 0, y: 0, w: 1240, h: 150 });
        check(`top strip is untouched (${(untouched * 100).toFixed(2)}% changed)`, untouched < 0.005);
      }

      // 문서를 data 로, 이미지 항목을 data URI 로, 곱하기 끔, 영문 이름
      const second = await call(ctx, 'place_on_document', {
        document: { data: fx.doc.toString('base64') },
        multiply: false,
        items: [
          { kind: 'signature', name: 'Jane Doe', lang: 'en', x: 0.3, y: 0.86, width: 0.3 },
          { kind: 'stamp', name: 'Jane Doe', lang: 'en', shape: 'circle-double', x: 0.7, y: 0.86 },
          { kind: 'image', image: { data: `data:image/png;base64,${state.stampPng.toString('base64')}` }, x: 0.15, y: 0.15, width: 0.12 },
        ],
      });
      check('document via base64 data, multiply:false, en items, image via data URI: succeeds', !second.isError, second.text.slice(0, 300));
      const sp = second.images[0] ? jpegSize(second.images[0].buf) : null;
      check('inline preview is a JPEG of the right shape', second.images[0]?.mime === 'image/jpeg' && isJpeg(second.images[0].buf) && sp && Math.abs(sp.width / sp.height - W / H) < 0.01);
      const secondPath = await verifySaved('second placement', second);
      if (secondPath) {
        const s = jpegSize(await readFile(secondPath));
        check('saved size equals input', s?.width === W && s?.height === H, `${s?.width}×${s?.height}`);
      }

      // PNG 문서 → PNG 저장, 미리보기는 JPEG
      const png = await call(ctx, 'place_on_document', { document: { path: fx.docPngPath }, items: [{ kind: 'stamp', name: '홍길동', x: 0.8, y: 0.8 }] });
      check('PNG document: succeeds', !png.isError, png.text.slice(0, 200));
      const pp = await verifySaved('png document', png);
      if (pp) {
        const buf = await readFile(pp);
        const dec = isPng(buf) ? decodePng(buf) : null;
        check('PNG in → PNG saved (.png) with the same size 600×800', pp.endsWith('.png') && dec?.width === 600 && dec?.height === 800, `${basename(pp)} ${dec?.width}×${dec?.height}`);
        check('inline preview is still a JPEG', png.images[0]?.mime === 'image/jpeg' && isJpeg(png.images[0].buf));
        const ps = jpegSize(png.images[0].buf);
        check('small document is not enlarged in the preview', ps?.width === 600 && ps?.height === 800, `${ps?.width}×${ps?.height}`);
      }

      // WebP 문서 → PNG 저장
      const webp = await call(ctx, 'place_on_document', { document: { data: fx.docWebp.toString('base64') }, items: [{ kind: 'signature', name: '홍길동', x: 0.5, y: 0.8 }] });
      check('WebP document: succeeds', !webp.isError, webp.text.slice(0, 200));
      const wp = await verifySaved('webp document', webp);
      if (wp) {
        const buf = await readFile(wp);
        const dec = isPng(buf) ? decodePng(buf) : null;
        check('WebP in → PNG saved (.png) with the same size 600×800', wp.endsWith('.png') && dec?.width === 600 && dec?.height === 800, `${basename(wp)} ${dec?.width}×${dec?.height}`);
      }

      // 긴 변 4000px 제한
      const big = await call(ctx, 'place_on_document', { document: { data: fx.docBig.toString('base64') }, items: [{ kind: 'signature', name: '홍길동', x: 0.5, y: 0.5 }] });
      check('4500×3000 document: succeeds', !big.isError, big.text.slice(0, 200));
      const bp = await verifySaved('big document', big);
      if (bp) {
        const s = jpegSize(await readFile(bp));
        check('long side is capped at 4000px (4000×2667)', s?.width === 4000 && s?.height === 2667, `${s?.width}×${s?.height}`);
        const ps = jpegSize(big.images[0].buf);
        check('preview long side ≤ 1600', Math.max(ps.width, ps.height) <= 1600, `${ps.width}×${ps.height}`);
      }
    });

    await section('stdio: concurrency (render queue limit, parallel saves)', async () => {
      // 한꺼번에 24건: 페이지 2개 + 대기 16건을 넘는 요청은 '요청이 많아요' 로 돌려보낸다
      const N = 24;
      const rs = await Promise.all(Array.from({ length: N }, () => call(ctx, 'preview_signatures', { name: '홍길동' }, { timed: false })));
      const ok = rs.filter((r) => !r.isError);
      const busy = rs.filter((r) => r.isError && /요청이 많아요/.test(r.text));
      info(`${N} parallel previews: ${ok.length} ok, ${busy.length} told to retry`);
      check(`all ${N} parallel previews get an answer (ok or Korean busy message), none hangs or throws`, ok.length + busy.length === N && !rs.some((r) => r.thrown), rs.filter((r) => r.isError && !/요청이 많아요/.test(r.text)).map((r) => r.text.slice(0, 100)).join(' | '));
      check('every successful answer carries a valid PNG sheet', ok.length > 0 && ok.every((r) => r.images.length === 1 && isPng(r.images[0].buf)));
      if (!busy.length) warn('no request was turned away; the queue limit (16 waiting + 2 rendering) was not reached');
      const after = await call(ctx, 'create_stamp', { name: '홍길동' }, { timed: false });
      check('server recovers right after the burst', !after.isError);
      await verifySaved('after burst', after, midOf(after));

      // 같은 이름을 동시에 저장해도 서로 덮어쓰지 않는다
      const M = 12;
      const saves = await Promise.all(Array.from({ length: M }, () => call(ctx, 'create_stamp', { name: '동시저장' }, { timed: false })));
      check(`${M} parallel identical create_stamp calls all succeed`, saves.every((r) => !r.isError), saves.find((r) => r.isError)?.text.slice(0, 120));
      const paths = saves.map(whereOf);
      saves.forEach((r, i) => { if (paths[i]) savedFiles.push(paths[i]); });
      check(`each parallel save got its own file (${new Set(paths).size} distinct of ${M})`, new Set(paths).size === M);
    });

    await section('stdio: input errors return isError with a Korean message (no crash)', async () => {
      const many = Array.from({ length: 200 }, (_, s) => Array.from({ length: 101 }, (_, i) => [i + s, (i * 7 + s) % 50]));
      const cases = [
        ['empty name', 'create_signature', { name: '' }, /이름/],
        ['whitespace-only name', 'create_signature', { name: '   ' }, /이름/],
        ['empty name (preview_stamps)', 'preview_stamps', { name: '' }, /이름/],
        ['empty name (download_all)', 'download_all', { kind: 'stamp', name: '' }, /이름/],
        ['15-character Hangul name', 'create_signature', { name: '가나다라마바사아자차카타파하가' }, /14자/],
        ['30-character English name (stamp)', 'create_stamp', { name: 'A'.repeat(30) }, /14자/],
        ['100-character name', 'create_signature', { name: '가'.repeat(100) }, /14자/],
        ['15-character name (preview_signatures)', 'preview_signatures', { name: 'abcdefghijklmno' }, /14자/],
        ['Hangul name with lang en (signature)', 'create_signature', { name: '홍길동', lang: 'en' }, /영문/],
        ['Hangul name with lang en (stamp)', 'create_stamp', { name: '홍길동', lang: 'en' }, /영문/],
        ['unknown signature style', 'create_signature', { name: '홍길동', style: 'no-such-style' }, /no-such-style/],
        ['style from the other language (en style for a Hangul name)', 'create_signature', { name: '홍길동', style: enIds[0] }, new RegExp(enIds[0])],
        ['unknown stamp shape', 'create_stamp', { name: '홍길동', shape: 'no-such-shape' }, /no-such-shape/],
        ['unknown stamp font', 'create_stamp', { name: '홍길동', font: 'No Such Font' }, /No Such Font/],
        ['unknown stamp category (preview_stamps)', 'preview_stamps', { name: '홍길동', category: 'no-such-category' }, /no-such-category/],
        ['unknown stamp category (download_all)', 'download_all', { kind: 'stamp', name: '홍길동', category: 'no-such-category' }, /no-such-category/],
        ['unknown stamp font (preview_stamps)', 'preview_stamps', { name: '홍길동', font: 'No Such Font' }, /No Such Font/],
        ['bad ink name (signature)', 'create_signature', { name: '홍길동', ink: 'purple' }, /purple/],
        ['bad ink hex #12345', 'create_stamp', { name: '홍길동', ink: '#12345' }, /#12345/],
        ['bad ink (preview_signatures)', 'preview_signatures', { name: '홍길동', ink: 'nope' }, /nope/],
        ['bad background name', 'create_signature', { name: '홍길동', background: 'rainbow' }, /rainbow/],
        ['bad background hex #gg0000', 'create_stamp', { name: '홍길동', background: '#gg0000' }, /#gg0000/],
        ['bad ink (draw_signature)', 'draw_signature', { strokes: [[[0, 0], [1, 1]]], ink: 'nope' }, /nope/],
        ['photo: text file instead of an image (path)', 'signature_from_photo', { image: { path: fx.textPath } }, /이미지/],
        ['photo: text instead of an image (data)', 'signature_from_photo', { image: { data: Buffer.from('hello, not an image at all').toString('base64') } }, /이미지/],
        ['photo: two sources (path + data)', 'signature_from_photo', { image: { path: fx.photoPath, data: 'AAAA' } }, /하나만/],
        ['photo: two sources (data + url)', 'signature_from_photo', { image: { data: 'AAAA', url: 'https://example.com/a.png' } }, /하나만/],
        ['photo: no source at all', 'signature_from_photo', { image: {} }, /하나만/],
        ['photo: path does not exist', 'signature_from_photo', { image: { path: join(WORK, 'does-not-exist.jpg') } }, /찾지 못/],
        ['photo: ~ path that does not exist', 'signature_from_photo', { image: { path: '~/no-such-dojang-test-file.jpg' } }, /찾지 못/],
        ['photo: path is a directory', 'signature_from_photo', { image: { path: WORK } }, /찾지 못/],
        ['photo: url that is not https', 'signature_from_photo', { image: { url: 'http://example.com/a.png' } }, /https/],
        ['draw_signature: more than 20,000 points', 'draw_signature', { strokes: many }, /점이 너무 많/],
        ['place: document is a text file', 'place_on_document', { document: { path: fx.textPath }, items: [{ kind: 'stamp', name: '홍길동', x: 0.5, y: 0.5 }] }, /이미지/],
        ['place: document path does not exist', 'place_on_document', { document: { path: join(WORK, 'nope.jpg') }, items: [{ kind: 'stamp', name: '홍길동', x: 0.5, y: 0.5 }] }, /찾지 못/],
        ['place: document with two sources', 'place_on_document', { document: { path: fx.docPath, data: 'AAAA' }, items: [{ kind: 'stamp', name: '홍길동', x: 0.5, y: 0.5 }] }, /하나만/],
        ['place: stamp item without a name', 'place_on_document', { document: { path: fx.docPath }, items: [{ kind: 'stamp', x: 0.5, y: 0.5 }] }, /이름/],
        ['place: signature item with an empty name', 'place_on_document', { document: { path: fx.docPath }, items: [{ kind: 'signature', name: '', x: 0.5, y: 0.5 }] }, /이름/],
        ['place: image item without an image', 'place_on_document', { document: { path: fx.docPath }, items: [{ kind: 'image', x: 0.5, y: 0.5 }] }, /image/],
        ['place: image item whose file does not exist', 'place_on_document', { document: { path: fx.docPath }, items: [{ kind: 'image', image: { path: join(WORK, 'gone.png') }, x: 0.5, y: 0.5 }] }, /찾지 못/],
        ['place: unknown stamp shape inside an item', 'place_on_document', { document: { path: fx.docPath }, items: [{ kind: 'stamp', name: '홍길동', shape: 'no-such-shape', x: 0.5, y: 0.5 }] }, /no-such-shape/],
        ['place: bad ink inside an item', 'place_on_document', { document: { path: fx.docPath }, items: [{ kind: 'signature', name: '홍길동', ink: 'nope', x: 0.5, y: 0.5 }] }, /nope/],
      ];
      for (const [label, name, args, expect] of cases) {
        const r = await call(ctx, name, args);
        const korean = HANGUL.test(r.text) && !/^MCP error/.test(r.text);
        check(`${label}`, r.isError && !r.thrown && korean && expect.test(r.text), `isError=${r.isError} thrown=${Boolean(r.thrown)} text=${JSON.stringify(r.text.slice(0, 140))}`);
      }
      // 입력 스키마 단계에서 막히는 값 (SDK 메시지는 영어여도 괜찮다. 충돌 없이 isError 로만 돌아오면 된다)
      const schemaCases = [
        ['malformed date (create_stamp)', 'create_stamp', { name: '홍길동', date: '2026/11/22' }],
        ['resolution not in enum', 'create_signature', { name: '홍길동', resolution: 'ultra' }],
        ['rotation out of range (99)', 'create_stamp', { name: '홍길동', rotation: 99 }],
        ['photo strength out of range (500)', 'signature_from_photo', { image: { path: fx.photoPath }, strength: 500 }],
        ['place_on_document with no items', 'place_on_document', { document: { path: fx.docPath }, items: [] }],
        ['place item x out of range (2)', 'place_on_document', { document: { path: fx.docPath }, items: [{ kind: 'stamp', name: '홍길동', x: 2, y: 0.5 }] }],
        ['missing required name', 'create_signature', {}],
        ['unknown tool name', 'no_such_tool', {}],
      ];
      for (const [label, name, args] of schemaCases) {
        const r = await call(ctx, name, args);
        check(`${label} (schema level): isError, no crash`, r.isError && r.text.length > 0, JSON.stringify(r.text.slice(0, 140)));
      }
      const alive = await call(ctx, 'list_styles', { kind: 'stamp' });
      check('server still answers after all the bad input', !alive.isError && alive.text.includes('stampShapes'));
    });

    await section('stdio: saved files and server log', async () => {
      const files = await readdir(OUT_STDIO);
      info(`${files.length} files in DOJANG_OUT_DIR`);
      check('files were written to DOJANG_OUT_DIR only (everything recorded exists)', savedFiles.every((p) => files.includes(basename(p))));
      check('no file name collisions (every call produced its own file)', new Set(savedFiles).size === savedFiles.length);
      check('only expected extensions (.png .jpg .zip)', files.every((f) => /\.(png|jpg|zip)$/.test(f)), files.filter((f) => !/\.(png|jpg|zip)$/.test(f)).join(','));
      const log = stderrLines.join('');
      check('server log has no unexpected tool error or page error', !/\[mcp\] tool error|\[render\] page error/.test(log), log.split('\n').filter((l) => /tool error|page error/.test(l)).slice(0, 3).join(' | '));
    });
  } finally {
    await client.close().catch(() => {});
  }
}

function sameSize(a, b) {
  const da = decodePng(a);
  const db = decodePng(b);
  return da.width === db.width && da.height === db.height;
}

// ───────────── 2. HTTP ─────────────

let httpProc = null;
const httpLog = [];
let mcpPosts = 0; // 서버의 호출 제한을 소모하는 POST /mcp 개수(이 서버 시작 뒤)
let firstPostAt = 0;

function noteMcpPost() {
  if (!firstPostAt) firstPostAt = Date.now();
  mcpPosts++;
}
const countingFetch = (url, init) => {
  if ((init?.method ?? 'GET') === 'POST' && new URL(String(url)).pathname === '/mcp') noteMcpPost();
  return fetch(url, init);
};

/** 원시 http 요청 (fetch 가 못 하는 Host 헤더 바꾸기 등). consumes: POST /mcp 로서 제한을 소모하는지 */
function raw({ method = 'GET', path = '/', headers = {}, body = null, consumes = false }) {
  if (consumes) noteMcpPost();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, method, path, headers: { ...(body != null ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('timeout')));
    if (body != null) req.write(body);
    req.end();
  });
}

const portInUse = () => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port: HTTP_PORT });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});

async function startHttp() {
  if (await portInUse()) throw new Error(`포트 ${HTTP_PORT} 에 이미 무언가 떠 있어요. 다른 서버를 건드리지 않으려고 중단합니다 (DOJANG_TEST_PORT 로 바꿀 수 있어요).`);
  httpProc = spawn(process.execPath, [SERVER, '--http', String(HTTP_PORT)], {
    env: { ...process.env, DOJANG_PUBLIC_URL: BASE, DOJANG_OUT_DIR: OUT_HTTP },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  httpProc.stderr.on('data', (d) => httpLog.push(String(d)));
  httpProc.stdout.on('data', (d) => httpLog.push(String(d)));
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) {
    if (httpProc.exitCode !== null) throw new Error(`HTTP 서버가 바로 종료됐어요: ${httpLog.join('').slice(0, 300)}`);
    try {
      const r = await raw({ path: '/mcp/health' });
      if (r.status === 200) return Date.now() - t0;
    } catch { /* 아직 안 뜸 */ }
    await sleep(100);
  }
  throw new Error('HTTP 서버가 10초 안에 뜨지 않았어요');
}

async function stopHttp() {
  if (!httpProc || httpProc.exitCode !== null) return;
  const exited = new Promise((r) => httpProc.once('exit', r));
  httpProc.kill('SIGTERM');
  await Promise.race([exited, sleep(10_000)]);
  if (httpProc.exitCode === null) httpProc.kill('SIGKILL');
}
process.on('exit', () => { try { if (httpProc && httpProc.exitCode === null) httpProc.kill('SIGKILL'); } catch { /* 이미 끝남 */ } });

async function runHttp() {
  const startMs = await startHttp();
  info(`HTTP server up on ${BASE} in ${startMs}ms`);
  const client = new Client({ name: 'dojang-e2e-http', version: '1.0.0' });
  const ctx = { client, mode: 'http' };
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { fetch: countingFetch }));
  const fileUrlRe = new RegExp(`${BASE.replace(/[.]/g, '\\.')}/mcp/files/[\\w-]{22}/\\S+`);

  try {
    await section('http: tools/list', async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      check('exactly 10 tools: the 9 plus create_upload_link', names.length === 10 && names.includes('create_upload_link') && EXPECTED_TOOLS.every((n) => names.includes(n)), names.join(', '));
      const img = tools.find((t) => t.name === 'place_on_document')?.inputSchema.properties.document.properties ?? {};
      check('image input offers upload_id (not path) in HTTP mode', 'upload_id' in img && !('path' in img), Object.keys(img).join(','));
      check('create_upload_link accepts a purpose', Boolean(tools.find((t) => t.name === 'create_upload_link')?.inputSchema.properties.purpose));
    });

    let stampBytes = null;
    await section('http: result download links', async () => {
      const r = await call(ctx, 'create_stamp', { name: '홍길동', shape: 'circle', add_in: true });
      check('create_stamp succeeds', !r.isError, r.text.slice(0, 200));
      const url = whereOf(r);
      check(`download URL is under ${BASE}/mcp/files/`, Boolean(url && fileUrlRe.test(url)), String(url));
      check('text says the link is valid for 1 hour', r.text.includes('1시간'));
      stampBytes = midOf(r);
      if (!url) return;
      const res = await fetch(url);
      const body = Buffer.from(await res.arrayBuffer());
      check('GET download → 200', res.status === 200, `status ${res.status}`);
      const cd = res.headers.get('content-disposition') ?? '';
      check('Content-Disposition is attachment with a UTF-8 file name', /^attachment;/.test(cd) && cd.includes("filename*=UTF-8''"), cd);
      const fname = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] ?? '');
      check('file name is 도장_홍길동_… .png', /^도장_홍길동_.*\.png$/.test(fname), fname);
      check('Content-Type image/png, nosniff, no-store', res.headers.get('content-type') === 'image/png' && res.headers.get('x-content-type-options') === 'nosniff' && /no-store/.test(res.headers.get('cache-control') ?? ''), `${res.headers.get('content-type')} / ${res.headers.get('x-content-type-options')} / ${res.headers.get('cache-control')}`);
      check('Content-Length matches the body', Number(res.headers.get('content-length')) === body.length);
      check('body is a PNG and equals the image returned inline', isPng(body) && stampBytes && Buffer.compare(body, stampBytes) === 0);
      check('second download of the same link also works (not one-shot)', (await fetch(url)).status === 200);

      const unknown = await fetch(`${BASE}/mcp/files/${'A'.repeat(22)}/x.png`);
      check('unknown file id → 404 with a JSON error', unknown.status === 404 && /json/.test(unknown.headers.get('content-type') ?? ''), `status ${unknown.status}`);
      check('malformed file id → 404', (await fetch(`${BASE}/mcp/files/short/x.png`)).status === 404);
      check('a valid link with the wrong id char set → 404', (await fetch(`${BASE}/mcp/files/${'*'.repeat(22)}/x.png`)).status === 404);
      // 다운로드 경로는 id 만 본다. 파일 이름 부분을 바꿔도 같은 파일
      check('POST to a files URL is not served', (await fetch(url, { method: 'POST', body: 'x' })).status === 404);

      const z = await call(ctx, 'download_all', { kind: 'signature', name: 'Jane Doe', lang: 'en' });
      const zu = whereOf(z);
      check('download_all returns a .zip link', Boolean(zu && /\.zip$/.test(zu)), String(zu));
      if (zu) {
        const zr = await fetch(zu);
        const zb = Buffer.from(await zr.arrayBuffer());
        check('ZIP download: 200, application/zip, PK header', zr.status === 200 && zr.headers.get('content-type') === 'application/zip' && zb.readUInt32LE(0) === 0x04034b50, `${zr.status} ${zr.headers.get('content-type')}`);
        const n = state.styles?.signatureStyles?.en?.length;
        const parsed = readZip(zb);
        check(`ZIP entry count ${parsed.entries.length} equals the en signature style count (${n})`, parsed.entries.length === n);
      }
    });

    let docUploadId = null;
    await section('http: upload flow (create_upload_link → page → PUT → place_on_document)', async () => {
      const r = await call(ctx, 'create_upload_link', { purpose: 'document' });
      check('create_upload_link succeeds', !r.isError, r.text.slice(0, 200));
      let link = null;
      try { link = JSON.parse(r.text); } catch { check('returns JSON with upload_id and url', false, r.text.slice(0, 160)); return; }
      check('upload_id and url are returned', link.upload_id && link.url, JSON.stringify(link));
      check(`url is ${BASE}/mcp/upload/<id>`, link.url === `${BASE}/mcp/upload/${link.upload_id}`, link.url);
      docUploadId = link.upload_id;

      const page = await fetch(link.url);
      const html = await page.text();
      const csp = page.headers.get('content-security-policy') ?? '';
      check('GET upload page → 200 text/html', page.status === 200 && /text\/html/.test(page.headers.get('content-type') ?? ''), `status ${page.status}`);
      check('CSP header is present with default-src none, nonce script/style, frame-ancestors none', /default-src 'none'/.test(csp) && /script-src 'nonce-[\w+/=]+'/.test(csp) && /style-src 'nonce-/.test(csp) && /frame-ancestors 'none'/.test(csp), csp);
      const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
      check('the nonce in the CSP header matches the page script and style tags', nonce && html.includes(`<script nonce="${nonce}">`) && html.includes(`<style nonce="${nonce}">`));
      check('page has a file input and a PUT upload script, no inline event handlers', html.includes('type="file"') && html.includes("method:'PUT'") && !/\son\w+=/.test(html));
      check('upload page is no-store, nosniff, no-referrer', /no-store/.test(page.headers.get('cache-control') ?? '') && page.headers.get('x-content-type-options') === 'nosniff' && page.headers.get('referrer-policy') === 'no-referrer');
      const nonce2 = /script-src 'nonce-([^']+)'/.exec((await fetch(link.url)).headers.get('content-security-policy') ?? '')?.[1];
      check('the nonce changes on every request', Boolean(nonce2) && nonce2 !== nonce);
      check('POST to the upload URL → 405 with Allow: GET, PUT', await (async () => { const x = await fetch(link.url, { method: 'POST', body: 'x' }); return x.status === 405 && /PUT/.test(x.headers.get('allow') ?? ''); })());

      // 올리기 전에는 쓸 수 없다
      const early = await call(ctx, 'place_on_document', { document: { upload_id: link.upload_id }, items: [{ kind: 'stamp', name: '홍길동', x: 0.5, y: 0.5 }] });
      check('using the upload_id before anything is uploaded → isError with Korean message', early.isError && HANGUL.test(early.text) && /업로드/.test(early.text), early.text.slice(0, 160));

      const bad = await raw({ method: 'PUT', path: new URL(link.url).pathname, headers: { 'Content-Type': 'text/plain' }, body: 'this is not an image' });
      check('PUT of a non-image → 415', bad.status === 415, `status ${bad.status} ${bad.body.toString().slice(0, 100)}`);
      check('415 body is JSON with a Korean error', HANGUL.test(bad.body.toString()) && /json/.test(bad.headers['content-type'] ?? ''), bad.body.toString().slice(0, 100));
      const stillEmpty = await call(ctx, 'place_on_document', { document: { upload_id: link.upload_id }, items: [{ kind: 'stamp', name: '홍길동', x: 0.5, y: 0.5 }] });
      check('after the rejected PUT the slot is still empty', stillEmpty.isError);

      // 이름이 깨진 X-File-Name 은 이름 없이 저장하되 올리기는 성공
      const put = await raw({ method: 'PUT', path: new URL(link.url).pathname, headers: { 'Content-Type': 'image/jpeg', 'X-File-Name': encodeURIComponent('계약서.jpg') }, body: fx.doc });
      check('PUT of the 1240×1754 JPEG → 200 {ok:true}', put.status === 200 && JSON.parse(put.body.toString()).ok === true, `status ${put.status} ${put.body.toString().slice(0, 100)}`);

      const items = [
        { kind: 'signature', name: '홍길동', ink: 'navy', x: 0.30, y: 0.80, width: 0.35 },
        { kind: 'stamp', name: '홍길동', shape: 'circle', add_in: true, x: 0.74, y: 0.785, width: 0.15 },
        { kind: 'image', image: { data: stampBytes.toString('base64') }, x: 0.5, y: 0.5, width: 0.15 },
      ];
      const placed = await call(ctx, 'place_on_document', { document: { upload_id: link.upload_id }, items });
      noteFonts('http place', placed);
      check('place_on_document with { upload_id } succeeds', !placed.isError, placed.text.slice(0, 300));
      const prev = placed.images[0];
      check('inline preview is a JPEG with long side ≤ 1600', prev?.mime === 'image/jpeg' && isJpeg(prev.buf) && Math.max(jpegSize(prev.buf).width, jpegSize(prev.buf).height) <= 1600);
      const url = whereOf(placed);
      check('result is a download link', Boolean(url && fileUrlRe.test(url)), String(url));
      if (url) {
        const res = await fetch(url);
        const body = Buffer.from(await res.arrayBuffer());
        check('download → 200 image/jpeg attachment', res.status === 200 && res.headers.get('content-type') === 'image/jpeg' && /^attachment/.test(res.headers.get('content-disposition') ?? ''), `${res.status} ${res.headers.get('content-type')}`);
        const sz = isJpeg(body) ? jpegSize(body) : null;
        check('downloaded file is a JPEG with the same 1240×1754 size', sz?.width === 1240 && sz?.height === 1754, `${sz?.width}×${sz?.height}`);
        const fname = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? '');
        check('file name carries the uploaded name (계약서_서명완료_…jpg)', /^계약서_서명완료_.*\.jpg$/.test(fname), fname);
        const frac = await changedFraction(fx.doc, body, { x: 0, y: Math.round(1754 * 0.72), w: 1240, h: Math.round(1754 * 0.16) });
        check(`signature band changed in the downloaded file (${(frac * 100).toFixed(1)}%)`, frac > 0.005);
      }
      check('the upload can be reused for a second placement within the hour', !(await call(ctx, 'place_on_document', { document: { upload_id: link.upload_id }, items: [{ kind: 'stamp', name: 'Jane Doe', x: 0.5, y: 0.5 }] })).isError);

      // 사진 업로드 → signature_from_photo
      const l2 = JSON.parse((await call(ctx, 'create_upload_link', { purpose: 'photo' })).text);
      const up2 = await raw({ method: 'PUT', path: new URL(l2.url).pathname, headers: { 'Content-Type': 'image/jpeg' }, body: fx.photo });
      check('PUT of the signature photo → 200', up2.status === 200);
      const ph = await call(ctx, 'signature_from_photo', { image: { upload_id: l2.upload_id }, ink: 'navy' });
      check('signature_from_photo with { upload_id } succeeds and is a PNG', !ph.isError && checkPng('http photo', ph) !== null, ph.text.slice(0, 200));

      // 업로드 쪽 404
      const unk = '0'.repeat(22);
      const g404 = await fetch(`${BASE}/mcp/upload/${unk}`);
      check('GET of an unknown upload id → 404', g404.status === 404, `status ${g404.status}`);
      const p404 = await raw({ method: 'PUT', path: `/mcp/upload/${unk}`, headers: { 'Content-Type': 'image/jpeg' }, body: fx.photo });
      check('PUT to an unknown upload id → 404', p404.status === 404, `status ${p404.status}`);
      const unkUse = await call(ctx, 'place_on_document', { document: { upload_id: unk }, items: [{ kind: 'stamp', name: '홍길동', x: 0.5, y: 0.5 }] });
      check('place_on_document with an unknown upload_id → isError, Korean message', unkUse.isError && HANGUL.test(unkUse.text), unkUse.text.slice(0, 160));
    });

    await section('http: >15MB upload → 413 (extra)', async () => {
      const l = JSON.parse((await call(ctx, 'create_upload_link', { purpose: 'image' })).text);
      const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16 * 1024 * 1024)]);
      let res = null;
      let err = null;
      try { res = await raw({ method: 'PUT', path: new URL(l.url).pathname, headers: { 'Content-Type': 'image/jpeg' }, body: big }); } catch (e) { err = e; }
      check('PUT of 16MB → 413 (client receives a real HTTP response)', res?.status === 413, err ? `no response: ${err.code ?? err.message}` : `status ${res?.status}`);
      if (res) check('413 body is a Korean JSON error', HANGUL.test(res.body.toString()));
    });

    await section('http: SSRF guard and local-file guard on image inputs', async () => {
      const doc = { items: [{ kind: 'stamp', name: '홍길동', x: 0.5, y: 0.5 }] };
      const cases = [
        ['url https://127.0.0.1/x.png (place_on_document)', 'place_on_document', { document: { url: 'https://127.0.0.1/x.png' }, ...doc }, /내부망/],
        ['url http://example.com/x.png (place_on_document)', 'place_on_document', { document: { url: 'http://example.com/x.png' }, ...doc }, /https/],
        ['url https://127.0.0.1/x.png (signature_from_photo)', 'signature_from_photo', { image: { url: 'https://127.0.0.1/x.png' } }, /내부망/],
        ['url http://example.com/x.png (signature_from_photo)', 'signature_from_photo', { image: { url: 'http://example.com/x.png' } }, /https/],
        ['url https://[::1]/x.png', 'signature_from_photo', { image: { url: 'https://[::1]/x.png' } }, /내부망/],
        ['url https://[::ffff:127.0.0.1]/x.png (IPv4-mapped IPv6)', 'signature_from_photo', { image: { url: 'https://[::ffff:127.0.0.1]/x.png' } }, /내부망/],
        ['url https://169.254.169.254/latest/meta-data (cloud metadata)', 'signature_from_photo', { image: { url: 'https://169.254.169.254/latest/meta-data' } }, /내부망/],
        ['url https://10.0.0.1/x.png', 'signature_from_photo', { image: { url: 'https://10.0.0.1/x.png' } }, /내부망/],
        ['url https://192.168.0.1/x.png', 'signature_from_photo', { image: { url: 'https://192.168.0.1/x.png' } }, /내부망/],
        ['url https://100.64.0.1/x.png (carrier-grade NAT)', 'signature_from_photo', { image: { url: 'https://100.64.0.1/x.png' } }, /내부망/],
        ['url https://localhost/x.png (hostname resolving to loopback)', 'signature_from_photo', { image: { url: 'https://localhost/x.png' } }, /내부망/],
        ['url with credentials', 'signature_from_photo', { image: { url: 'https://user:pw@example.com/x.png' } }, /https/],
        ['url file:///etc/hosts', 'signature_from_photo', { image: { url: 'file:///etc/hosts' } }, /https/],
        ['local path /etc/hosts is not accepted over HTTP', 'signature_from_photo', { image: { path: '/etc/hosts' } }, /upload_id/],
        ['local path for the document is not accepted over HTTP', 'place_on_document', { document: { path: fx.docPath }, ...doc }, /upload_id/],
        ['local path for an image item is not accepted over HTTP', 'place_on_document', { document: { data: fx.doc.toString('base64') }, items: [{ kind: 'image', image: { path: fx.photoPath }, x: 0.5, y: 0.5 }] }, /upload_id/],
      ];
      for (const [label, name, args, expect] of cases) {
        const r = await call(ctx, name, args);
        check(label, r.isError && !r.thrown && expect.test(r.text) && HANGUL.test(r.text), `isError=${r.isError} text=${JSON.stringify(r.text.slice(0, 140))}`);
      }
    });

    await section('http: routing, Host check, methods', async () => {
      const h = await raw({ path: '/mcp/health' });
      check('GET /mcp/health → 200 {ok:true}', h.status === 200 && JSON.parse(h.body.toString()).ok === true);
      for (const [label, host] of [['Host: localhost:PORT', `localhost:${HTTP_PORT}`], ['Host: 127.0.0.1:PORT', `127.0.0.1:${HTTP_PORT}`]]) {
        check(`${label} is accepted`, (await raw({ path: '/mcp/health', headers: { Host: host } })).status === 200);
      }
      const evil = await raw({ path: '/mcp/health', headers: { Host: 'evil.example' } });
      check('Host: evil.example → 421', evil.status === 421, `status ${evil.status}`);
      check('Host: evil.example on POST /mcp → 421', (await raw({ method: 'POST', path: '/mcp', headers: { Host: 'evil.example', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{}' })).status === 421);
      check('Host: evil.example on a download link → 421', (await raw({ path: `/mcp/files/${'A'.repeat(22)}/x.png`, headers: { Host: 'evil.example' } })).status === 421);
      check('Host: evil.example on the upload page → 421', (await raw({ path: `/mcp/upload/${'A'.repeat(22)}`, headers: { Host: 'evil.example' } })).status === 421);
      check('Host with the wrong port (127.0.0.1:1) → 421', (await raw({ path: '/mcp/health', headers: { Host: '127.0.0.1:1' } })).status === 421);
      const get = await raw({ path: '/mcp' });
      check('GET /mcp → 405', get.status === 405, `status ${get.status}`);
      check('405 carries Allow: POST and a JSON-RPC error body', /POST/.test(get.headers.allow ?? '') && JSON.parse(get.body.toString()).error?.code === -32000, `${get.headers.allow} ${get.body.toString().slice(0, 80)}`);
      check('DELETE /mcp → 405', (await raw({ method: 'DELETE', path: '/mcp' })).status === 405);
      check('unknown path → 404', (await raw({ path: '/nope' })).status === 404);
      check('/ and /mcp/ are not served (404)', (await raw({ path: '/' })).status === 404);
      const badJson = await raw({ method: 'POST', path: '/mcp', consumes: true, headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{not json' });
      check('POST /mcp with malformed JSON → 400 JSON-RPC parse error (-32700)', badJson.status === 400 && JSON.parse(badJson.body.toString()).error?.code === -32700, `status ${badJson.status}`);
      const huge = await raw({ method: 'POST', path: '/mcp', consumes: true, headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: Buffer.alloc(23 * 1024 * 1024, 0x20) }).catch((e) => ({ status: `no response: ${e.code ?? e.message}`, body: Buffer.alloc(0) }));
      check('POST /mcp with a 23MB body → 413 (extra)', huge.status === 413, `status ${huge.status}`);
    });

    await section('http: warm-path sanity (no server error logged yet)', async () => {
      const log = httpLog.join('');
      check('server log has no unexpected tool error or page error', !/\[mcp\] tool error|\[render\] page error/.test(log), log.split('\n').filter((l) => /tool error|page error/.test(l)).slice(0, 3).join(' | '));
    });

    // 반드시 마지막: 127.0.0.1 의 호출 제한 통을 비운다
    await section('http: rate limit (runs last — drains the bucket for 127.0.0.1)', async () => {
      const used = mcpPosts;
      const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
      const statuses = {};
      let first429 = null;
      let r429 = null;
      for (let i = 0; i < 200; i++) {
        const r = await raw({ method: 'POST', path: '/mcp', headers, body: ping, consumes: true });
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        if (r.status === 429) { first429 = mcpPosts; r429 = r; break; }
      }
      info(`POST /mcp requests so far: ${used} before the hammer; statuses during hammer ${JSON.stringify(statuses)}`);
      const elapsedS = (Date.now() - firstPostAt) / 1000;
      const refill = Math.ceil(elapsedS * 0.1);
      check(`429 appears (first at request #${first429} counted from server start, ${elapsedS.toFixed(0)}s elapsed)`, first429 !== null);
      if (first429 !== null) {
        check(`first 429 is at request 61..${60 + refill + 2} (capacity 60 + ${refill} refilled in ${elapsedS.toFixed(0)}s)`, first429 >= 61 && first429 <= 60 + refill + 2, `first 429 at #${first429}`);
        check('429 carries Retry-After and a JSON-RPC error body', Boolean(r429.headers['retry-after']) && JSON.parse(r429.body.toString()).error?.code === -32000, `retry-after=${r429.headers['retry-after']}`);
        check('429 body is Korean', HANGUL.test(r429.body.toString()));
        const again = await raw({ method: 'POST', path: '/mcp', headers, body: ping, consumes: true });
        check('the next request is also 429 (bucket is empty)', again.status === 429, `status ${again.status}`);
        check('GET /mcp/health is not rate limited', (await raw({ path: '/mcp/health' })).status === 200);
        const other = await raw({ method: 'POST', path: '/mcp', headers: { ...headers, 'CF-Connecting-IP': '203.0.113.77' }, body: ping });
        check('a different client IP (CF-Connecting-IP via loopback) has its own bucket', other.status !== 429, `status ${other.status}`);
        const viaClient = await call(ctx, 'list_styles', { kind: 'signature' });
        check('the MCP client is rejected too while limited (isError / thrown)', viaClient.isError);
      }
    });
  } finally {
    await client.close().catch(() => {});
  }
}

// ───────────── 시간 요약 ─────────────

function printTimings() {
  console.log('\n== Timing summary');
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
  const ms = (v) => (Number.isFinite(v) ? `${Math.round(v)}ms` : 'n/a');
  for (const mode of ['stdio', 'http']) {
    const all = timings.filter((t) => t.mode === mode && t.ok);
    if (!all.length) continue;
    const cold = all.find((t) => t.cold);
    const warm = all.filter((t) => !t.cold);
    const w = warm.map((t) => t.ms);
    console.log(`  ${mode}: first call (Chrome cold start, ${cold?.tool}) ${ms(cold?.ms)}; ${warm.length} warm successful calls: median ${ms(med(w))}, p90 ${ms(q(w, 0.9))}, max ${ms(Math.max(...w))}`);
    const byTool = new Map();
    for (const t of warm) byTool.set(t.tool, [...(byTool.get(t.tool) ?? []), t.ms]);
    for (const [name, xs] of byTool) console.log(`      ${name.padEnd(22)} n=${String(xs.length).padStart(2)}  median ${ms(med(xs)).padStart(7)}  max ${ms(Math.max(...xs)).padStart(7)}`);
  }
}

// ───────────── 실행 ─────────────

const t0 = Date.now();
let exitCode = 0;
try {
  await section('fixtures', async () => {
    await makeFixtures();
    check('synthetic signature photo is a JPEG', isJpeg(fx.photo), `${fx.photo.length} bytes`);
    check('WebP document fixture has a RIFF/WEBP header', fx.docWebp.toString('latin1', 0, 4) === 'RIFF' && fx.docWebp.toString('latin1', 8, 12) === 'WEBP');
    check('document fixture is a 1240×1754 JPEG', jpegSize(fx.doc)?.width === 1240 && jpegSize(fx.doc)?.height === 1754);
  });
  await runStdio();
  try {
    await runHttp();
  } catch (err) {
    currentSection = 'http';
    check('HTTP test setup/run did not throw', false, err?.stack ?? String(err));
  }
} catch (err) {
  check('test run did not throw', false, err?.stack ?? String(err));
} finally {
  await stopHttp();
  const stillUp = await portInUse();
  currentSection = 'cleanup';
  console.log('\n== cleanup');
  check(`test HTTP server on ${HTTP_PORT} is stopped`, !stillUp);
  await browser?.close().catch(() => {});
  printTimings();
  if (fontWarnings.length) warn(`${fontWarnings.length} call(s) used fallback fonts (offline or slow Google Fonts?)`, fontWarnings.slice(0, 3).join(' | '));
  console.log(`\n== Result: ${passed} passed, ${failed} failed, ${warned} warnings  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - [${f.section}] ${f.label}${f.detail ? `\n      ${f.detail}` : ''}`);
    exitCode = 1;
  }
  if (userDir) console.log(`\n산출물: ${WORK}`);
  else await rm(WORK, { recursive: true, force: true }).catch(() => {});
}
process.exit(exitCode);
