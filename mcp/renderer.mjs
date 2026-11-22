// 헤드리스 Chrome 하나를 띄워 두고 mcp/render.js 의 함수를 부른다.
// 페이지는 가짜 주소(https://dojang.render)로 열고 저장소 파일을 직접 돌려준다. 외부로는 Google Fonts 만 나간다.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ORIGIN = 'https://dojang.render';
const PAGE_URL = `${ORIGIN}/mcp/render.html`;
const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const SERVABLE = /^(js\/.+\.js|mcp\/render\.js)$/;
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' };

export class UserError extends Error {}
export class BusyError extends Error {}

async function pageHtml() {
  // 글꼴 링크는 index.html 의 것을 그대로 쓴다 (글꼴 목록을 바꿔도 따로 고칠 곳이 없게)
  const index = await readFile(join(ROOT, 'index.html'), 'utf8');
  const link = index.match(/<link id="font-css"[^>]*>/)?.[0];
  if (!link) throw new Error('index.html 에서 글꼴 링크를 찾지 못했습니다');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">${link}</head><body><script type="module" src="/mcp/render.js"></script></body></html>`;
}

export class Renderer {
  /**
   * @param {object} [o]
   * @param {number} [o.pages] 동시에 그릴 페이지 수
   * @param {number} [o.queueLimit] 기다릴 수 있는 요청 수. 넘으면 BusyError
   * @param {number} [o.timeoutMs] 한 번 부를 때 최대 시간
   */
  constructor({ pages = 2, queueLimit = 16, timeoutMs = 90_000 } = {}) {
    this.size = pages;
    this.queueLimit = queueLimit;
    this.timeoutMs = timeoutMs;
    this.idle = [];
    this.waiting = [];
    this.starting = null;
    this.browser = null;
    this.context = null;
  }

  async #start() {
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.DOJANG_CHROME ? { executablePath: process.env.DOJANG_CHROME } : { channel: 'chrome' }),
    });
    const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', deviceScaleFactor: 1 });
    const html = await pageHtml();
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (FONT_HOSTS.test(url)) return route.continue();
      if (!url.startsWith(`${ORIGIN}/`)) return route.abort('blockedbyclient');
      const path = decodeURIComponent(new URL(url).pathname).slice(1);
      if (path === 'mcp/render.html') return route.fulfill({ status: 200, contentType: TYPES['.html'], body: html });
      const file = normalize(join(ROOT, path));
      const rel = relative(ROOT, file);
      if (!SERVABLE.test(rel.split('\\').join('/')) || rel.startsWith('..') || isAbsolute(rel)) return route.fulfill({ status: 404, body: '' });
      try {
        return route.fulfill({ status: 200, contentType: TYPES[extname(file)], body: await readFile(file) });
      } catch {
        return route.fulfill({ status: 404, body: '' });
      }
    });
    browser.on('disconnected', () => {
      if (this.browser === browser) this.#reset();
    });
    this.browser = browser;
    this.context = context;
    for (let i = 0; i < this.size; i++) this.idle.push(await this.#newPage());
  }

  async #newPage() {
    const page = await this.context.newPage();
    page.on('pageerror', (err) => console.error('[render] page error:', err.message));
    await page.goto(PAGE_URL);
    await page.waitForFunction(() => window.dojangReady === true, null, { timeout: 30_000 });
    return page;
  }

  #reset() {
    this.browser = null;
    this.context = null;
    this.idle = [];
    this.starting = null;
  }

  #ready() {
    this.starting ??= this.#start().catch((err) => {
      this.#reset();
      throw err;
    });
    return this.starting;
  }

  async #acquire() {
    await this.#ready();
    const page = this.idle.pop();
    if (page) return page;
    if (this.waiting.length >= this.queueLimit) throw new BusyError('지금 요청이 많아요. 잠시 뒤에 다시 시도해 주세요.');
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  #release(page) {
    const next = this.waiting.shift();
    if (next) next.resolve(page);
    else this.idle.push(page);
  }

  /** render.js 의 함수를 부른다. 입력 문제는 UserError 로 던진다 */
  async call(fn, ...args) {
    let page = await this.#acquire();
    let timer;
    try {
      const result = await Promise.race([
        page.evaluate(([f, a]) => window.dojang.call(f, a), [fn, args]),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs); }),
      ]);
      if (!result.ok) throw result.user ? new UserError(result.message) : new Error(result.message);
      return result.value;
    } catch (err) {
      // 멈추거나 죽은 페이지는 버리고 새로 연다
      if (!(err instanceof UserError) && this.context) {
        await page.close().catch(() => {});
        page = await this.#newPage().catch(() => null);
      }
      if (err.message === 'timeout') throw new UserError('그리는 데 시간이 너무 오래 걸려 멈췄어요. 이미지를 줄이거나 다시 시도해 주세요.');
      throw err;
    } finally {
      clearTimeout(timer);
      if (page && this.context) this.#release(page);
      else {
        // 브라우저가 죽었으면 기다리던 요청을 새 브라우저로 넘긴다
        const next = this.waiting.shift();
        if (next) this.#acquire().then(next.resolve, next.reject);
      }
    }
  }

  async close() {
    const b = this.browser;
    this.#reset();
    await b?.close().catch(() => {});
  }
}
