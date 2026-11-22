#!/usr/bin/env node
// 슈퍼도장 MCP 서버
//   로컬(stdio):  node mcp/server.mjs            → 결과 PNG를 ~/Downloads/슈퍼도장 에 저장, 입력은 파일 경로도 받음
//   원격(HTTP):   node mcp/server.mjs --http 7550 → POST /mcp, 결과는 1시간짜리 다운로드 링크, 입력은 업로드 링크로 받음
import { randomBytes } from 'node:crypto';
import dns from 'node:dns';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { buildFileName, formatDate, isHexColor, sanitizeFilePart } from '../js/core/text.js';
import { createZip, uniqueNames } from '../js/core/zip.js';
import { SEAL_CENTERS } from '../js/stamp-gen.js';
import { BusyError, Renderer, UserError } from './renderer.mjs';

const VERSION = '1.0.0';
const argv = process.argv.slice(2);
const HTTP = argv.includes('--http');
const PORT = Number(argv[argv.indexOf('--http') + 1] || process.env.PORT || 7550);
const PUBLIC_URL = (process.env.DOJANG_PUBLIC_URL ?? `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
const OUT_DIR = process.env.DOJANG_OUT_DIR ?? join(homedir(), 'Downloads', '슈퍼도장');
const MAX_INPUT_BYTES = 15 * 1024 * 1024; // 입력 이미지 하나
const MAX_BODY_BYTES = 22 * 1024 * 1024; // base64로 15MB 이미지를 담은 요청
const FILE_TTL_MS = 60 * 60 * 1000; // 다운로드·업로드 보관 시간

const renderer = new Renderer({ pages: Number(process.env.DOJANG_PAGES ?? 2) });

// ───────────── 옵션 값 ─────────────

const INKS = {
  black: '#111111', 검정: '#111111', navy: '#1d2b64', 남색: '#1d2b64', blue: '#1f5fd1', 파랑: '#1f5fd1',
  red: '#d0201f', 빨강: '#d0201f', orange: '#e5532d', 주홍: '#e5532d',
};
const BACKGROUNDS = { transparent: null, 투명: null, white: '#ffffff', 흰색: '#ffffff', cream: '#fdf6e3', 미색: '#fdf6e3' };
const RESOLUTION = { normal: 1, high: 2.5 };
const DATE_LABELS = ['확인', '결재', '검수', '승인', '접수', '완료', 'APPROVED', 'RECEIVED', 'PAID'];

function inkOf(value, fallback) {
  if (!value) return fallback;
  const v = value.trim();
  const hit = INKS[v.toLowerCase()] ?? INKS[v];
  if (hit) return hit;
  if (isHexColor(v)) return v;
  throw new UserError(`잉크 색 '${value}'를 알 수 없어요. black·navy·blue·red·orange 또는 #RRGGBB로 주세요.`);
}

function backgroundOf(value) {
  if (!value) return null;
  const v = value.trim();
  const key = v.toLowerCase();
  if (key in BACKGROUNDS) return BACKGROUNDS[key];
  if (v in BACKGROUNDS) return BACKGROUNDS[v];
  if (isHexColor(v)) return v;
  throw new UserError(`배경 '${value}'를 알 수 없어요. transparent·white·cream 또는 #RRGGBB로 주세요.`);
}

// ───────────── 입력 스키마 ─────────────

// 빈 값·길이 검사는 일부러 validateName 에 맡긴다(한국어 오류 문구). 스키마에서 막으면 SDK 의 영어 문구가 나간다. max 는 터무니없는 입력만 거른다
const name = z.string().max(1000).describe('이름. 한글·영문 14자까지 (예: 홍길동, Jane Doe)');
const lang = z.enum(['auto', 'ko', 'en']).optional().describe('언어. 기본 auto (한글이 있으면 ko)');
const ink = z.string().optional().describe('잉크 색: black·navy·blue·red·orange 또는 #RRGGBB. 기본: 서명 black, 도장 red');
const background = z.string().optional().describe('배경: transparent(기본)·white·cream 또는 #RRGGBB');
const resolution = z.enum(['normal', 'high']).optional().describe('해상도: normal(기본) 또는 high(2.5배, 인쇄용)');
const slant = z.number().min(-10).max(20).optional().describe('서명 기울기 추가(도), -10~20. 기본 0');
const weight = z.number().min(0).max(3).optional().describe('서명 굵게, 0~3. 기본 0');
const stampOptions = {
  font: z.string().optional().describe("도장 글꼴 이름(family 또는 한글 이름). 생략하면 모양마다 추천 글꼴. list_styles 참고"),
  add_in: z.boolean().optional().describe("한글 이름 끝에 '인' 붙이기 (홍길동인). 기본 false"),
  order: z.enum(['horizontal', 'vertical']).optional().describe('한글 글자 읽는 순서: horizontal(가로, 기본) 또는 vertical(전통 세로, 오른쪽 열부터)'),
  texture: z.boolean().optional().describe('인주 질감. 기본 false'),
  bleed: z.boolean().optional().describe('잉크 번짐. 기본 false'),
  rotation: z.number().min(-20).max(20).optional().describe('회전(도), -20~20. 기본 0'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('날짜 도장 날짜 YYYY-MM-DD. 기본 오늘(한국 시간)'),
  seal_center: z.enum(SEAL_CENTERS.map((c) => c.id)).optional()
    .describe(`가운데 원이 있는 둘레글자 도장(ring, ring-star, ring-scallop 등)의 가운데 글자: ${SEAL_CENTERS.map((c) => `${c.id}=${c.label}`).join(', ')}. 기본 daepyo-hanja. 영문 이름은 머리글자(star 는 별)`),
  date_label: z.string().max(12).optional().describe(`날짜 도장 문구. 예: ${DATE_LABELS.join(', ')}. 기본 한글 '확인' · 영문 'APPROVED'`),
};

function imageInput(label) {
  const fields = {
    url: z.string().url().optional().describe('공개된 https 이미지 주소'),
    data: z.string().optional().describe('base64 이미지 데이터 (data:image/...;base64, 로 시작해도 됨)'),
  };
  if (HTTP) fields.upload_id = z.string().optional().describe('create_upload_link 로 받은 업로드 ID (사용자가 링크에서 파일을 올린 뒤)');
  else fields.path = z.string().optional().describe('이 컴퓨터의 파일 경로 (예: ~/Desktop/계약서.jpg)');
  return z.object(fields).describe(`${label}. JPG·PNG·WebP, 15MB까지. ${HTTP ? 'upload_id·url·data' : 'path·url·data'} 중 하나만 주세요.`);
}

// ───────────── 입력 이미지 읽기 ─────────────

function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// 공개 인터넷 주소만 받는다 (서버 내부망·클라우드 메타데이터 주소로 요청을 보내게 하는 공격 막기)
const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) {
  blocked.addSubnet(a, p, 'ipv4');
}
for (const [a, p] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32], ['100::', 64]]) {
  blocked.addSubnet(a, p, 'ipv6');
}
function isPublicIp(ip) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPublicIp(mapped[1]);
  const family = net.isIP(ip);
  if (!family) return false;
  return !blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err);
    if (!addrs.length || addrs.some((a) => !isPublicIp(a.address))) return callback(new UserError('내부망 주소의 이미지는 받을 수 없어요.'));
    if (options.all) return callback(null, addrs);
    return callback(null, addrs[0].address, addrs[0].family);
  });
}

function fetchImage(raw, redirects = 3) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new UserError('이미지 주소가 올바르지 않아요.');
  }
  if (u.protocol !== 'https:' || u.username || u.password) throw new UserError('이미지 주소는 https:// 로 시작하는 공개 주소만 받아요.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicIp(host)) throw new UserError('내부망 주소의 이미지는 받을 수 없어요.');
  return new Promise((resolvePromise, reject) => {
    const req = https.get(u, { lookup: safeLookup, timeout: 15_000, headers: { 'User-Agent': `SuperDojang-MCP/${VERSION}`, Accept: 'image/*' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new UserError('이미지 주소가 너무 여러 번 다른 곳으로 넘겨요.'));
        try {
          return resolvePromise(fetchImage(new URL(res.headers.location, u).href, redirects - 1));
        } catch (err) {
          return reject(err);
        }
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new UserError(`이미지 주소가 ${res.statusCode} 응답을 줬어요.`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_INPUT_BYTES) req.destroy(new UserError('이미지가 15MB보다 커요.'));
        else chunks.push(c);
      });
      res.on('end', () => resolvePromise(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new UserError('이미지 주소가 응답하지 않아요.')));
    req.on('error', (err) => reject(err instanceof UserError ? err : new UserError(`이미지를 받지 못했어요 (${err.code ?? err.message}).`)));
  });
}

async function loadInput(src, label) {
  const keys = ['path', 'url', 'data', 'upload_id'].filter((k) => src?.[k]);
  if (keys.length !== 1) throw new UserError(`${label}: ${HTTP ? 'upload_id·url·data' : 'path·url·data'} 중 하나만 주세요.`);
  let buf;
  let fileName = label;
  if (src.path) {
    const p = resolve(src.path.replace(/^~(?=\/|$)/, homedir()));
    const st = await stat(p).catch(() => null);
    if (!st?.isFile()) throw new UserError(`${label} 파일을 찾지 못했어요: ${p}`);
    if (st.size > MAX_INPUT_BYTES) throw new UserError(`${label} 파일이 15MB보다 커요.`);
    buf = await readFile(p);
    fileName = basename(p, extname(p));
  } else if (src.data) {
    const m = /^data:[^,]*?(;base64)?,/.exec(src.data);
    buf = Buffer.from((m ? src.data.slice(m[0].length) : src.data).replace(/\s+/g, ''), 'base64');
    if (buf.length > MAX_INPUT_BYTES) throw new UserError(`${label} 이미지가 15MB보다 커요.`);
  } else if (src.url) {
    buf = await fetchImage(src.url);
  } else {
    const up = uploads.get(src.upload_id);
    if (!up?.buf) throw new UserError('업로드한 파일을 찾지 못했어요. 링크에서 파일을 올렸는지, 1시간이 지나지 않았는지 확인해 주세요.');
    buf = up.buf;
    fileName = up.name || label;
  }
  const mime = sniff(buf);
  if (!mime) throw new UserError(`${label}: JPG·PNG·WebP 이미지만 받을 수 있어요.`);
  return { data: buf.toString('base64'), mime, fileName };
}

// ───────────── 결과 파일 (로컬: 저장 / 원격: 다운로드 링크) ─────────────

class TempStore {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.items = new Map();
    this.bytes = 0;
    setInterval(() => this.sweep(), 60_000).unref();
  }

  put(id, entry) {
    this.delete(id);
    const size = entry.buf?.length ?? 0;
    // 공간이 모자라면 오래된 것부터 지운다
    for (const [old] of this.items) {
      if (this.bytes + size <= this.maxBytes) break;
      this.delete(old);
    }
    this.items.set(id, { ...entry, expires: Date.now() + FILE_TTL_MS });
    this.bytes += size;
  }

  get(id) {
    const e = this.items.get(id);
    if (!e) return null;
    if (e.expires < Date.now()) {
      this.delete(id);
      return null;
    }
    return e;
  }

  delete(id) {
    const e = this.items.get(id);
    if (!e) return;
    this.bytes -= e.buf?.length ?? 0;
    this.items.delete(id);
  }

  sweep() {
    const now = Date.now();
    for (const [id, e] of this.items) if (e.expires < now) this.delete(id);
  }
}

const downloads = new TempStore(400 * 1024 * 1024);
const uploads = new TempStore(300 * 1024 * 1024);
const newId = () => randomBytes(16).toString('base64url');

/** 같은 이름이 있으면 _2, _3 … 을 붙여 새 파일로 쓴다. 'wx' 로 열어 동시에 저장해도 서로 덮어쓰지 않는다 */
async function writeUnique(dir, fileName, buf) {
  const ext = extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let i = 1; ; i++) {
    const p = join(dir, i === 1 ? fileName : `${stem}_${i}${ext}`);
    try {
      await writeFile(p, buf, { flag: 'wx' });
      return p;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

/** @returns {Promise<string>} 사용자에게 보여 줄 위치 (저장 경로 또는 다운로드 주소) */
async function deliver(fileName, buf, mime) {
  if (HTTP) {
    const id = newId();
    downloads.put(id, { buf, mime, name: fileName });
    return `${PUBLIC_URL}/mcp/files/${id}/${encodeURIComponent(fileName)}`;
  }
  await mkdir(OUT_DIR, { recursive: true });
  return writeUnique(OUT_DIR, fileName, buf);
}

const whereLabel = HTTP ? '다운로드 (1시간 동안 유효)' : '저장한 파일';

// ───────────── 도구 응답 ─────────────

const text = (value) => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) });
const image = (data, mimeType = 'image/png') => ({ type: 'image', data, mimeType });
const kb = (b64) => `${Math.round((b64.length * 3) / 4 / 1024)}KB`;

function fallbackNote(fonts) {
  return fonts?.length ? `\n주의: 글꼴(${fonts.join(', ')})을 제때 받지 못해 대체 글꼴로 그렸어요. 다시 부르면 대개 정상으로 나옵니다.` : '';
}

/** 도구 처리 중 생긴 오류를 MCP 오류 응답으로 바꾼다. 입력 문제는 메시지를 그대로, 그 밖에는 일반 문구 */
function tool(fn) {
  return async (args) => {
    const started = Date.now();
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof UserError || err instanceof BusyError) return { isError: true, content: [text(err.message)] };
      console.error('[mcp] tool error:', err);
      return { isError: true, content: [text('서버에서 이미지를 만들다 오류가 났어요. 잠시 뒤에 다시 시도해 주세요.')] };
    } finally {
      if (HTTP) console.error(`[mcp] ${fn.name || 'tool'} ${Date.now() - started}ms`);
    }
  };
}

function signatureArgs(a) {
  return { name: a.name, lang: a.lang ?? 'auto', slant: a.slant ?? 0, weight: a.weight ?? 0, ink: inkOf(a.ink, INKS.black) };
}

function stampArgs(a) {
  return {
    name: a.name, lang: a.lang ?? 'auto', font: a.font, addIn: a.add_in ?? false, order: a.order ?? 'horizontal',
    texture: a.texture ?? false, bleed: a.bleed ?? false, rotation: a.rotation ?? 0, date: a.date, dateLabel: a.date_label ?? '',
    sealCenter: a.seal_center,
    ink: inkOf(a.ink, INKS.red),
  };
}

function outputArgs(a) {
  return { bg: backgroundOf(a.background), res: RESOLUTION[a.resolution ?? 'normal'] };
}

// ───────────── MCP 서버 ─────────────

const INSTRUCTIONS = `슈퍼도장: 이름으로 전자서명·도장 이미지를 만들고 문서 이미지에 넣는 도구입니다. 웹사이트 https://dojangfree.jihyeadminoffice.com 과 같은 엔진으로 그립니다.
권장 순서: preview_signatures / preview_stamps 로 후보 전체를 번호 붙은 한 장으로 보여 주고 → 사용자가 고른 번호의 id 로 create_signature / create_stamp 를 불러 PNG를 만듭니다. 후보 전체 PNG 묶음은 download_all.
종이에 쓴 서명 사진은 signature_from_photo, 획 좌표로 그린 서명은 draw_signature, 계약서 같은 문서 이미지에 서명·도장을 넣을 때는 place_on_document.
${HTTP ? '사용자의 사진·문서 파일은 create_upload_link 로 업로드 링크를 만들어 사용자에게 열게 한 뒤, 올렸다고 하면 upload_id 로 넘기세요. 결과 파일은 1시간 동안 받을 수 있는 다운로드 링크로 돌려줍니다.' : `결과 파일은 ${OUT_DIR} 에 저장하고 경로를 돌려줍니다. 입력 이미지는 파일 경로(path)로 줄 수 있습니다.`}
주의: 만든 서명·도장은 이미지일 뿐 등록 인감이나 공인 전자서명의 효력이 없습니다. 다른 사람 이름으로 도장을 만들어 문서에 넣으면 사문서 위조가 될 수 있으니, 본인 이름이 아닌 요청에는 이 점을 알려 주세요.`;

function buildServer() {
  const server = new McpServer({ name: 'super-dojang', title: '슈퍼도장', version: VERSION }, { instructions: INSTRUCTIONS });
  const readOnly = { readOnlyHint: true, openWorldHint: false };
  const creates = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool('list_styles', {
    title: '서명·도장 형태 목록',
    description: '만들 수 있는 서명 형태(한글·영문 각 24가지), 도장 모양·분류·글꼴, 잉크·배경 색, 날짜 도장 문구를 id와 함께 돌려줍니다.',
    inputSchema: { kind: z.enum(['signature', 'stamp', 'all']).optional().describe('signature·stamp·all(기본)') },
    annotations: readOnly,
  }, tool(async function list_styles({ kind = 'all' }) {
    const c = await renderer.call('catalog');
    const out = {};
    if (kind !== 'stamp') out.signatureStyles = c.signatureStyles;
    if (kind !== 'signature') {
      out.stampShapes = c.stampShapes;
      out.stampCategories = c.stampCategories;
      out.stampFonts = c.stampFonts;
      out.sealCenters = c.sealCenters;
      out.dateLabels = DATE_LABELS;
    }
    out.inks = { signature: ['black', 'navy', 'blue'], stamp: ['red', 'orange', 'black'], custom: '#RRGGBB' };
    out.backgrounds = ['transparent', 'white', 'cream', '#RRGGBB'];
    out.resolutions = { normal: '기본', high: '2.5배 (인쇄용)' };
    return { content: [text(out)] };
  }));

  server.registerTool('preview_signatures', {
    title: '서명 후보 미리보기',
    description: '이름으로 서명 후보 24가지를 만들어 번호를 붙인 한 장짜리 미리보기 이미지와 번호별 id 목록을 돌려줍니다. 사용자가 번호를 고르면 그 id로 create_signature 를 부르세요.',
    inputSchema: { name, lang, slant, weight, ink },
    annotations: readOnly,
  }, tool(async function preview_signatures(a) {
    const r = await renderer.call('sheet', 'signature', signatureArgs(a));
    const lines = r.items.map((it) => `${it.no}. ${it.label} — id: ${it.id} (${it.font})`);
    return { content: [image(r.png), text(`'${r.name}' 서명 후보 ${r.items.length}가지 (${r.lang === 'ko' ? '한글' : '영문'})\n${lines.join('\n')}${fallbackNote(r.fallbackFonts)}`)] };
  }));

  server.registerTool('create_signature', {
    title: '서명 만들기',
    description: '이름과 서명 형태 id로 배경이 투명한(또는 고른 배경색) 서명 PNG를 만듭니다. style 을 생략하면 첫 번째 형태.',
    inputSchema: { name, style: z.string().optional().describe('서명 형태 id (preview_signatures·list_styles 참고). 예: ko-brush-swoosh, en-vibes'), lang, slant, weight, ink, background, resolution },
    annotations: creates,
  }, tool(async function create_signature(a) {
    const r = await renderer.call('render', 'signature', { ...signatureArgs(a), ...outputArgs(a), styles: a.style ? [a.style] : undefined });
    const it = r.items[0];
    const where = await deliver(buildFileName('signature', r.name), Buffer.from(it.png, 'base64'), 'image/png');
    return { content: [image(it.png), text(`서명: ${r.name} · ${it.label} (${it.id}, ${it.font}) · ${it.width}×${it.height}px · ${kb(it.png)}\n${whereLabel}: ${where}${fallbackNote(r.fallbackFonts)}`)] };
  }));

  server.registerTool('preview_stamps', {
    title: '도장 후보 미리보기',
    description: '이름으로 도장 후보 전체(또는 한 분류)를 번호 붙인 한 장짜리 미리보기 이미지와 번호별 id 목록으로 돌려줍니다. 사용자가 번호를 고르면 그 id로 create_stamp 를 부르세요.',
    inputSchema: { name, lang, category: z.string().optional().describe('도장 분류 id (list_styles 의 stampCategories). 생략하면 전체'), ...stampOptions, ink },
    annotations: readOnly,
  }, tool(async function preview_stamps(a) {
    const r = await renderer.call('sheet', 'stamp', { ...stampArgs(a), category: a.category });
    const lines = r.items.map((it) => `${it.no}. ${it.label} — id: ${it.id} (${it.font})`);
    return { content: [image(r.png), text(`'${r.name}' 도장 후보 ${r.items.length}가지 (${r.lang === 'ko' ? '한글' : '영문'})\n${lines.join('\n')}${fallbackNote(r.fallbackFonts)}`)] };
  }));

  server.registerTool('create_stamp', {
    title: '도장 만들기',
    description: '이름과 도장 모양 id로 도장 PNG를 만듭니다. 인주 질감·번짐·회전·날짜 도장 문구도 고를 수 있습니다. shape 를 생략하면 원형.',
    inputSchema: { name, shape: z.string().optional().describe('도장 모양 id (preview_stamps·list_styles 참고). 예: circle, square-double, date'), lang, ...stampOptions, ink, background, resolution },
    annotations: creates,
  }, tool(async function create_stamp(a) {
    const r = await renderer.call('render', 'stamp', { ...stampArgs(a), ...outputArgs(a), shapes: [a.shape ?? 'circle'] });
    const it = r.items[0];
    const where = await deliver(buildFileName('stamp', r.name), Buffer.from(it.png, 'base64'), 'image/png');
    return { content: [image(it.png), text(`도장: ${r.name} · ${it.label} (${it.id}, ${it.font}) · ${it.width}×${it.height}px · ${kb(it.png)}\n${whereLabel}: ${where}${fallbackNote(r.fallbackFonts)}`)] };
  }));

  server.registerTool('download_all', {
    title: '후보 전체 ZIP',
    description: '서명 또는 도장 후보 전체를 PNG로 만들어 ZIP 한 파일로 돌려줍니다 (사이트의 \'전체 ZIP\'과 같음).',
    inputSchema: {
      kind: z.enum(['signature', 'stamp']).describe('signature 또는 stamp'),
      name, lang, slant, weight,
      category: z.string().optional().describe('도장 분류 id. 생략하면 전체'),
      ...stampOptions, ink, background, resolution,
    },
    annotations: creates,
  }, tool(async function download_all(a) {
    const base = a.kind === 'signature' ? signatureArgs(a) : { ...stampArgs(a), category: a.category };
    const r = await renderer.call('render', a.kind, { ...base, ...outputArgs(a) });
    const names = uniqueNames(r.items.map((it, i) => `${String(i + 1).padStart(2, '0')}_${sanitizeFilePart(`${it.label}_${it.font}`)}.png`));
    const zip = Buffer.from(createZip(r.items.map((it, i) => ({ name: names[i], data: Buffer.from(it.png, 'base64') }))));
    const label = a.kind === 'signature' ? '서명' : '도장';
    const where = await deliver(`${label}_전체_${sanitizeFilePart(r.name)}_${formatDate(new Date())}.zip`, zip, 'application/zip');
    return { content: [text(`${label} 후보 ${r.items.length}장 ZIP (${Math.round(zip.length / 1024)}KB)\n${whereLabel}: ${where}${fallbackNote(r.fallbackFonts)}`)] };
  }));

  server.registerTool('signature_from_photo', {
    title: '사진에서 서명 가져오기',
    description: '종이에 쓴 서명을 찍은 사진에서 배경을 지워 투명 서명 PNG로 만듭니다. 밝은 곳에서 흰 종이에 찍은 사진이 좋습니다.',
    inputSchema: {
      image: imageInput('서명 사진'),
      strength: z.number().min(-60).max(60).optional().describe('배경 제거 세기 -60~60. 배경이 남으면 올리고, 획이 끊기면 내리세요. 기본 0'),
      keep_color: z.boolean().optional().describe('사진 속 원래 잉크 색 유지. 기본 false (ink 색으로 칠함)'),
      ink, background, resolution,
    },
    annotations: { ...creates, openWorldHint: true },
  }, tool(async function signature_from_photo(a) {
    const input = await loadInput(a.image, '서명 사진');
    const r = await renderer.call('photo', { data: input.data, mime: input.mime, strength: a.strength ?? 0, keepColor: a.keep_color ?? false, ink: inkOf(a.ink, INKS.black), ...outputArgs(a) });
    const where = await deliver(buildFileName('drawing', '사진'), Buffer.from(r.png, 'base64'), 'image/png');
    return { content: [image(r.png), text(`사진 서명 · ${r.width}×${r.height}px · ${kb(r.png)}\n${whereLabel}: ${where}`)] };
  }));

  server.registerTool('draw_signature', {
    title: '획으로 서명 그리기',
    description: '획 좌표로 손글씨 서명을 그립니다 (사이트의 \'직접 서명\' 패드와 같은 펜). 좌표 단위는 자유이며 전체를 맞춰 그립니다. y는 아래로 갈수록 커집니다.',
    inputSchema: {
      strokes: z.array(z.array(z.array(z.number()).min(2).max(3)).min(1).max(4000)).min(1).max(200)
        .describe('획 목록. 각 획은 점 [x, y] 또는 [x, y, 굵기배율] 의 배열. 예: [[[0,0],[10,20],[20,0]], [[30,5],[45,5]]]'),
      pen_width: z.number().min(1.5).max(9).optional().describe('펜 굵기 1.5~9. 기본 3.5'),
      ink, background, resolution,
    },
    annotations: creates,
  }, tool(async function draw_signature(a) {
    if (a.strokes.reduce((s, st) => s + st.length, 0) > 20_000) throw new UserError('점이 너무 많아요 (2만 개까지).');
    const r = await renderer.call('drawn', { strokes: a.strokes, penWidth: a.pen_width ?? 3.5, ink: inkOf(a.ink, INKS.black), ...outputArgs(a) });
    const where = await deliver(buildFileName('drawing', ''), Buffer.from(r.png, 'base64'), 'image/png');
    return { content: [image(r.png), text(`직접 서명 · ${r.width}×${r.height}px · ${kb(r.png)}\n${whereLabel}: ${where}`)] };
  }));

  const placement = z.object({
    kind: z.enum(['signature', 'stamp', 'image']).describe('signature(이름으로 서명), stamp(이름으로 도장), image(이미 있는 서명·도장 이미지)'),
    name: z.string().max(1000).optional().describe('signature·stamp 일 때 이름'),
    style: z.string().optional().describe('signature 형태 id'),
    shape: z.string().optional().describe('stamp 모양 id. 기본 circle'),
    lang, ink, slant, weight, ...stampOptions,
    image: imageInput('넣을 이미지').optional().describe('kind 가 image 일 때 넣을 투명 PNG 등'),
    x: z.number().min(0).max(1).describe('가운데 위치: 문서 폭 대비 비율 (0=왼쪽 끝, 1=오른쪽 끝)'),
    y: z.number().min(0).max(1).describe('가운데 위치: 문서 높이 대비 비율 (0=맨 위, 1=맨 아래)'),
    width: z.number().min(0.04).max(1).optional().describe('폭: 문서 폭 대비 비율. 기본 서명 0.3, 도장 0.16'),
  });

  server.registerTool('place_on_document', {
    title: '문서에 서명·도장 넣기',
    description: '계약서 같은 문서 이미지(JPG·PNG·WebP)에 서명·도장을 원하는 위치·크기로 넣어 한 장으로 저장합니다. 문서는 긴 변 4000px까지 원본 해상도를 유지합니다. 서명란 위치를 모르면 먼저 문서를 보고 x·y 비율을 정하세요.',
    inputSchema: {
      document: imageInput('문서 이미지'),
      items: z.array(placement).min(1).max(20).describe('넣을 서명·도장 목록 (뒤에 있는 것이 위에 그려짐)'),
      multiply: z.boolean().optional().describe('종이에 스며들게 합성(곱하기). 기본 true'),
    },
    annotations: { ...creates, openWorldHint: true },
  }, tool(async function place_on_document(a) {
    const doc = await loadInput(a.document, '문서 이미지');
    const items = [];
    for (const it of a.items) {
      if (it.kind === 'image') {
        if (!it.image) throw new UserError("kind 가 image 이면 image 를 주세요.");
        const img = await loadInput(it.image, '넣을 이미지');
        items.push({ kind: 'image', data: img.data, mime: img.mime, x: it.x, y: it.y, width: it.width });
      } else {
        if (!it.name) throw new UserError(`${it.kind === 'stamp' ? '도장' : '서명'}에 넣을 이름(name)을 주세요.`);
        const base = it.kind === 'stamp' ? { ...stampArgs(it), shape: it.shape ?? 'circle' } : { ...signatureArgs(it), style: it.style };
        items.push({ kind: it.kind, ...base, x: it.x, y: it.y, width: it.width });
      }
    }
    const r = await renderer.call('compose', { data: doc.data, mime: doc.mime, items, multiply: a.multiply ?? true });
    const ext = r.mime === 'image/jpeg' ? 'jpg' : 'png';
    const where = await deliver(`${sanitizeFilePart(doc.fileName) || '문서'}_서명완료_${formatDate(new Date())}.${ext}`, Buffer.from(r.data, 'base64'), r.mime);
    const placed = r.placed.map((p, i) => `${i + 1}. ${p.kind} — 위치 (${p.x}, ${p.y}) 크기 ${p.width}×${p.height}px`).join('\n');
    return { content: [image(r.preview, 'image/jpeg'), text(`완성 문서 ${r.width}×${r.height}px (미리보기는 줄인 이미지)\n${placed}\n${whereLabel}: ${where}${fallbackNote(r.fallbackFonts)}`)] };
  }));

  if (HTTP) {
    server.registerTool('create_upload_link', {
      title: '파일 업로드 링크 만들기',
      description: '사용자가 서명 사진이나 문서 이미지를 올릴 수 있는 웹 링크를 만듭니다. 링크를 사용자에게 주고, 올렸다고 하면 돌려받은 upload_id 를 signature_from_photo·place_on_document 의 image/document 에 { "upload_id": ... } 로 넘기세요. 1시간 동안 유효.',
      inputSchema: { purpose: z.enum(['document', 'photo', 'image']).optional().describe('document(문서), photo(서명 사진), image(넣을 서명·도장 이미지). 안내 문구에만 씀') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, tool(async function create_upload_link({ purpose = 'document' }) {
      const id = newId();
      uploads.put(id, { buf: null, name: '', purpose });
      return { content: [text({ upload_id: id, url: `${PUBLIC_URL}/mcp/upload/${id}`, expires_in: '1시간', next: '사용자에게 url 을 열어 파일을 올리게 한 뒤, 올렸다고 하면 upload_id 로 다른 도구를 부르세요.' })] };
    }));
  }
  return server;
}

// ───────────── 원격 HTTP ─────────────

class RateLimiter {
  constructor(capacity, perSecond) {
    this.capacity = capacity;
    this.perSecond = perSecond;
    this.buckets = new Map();
    setInterval(() => {
      const now = Date.now();
      for (const [k, b] of this.buckets) if (now - b.t > 3_600_000) this.buckets.delete(k);
    }, 600_000).unref();
  }

  take(key) {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, t: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.t) / 1000) * this.perSecond);
    b.t = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

const mcpLimiter = new RateLimiter(60, 0.1); // 순간 60회, 이후 10초에 1회 (시간당 약 360회)
const uploadLimiter = new RateLimiter(10, 1 / 60);

function clientIp(req) {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  return (local && req.headers['cf-connecting-ip']) || req.socket.remoteAddress || 'unknown';
}

function readBody(req, limit) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (tooBig) {
        // 연결을 바로 끊으면 클라이언트는 413 대신 연결 오류만 본다. 413 을 돌려줄 때까지 나머지는 버리며 받고, 한도의 2배를 넘으면 끊는다
        if (size > limit * 2) req.destroy();
      } else if (size > limit) {
        tooBig = true;
        chunks.length = 0;
        reject(Object.assign(new Error('too large'), { status: 413 }));
      } else chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }).end(JSON.stringify(body));
}

const rpcError = (code, message) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

function uploadPage(id, purpose) {
  const nonce = randomBytes(16).toString('base64');
  const what = { document: '서명·도장을 넣을 문서 이미지', photo: '종이에 쓴 서명 사진', image: '넣을 서명·도장 이미지' }[purpose] ?? '이미지';
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>슈퍼도장 파일 올리기</title><style nonce="${nonce}">
body{margin:0;font:16px/1.6 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;background:#faf7f2;color:#3d2f22}
main{max-width:520px;margin:0 auto;padding:40px 20px}h1{font-size:22px;margin:0 0 8px}p{margin:0 0 16px}
label{display:block;border:2px dashed #c9b59c;border-radius:14px;padding:36px 16px;text-align:center;background:#fff;cursor:pointer;font-weight:700}
input{display:none}#msg{margin-top:16px;font-weight:700}.ok{color:#2f7d32}.err{color:#c62828}small{color:#8a7158}
</style></head><body><main><h1>슈퍼도장 파일 올리기</h1><p>${what}를 골라 주세요. JPG·PNG·WebP, 15MB까지.</p>
<label>파일 고르기<input id="f" type="file" accept="image/jpeg,image/png,image/webp"></label><p id="msg" role="status"></p>
<small>올린 파일은 서명·도장을 넣는 데만 쓰고 1시간 뒤 자동으로 지워집니다.</small></main>
<script nonce="${nonce}">
const f=document.getElementById('f'),m=document.getElementById('msg');
f.addEventListener('change',async()=>{const file=f.files[0];if(!file)return;m.className='';m.textContent='올리는 중…';
try{const r=await fetch(location.pathname,{method:'PUT',body:file,headers:{'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name)}});
const j=await r.json();if(!r.ok)throw new Error(j.error||'실패');m.className='ok';m.textContent='올렸어요. 대화창으로 돌아가 "올렸어"라고 말해 주세요.';}
catch(e){m.className='err';m.textContent='올리지 못했어요: '+e.message;}});
</script></body></html>`;
  return {
    html,
    csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
}

async function handle(req, res, allowedHosts) {
  const url = new URL(req.url, 'http://localhost');
  // DNS 리바인딩 막기: 알려진 호스트 이름으로 들어온 요청만 받는다
  if (!allowedHosts.has((req.headers.host ?? '').toLowerCase())) return sendJson(res, 421, { error: 'misdirected request' });

  if (url.pathname === '/mcp') {
    if (req.method !== 'POST') return sendJson(res, 405, rpcError(-32000, 'POST 만 받습니다 (stateless Streamable HTTP).'), { Allow: 'POST' });
    if (!mcpLimiter.take(clientIp(req))) return sendJson(res, 429, rpcError(-32000, '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.'), { 'Retry-After': '30' });
    let body;
    try {
      body = JSON.parse((await readBody(req, MAX_BODY_BYTES)).toString('utf8'));
    } catch (err) {
      return sendJson(res, err.status ?? 400, rpcError(err.status ? -32000 : -32700, err.status ? '요청이 너무 커요.' : 'JSON 이 올바르지 않아요.'));
    }
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return;
  }

  if (url.pathname === '/mcp/health') return sendJson(res, 200, { ok: true, version: VERSION });

  const file = /^\/mcp\/files\/([\w-]{22})\/[^/]+$/.exec(url.pathname);
  if (file && req.method === 'GET') {
    const e = downloads.get(file[1]);
    if (!e) return sendJson(res, 404, { error: '파일이 없거나 1시간이 지나 지워졌어요.' });
    res.writeHead(200, {
      'Content-Type': e.mime,
      'Content-Length': e.buf.length,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(e.name)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }).end(e.buf);
    return;
  }

  const up = /^\/mcp\/upload\/([\w-]{22})$/.exec(url.pathname);
  if (up) {
    const slot = uploads.get(up[1]);
    if (!slot) return sendJson(res, 404, { error: '업로드 링크가 없거나 1시간이 지났어요. 대화창에서 새 링크를 요청해 주세요.' });
    if (req.method === 'GET') {
      const page = uploadPage(up[1], slot.purpose);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': page.csp, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }).end(page.html);
      return;
    }
    if (req.method === 'PUT') {
      if (!uploadLimiter.take(clientIp(req))) return sendJson(res, 429, { error: '업로드가 너무 많아요. 잠시 뒤에 다시 시도해 주세요.' });
      let buf;
      try {
        buf = await readBody(req, MAX_INPUT_BYTES);
      } catch {
        return sendJson(res, 413, { error: '15MB보다 큰 파일은 올릴 수 없어요.' });
      }
      if (!sniff(buf)) return sendJson(res, 415, { error: 'JPG·PNG·WebP 이미지만 올릴 수 있어요.' });
      let fileName = '';
      try {
        fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? '')).replace(/\.[^.]+$/, '');
      } catch { /* 이름이 깨져 있으면 이름 없이 저장 */ }
      uploads.put(up[1], { buf, name: sanitizeFilePart(fileName), purpose: slot.purpose });
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'GET, PUT' });
  }

  return sendJson(res, 404, { error: 'not found' });
}

// ───────────── 시작 ─────────────

async function shutdown() {
  await renderer.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (HTTP) {
  const publicHost = new URL(PUBLIC_URL).host.toLowerCase();
  const allowedHosts = new Set([publicHost, `127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  createServer((req, res) => {
    handle(req, res, allowedHosts).catch((err) => {
      console.error('[mcp] request error:', err);
      if (!res.headersSent) sendJson(res, 500, rpcError(-32603, '서버 오류'));
    });
  }).listen(PORT, '127.0.0.1', () => console.error(`슈퍼도장 MCP: http://127.0.0.1:${PORT}/mcp (공개 주소 ${PUBLIC_URL}/mcp)`));
} else {
  const server = buildServer();
  const transport = new StdioServerTransport();
  transport.onclose = shutdown;
  await server.connect(transport);
  console.error(`슈퍼도장 MCP (stdio) 시작. 결과 저장 위치: ${OUT_DIR}`);
}
